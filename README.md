# DASS-21 Survey

Public DASS-21 screening survey. React + Tailwind (Vite) front end on GitHub Pages,
Supabase (Postgres + Edge Function) back end, jsPDF reports, email via AgentMail.

## How it works

- `supabase/functions/submit-dass21/dass.ts` – items, scoring (subscale sum × 2), severity bands
  and all wording. Shared by the web page, the PDF and the email so they always match.
- `supabase/functions/submit-dass21/report.ts` – PDF (jsPDF) and email (text + HTML) builders.
- `supabase/functions/submit-dass21/index.ts` – the only public endpoint. It re-scores the
  answers server-side, rate-limits (3 per email per hour, 60 total per 10 min), saves the row,
  builds the PDF itself, then sends it twice via AgentMail (respondent, then owner).
- `supabase/migrations/…_dass21_responses.sql` – the table. RLS is on with **no policies**, so
  the public key cannot read or write it. Only the Edge Function (service role) writes.

## ⚠️ Required setup: AgentMail secret

Email will not send until you add the secret. Responses are still saved, with
`email_status = 'missing-key'`, and users see "Results saved, email could not be sent yet."

Supabase dashboard → Project → Edge Functions → Secrets → add:

| Name | Value |
|---|---|
| `AGENTMAIL_API_KEY` | your AgentMail API key |

Optional secrets: `OWNER_EMAIL` (default `sheraj.hussein@gmail.com`),
`AGENTMAIL_INBOX` (default `satu-muse@agentmail.to`),
`ALLOWED_ORIGINS` (comma list, e.g. `https://sherajdev.github.io`; default `*`).

Never put the key in code or in `VITE_*` variables — those ship to the browser.

## Viewing responses

Supabase dashboard → Table Editor → `dass21_responses`. There is no admin page on the site,
by design. `email_status` is one of `sent`, `partial-respondent-failed`,
`partial-owner-failed`, `failed`, `missing-key`, `pending`; `email_error` holds the reason.

## Deploy

- Function: `supabase functions deploy submit-dass21 --no-verify-jwt`
  (the function validates and rate-limits itself; no user login exists).
- Site: push to `main`. The workflow runs the tests, builds with the repo **variables**
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and publishes to Pages
  (Settings → Pages → Source: GitHub Actions).

## Tests

`npx vitest run` covers: all 0s = Normal ×3; raw D6/A7/S11 → 12 Mild / 14 Moderate /
22 Moderate; all 3s = 42 Extremely Severe; item-to-subscale mapping; every band boundary;
invalid input; PDF output; email escaping, disclaimer and helplines.

## Privacy note (Singapore PDPA)

The survey stores names, emails and mental-health screening answers and sends them to the
owner. Respondents must tick an explicit consent box before starting. Decide a retention
period and how people can ask for deletion, and say so on the intro page.
