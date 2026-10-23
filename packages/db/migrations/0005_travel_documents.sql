-- Travel documents: one passport per person, for booking flights.
-- The passport is encrypted by the app (AES-256-GCM, key held only in the server's environment)
-- before it reaches the database, so the table holds ciphertext plus a masked summary for display.
-- Row-level security: each person can reach only their own row.
create table if not exists public.travel_documents (
  user_id     uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  ciphertext  text not null check (char_length(ciphertext) < 4000),
  summary     jsonb not null default '{}'::jsonb check (pg_column_size(summary) < 2000),
  consent_at  timestamptz not null,
  updated_at  timestamptz not null default now()
);

alter table public.travel_documents enable row level security;
drop policy if exists "own documents" on public.travel_documents;
create policy "own documents" on public.travel_documents for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.travel_documents to authenticated;
revoke all on public.travel_documents from anon;
