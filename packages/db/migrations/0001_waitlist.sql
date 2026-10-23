-- Waitlist: early-access signups with queue position and referrals.
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to re-run.
--
-- Access model: the table has RLS on and no policies, and anon/authenticated
-- roles have no grants, so browsers can never read or write it directly.
-- Only the web server, using the secret (service role) key, calls waitlist_join().

create extension if not exists citext;

create table if not exists public.waitlist (
  id               uuid primary key default gen_random_uuid(),
  email            citext not null unique check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name             text check (char_length(name) <= 80),
  role             text not null check (role in ('artist', 'manager', 'label', 'agency', 'brand', 'other')),
  artist           text check (char_length(artist) <= 120),
  country          text check (char_length(country) <= 80),
  ref_code         text not null unique check (ref_code ~ '^[a-z0-9]{8}$'),
  referred_by      text references public.waitlist (ref_code) on delete set null,
  referrals        integer not null default 0 check (referrals >= 0),
  consent_at       timestamptz not null,
  marketing_opt_in boolean not null default false,
  source           text check (char_length(source) <= 40),
  created_at       timestamptz not null default now()
);


alter table public.waitlist enable row level security;
revoke all on public.waitlist from anon, authenticated;

-- Each referral moves you up the queue as if you'd joined two days earlier (capped at 30 referrals).
create or replace function public.waitlist_position(p_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  with me as (
    select created_at - make_interval(days => least(referrals, 30) * 2) as score, created_at
    from waitlist where id = p_id
  )
  select 1 + count(*)::int
  from waitlist w, me
  where (w.created_at - make_interval(days => least(w.referrals, 30) * 2), w.created_at) < (me.score, me.created_at);
$$;

create or replace function public.waitlist_join(
  p_email text,
  p_role text,
  p_name text default null,
  p_artist text default null,
  p_country text default null,
  p_ref text default null,
  p_marketing boolean default false,
  p_source text default null
)
returns table (already boolean, ref_code text, queue_position integer, total integer)
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_code text;
  v_ref text;
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  i int;
begin
  -- Only credit referral codes that exist and belong to someone else.
  select w.ref_code into v_ref from waitlist w where w.ref_code = lower(p_ref) and w.email <> p_email::citext;

  for attempt in 1..5 loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(v_alphabet)), 1);
    end loop;
    begin
      insert into waitlist (email, name, role, artist, country, ref_code, referred_by, consent_at, marketing_opt_in, source)
      values (p_email, nullif(p_name, ''), p_role, nullif(p_artist, ''), nullif(p_country, ''), v_code, v_ref, now(), coalesce(p_marketing, false), p_source)
      on conflict (email) do nothing
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- ref_code collision: try another code.
      continue;
    end;
  end loop;

  if v_id is null then
    -- Email already on the list. Don't reveal its code or position to whoever is asking.
    return query select true, null::text, null::integer, (select count(*)::int from waitlist);
    return;
  end if;

  if v_ref is not null then
    update waitlist set referrals = referrals + 1 where waitlist.ref_code = v_ref;
  end if;

  return query select false, v_code, waitlist_position(v_id), (select count(*)::int from waitlist);
end;
$$;

revoke all on function public.waitlist_join(text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.waitlist_position(uuid) from public, anon, authenticated;
grant execute on function public.waitlist_join(text, text, text, text, text, text, boolean, text) to service_role;
grant execute on function public.waitlist_position(uuid) to service_role;
