import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ITEMS,
  SCALE_OPTIONS,
  SCALE_KEYS,
  scoreDass,
  analyseScale,
  overallSummary,
  DISCLAIMER,
  HELP_RESOURCES,
  type DassResult,
} from "../supabase/functions/submit-dass21/dass.ts";
import { buildPdf, pdfFilename, formatDate } from "../supabase/functions/submit-dass21/report.ts";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const STORAGE_KEY = "dass21-progress-v1";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Step = "intro" | "details" | "questions" | "submitting" | "results";
type SubmitOutcome = "sent" | "email-failed" | "not-saved";

interface Saved {
  step: Step;
  name: string;
  email: string;
  consent: boolean;
  answers: (number | null)[];
  index: number;
}

function loadSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (!Array.isArray(s.answers) || s.answers.length !== 21) return null;
    if (s.step !== "details" && s.step !== "questions") return null;
    return s;
  } catch {
    return null;
  }
}

export default function App() {
  const saved = useRef(loadSaved()).current;
  const [step, setStep] = useState<Step>(saved?.step ?? "intro");
  const [name, setName] = useState(saved?.name ?? "");
  const [email, setEmail] = useState(saved?.email ?? "");
  const [consent, setConsent] = useState(saved?.consent ?? false);
  const [answers, setAnswers] = useState<(number | null)[]>(saved?.answers ?? Array(21).fill(null));
  const [index, setIndex] = useState(saved?.index ?? 0);
  const [result, setResult] = useState<DassResult | null>(null);
  const [submittedAt, setSubmittedAt] = useState<Date>(new Date());
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);

  // Persist in-progress answers for this tab only (survives an accidental refresh).
  useEffect(() => {
    try {
      if (step === "details" || step === "questions") {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step, name, email, consent, answers, index }));
      } else if (step === "results") {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* storage unavailable: fine */
    }
  }, [step, name, email, consent, answers, index]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  async function submit() {
    const final = answers as number[];
    const r = scoreDass(final);
    const now = new Date();
    setResult(r);
    setSubmittedAt(now);
    setStep("submitting");

    let res: SubmitOutcome = "not-saved";
    try {
      if (!SUPABASE_URL) throw new Error("Backend not configured");
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/submit-dass21`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(SUPABASE_KEY ? { apikey: SUPABASE_KEY } : {}),
        },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), consent, answers: final }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.saved) res = data.respondent_sent ? "sent" : "email-failed";
    } catch (err) {
      console.error(err);
    }
    setOutcome(res);
    setStep("results");
  }

  async function downloadPdf() {
    if (!result) return;
    const { jsPDF } = await import("jspdf");
    const doc = buildPdf(jsPDF, { name: name.trim(), email: email.trim(), date: submittedAt, result });
    doc.save(pdfFilename(name.trim(), submittedAt));
  }

  function restart() {
    setStep("intro");
    setName("");
    setEmail("");
    setConsent(false);
    setAnswers(Array(21).fill(null));
    setIndex(0);
    setResult(null);
    setOutcome(null);
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="border-b border-brand-100 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-3 flex items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 32 32" className="h-7 w-7">
            <rect width="32" height="32" rx="8" fill="#2f6f73" />
            <path d="M9 20h3v-6H9zm5.5 0h3V10h-3zm5.5 0h3v-9h-3z" fill="#fff" />
          </svg>
          <span className="font-semibold tracking-tight">DASS-21 Survey</span>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        {step === "intro" && <Intro onStart={() => setStep("details")} />}
        {step === "details" && (
          <Details
            name={name}
            email={email}
            consent={consent}
            setName={setName}
            setEmail={setEmail}
            setConsent={setConsent}
            onBack={() => setStep("intro")}
            onNext={() => setStep("questions")}
          />
        )}
        {step === "questions" && (
          <Questions
            answers={answers}
            index={index}
            setIndex={setIndex}
            setAnswer={(i, v) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))}
            onBack={() => setStep("details")}
            onSubmit={submit}
          />
        )}
        {step === "submitting" && (
          <Card>
            <div role="status" aria-live="polite" className="flex items-center gap-3 py-6">
              <span className="h-5 w-5 rounded-full border-2 border-brand-600 border-t-transparent animate-spin" aria-hidden="true" />
              <span>Saving your responses and preparing your report…</span>
            </div>
          </Card>
        )}
        {step === "results" && result && (
          <Results
            result={result}
            name={name.trim()}
            email={email.trim()}
            date={submittedAt}
            outcome={outcome}
            onDownload={downloadPdf}
            onRestart={restart}
          />
        )}
      </main>

      <footer className="mx-auto max-w-2xl px-4 pb-8 text-xs text-slate-500">
        Screening tool only, not a diagnosis. In an emergency in Singapore, call 995.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 p-5 sm:p-8 ${className}`}>{children}</section>;
}

const btnPrimary =
  "inline-flex items-center justify-center rounded-xl bg-brand-600 px-5 py-3 font-medium text-white hover:bg-brand-700 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-40 disabled:cursor-not-allowed min-h-12";
const btnSecondary =
  "inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 font-medium text-ink ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-40 min-h-12";

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <Card>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">DASS-21 Survey</h1>
      <p className="mt-4 text-slate-700 leading-relaxed">
        The DASS-21 (Depression, Anxiety and Stress Scales) is a set of <strong>21 statements</strong> about how you have
        felt <strong>over the past week</strong>. For each one, choose how much it applied to you. There are no right or
        wrong answers, and it takes about 5 minutes.
      </p>

      <h2 className="mt-6 font-semibold">Rating scale</h2>
      <ul className="mt-2 space-y-2">
        {SCALE_OPTIONS.map((o) => (
          <li key={o.value} className="flex gap-3 items-start">
            <span className="shrink-0 grid place-items-center h-7 w-7 rounded-lg bg-brand-50 text-brand-700 font-semibold">
              {o.value}
            </span>
            <span className="text-slate-700 pt-0.5">{o.label}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-xl bg-amber-50 ring-1 ring-amber-200 p-4 text-sm text-amber-900">
        <strong>This is a screening tool only, not a diagnosis.</strong> Your results can help you reflect on how you have
        been feeling, but only a qualified professional can assess your mental health.
      </div>

      <div className="mt-4 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4 text-sm text-slate-700">
        <strong>Privacy:</strong> Your name and email are collected only to send you your report and for the survey owner
        to review responses. Your responses are not shown publicly.
      </div>

      <div className="mt-8">
        <button className={btnPrimary + " w-full sm:w-auto"} onClick={onStart}>
          Start the survey
        </button>
      </div>
    </Card>
  );
}

function Details(props: {
  name: string;
  email: string;
  consent: boolean;
  setName: (v: string) => void;
  setEmail: (v: string) => void;
  setConsent: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const nameErr = props.name.trim().length < 2 ? "Please enter your full name." : props.name.trim().length > 100 ? "Name is too long." : "";
  const emailErr = !EMAIL_RE.test(props.email.trim()) ? "Please enter a valid email address." : "";
  const consentErr = !props.consent ? "Please tick the box to continue." : "";
  const valid = !nameErr && !emailErr && !consentErr;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (valid) props.onNext();
  }

  const input =
    "mt-1 block w-full rounded-xl border-0 px-4 py-3 ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-600 outline-none text-base";

  return (
    <Card>
      <h1 className="text-2xl font-semibold tracking-tight">Your details</h1>
      <p className="mt-2 text-slate-600">We will email your results report to this address.</p>
      <form className="mt-6 space-y-5" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="name" className="font-medium">
            Full name <span aria-hidden="true" className="text-red-600">*</span>
          </label>
          <input
            id="name"
            className={input}
            autoComplete="name"
            required
            maxLength={100}
            value={props.name}
            onChange={(e) => props.setName(e.target.value)}
            aria-invalid={touched && !!nameErr}
            aria-describedby={touched && nameErr ? "name-err" : undefined}
          />
          {touched && nameErr && <p id="name-err" className="mt-1 text-sm text-red-700">{nameErr}</p>}
        </div>
        <div>
          <label htmlFor="email" className="font-medium">
            Email <span aria-hidden="true" className="text-red-600">*</span>
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            className={input}
            autoComplete="email"
            required
            maxLength={254}
            value={props.email}
            onChange={(e) => props.setEmail(e.target.value)}
            aria-invalid={touched && !!emailErr}
            aria-describedby={touched && emailErr ? "email-err" : undefined}
          />
          {touched && emailErr && <p id="email-err" className="mt-1 text-sm text-red-700">{emailErr}</p>}
        </div>
        <div>
          <label className="flex gap-3 items-start cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-brand-600 shrink-0"
              checked={props.consent}
              onChange={(e) => props.setConsent(e.target.checked)}
              aria-invalid={touched && !!consentErr}
              aria-describedby={touched && consentErr ? "consent-err" : undefined}
            />
            <span className="text-sm text-slate-700">
              I agree that my name, email and answers will be stored, emailed to me, and shared with the survey owner for
              review. <span aria-hidden="true" className="text-red-600">*</span>
            </span>
          </label>
          {touched && consentErr && <p id="consent-err" className="mt-1 text-sm text-red-700">{consentErr}</p>}
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
          <button type="button" className={btnSecondary} onClick={props.onBack}>
            Back
          </button>
          <button type="submit" className={btnPrimary + " sm:ml-auto"}>
            Continue to questions
          </button>
        </div>
      </form>
    </Card>
  );
}

function Questions(props: {
  answers: (number | null)[];
  index: number;
  setIndex: (i: number) => void;
  setAnswer: (i: number, v: number) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { answers, index, setIndex, setAnswer } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const answered = answers.filter((a) => a !== null).length;
  const current = answers[index];
  const isLast = index === 20;
  const allDone = answered === 21;
  const firstMissing = answers.findIndex((a) => a === null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [index]);

  function next() {
    if (current === null) return;
    if (isLast) {
      if (allDone) props.onSubmit();
      else setIndex(firstMissing);
    } else setIndex(index + 1);
  }

  return (
    <Card>
      <div>
        <div className="flex justify-between text-sm text-slate-600">
          <span>
            Statement {index + 1} of 21
          </span>
          <span>{answered} answered</span>
        </div>
        <div
          className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden"
          role="progressbar"
          aria-label="Survey progress"
          aria-valuemin={0}
          aria-valuemax={21}
          aria-valuenow={answered}
        >
          <div className="h-full bg-brand-600 transition-all duration-300" style={{ width: `${(answered / 21) * 100}%` }} />
        </div>
      </div>

      <p className="mt-6 text-sm font-medium text-brand-700">Over the past week…</p>
      <fieldset className="mt-1">
        <legend className="contents">
          <h1 ref={headingRef} tabIndex={-1} className="text-xl sm:text-2xl font-semibold leading-snug outline-none">
            {ITEMS[index]}
          </h1>
        </legend>
        <div className="mt-6 space-y-3">
          {SCALE_OPTIONS.map((o) => {
            const selected = current === o.value;
            return (
              <label
                key={o.value}
                className={`flex items-center gap-4 rounded-xl p-4 cursor-pointer ring-1 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-brand-600 ${
                  selected ? "bg-brand-50 ring-brand-600" : "bg-white ring-slate-300 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name={`q${index}`}
                  value={o.value}
                  checked={selected}
                  onChange={() => setAnswer(index, o.value)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`shrink-0 grid place-items-center h-9 w-9 rounded-lg font-semibold ${
                    selected ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {o.value}
                </span>
                <span className="text-slate-800">{o.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {isLast && current !== null && !allDone && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          Please answer all 21 statements before submitting. Statement {firstMissing + 1} is still unanswered.
        </p>
      )}

      <div className="mt-8 flex gap-3">
        <button className={btnSecondary} onClick={() => (index === 0 ? props.onBack() : setIndex(index - 1))}>
          Back
        </button>
        <button className={btnPrimary + " ml-auto"} disabled={current === null} onClick={next}>
          {isLast ? (allDone || current === null ? "Submit" : "Go to unanswered") : "Next"}
        </button>
      </div>
    </Card>
  );
}

const SEVERITY_STYLES = [
  { bar: "bg-emerald-600", text: "text-emerald-800", chip: "bg-emerald-50 ring-emerald-200" },
  { bar: "bg-yellow-500", text: "text-yellow-800", chip: "bg-yellow-50 ring-yellow-200" },
  { bar: "bg-orange-500", text: "text-orange-800", chip: "bg-orange-50 ring-orange-200" },
  { bar: "bg-red-600", text: "text-red-800", chip: "bg-red-50 ring-red-200" },
  { bar: "bg-rose-800", text: "text-rose-900", chip: "bg-rose-50 ring-rose-200" },
];

function Results(props: {
  result: DassResult;
  name: string;
  email: string;
  date: Date;
  outcome: SubmitOutcome | null;
  onDownload: () => void;
  onRestart: () => void;
}) {
  const { result, outcome } = props;
  return (
    <div className="space-y-5">
      <div role="status" aria-live="polite">
        {outcome === "sent" && (
          <Notice tone="ok">Results saved. A copy of your report has been emailed to {props.email}.</Notice>
        )}
        {outcome === "email-failed" && <Notice tone="warn">Results saved, email could not be sent yet.</Notice>}
        {outcome === "not-saved" && (
          <Notice tone="warn">
            Your results are shown below, but they could not be saved or emailed right now. Please download your PDF
            report.
          </Notice>
        )}
      </div>

      <Card>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Your DASS-21 results</h1>
        <p className="mt-1 text-slate-600 text-sm">
          {props.name} · {formatDate(props.date)}
        </p>

        <div className="mt-6 space-y-5" role="list" aria-label="Scores out of 42">
          {SCALE_KEYS.map((k) => {
            const s = result.scales[k];
            const st = SEVERITY_STYLES[s.level];
            return (
              <div key={k} role="listitem">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-sm">
                    <span className="font-semibold tabular-nums">{s.score}</span>
                    <span className="text-slate-500"> / 42</span>
                    <span className={`ml-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${st.chip} ${st.text}`}>
                      {s.severity}
                    </span>
                  </span>
                </div>
                <div className="mt-2 h-3 rounded-full bg-slate-200 overflow-hidden" aria-hidden="true">
                  <div className={`h-full rounded-full ${st.bar}`} style={{ width: `${(s.score / 42) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <button className={btnPrimary} onClick={props.onDownload}>
            <svg aria-hidden="true" viewBox="0 0 20 20" className="mr-2 h-5 w-5" fill="currentColor">
              <path d="M10 3a1 1 0 0 1 1 1v7.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42L9 11.6V4a1 1 0 0 1 1-1ZM4 15a1 1 0 0 1 1 1v1h10v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />
            </svg>
            Download PDF report
          </button>
        </div>
      </Card>

      {SCALE_KEYS.map((k) => {
        const s = result.scales[k];
        const a = analyseScale(s);
        const st = SEVERITY_STYLES[s.level];
        return (
          <Card key={k}>
            <h2 className="text-xl font-semibold">
              {s.name}: <span className={st.text}>{s.severity}</span>
            </h2>
            <p className="mt-3 text-slate-700 leading-relaxed">{a.meaning}</p>
            <p className="mt-3 text-slate-700 leading-relaxed">{a.levelText}</p>
            {a.suggestions.length > 0 && (
              <>
                <h3 className="mt-5 font-semibold">Things that may help</h3>
                <ul className="mt-2 space-y-2 list-disc pl-5 text-slate-700">
                  {a.suggestions.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        );
      })}

      <Card>
        <h2 className="text-xl font-semibold">Overall summary</h2>
        <p className="mt-3 text-slate-700 leading-relaxed">{overallSummary(result)}</p>
      </Card>

      <Card className="bg-amber-50! ring-amber-200!">
        <h2 className="font-semibold text-amber-900">Important</h2>
        <p className="mt-2 text-amber-900">{DISCLAIMER}</p>
      </Card>

      <Card>
        <h2 className="text-xl font-semibold">Help in Singapore</h2>
        <ul className="mt-3 space-y-2">
          {HELP_RESOURCES.map((r) => (
            <li key={r.name} className="flex flex-col sm:flex-row sm:justify-between gap-0.5 border-b border-slate-100 pb-2 last:border-0">
              <span className="text-slate-700">{r.name}</span>
              <span className="font-semibold tabular-nums">{r.detail}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="text-center">
        <button className="text-sm text-brand-700 underline underline-offset-4 py-2" onClick={props.onRestart}>
          Start a new survey
        </button>
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: "ok" | "warn"; children: ReactNode }) {
  const cls =
    tone === "ok" ? "bg-emerald-50 ring-emerald-200 text-emerald-900" : "bg-amber-50 ring-amber-200 text-amber-900";
  return <div className={`rounded-xl ring-1 p-4 text-sm ${cls}`}>{children}</div>;
}
