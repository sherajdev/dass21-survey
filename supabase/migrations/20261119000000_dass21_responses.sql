-- DASS-21 responses. Written ONLY by the submit-dass21 Edge Function (service role).
-- RLS is on with no policies, so the public publishable/anon key can neither read nor write.
create table if not exists public.dass21_responses (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  name                text not null check (char_length(name) between 2 and 100),
  email               text not null check (char_length(email) between 3 and 254),
  consent             boolean not null default false,
  answers             jsonb not null,  -- array of 21 integers 0-3, item order 1..21
  depression_score    smallint not null check (depression_score between 0 and 42),
  anxiety_score       smallint not null check (anxiety_score between 0 and 42),
  stress_score        smallint not null check (stress_score between 0 and 42),
  depression_severity text not null,
  anxiety_severity    text not null,
  stress_severity     text not null,
  email_status        text not null default 'pending',
    -- pending | sent | partial-respondent-failed | partial-owner-failed | failed | missing-key
  email_error         text,
  constraint answers_is_21_array check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) = 21)
);

create index if not exists dass21_responses_email_created_idx
  on public.dass21_responses (lower(email), created_at desc);
create index if not exists dass21_responses_created_idx
  on public.dass21_responses (created_at desc);

alter table public.dass21_responses enable row level security;
revoke all on table public.dass21_responses from anon, authenticated;

comment on table public.dass21_responses is
  'DASS-21 survey submissions. Private: view in the Supabase dashboard (Table Editor) only.';
