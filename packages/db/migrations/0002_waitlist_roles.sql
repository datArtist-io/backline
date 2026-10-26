-- Backline waitlist: roles for a trip-doing agent (travellers, business travel, hosts, planners).
-- Earlier roles stay valid so existing rows keep passing the check.
alter table public.waitlist drop constraint if exists waitlist_role_check;
alter table public.waitlist
  add constraint waitlist_role_check
  check (role in ('traveller', 'business', 'host', 'agency', 'other', 'artist', 'manager', 'label', 'brand'));
