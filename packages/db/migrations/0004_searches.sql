-- Search history: every request a signed-in person gives the agent, newest first.
-- Same rules as the other account tables: each row belongs to one person and only they can see it.
create table if not exists public.searches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  query       text not null check (char_length(query) between 1 and 2000),
  mode        text check (mode in ('check', 'auto')),
  title       text check (char_length(title) <= 160),
  destination text check (char_length(destination) <= 120),
  created_at  timestamptz not null default now()
);
create index if not exists searches_user_created on public.searches (user_id, created_at desc);

alter table public.searches enable row level security;
drop policy if exists "own searches" on public.searches;
create policy "own searches" on public.searches for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, delete on public.searches to authenticated;
revoke all on public.searches from anon;
