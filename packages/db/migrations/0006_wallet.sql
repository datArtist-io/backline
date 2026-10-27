-- Backline Wallet (demo balance): a ledger per person. Payments the agent makes for an approved booking
-- are held against the balance, then captured when the booking is confirmed or released if it fails.
-- People can read their own ledger; every change goes through the functions below, which check the
-- caller, cap top-ups, and check the balance under a per-person lock so nothing is spent twice.

create table if not exists public.wallet_entries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade default auth.uid(),
  kind              text not null check (kind in ('topup', 'payment')),
  status            text not null check (status in ('credited', 'held', 'paid', 'void')),
  amount_minor      bigint not null check (amount_minor > 0),          -- US cents
  original_amount   numeric(14, 2),
  original_currency text check (char_length(original_currency) = 3),
  label             text not null check (char_length(label) between 1 and 200),
  ref               text check (char_length(ref) <= 120),
  details           jsonb not null default '{}'::jsonb,                -- receipt: business, date, party, address, trip
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- Safe to run again over an earlier version of this migration.
alter table public.wallet_entries add column if not exists details jsonb not null default '{}'::jsonb;
drop function if exists public.wallet_hold(bigint, text, numeric, text);
create index if not exists wallet_entries_user_created on public.wallet_entries (user_id, created_at desc);

alter table public.wallet_entries enable row level security;
drop policy if exists "own wallet" on public.wallet_entries;
create policy "own wallet" on public.wallet_entries for select to authenticated using (user_id = auth.uid());
grant select on public.wallet_entries to authenticated;
revoke all on public.wallet_entries from anon;

create or replace function public.wallet_balance() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case
    when kind = 'topup' and status = 'credited' then amount_minor
    when kind = 'payment' and status in ('held', 'paid') then -amount_minor
    else 0 end), 0)
  from public.wallet_entries where user_id = auth.uid();
$$;

-- Demo top-ups: at most $1,000 at a time and $2,000 a day.
create or replace function public.wallet_topup(amount_minor bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare today_total bigint;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if amount_minor < 100 or amount_minor > 100000 then raise exception 'amount out of range'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  select coalesce(sum(e.amount_minor), 0) into today_total from public.wallet_entries e
    where e.user_id = auth.uid() and e.kind = 'topup' and e.created_at > now() - interval '1 day';
  if today_total + amount_minor > 200000 then raise exception 'daily top-up limit reached'; end if;
  insert into public.wallet_entries (user_id, kind, status, amount_minor, label)
    values (auth.uid(), 'topup', 'credited', amount_minor, 'Funds added');
  return public.wallet_balance();
end $$;

-- Hold a payment if the balance covers it. Returns the entry id, or null when funds are short.
create or replace function public.wallet_hold(amount_minor bigint, label text, original_amount numeric default null, original_currency text default null, details jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare entry uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if amount_minor <= 0 or amount_minor > 5000000 then raise exception 'amount out of range'; end if;
  if pg_column_size(details) > 4000 then raise exception 'details too large'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if public.wallet_balance() < amount_minor then return null; end if;
  insert into public.wallet_entries (user_id, kind, status, amount_minor, label, original_amount, original_currency, details)
    values (auth.uid(), 'payment', 'held', amount_minor, left(label, 200), original_amount, upper(original_currency), coalesce(details, '{}'::jsonb))
    returning id into entry;
  return entry;
end $$;

create or replace function public.wallet_capture(entry uuid, reference text default null) returns void
language sql security definer set search_path = public as $$
  update public.wallet_entries set status = 'paid', ref = left(reference, 120), updated_at = now()
  where id = entry and user_id = auth.uid() and status = 'held';
$$;

-- Refund a paid booking that couldn't go ahead (the place couldn't take it).
create or replace function public.wallet_refund(entry uuid) returns void
language sql security definer set search_path = public as $$
  update public.wallet_entries set status = 'void', updated_at = now(), details = details || '{"refunded": true}'::jsonb
  where id = entry and user_id = auth.uid() and kind = 'payment' and status in ('held', 'paid');
$$;

create or replace function public.wallet_release(entry uuid) returns void
language sql security definer set search_path = public as $$
  update public.wallet_entries set status = 'void', updated_at = now()
  where id = entry and user_id = auth.uid() and status = 'held';
$$;

revoke all on function public.wallet_balance(), public.wallet_topup(bigint), public.wallet_hold(bigint, text, numeric, text, jsonb), public.wallet_capture(uuid, text), public.wallet_release(uuid), public.wallet_refund(uuid) from public, anon;
grant execute on function public.wallet_balance(), public.wallet_topup(bigint), public.wallet_hold(bigint, text, numeric, text, jsonb), public.wallet_capture(uuid, text), public.wallet_release(uuid), public.wallet_refund(uuid) to authenticated;

-- Identity checks (KYC) with Persona: which inquiry belongs to whom. The result itself is always read
-- from Persona's API on the server, never trusted from this table or the browser.
create table if not exists public.kyc_inquiries (
  user_id     uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  inquiry_id  text not null check (inquiry_id ~ '^inq_[A-Za-z0-9]{6,64}$'),
  updated_at  timestamptz not null default now()
);
alter table public.kyc_inquiries enable row level security;
drop policy if exists "own kyc" on public.kyc_inquiries;
create policy "own kyc" on public.kyc_inquiries for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.kyc_inquiries to authenticated;
revoke all on public.kyc_inquiries from anon;

-- Everyone starts with a $20,000 demo balance, granted once on first open.
create or replace function public.wallet_welcome() returns bigint
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if not exists (select 1 from public.wallet_entries where user_id = auth.uid() and kind = 'topup' and label = 'Welcome balance') then
    insert into public.wallet_entries (user_id, kind, status, amount_minor, label)
      values (auth.uid(), 'topup', 'credited', 2000000, 'Welcome balance');
  end if;
  return public.wallet_balance();
end $$;
revoke all on function public.wallet_welcome() from public, anon;
grant execute on function public.wallet_welcome() to authenticated;
