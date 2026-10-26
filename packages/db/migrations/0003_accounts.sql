-- Backline accounts: each signed-in person's details, their trips and what the agent remembers.
-- Sign-in itself is Supabase Auth (Google, email link). Every row belongs to one user and
-- row-level security lets people read and change only their own rows; the server reaches these
-- tables with the person's own access token, so a bug can't leak someone else's data.

-- Details: name, contact, home city, budget style, traveller details for flights, things they love.
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  details     jsonb not null default '{}'::jsonb check (pg_column_size(details) < 16000),
  updated_at  timestamptz not null default now()
);

-- Trips the agent planned and booked.
create table if not exists public.trips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title        text not null check (char_length(title) <= 160),
  goal         text check (char_length(goal) <= 2000),
  destination  text check (char_length(destination) <= 120),
  start_date   date,
  end_date     date,
  summary      text check (char_length(summary) <= 2000),
  -- Compact record of what was booked and planned: bookings with references, the days, the budget.
  details      jsonb not null default '{}'::jsonb check (pg_column_size(details) < 200000),
  created_at   timestamptz not null default now()
);
create index if not exists trips_user_created on public.trips (user_id, created_at desc);

-- What the agent learned: tastes, places stayed, cities visited, notes. Each can be forgotten.
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  kind        text not null check (kind in ('like', 'stayed', 'visited', 'note')),
  value       text not null check (char_length(value) between 1 and 200),
  source      text check (char_length(source) <= 160),
  created_at  timestamptz not null default now(),
  unique (user_id, kind, value)
);

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.memories enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own trips" on public.trips;
create policy "own trips" on public.trips for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own memories" on public.memories;
create policy "own memories" on public.memories for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.profiles, public.trips, public.memories to authenticated;
revoke all on public.profiles, public.trips, public.memories from anon;
