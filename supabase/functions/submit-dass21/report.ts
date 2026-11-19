// Shared report builders: PDF (jsPDF) and email (text + HTML).
// The jsPDF constructor is passed in so the same code runs in the browser
// (npm "jspdf") and in the Edge Function (npm:jspdf).
import {
  analyseScale,
  DISCLAIMER,
  HELP_RESOURCES,
  overallSummary,
  SCALE_KEYS,
  type DassResult,
} from "./dass.ts";

export interface ReportInput {
  name: string;
  email: string;
  date: Date;
  result: DassResult;
}

export function formatDate(d: Date): string {
  return d.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// deno-lint-ignore no-explicit-any
type JsPDFCtor = new (opts?: any) => any;

export function buildPdf(JsPDF: JsPDFCtor, input: ReportInput) {
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 50;
  const CW = W - M * 2;
  let y = M;

  const ensure = (h: number) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const para = (text: string, size = 10.5, style: "normal" | "bold" = "normal", color = [40, 48, 60]) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(text, CW);
    const lh = size * 1.4;
    for (const line of lines) {
      ensure(lh);
      doc.text(line, M, y + size);
      y += lh;
    }
  };
  const bullet = (text: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(40, 48, 60);
    const lines = doc.splitTextToSize(text, CW - 14);
    const lh = 10.5 * 1.4;
    lines.forEach((line: string, i: number) => {
      ensure(lh);
      if (i === 0) doc.text("•", M + 2, y + 10.5);
      doc.text(line, M + 14, y + 10.5);
      y += lh;
    });
  };
  const gap = (h: number) => (y += h);

  // Header
  doc.setFillColor(47, 111, 115);
  doc.rect(0, 0, W, 6, "F");
  para("DASS-21 Results", 22, "bold", [24, 39, 52]);
  gap(4);
  para(`Name: ${input.name}`);
  para(`Email: ${input.email}`);
  para(`Date: ${formatDate(input.date)}`);
  gap(12);

  // Score table with bars
  para("Your scores (out of 42)", 13, "bold", [24, 39, 52]);
  gap(6);
  for (const k of SCALE_KEYS) {
    const s = input.result.scales[k];
    ensure(34);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(24, 39, 52);
    doc.text(s.name, M, y + 11);
    doc.setFont("helvetica", "normal");
    doc.text(`${s.score} / 42  ·  ${s.severity}`, M + CW, y + 11, { align: "right" });
    y += 17;
    doc.setFillColor(228, 234, 236);
    doc.roundedRect(M, y, CW, 8, 4, 4, "F");
    const fill = [[95, 160, 130], [205, 170, 60], [222, 135, 60], [205, 90, 70], [165, 55, 70]][s.level];
    doc.setFillColor(fill[0], fill[1], fill[2]);
    const w = Math.max(8, (s.score / 42) * CW);
    if (s.score > 0) doc.roundedRect(M, y, w, 8, 4, 4, "F");
    y += 20;
  }
  gap(6);

  // Per-scale analysis
  for (const k of SCALE_KEYS) {
    const s = input.result.scales[k];
    const a = analyseScale(s);
    ensure(60);
    para(`${s.name}: ${s.severity} (${s.score}/42)`, 13, "bold", [24, 39, 52]);
    gap(2);
    para(a.meaning);
    gap(3);
    para(a.levelText);
    if (a.suggestions.length) {
      gap(4);
      para("Things that may help:", 10.5, "bold");
      a.suggestions.forEach(bullet);
    }
    gap(12);
  }

  ensure(60);
  para("Overall summary", 13, "bold", [24, 39, 52]);
  gap(2);
  para(overallSummary(input.result));
  gap(14);

  // Disclaimer box
  const dLines = doc.splitTextToSize(DISCLAIMER, CW - 24);
  const boxH = dLines.length * 15 + 34;
  ensure(boxH);
  doc.setFillColor(243, 246, 247);
  doc.setDrawColor(200, 210, 214);
  doc.roundedRect(M, y, CW, boxH, 6, 6, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(24, 39, 52);
  doc.text("Important", M + 12, y + 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(40, 48, 60);
  dLines.forEach((l: string, i: number) => doc.text(l, M + 12, y + 38 + i * 15));
  y += boxH + 14;

  ensure(90);
  para("Help in Singapore", 13, "bold", [24, 39, 52]);
  gap(2);
  HELP_RESOURCES.forEach((r) => bullet(`${r.name}: ${r.detail}`));

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(120, 130, 140);
    doc.text("DASS-21 Survey · Screening tool only, not a diagnosis", M, H - 24);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 24, { align: "right" });
  }
  return doc;
}

export function pdfFilename(name: string, date: Date): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "report";
  const d = date.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  return `DASS-21-Results-${slug}-${d}.pdf`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function emailSubject(name: string): string {
  return `Your DASS-21 Results - ${name}`;
}

export function buildEmail(input: ReportInput): { subject: string; text: string; html: string } {
  const { name, result } = input;
  const subject = emailSubject(name);
  const summary = overallSummary(result);

  // Plain text
  const t: string[] = [];
  t.push(`Hi ${name},`, "");
  t.push(`Thank you for completing the DASS-21 on ${formatDate(input.date)}. Here is a summary of your results. Your full report is attached as a PDF.`, "");
  t.push("YOUR SCORES (out of 42)");
  for (const k of SCALE_KEYS) {
    const s = result.scales[k];
    t.push(`- ${s.name}: ${s.score} (${s.severity})`);
  }
  t.push("");
  for (const k of SCALE_KEYS) {
    const s = result.scales[k];
    const a = analyseScale(s);
    t.push(`${s.name.toUpperCase()}: ${s.severity}`, a.levelText);
    if (a.suggestions.length) {
      t.push("Things that may help:");
      a.suggestions.forEach((x) => t.push(`  * ${x}`));
    }
    t.push("");
  }
  t.push("OVERALL SUMMARY", summary, "");
  t.push("IMPORTANT", DISCLAIMER, "");
  t.push("HELP IN SINGAPORE");
  HELP_RESOURCES.forEach((r) => t.push(`- ${r.name}: ${r.detail}`));
  t.push("", "Take care,", "DASS-21 Survey");
  const text = t.join("\n");

  // HTML
  const e = escapeHtml;
  const colors = ["#3f8f6b", "#b48a1c", "#c46a22", "#b9473a", "#8f2f43"];
  const rows = SCALE_KEYS.map((k) => {
    const s = result.scales[k];
    const pct = Math.round((s.score / 42) * 100);
    return `<tr><td style="padding:8px 0;font-weight:600;width:110px">${s.name}</td>
<td style="padding:8px 8px"><div style="background:#e4eaec;border-radius:6px;height:10px;width:100%"><div style="background:${colors[s.level]};border-radius:6px;height:10px;width:${pct}%"></div></div></td>
<td style="padding:8px 0;white-space:nowrap;text-align:right">${s.score}/42 &middot; <strong style="color:${colors[s.level]}">${s.severity}</strong></td></tr>`;
  }).join("");
  const sections = SCALE_KEYS.map((k) => {
    const s = result.scales[k];
    const a = analyseScale(s);
    const tips = a.suggestions.length
      ? `<p style="margin:8px 0 4px;font-weight:600">Things that may help:</p><ul style="margin:0;padding-left:20px">${a.suggestions.map((x) => `<li style="margin:3px 0">${e(x)}</li>`).join("")}</ul>`
      : "";
    return `<h3 style="margin:22px 0 6px;font-size:16px;color:#182734">${s.name}: ${s.severity}</h3><p style="margin:0">${e(a.levelText)}</p>${tips}`;
  }).join("");
  const help = HELP_RESOURCES.map((r) => `<li style="margin:3px 0"><strong>${e(r.name)}:</strong> ${e(r.detail)}</li>`).join("");

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f7f7;font-family:Helvetica,Arial,sans-serif;color:#28303c;line-height:1.55">
<div style="max-width:600px;margin:0 auto;padding:24px">
<div style="background:#ffffff;border-radius:12px;padding:28px;border-top:5px solid #2f6f73">
<h1 style="margin:0 0 4px;font-size:22px;color:#182734">DASS-21 Results</h1>
<p style="margin:0 0 18px;color:#5b6672;font-size:14px">${e(formatDate(input.date))}</p>
<p>Hi ${e(name)},</p>
<p>Thank you for completing the DASS-21. Here is a summary of your results. Your full report is attached as a PDF.</p>
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">${rows}</table>
${sections}
<h3 style="margin:22px 0 6px;font-size:16px;color:#182734">Overall summary</h3>
<p style="margin:0">${e(summary)}</p>
<div style="margin:22px 0;padding:14px 16px;background:#f3f6f7;border:1px solid #c8d2d6;border-radius:8px"><strong>Important:</strong> ${e(DISCLAIMER)}</div>
<h3 style="margin:0 0 6px;font-size:16px;color:#182734">Help in Singapore</h3>
<ul style="margin:0;padding-left:20px">${help}</ul>
<p style="margin-top:22px">Take care,<br>DASS-21 Survey</p>
</div></div></body></html>`;

  return { subject, text, html };
}
