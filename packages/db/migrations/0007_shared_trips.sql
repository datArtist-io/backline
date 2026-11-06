-- Shared trips: a finished trip saved exactly as its planner saw it, so a link opens the same trip for
-- anyone (no new planning run, no different picks, no waiting). The table is closed to everyone; two
-- functions save and read a trip by its random id. Nothing personal is kept: no wallet, no approval seal.
-- Safe to run again.

create table if not exists public.shared_trips (
  id          text primary key check (id ~ '^[A-Za-z0-9]{10,24}$'),
  goal        text not null check (char_length(goal) between 1 and 2000),
  snap        jsonb not null,
  owner       uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists shared_trips_created on public.shared_trips (created_at desc);

alter table public.shared_trips enable row level security;
revoke all on public.shared_trips from anon, authenticated;

-- Save a trip; returns its id. Capped at 3 MB, so the table can't be used as free storage.
create or replace function public.share_trip_save(p_id text, p_goal text, p_snap jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id !~ '^[A-Za-z0-9]{10,24}$' then raise exception 'bad id'; end if;
  if char_length(coalesce(p_goal, '')) not between 1 and 2000 then raise exception 'bad goal'; end if;
  if octet_length(p_snap::text) > 3000000 then raise exception 'trip too large'; end if;
  insert into public.shared_trips (id, goal, snap, owner) values (p_id, p_goal, p_snap, auth.uid());
  return p_id;
end;
$$;

-- Read a saved trip by id (null when there is none).
create or replace function public.share_trip_get(p_id text)
returns table (goal text, snap jsonb, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select s.goal, s.snap, s.created_at from public.shared_trips s where s.id = p_id and p_id ~ '^[A-Za-z0-9]{10,24}$';
$$;

revoke all on function public.share_trip_save(text, text, jsonb) from public;
revoke all on function public.share_trip_get(text) from public;
grant execute on function public.share_trip_save(text, text, jsonb) to anon, authenticated;
grant execute on function public.share_trip_get(text) to anon, authenticated;
