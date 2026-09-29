-- =====================================================================
-- 0030_order_creation_authority.sql
--
-- Phase 4b-auth. A salesperson may not create an order.
--
--   0027  added the salesperson role, and closed appointments and
--         contractor_customers INSERT
--   0029  stripped truncate/references/trigger from the client roles
--   0030  closes the one the 4a survey found open: order creation
--
-- THE RULING, locked, recorded here so it is not re-litigated:
-- THE SALESPERSON CLOSES, THE OFFICE CONVERTS. A rep's authority ends
-- at the signature. They measure, design, quote from their own measure,
-- and get the customer's acceptance. The accepted proposal then waits
-- for the contractor's office, which collects payment and completes its
-- internal SOP before converting. Conversion is owner and member only.
-- Kitify admins convert for support.
--
-- NO NEW TABLE, NO NEW COLUMN. Two functions and one trigger.
--
-- ---------------------------------------------------------------------
-- WHAT THE SURVEY FOUND
--
-- (c) EXACTLY ONE PATH CREATES AN ORDERS ROW. `createOrder()` at
--     lib/store.ts:769 is module-private and has a single caller,
--     `createOrderFromProposal()` at lib/store.ts:891, reached from one
--     button on app/portal/projects/[id]/page.tsx:119. No API route, no
--     server action, no SECURITY DEFINER function and no SQL in any
--     migration inserts into public.orders. So there is one door, and
--     one gate closes it.
--
--     That is why this is a BEFORE INSERT trigger on the table rather
--     than a check inside a conversion RPC: the gate belongs on the
--     table, so it holds for the door that exists today and for any
--     second door added later without remembering this file.
--
-- (d) ACCEPTANCE IS PERFORMED BY THE HOMEOWNER, AS service_role.
--     app/api/proposal/[token]/accept/route.ts runs with the
--     SERVICE_ROLE key (RLS-bypassing, no session) and writes
--     accepted_by / accepted_email / accepted_phone / accepted_at and
--     status = 'accepted'. It touches proposals only. It never creates
--     an order, and nothing else server-side does either.
--
--     This matters for the `auth.uid() is null` branch below: that
--     branch exists for service_role, the SQL Editor and definer
--     functions, and today no server-side path reaches order creation
--     at all. If one is ever added — a payment webhook converting on
--     receipt is the obvious candidate — it will pass this guard
--     unchallenged. Written down so that is a decision rather than a
--     discovery.
--
-- (a)/(b) NO NEW PROPOSAL STATE IS ADDED. See the report: 'accepted'
--     already means "the customer has chosen and identified themselves,
--     and no order exists yet", which is exactly the state a rep's work
--     lands in. Adding a 'signed' state beside it would be symmetry,
--     not meaning.
--
-- ---------------------------------------------------------------------
-- WHY A TRIGGER AND NOT A TIGHTER INSERT POLICY
--
-- Unlike an UPDATE or SELECT policy, an INSERT `with check` failure
-- does raise rather than silently filter, so a policy would not have
-- been the silent-zero-rows trap that made 0027 choose a trigger. The
-- reasons are different here:
--
--   1. A policy failure says `new row violates row-level security
--      policy for table "orders"` and nothing more. It cannot
--      distinguish "wrong org" from "wrong role", which is precisely
--      the distinction 4c has to put in front of a rep.
--   2. A trigger fires regardless of RLS and regardless of grants, so
--      it survives a future migration widening a policy by accident.
--   3. orders_insert_org is deliberately LEFT ALONE. Putting the role
--      rule in both the policy and the trigger would be two places for
--      one rule, which is how they drift. The trigger is strictly
--      stronger, so the policy has nothing to add.
--
-- BEFORE-trigger ordering is not accidental either. Triggers fire in
-- name order, so orders_creation_guard runs before
-- orders_lifecycle_guard (which stamps submitted_at) and before
-- orders_set_order_number (which burns a number from the monthly
-- counter). A denied insert therefore stamps nothing and consumes no
-- order number.
--
-- ---------------------------------------------------------------------
-- DEPENDENCY ORDERING. Both of 0027's bugs are avoided by construction
-- rather than by care: this migration adds no column, so nothing reads
-- a field off a row type, and it adds no column default, so nothing
-- references a function at DDL time. The only ordering that matters is
-- the rule function before the trigger function that calls it, and
-- PART 1 precedes PART 2.
--
-- NO TABLE IS CREATED, so the README's revoke-then-grant rule has
-- nothing to apply to here. Recorded rather than silently skipped: the
-- rule is `revoke all on <table> from authenticated, anon;` —
-- `from anon, public` does NOT cover `authenticated`, and that one
-- wording error is behind all five prior occurrences.
--
-- Re-runnable. Transactional.
-- =====================================================================

begin;

-- =====================================================================
-- PART 0 — Pre-flight. Abort rather than half-apply.
-- =====================================================================

-- 0a. 0027 must be in place. current_membership_role() is the role
--     lookup this migration reuses rather than re-deriving, and
--     is_admin() is the admin override.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_membership_role'
  ) then
    raise exception
      'ABORT 0030/0a: public.current_membership_role() missing. Apply '
      '0027_salesperson_tier.sql first — this migration must not write a second role lookup.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin' and p.prosecdef
  ) then
    raise exception 'ABORT 0030/0a: public.is_admin() missing or not SECURITY DEFINER.';
  end if;
end $$;

-- 0b. memberships.role must hold only the three known values. A fourth
--     would fall through order_create_role_allowed() as "not permitted"
--     and silently stop that user converting, which reads as a broken
--     button rather than as a permissions decision.
do $$
declare v_other text;
begin
  select string_agg(distinct m.role, ', ') into v_other
  from public.memberships m
  where m.role not in ('owner', 'member', 'salesperson');

  if v_other is not null then
    raise exception
      'ABORT 0030/0b: unexpected memberships.role value(s): %. Extend '
      'public.order_create_role_allowed() before running.', v_other;
  end if;
end $$;

-- 0c. public.orders must exist and must still be the table this guard
--     assumes — owner_id and org_id are both read by the message below.
do $$
declare v_missing text;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'orders'
  ) then
    raise exception 'ABORT 0030/0c: public.orders does not exist.';
  end if;

  select string_agg(want.col, ', ') into v_missing
  from (values ('org_id'), ('owner_id')) as want(col)
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.orders'::regclass
      and a.attname = want.col and not a.attisdropped
  );
  if v_missing is not null then
    raise exception
      'ABORT 0030/0c: public.orders is missing %. Apply 0024_tenancy.sql first.', v_missing;
  end if;
end $$;

-- =====================================================================
-- PART 1 — The rule
--
-- A SEPARATE PREDICATE FROM appointment_role_may_create(), DELIBERATELY,
-- even though the two return the same answers today.
--
-- The brief's instruction was to reuse the ROLE LOOKUP — and this does:
-- public.current_membership_role() is called, never re-derived, so
-- there is one definition of "which membership row is the caller's".
-- The PREDICATE is a different thing. "Who may book a visit" and "who
-- may convert a signed proposal into a purchase order" are two business
-- rules that happen to coincide at three roles; collapsing them into
-- one function would mean a later change to either silently changes the
-- other. Sharing the lookup prevents drift. Sharing the rule creates
-- coupling.
-- =====================================================================
create or replace function public.order_create_role_allowed(p_role text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_role in ('owner', 'member'), false);
$$;

comment on function public.order_create_role_allowed(text) is
  'Added by 0030. True for owner and member, false for salesperson and for NULL (no '
  'membership). THE RULING: the salesperson closes, the office converts — a rep''s authority '
  'ends at the customer''s acceptance, and conversion waits for the office to collect payment '
  'and finish its SOP. Enforced by the orders_creation_guard trigger. Separate from '
  'appointment_role_may_create() on purpose: same answers today, different rules.';

revoke execute on function public.order_create_role_allowed(text) from anon, public;
grant  execute on function public.order_create_role_allowed(text) to authenticated, service_role;

-- =====================================================================
-- PART 2 — The guard
--
-- BEFORE INSERT only. Order UPDATES are already governed by
-- orders_lifecycle_guard (0027) and are a separate question — see the
-- boundary list in the report for what a salesperson can still do to an
-- order that already exists.
-- =====================================================================
create or replace function public.orders_creation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  -- Kitify support converts on a contractor's behalf.
  if public.is_admin() then
    return new;
  end if;

  -- No session: service_role, the SQL Editor, or a SECURITY DEFINER
  -- function. Same bypass orders_lifecycle_guard takes, for the same
  -- reason — these are not a rep exceeding their authority, and
  -- refusing them would mean a support fix required disabling a
  -- trigger. See the header: no server-side path creates orders today.
  if auth.uid() is null then
    return new;
  end if;

  v_role := public.current_membership_role();

  if not public.order_create_role_allowed(v_role) then
    raise exception
      'ORDER_CREATE_FORBIDDEN: a % may not convert a proposal into an order. The salesperson '
      'closes; the office converts. Ask an owner or a member of this organisation to convert '
      'it once payment is collected.',
      coalesce(v_role, 'user with no membership')
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.orders_creation_guard() is
  'Added by 0030. Refuses an INSERT on public.orders from a salesperson, with a named '
  'ORDER_CREATE_FORBIDDEN error (42501) rather than the generic RLS message, so 4c can '
  'translate it. Admins and auth.uid() IS NULL sessions bypass. Fires before '
  'orders_lifecycle_guard and orders_set_order_number — name order — so a refused insert '
  'stamps no timestamp and burns no order number.';

drop trigger if exists orders_creation_guard on public.orders;
create trigger orders_creation_guard
  before insert on public.orders
  for each row execute function public.orders_creation_guard();

commit;


-- =====================================================================
-- =====================================================================
--                          VERIFY SCRIPT
--
-- READ-ONLY. Run in the SQL Editor after applying. Every row must read
-- pass = true.
--
-- pg_catalog "char" columns (tgtype, tgenabled, relkind) are cast to
-- ::text before comparison — same fix as 0023, 0024, 0026, 0028, 0029.
--
-- Checks 1 and 2 prove the RULE by calling the function that defines
-- it. Checks 3 and 4 prove the ERROR is the named one rather than a
-- policy silence, which is the half a rule-only check would miss.
-- =====================================================================
-- =====================================================================

-- 1. a salesperson may not create an order; an owner and a member may
select
  '1. who may create an order'                              as check,
  r.role                                                    as detail,
  r.want::text                                              as expected,
  public.order_create_role_allowed(r.role)::text            as actual,
  public.order_create_role_allowed(r.role) = r.want         as pass
from (values ('owner', true), ('member', true), ('salesperson', false)) as r(role, want)

union all
-- 1b. ...and a session with no membership is not accidentally permitted
select
  '1b. no-membership may not create an order',
  'null role',
  'false',
  public.order_create_role_allowed(null)::text,
  public.order_create_role_allowed(null) = false

union all
-- 2. AN ADMIN MAY. The override is not in the predicate — it is the
--    first branch of the guard — so it is proven where it lives.
select
  '2. admin override present in the guard',
  'is_admin() branch',
  'true',
  (p.prosrc like '%is_admin()%')::text,
  p.prosrc like '%is_admin()%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'orders_creation_guard'

union all
-- 2b. ...and the guard reuses current_membership_role() rather than
--     re-deriving the caller's membership. Two lookups is how they
--     drift; this is the check that catches a second one appearing.
select
  '2b. guard reuses current_membership_role',
  'single role lookup',
  'true',
  (p.prosrc like '%current_membership_role()%')::text,
  p.prosrc like '%current_membership_role()%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'orders_creation_guard'

union all
-- 2c. ...and it routes through the rule function rather than inlining
--     the role list, so check 1 is testing what actually runs
select
  '2c. guard routes through the rule fn',
  'order_create_role_allowed',
  'true',
  (p.prosrc like '%order_create_role_allowed%')::text,
  p.prosrc like '%order_create_role_allowed%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'orders_creation_guard'

union all
-- 3. THE ERROR IS NAMED, NOT A POLICY SILENCE. Both halves: the
--    identifier 4c will switch on, and the SQLSTATE the client sees.
select
  '3. error is the named one',
  w.what,
  'true',
  (p.prosrc like w.pat)::text,
  p.prosrc like w.pat
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values
  ('ORDER_CREATE_FORBIDDEN identifier', '%ORDER_CREATE_FORBIDDEN%'),
  ('errcode 42501',                     '%42501%')
) as w(what, pat)
where n.nspname = 'public' and p.proname = 'orders_creation_guard'

union all
-- 3b. the trigger exists, is ENABLED, and fires BEFORE INSERT. A
--     disabled trigger is the failure mode that looks exactly like a
--     working one.
select
  '3b. trigger enabled',
  t.tgname,
  'O',
  t.tgenabled::text,
  t.tgenabled::text = 'O'
from pg_trigger t
where t.tgrelid = 'public.orders'::regclass
  and t.tgname = 'orders_creation_guard'

union all
-- 3c. ...BEFORE and INSERT, and NOT UPDATE. An INSERT guard that also
--     fired on UPDATE would block every admin pipeline advance.
--
--     tgtype bits, from src/include/catalog/pg_trigger.h — worth
--     writing out, because 1 is ROW and 2 is BEFORE, and reading 1 as
--     "before" gives a check that passes for the wrong reason:
--       1 ROW · 2 BEFORE · 4 INSERT · 8 DELETE · 16 UPDATE
--       32 TRUNCATE · 64 INSTEAD · AFTER is the absence of 2 and 64
select
  '3c. trigger is BEFORE INSERT only',
  'tgtype & 2 (before), & 4 (insert), & 16 (update)',
  'true/true/false',
  ((t.tgtype & 2) > 0)::text || '/' || ((t.tgtype & 4) > 0)::text || '/' || ((t.tgtype & 16) > 0)::text,
  (t.tgtype & 2) > 0 and (t.tgtype & 4) > 0 and (t.tgtype & 16) = 0
from pg_trigger t
where t.tgrelid = 'public.orders'::regclass
  and t.tgname = 'orders_creation_guard'

union all
-- 3d. it sorts BEFORE the other two BEFORE-INSERT triggers on orders,
--     which is what keeps a refused insert from stamping submitted_at
--     or burning an order number. Triggers fire in name order.
select
  '3d. guard fires first',
  'orders_creation_guard < orders_lifecycle_guard < orders_set_order_number',
  'true',
  (min(t.tgname) = 'orders_creation_guard')::text,
  min(t.tgname) = 'orders_creation_guard'
from pg_trigger t
where t.tgrelid = 'public.orders'::regclass
  and not t.tgisinternal
  and (t.tgtype & 4) > 0            -- INSERT
  and (t.tgtype & 2) > 0            -- BEFORE (bit 2; bit 1 is ROW)

union all
-- 4. orders_insert_org IS UNCHANGED. The rule lives in the trigger and
--    nowhere else; a role clause appearing here would mean two
--    definitions, and the one that fired would depend on evaluation
--    order rather than on intent.
select
  '4. insert policy not role-gated',
  pol.polname,
  'false',
  (pg_get_expr(pol.polwithcheck, pol.polrelid) like '%role%')::text,
  pg_get_expr(pol.polwithcheck, pol.polrelid) not like '%role%'
from pg_policy pol
where pol.polrelid = 'public.orders'::regclass
  and pol.polcmd::text = 'a'                    -- "char": a = INSERT

union all
-- 4b. ...and there is still exactly ONE of them. Permissive policies OR
--     together, so a second INSERT policy would widen the table without
--     touching the one above.
select
  '4b. one INSERT policy on orders',
  'insert policy count',
  '1',
  count(*)::text,
  count(*) = 1
from pg_policy pol
where pol.polrelid = 'public.orders'::regclass
  and pol.polcmd::text = 'a'

union all
-- 5. REGRESSION — the whole-schema grant sweep from 0029 check 1. This
--    migration creates no table, so it cannot have reintroduced the
--    default-grant problem; the check is here because the README rule
--    says every grant-related VERIFY sweeps the whole schema, and
--    because five occurrences is enough to keep looking.
select
  '5. no client role holds truncate/references/trigger',
  'offending role/relation/privilege combinations',
  '0',
  count(*)::text,
  count(*) = 0
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as pr(priv)
cross join (values ('authenticated'), ('anon'))               as r(role)
where n.nspname in ('public', 'leads')
  and c.relkind::text in ('r', 'p', 'v', 'm', 'f')
  and has_table_privilege(r.role, c.oid::regclass::text, pr.priv)

union all
-- 5b. ...one row per survivor, so the count is actionable
select
  '5b. surviving grant offender',
  r.role || ' / ' || n.nspname || '.' || c.relname || ' / ' || pr.priv,
  'none',
  'held',
  false
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as pr(priv)
cross join (values ('authenticated'), ('anon'))               as r(role)
where n.nspname in ('public', 'leads')
  and c.relkind::text in ('r', 'p', 'v', 'm', 'f')
  and has_table_privilege(r.role, c.oid::regclass::text, pr.priv)

union all
-- 6. THE OTHER DIRECTION. A guard on order creation is exactly the
--    change that quietly breaks the thing it guards. authenticated must
--    still hold INSERT on orders — the trigger decides WHO, the grant
--    decides WHETHER the statement is even attempted, and removing the
--    grant would turn a translatable refusal back into a bare
--    permission-denied for everyone including owners.
select
  '6. authenticated keeps DML on orders',
  'public.orders / ' || pr.priv,
  'true',
  has_table_privilege('authenticated', 'public.orders', pr.priv)::text,
  has_table_privilege('authenticated', 'public.orders', pr.priv)
from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as pr(priv)

union all
-- 6b. ...and RLS is still on. The trigger checks the ROLE; RLS is still
--     what checks the ORG, and neither replaces the other.
select
  '6b. RLS still enabled on orders',
  c.relname,
  'true',
  c.relrowsecurity::text,
  c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'orders'

union all
-- 7. 0027's lifecycle guard is untouched. This migration added a second
--    trigger to the same table, and the failure mode worth excluding is
--    a `drop trigger` typo taking the first one with it.
select
  '7. lifecycle guard still enabled',
  t.tgname,
  'O',
  t.tgenabled::text,
  t.tgenabled::text = 'O'
from pg_trigger t
where t.tgrelid = 'public.orders'::regclass
  and t.tgname = 'orders_lifecycle_guard'

order by 1, 2;
