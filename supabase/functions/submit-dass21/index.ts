// submit-dass21 — public endpoint called by the survey page.
// 1. Validates input and re-scores server-side (the client's numbers are never trusted).
// 2. Saves the response with the service role (table has RLS on, no public access).
// 3. Builds the PDF here, so the email attachment can't be swapped for arbitrary content.
// 4. Sends via AgentMail twice: respondent, then owner. Key comes ONLY from the
//    AGENTMAIL_API_KEY secret. Email failure never loses the saved response.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@4";
import { isValidAnswers, scoreDass, SCALE_KEYS } from "./dass.ts";
import { buildEmail, buildPdf, pdfFilename } from "./report.ts";

const INBOX = Deno.env.get("AGENTMAIL_INBOX") ?? "satu-muse@agentmail.to";
const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL") ?? "sheraj.hussein@gmail.com";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PER_EMAIL_PER_HOUR = 3;
const GLOBAL_PER_10_MIN = 60;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes("*") ? "*" : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-control-regex
function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

async function sendMail(apiKey: string, to: string, mail: { subject: string; text: string; html: string }, pdf: { filename: string; b64: string }) {
  const resp = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(INBOX)}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [
        {
          filename: pdf.filename,
          content_type: "application/pdf",
          content_disposition: "attachment",
          content: pdf.b64,
        },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 300);
    throw new Error(`AgentMail ${resp.status}: ${detail}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  // ---- Parse + validate --------------------------------------------------
  const rawBody = await req.text();
  if (rawBody.length > 5000) return json(req, 413, { error: "Request too large" });
  let body: { name?: unknown; email?: unknown; consent?: unknown; answers?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json(req, 400, { error: "Invalid JSON" });
  }
  const name = typeof body.name === "string" ? cleanName(body.name) : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (name.length < 2 || name.length > 100) return json(req, 400, { error: "Please enter your full name." });
  if (email.length > 254 || !EMAIL_RE.test(email)) return json(req, 400, { error: "Please enter a valid email address." });
  if (body.consent !== true) return json(req, 400, { error: "Consent is required." });
  if (!isValidAnswers(body.answers)) return json(req, 400, { error: "All 21 statements must be answered (0-3)." });
  const answers = body.answers;
  const result = scoreDass(answers);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // ---- Rate limit (stops the endpoint being used to spam an address) ------
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const tenMinAgo = new Date(Date.now() - 600_000).toISOString();
  const [perEmail, global] = await Promise.all([
    supabase.from("dass21_responses").select("id", { count: "exact", head: true }).ilike("email", email.replace(/[%_\\]/g, "\\$&")).gte("created_at", hourAgo),
    supabase.from("dass21_responses").select("id", { count: "exact", head: true }).gte("created_at", tenMinAgo),
  ]);
  if ((perEmail.count ?? 0) >= PER_EMAIL_PER_HOUR || (global.count ?? 0) >= GLOBAL_PER_10_MIN) {
    return json(req, 429, { error: "Too many submissions. Please try again later." });
  }

  // ---- Save --------------------------------------------------------------
  const s = result.scales;
  const { data: row, error: insertErr } = await supabase
    .from("dass21_responses")
    .insert({
      name,
      email,
      consent: true,
      answers,
      depression_score: s.depression.score,
      anxiety_score: s.anxiety.score,
      stress_score: s.stress.score,
      depression_severity: s.depression.severity,
      anxiety_severity: s.anxiety.severity,
      stress_severity: s.stress.severity,
      email_status: "pending",
    })
    .select("id, created_at")
    .single();
  if (insertErr || !row) {
    console.error("insert failed", insertErr);
    return json(req, 500, { saved: false, error: "Could not save response." });
  }

  const scores = Object.fromEntries(SCALE_KEYS.map((k) => [k, { score: s[k].score, severity: s[k].severity }]));
  const setStatus = (email_status: string, email_error: string | null = null) =>
    supabase.from("dass21_responses").update({ email_status, email_error }).eq("id", row.id);

  // ---- Email -------------------------------------------------------------
  const apiKey = Deno.env.get("AGENTMAIL_API_KEY");
  if (!apiKey) {
    await setStatus("missing-key", "AGENTMAIL_API_KEY secret is not set");
    return json(req, 200, { saved: true, id: row.id, email_status: "missing-key", respondent_sent: false, scores });
  }

  let respondentSent = false;
  let ownerSent = false;
  const errors: string[] = [];
  try {
    const date = new Date(row.created_at);
    const input = { name, email, date, result };
    const doc = buildPdf(jsPDF, input);
    const pdf = { filename: pdfFilename(name, date), b64: encodeBase64(new Uint8Array(doc.output("arraybuffer"))) };
    const mail = buildEmail(input);

    try {
      await sendMail(apiKey, email, mail, pdf);
      respondentSent = true;
    } catch (e) {
      errors.push(`respondent: ${(e as Error).message}`);
    }
    try {
      await sendMail(apiKey, OWNER_EMAIL, mail, pdf);
      ownerSent = true;
    } catch (e) {
      errors.push(`owner: ${(e as Error).message}`);
    }
  } catch (e) {
    errors.push(`build: ${(e as Error).message}`);
  }

  const status =
    respondentSent && ownerSent ? "sent"
    : ownerSent ? "partial-respondent-failed"
    : respondentSent ? "partial-owner-failed"
    : "failed";
  await setStatus(status, errors.length ? errors.join(" | ").slice(0, 1000) : null);
  if (errors.length) console.error("email errors", errors);

  return json(req, 200, { saved: true, id: row.id, email_status: status, respondent_sent: respondentSent, scores });
});
