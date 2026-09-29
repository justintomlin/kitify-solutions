-- =====================================================================
-- 0027_salesperson_tier.sql
--
-- Phase 4a. Schema and permissions only — no UI, no pricing logic.
--
--   0022  closed every path reachable with the anon key
--   0023  closed privilege escalation on profiles
--   0024  gave authorization something to scope BY (orgs/memberships)
--   0026  fixed the two places the org_id DEFAULT resolved to the wrong org
--   0027  adds the third membership role, the appointment it works, the
--         48-hour order change window, and two placeholder columns/tables
--         that 4b fills in
--
-- ADDITIVE. Nothing is deleted. Two new tables, one new enum, one new
-- column on orgs, one new column on orders, four new functions, one new
-- trigger on orders, one new trigger on memberships, and a tightening of
-- the contractor_customers INSERT policy.
--
-- ---------------------------------------------------------------------
-- WHAT THE SURVEY FOUND, AND WHAT IT CHANGED
--
-- (a) ORDER TRANSITIONS ARE ENFORCED NOWHERE IN THE DATABASE. The
--     `orders_status_check` CHECK (0006) constrains the SET of legal
--     values; it says nothing about which value may follow which. The
--     only ordering rule in the system is `canTransition()` in
--     lib/store.ts:789, a client-side function, and `updateOrder()`
--     (lib/store.ts:878) writes `status` straight through without
--     consulting it. So this migration is NEW enforcement, not a
--     rewrite of existing enforcement.
--
-- (e) orders HAS NO submitted_at. It has created_at, updated_at, and
--     placed_at — and placed_at is set CLIENT-SIDE at insert
--     (lib/store.ts:743, `o.placedAt ?? new Date().toISOString()`).
--     A clock that decides who may cancel cannot start from a value the
--     client chooses, so submitted_at is a separate column, stamped by
--     a trigger, and backfilled from placed_at for history.
--
-- ---------------------------------------------------------------------
-- WHY A TRIGGER AND NOT A POLICY FOR THE 48-HOUR WINDOW
--
-- An RLS USING clause that fails does not deny — it hides. PostgREST
-- returns "0 rows updated", which lib/store.ts raises as
-- `fail("updateOrder", null)` and app/portal/orders/[id]/page.tsx shows
-- as the generic `orders.actionError`. The contractor is told nothing
-- useful, and a genuine missing-row bug becomes indistinguishable from
-- a locked order.
--
-- A trigger raises a named error (ORDER_LOCKED, errcode 42501) that the
-- UI can translate in 4c. It also fires regardless of RLS and regardless
-- of grants, which is the same reasoning 0023 used for the profiles
-- guard. And the submitted_at stamp needs a trigger anyway, so one
-- trigger does both jobs and there is one place to read.
--
-- ---------------------------------------------------------------------
-- WHAT THE LOCK COVERS, AND WHAT IT DELIBERATELY DOES NOT
--
-- Read this before widening it. The rule is "locked to the production
-- schedule", and the contractor has legitimate work on an order LONG
-- after 48 hours: app/portal/orders/[id]/page.tsx lets them set the
-- install date, upload completion photos, register the warranty, and
-- mark the order completed — all of which happen weeks or months after
-- submission. A blanket "no non-admin UPDATE after 48h" would break
-- every one of them, silently, on the page that is already shipped.
--
-- So the lock is COLUMN-SCOPED. After the window closes, a non-admin
-- may not change what was ordered (project_id, quote_id, proposal_id,
-- snapshot, the customer_* block) and may not change status to anything
-- other than 'completed' — which blocks cancellation, the one thing the
-- ruling names, while leaving the contractor's terminal action alone.
--
-- NOT LOCKED, on purpose: carrier, tracking_number, estimated_delivery,
-- confirmed_at, shipped_at, delivered_at. No contractor code path
-- writes them today (they are inside the `isAdmin &&` block at
-- app/portal/orders/[id]/page.tsx:280), but they are reachable through
-- PostgREST at any time, including hour one. That is an authority gap
-- that is not time-based, so a 48-hour trigger is the wrong tool for
-- it. Recorded rather than fixed here. See the report.
--
-- ---------------------------------------------------------------------
-- WHY THE KITIFY/SALESPERSON RULE IS A TRIGGER AND NOT A CHECK
--
-- The brief asked for a check constraint. A CHECK constraint cannot
-- reference another table, and "salesperson is invalid at a kitify org"
-- needs orgs.kind, which lives in orgs. The two declarative options are
-- a composite FK (memberships.org_kind -> orgs(id, kind)), which means
-- denormalising a column every existing INSERT site would have to
-- learn, or a trigger. The trigger is used, and the rule itself lives
-- in public.membership_role_allowed(org_id, role) so there is exactly
-- one definition and VERIFY can call it directly.
--
-- The CHECK constraint that CAN be expressed — role in the three legal
-- values — is still a CHECK, widened in place.
--
-- ---------------------------------------------------------------------
-- THREE TRAPS IN THIS FILE, ALL AROUND ONE FUNCTION. EACH COST A RUN.
--
-- order_is_changeable() takes a ROW (public.orders) and reads one field
-- off it. That single line broke three different ways:
--
--   1. 42P01, missing FROM-clause entry for table "p_order".
--      In a `language sql` body, `p_order.submitted_at` parses as
--      TABLE.COLUMN. Composite field access needs the parentheses:
--      `(p_order).submitted_at`.
--
--   2. Function does not exist, at the call site.
--      `f(o.*)` expands `.*` to the column list instead of passing the
--      row, so it resolves to a ~29-argument call. It must be `f(o)`.
--
--   3. 42703, column "submitted_at" not found in data type orders.
--      Postgres resolves a composite field reference when the function
--      is CREATED. The function was being created before the
--      `alter table public.orders add column submitted_at` that gives
--      the row type that field. Columns now come first — see PART 2.
--
-- NEW.col / OLD.col inside the plpgsql trigger functions are a
-- different animal: plpgsql resolves its own variables, at execution
-- time, and needs none of this. Do not "fix" them.
--
-- THE SECTION ORDER IS THE FIX FOR (3) AND MUST NOT BE SHUFFLED:
--   0 guards -> 1 new tables -> 2 new columns -> 3 functions
--     -> 4 triggers -> 5 policies and grants
-- PART 2 before PART 3 because a function reads a column off a row
-- type. PART 3 before any default that names a function, which is the
-- opposite constraint and the bug that killed 0024's first run. Both
-- rules are written out in the PART 2 header.
--
-- Re-runnable. Transactional.
-- =====================================================================

begin;

-- =====================================================================
-- PART 0 — Pre-flight. Abort rather than half-apply.
-- =====================================================================

-- 0a. Tenancy must be in place. Every policy below scopes by org and
--     every new table defaults org_id to current_org_id().
do $$
declare v_missing text;
begin
  select string_agg(want.obj, ', ') into v_missing
  from (values ('orgs'), ('memberships')) as want(obj)
  where not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = want.obj
  );
  if v_missing is not null then
    raise exception 'ABORT 0027/0a: missing tenancy table(s): %. Apply 0024_tenancy.sql first.', v_missing;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_org_id'
  ) then
    raise exception 'ABORT 0027/0a: public.current_org_id() missing. Apply 0024_tenancy.sql first.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin' and p.prosecdef
  ) then
    raise exception 'ABORT 0027/0a: public.is_admin() missing or not SECURITY DEFINER.';
  end if;
end $$;

-- 0b. An appointments or labor_catalog table may exist only if THIS
--     migration created it. Anything else wearing the name is somebody
--     else's table and must not be policy-stamped by accident.
do $$
declare v_cols text;
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'appointments'
  ) then
    select string_agg(want.col, ', ') into v_cols
    from (values ('org_id'), ('assigned_to_user_id'), ('scheduled_at'), ('customer_id')) as want(col)
    where not exists (
      select 1 from pg_attribute a
      where a.attrelid = 'public.appointments'::regclass
        and a.attname = want.col and not a.attisdropped
    );
    if v_cols is not null then
      raise exception
        'ABORT 0027/0b: public.appointments already exists but is missing %. That is not the '
        'table this migration creates. Investigate before re-running.', v_cols;
    end if;
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'labor_catalog'
  ) then
    select string_agg(want.col, ', ') into v_cols
    from (values ('org_id'), ('unit'), ('rate'), ('active')) as want(col)
    where not exists (
      select 1 from pg_attribute a
      where a.attrelid = 'public.labor_catalog'::regclass
        and a.attname = want.col and not a.attisdropped
    );
    if v_cols is not null then
      raise exception
        'ABORT 0027/0b: public.labor_catalog already exists but is missing %. That is not the '
        'table this migration creates. Investigate before re-running.', v_cols;
    end if;
  end if;
end $$;

-- 0c. memberships.role must hold only values this migration knows about.
--     A fourth role would survive the widened CHECK and then fall
--     through every `role in (...)` policy below as "not permitted",
--     silently locking that user out.
do $$
declare v_other text;
begin
  select string_agg(distinct m.role, ', ') into v_other
  from public.memberships m
  where m.role not in ('owner', 'member', 'salesperson');

  if v_other is not null then
    raise exception
      'ABORT 0027/0c: unexpected memberships.role value(s): %. The policies in PART 5 admit '
      'only owner/member/salesperson; an unknown role would be silently denied everywhere.', v_other;
  end if;
end $$;

-- 0d. orders.status must hold only the eight values the survey found.
--     The lifecycle guard in PART 4 reasons about 'submitted' and
--     'completed' by name; a status nobody has heard of would take an
--     unexamined branch through it.
do $$
declare v_other text;
begin
  select string_agg(distinct o.status, ', ') into v_other
  from public.orders o
  where o.status not in (
    'submitted', 'confirmed', 'in_production', 'ready_to_ship',
    'in_transit', 'delivered', 'completed', 'cancelled'
  );

  if v_other is not null then
    raise exception
      'ABORT 0027/0d: unexpected orders.status value(s): %. Extend the lifecycle guard in '
      'PART 4 before running.', v_other;
  end if;
end $$;

-- =====================================================================
-- PART 1 — New enum + new tables
--
-- Created BEFORE the functions so the policies in PART 5 have something
-- to attach to, and AFTER the guards so nothing is created on a
-- database that failed pre-flight.
-- =====================================================================

-- labor_unit — how a labor line is measured. The ruling is that labor
-- is a formula keyed to square footage; 'each' and 'flat' exist because
-- not every line is (a toilet swap is 'each', a permit fee is 'flat').
do $$
begin
  create type public.labor_unit as enum ('sqft', 'each', 'flat');
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- appointments — a scheduled visit a salesperson works.
--
-- NOTHING RESEMBLING THIS EXISTED. Survey (b) found no appointment, no
-- visit, no scheduled_at, and no calendar anywhere in the schema or in
-- lib/*. install_date on orders is the closest thing and it is a single
-- date on a placed order, not a visit.
--
-- ADDRESS SHAPE, per (b): addresses in this system are jsonb
-- {street, city, state, zip} — contractor_customers.address (0011),
-- orders.customer_address (0005), projects.address. `address` here is
-- the same shape and is NULLABLE: null means "the customer's address",
-- which is the common case. It exists because the job site is not
-- always the billing address.
--
-- customer_id is NULLABLE. A first appointment is often booked off a
-- phone call before anyone has been entered as a customer, and a
-- salesperson cannot create the customer record (see PART 5), so
-- requiring one would make the common case impossible.
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default public.current_org_id()
                        references public.orgs (id),
  assigned_to_user_id uuid references public.profiles (id),
  customer_id         uuid references public.contractor_customers (id),
  scheduled_at        timestamptz not null,
  status              text not null default 'scheduled'
                        check (status in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  address             jsonb,                    -- {street, city, state, zip}; null = use the customer's
  notes               text,
  created_by_user_id  uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists appointments_org_scheduled_idx      on public.appointments (org_id, scheduled_at);
create index if not exists appointments_assigned_scheduled_idx on public.appointments (assigned_to_user_id, scheduled_at);
create index if not exists appointments_customer_id_idx        on public.appointments (customer_id);

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

comment on table public.appointments is
  'Added by 0027. A scheduled visit. Owners and members create and assign them; a '
  'salesperson reads only the ones assigned to them and cannot create one — enforced in '
  'policy, not in client code. address is null for "use the customer''s address".';

-- ---------------------------------------------------------------------
-- labor_catalog — placeholder. Seeded with NOTHING on purpose.
--
-- Per the ruling: labor is a formula keyed to square footage, materials
-- are untouched. The rates are real numbers nobody has supplied yet,
-- and the formulas and rep-facing toggles are 4b. This migration
-- creates the shape and the permissions so 4b has somewhere to land.
-- ---------------------------------------------------------------------
create table if not exists public.labor_catalog (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default public.current_org_id()
               references public.orgs (id),
  name       text not null,
  unit       public.labor_unit not null,
  rate       numeric(12, 2) not null default 0 check (rate >= 0),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists labor_catalog_org_active_idx on public.labor_catalog (org_id, active);

drop trigger if exists labor_catalog_set_updated_at on public.labor_catalog;
create trigger labor_catalog_set_updated_at
  before update on public.labor_catalog
  for each row execute function public.set_updated_at();

comment on table public.labor_catalog is
  'Added by 0027, deliberately empty. Owners write, members and salespeople read. The '
  'square-footage formulas and the rep-facing toggles are 4b.';

-- =====================================================================
-- PART 2 — Columns on existing tables
--
-- BEFORE THE FUNCTIONS, AND THIS ORDERING IS LOAD-BEARING IN BOTH
-- DIRECTIONS. Read this before moving anything.
--
--   A COLUMN MUST EXIST BEFORE A FUNCTION READS IT OFF THE ROW TYPE.
--   order_is_changeable(public.orders) reads (p_order).submitted_at.
--   Postgres resolves a composite field reference at function CREATION
--   time, against the row type as it stands at that moment. With the
--   functions first, `alter table public.orders add column
--   submitted_at` had not run yet, the orders row type genuinely had no
--   such field, and creation failed with 42703 "column submitted_at not
--   found in data type orders". This is the second run this file lost.
--
--   A FUNCTION MUST EXIST BEFORE A COLUMN DEFAULT REFERENCES IT.
--   The opposite constraint, and the bug that killed 0024's first run:
--   it set `default public.current_org_id()` in one part while the
--   NEXT part was what created the function, and a DEFAULT is resolved
--   at DDL time too.
--
-- The two rules point in opposite directions, so they can only both
-- hold when no column added HERE defaults to a function added in
-- PART 3. None does — check that before adding one. The two org_id
-- defaults on the new tables in PART 1 reference
-- public.current_org_id(), which 0024 created and PART 0/0a asserts.
-- =====================================================================

-- ---- memberships.role: widen to three ------------------------------
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_check
  check (role in ('owner', 'member', 'salesperson'));

comment on column public.memberships.role is
  'owner at a contractor org: the contractor principal, full authority within the org. '
  'member at a contractor org: office staff, can submit orders. '
  'salesperson at a contractor org: the contractor''s 1099 field rep, assigned appointments '
  'only — no authority to create appointments or customers, and zero discount authority '
  'regardless of orgs.discount_authority_pct. '
  'At the Kitify org, owner is admin and member is a Kitify field rep; salesperson is NOT '
  'valid at a Kitify org and is rejected by the memberships_role_guard trigger. '
  'Admin is Kitify-org MEMBERSHIP, not this column — see public.is_admin().';

-- ---- orgs.discount_authority_pct -----------------------------------
--
-- DISCOUNTS ARE NOT REPRESENTED ANYWHERE TODAY, so this column is added
-- WITHOUT an enforcement point, exactly as the brief instructed for
-- that case. What the survey found instead:
--   * proposals.markup_pct (0003) is a markup the contractor ADDS on
--     top of the dealer price. Opposite direction, different actor.
--   * discountPct in lib/hpl-shower-takeoff.ts is a fixed 25% on the
--     odd-panel HPL upsell. A product offer baked into the catalogue,
--     not a sales authority anyone exercises.
-- There is no column, no jsonb field and no input anywhere that records
-- "this salesperson discounted this quote by N%". Until 4b creates one,
-- there is nothing to clamp. The column is the durable half.
--
-- WHAT 4b MUST NOT FORGET: a salesperson's effective authority is ZERO,
-- always, regardless of what this column says. It is not configurable.
-- This column governs owners and members only.
-- ---------------------------------------------------------------------
alter table public.orgs
  add column if not exists discount_authority_pct numeric(5, 2) not null default 0;

alter table public.orgs drop constraint if exists orgs_discount_authority_pct_check;
alter table public.orgs add constraint orgs_discount_authority_pct_check
  check (discount_authority_pct >= 0 and discount_authority_pct <= 100);

comment on column public.orgs.discount_authority_pct is
  'Added by 0027. The maximum discount an OWNER or MEMBER of this org may apply. A '
  'SALESPERSON''S EFFECTIVE AUTHORITY IS ZERO REGARDLESS OF THIS VALUE — not configurable. '
  'No enforcement point exists yet: as of 0027 no discount is recorded anywhere in quotes or '
  'orders (proposals.markup_pct is a contractor markup, the opposite direction). 4b adds the '
  'representation and the clamp.';

-- ---- orders.submitted_at -------------------------------------------
--
-- !! THIS MUST STAY AHEAD OF PART 3. !! order_is_changeable() reads
-- this field off the public.orders row type, and that read is resolved
-- when the function is CREATED, not when it is called.
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists submitted_at timestamptz;

-- Backfill from placed_at, which is what the client has been stamping
-- at insert since 0001 (lib/store.ts:743). created_at is the fallback.
-- Every existing order was created in 'submitted' status by
-- createOrderFromProposal, so every existing order has a submission
-- moment; none is left null.
update public.orders
   set submitted_at = coalesce(placed_at, created_at)
 where submitted_at is null;

create index if not exists orders_submitted_at_idx on public.orders (submitted_at);

comment on column public.orders.submitted_at is
  'Added by 0027. When the order entered ''submitted''. Stamped by the '
  'orders_lifecycle_guard trigger, NEVER by the client — placed_at is client-supplied '
  '(lib/store.ts:743) and a clock that decides who may cancel cannot start from a value the '
  'client chooses. Backfilled from placed_at for orders that predate this migration.';

-- =====================================================================
-- PART 3 — Functions
--
-- AFTER PART 2, because order_is_changeable() reads submitted_at off
-- the orders row type and that field has to exist first. See the
-- PART 2 header for the full rule and for the opposite constraint it
-- has to coexist with.
--
-- Every one of these follows the pattern 0023 established and 0024
-- repeated: SECURITY DEFINER where it reads memberships, search_path =
-- '', every reference fully qualified.
--
-- The three "rule" functions (membership_role_allowed,
-- appointment_role_may_create, order_change_window_open) are SECURITY
-- INVOKER and take their inputs as parameters. That is what lets the
-- VERIFY block below prove the actual rules by calling them, instead of
-- pattern-matching policy text and hoping.
-- =====================================================================

-- ---------------------------------------------------------------------
-- current_membership_role() — the caller's role in their own org.
--
-- SAME TIEBREAK AS current_org_id() AND AS loadOrg() IN
-- components/AuthContext.tsx: earliest membership by created_at then
-- id. All three must resolve to the SAME membership row or the client
-- would name one org while the database scoped by another, and this
-- function would report a role from a third. The ordering is
-- load-bearing, not incidental — change them together.
-- ---------------------------------------------------------------------
create or replace function public.current_membership_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at, m.id
  limit 1;
$$;

comment on function public.current_membership_role() is
  'Added by 0027. The caller''s membership role (owner | member | salesperson), or NULL for '
  'an unauthenticated or membership-less session. Resolves the SAME membership row as '
  'public.current_org_id() — identical order by created_at, id limit 1 — so the two cannot '
  'diverge. NOT an admin check: admin is Kitify-org membership, via public.is_admin().';

-- ---------------------------------------------------------------------
-- membership_role_allowed(org, role) — the Kitify/salesperson rule.
--
-- One definition, called by the trigger below and callable directly by
-- VERIFY. A salesperson is a contractor's 1099 field rep; there is no
-- such thing at the house.
-- ---------------------------------------------------------------------
create or replace function public.membership_role_allowed(p_org_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_role not in ('owner', 'member', 'salesperson') then false
    when p_role <> 'salesperson' then true
    else not exists (
      select 1 from public.orgs o
      where o.id = p_org_id and o.kind = 'kitify'
    )
  end;
$$;

comment on function public.membership_role_allowed(uuid, text) is
  'Added by 0027. False for salesperson at a kitify org, true otherwise for the three legal '
  'roles. Enforced by the memberships_role_guard trigger. This is a FUNCTION rather than a '
  'CHECK constraint because the rule spans two tables and a CHECK cannot.';

-- ---------------------------------------------------------------------
-- appointment_role_may_create(role) — who books a visit.
--
-- "A salesperson cannot create an appointment or a customer. They work
-- what is assigned." Owners and members book; salespeople do not.
-- ---------------------------------------------------------------------
create or replace function public.appointment_role_may_create(p_role text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_role in ('owner', 'member'), false);
$$;

comment on function public.appointment_role_may_create(text) is
  'Added by 0027. True for owner and member, false for salesperson and for NULL (no '
  'membership). Backs the INSERT policy on public.appointments and the INSERT policy on '
  'public.contractor_customers — a rep works what is assigned, and creates neither.';

-- ---------------------------------------------------------------------
-- order_change_window_open(submitted_at) — the 48-hour rule itself.
--
-- THE LOCKED RULING, WRITTEN DOWN SO IT IS NOT RE-LITIGATED: the clock
-- starts at SUBMISSION, not at admin acceptance. A contractor's 48
-- hours must not be shortened by how long Kitify takes to look at the
-- order.
--
-- NULL submitted_at reads as OPEN. An order that has not been submitted
-- cannot have passed a deadline measured from its submission, and
-- failing closed there would lock a draft nobody had sent.
--
-- Split from order_is_changeable(orders) so the boundary can be proven
-- read-only against any timestamp. The row function below is the only
-- caller that matters and delegates here, so there is still one
-- definition of "48 hours".
-- ---------------------------------------------------------------------
create or replace function public.order_change_window_open(p_submitted_at timestamptz)
returns boolean
language sql
stable
as $$
  select p_submitted_at is null
      or p_submitted_at > now() - interval '48 hours';
$$;

comment on function public.order_change_window_open(timestamptz) is
  'Added by 0027. The 48-hour contractor change window, measured from SUBMISSION (not from '
  'admin acceptance — locked ruling). NULL reads as open: an unsubmitted order has no '
  'deadline to have passed.';

-- ---------------------------------------------------------------------
-- order_is_changeable(orders) — the row-level entry point.
--
-- Takes the row so callers can write `public.order_is_changeable(o)` or
-- `o.order_is_changeable` from a query, which is what 4c's countdown
-- will read. Says nothing about WHO is asking: admin override lives at
-- the enforcement point, deliberately, so this stays a fact about the
-- order rather than about the session.
--
-- !! THREE TRAPS, ONE PER RUN THIS FILE HAS LOST. !!
--
-- 1. THE BODY. `p_order.submitted_at` is parsed as TABLE.COLUMN, so
--    Postgres looks for a FROM-clause entry named p_order, finds none,
--    and raises 42P01. Composite field access needs the parentheses:
--    (p_order).submitted_at. This is a `language sql` problem
--    specifically — the body is parsed as plain SQL, where a dotted
--    name is qualification, not field selection. NEW.col and OLD.col
--    inside the plpgsql trigger functions below are NOT affected and
--    need no parentheses: plpgsql resolves its own variables first.
--
-- 2. THE CALL SITE. `order_is_changeable(o.*)` does NOT pass the row —
--    `.*` expands to the column list, so it resolves to a call with
--    ~29 scalar arguments and fails with "function does not exist".
--    Pass the bare alias: `order_is_changeable(o)`. VERIFY check 4c had
--    this bug and is fixed.
--
-- 3. THE ORDERING. Once (1) parsed, it raised 42703, column
--    "submitted_at" not found in data type orders — because a
--    composite field reference is resolved when the function is
--    CREATED, against the row type as it stands right then, and
--    orders.submitted_at was being added AFTER this. That is why
--    PART 2 (columns) now runs before PART 3 (functions), and why
--    moving them back would break this function and nothing else,
--    silently, at the next `supabase db push` on a fresh database.
--
-- KEPT AS `language sql` RATHER THAN plpgsql. plpgsql would make trap 1
-- go away, because its variable resolution runs before the SQL parser
-- sees the name. It would also stop the planner inlining this: a STABLE
-- sql function this small is folded into the calling query, which
-- matters because 4c's countdown reads it across every order on the
-- page and VERIFY check 4c reads it across the whole table. One pair of
-- parentheses is a cheaper fix than a per-row function call, and the
-- trap is now written down.
-- ---------------------------------------------------------------------
create or replace function public.order_is_changeable(p_order public.orders)
returns boolean
language sql
stable
as $$
  select public.order_change_window_open((p_order).submitted_at);
$$;

comment on function public.order_is_changeable(public.orders) is
  'Added by 0027. True while the order is inside its 48-hour change window. A fact about the '
  'ORDER, not about the caller — an admin may alter a locked order, and that override lives '
  'in the orders_lifecycle_guard trigger, not here.';

revoke execute on function public.current_membership_role()                     from anon, public;
revoke execute on function public.membership_role_allowed(uuid, text)           from anon, public;
revoke execute on function public.appointment_role_may_create(text)             from anon, public;
revoke execute on function public.order_change_window_open(timestamptz)         from anon, public;
revoke execute on function public.order_is_changeable(public.orders)            from anon, public;

grant execute on function public.current_membership_role()                      to authenticated, service_role;
grant execute on function public.membership_role_allowed(uuid, text)            to authenticated, service_role;
grant execute on function public.appointment_role_may_create(text)              to authenticated, service_role;
grant execute on function public.order_change_window_open(timestamptz)          to authenticated, service_role;
grant execute on function public.order_is_changeable(public.orders)             to authenticated, service_role;

-- =====================================================================
-- PART 4 — Triggers
--
-- After the functions, because every trigger function below calls one
-- of them by name. A plpgsql body is NOT resolved at creation time —
-- the call would be looked up on first execution — but the two guards
-- here fire on tables this migration is about to be verified against,
-- so a missing function would surface as a runtime error in VERIFY
-- rather than as a failed migration. Keeping them after PART 3 means
-- that cannot happen.
-- =====================================================================

-- ---------------------------------------------------------------------
-- memberships_role_guard — salesperson is not valid at a Kitify org.
--
-- Fires regardless of RLS and regardless of grants, so it holds even
-- against service_role and against the SQL Editor. That is deliberate:
-- the rule is about what the data may MEAN, not about who is writing.
-- ---------------------------------------------------------------------
create or replace function public.memberships_role_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.membership_role_allowed(new.org_id, new.role) then
    raise exception
      'MEMBERSHIP_ROLE_INVALID: role "%" is not valid for org % (a salesperson is a '
      'contractor''s field rep; there is no salesperson at the Kitify org)',
      new.role, new.org_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_role_guard on public.memberships;
create trigger memberships_role_guard
  before insert or update on public.memberships
  for each row execute function public.memberships_role_guard();

-- ---------------------------------------------------------------------
-- orders_lifecycle_guard — two jobs, one trigger.
--
--   1. Stamp submitted_at on entry into 'submitted' (INSERT or UPDATE),
--      once. Never rewritten: a re-entry or a manual correction must
--      not restart the contractor's clock.
--   2. Enforce the 48-hour change window for non-admins.
--
-- The admin override is `public.is_admin()`, which since 0024 means
-- membership of the Kitify org. auth.uid() IS NULL — service_role, the
-- SQL Editor, a SECURITY DEFINER function — also passes: those are not
-- a contractor changing their mind, and locking them out would mean a
-- support fix required disabling a trigger.
--
-- See the header for what is and is not locked, and why.
-- ---------------------------------------------------------------------
create or replace function public.orders_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text;
begin
  -- ---- 1. stamp submitted_at, once ---------------------------------
  if new.status = 'submitted' and new.submitted_at is null then
    new.submitted_at := now();
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  -- Never let an existing stamp be moved. The window is measured from
  -- it, so a writable submitted_at is a writable deadline.
  if old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then
    new.submitted_at := old.submitted_at;
  end if;

  -- ---- 2. the 48-hour window ---------------------------------------
  if public.is_admin() or auth.uid() is null then
    return new;
  end if;

  if public.order_change_window_open(old.submitted_at) then
    return new;
  end if;

  -- Window closed, caller is a contractor. What was ORDERED is frozen.
  select string_agg(c.col, ', ') into v_changed
  from (values
    ('project_id',       new.project_id       is distinct from old.project_id),
    ('quote_id',         new.quote_id         is distinct from old.quote_id),
    ('proposal_id',      new.proposal_id      is distinct from old.proposal_id),
    ('snapshot',         new.snapshot         is distinct from old.snapshot),
    ('customer_name',    new.customer_name    is distinct from old.customer_name),
    ('customer_email',   new.customer_email   is distinct from old.customer_email),
    ('customer_phone',   new.customer_phone   is distinct from old.customer_phone),
    ('customer_address', new.customer_address is distinct from old.customer_address)
  ) as c(col, did_change)
  where c.did_change;

  if v_changed is not null then
    raise exception
      'ORDER_LOCKED: order % passed its 48-hour change window at %; % may no longer be '
      'changed by the contractor. Contact Kitify.',
      old.order_number, old.submitted_at + interval '48 hours', v_changed
      using errcode = '42501';
  end if;

  -- Status: 'completed' is the contractor's terminal action after
  -- install and is allowed indefinitely. Everything else — cancellation
  -- above all — belongs to Kitify once the window has closed.
  if new.status is distinct from old.status and new.status <> 'completed' then
    raise exception
      'ORDER_LOCKED: order % passed its 48-hour change window at %; the contractor may no '
      'longer move it from "%" to "%". Contact Kitify.',
      old.order_number, old.submitted_at + interval '48 hours', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_lifecycle_guard on public.orders;
create trigger orders_lifecycle_guard
  before insert or update on public.orders
  for each row execute function public.orders_lifecycle_guard();

comment on function public.orders_lifecycle_guard() is
  'Added by 0027. Stamps orders.submitted_at once on entry into ''submitted'', and enforces '
  'the 48-hour contractor change window. Column-scoped on purpose: the contractor''s '
  'post-delivery work (install date, completion photos, warranty, mark completed) must keep '
  'working months after submission. Admins and auth.uid() IS NULL sessions bypass.';

-- =====================================================================
-- PART 5 — Policies and grants
--
-- THE GRANT GAP, FOR THE FOURTH TIME. "Automatically expose new tables"
-- is OFF (see supabase/baseline/README.md), but that setting governs
-- PostgREST exposure, not privileges: Postgres default role grants
-- still apply at CREATE TABLE. profiles hit this in 0022 and events hit
-- it in 0024. So every new table below is revoked from anon and PUBLIC
-- first, then granted back to authenticated explicitly.
--
-- !! THE PARAGRAPH ABOVE IS WRONG AND THIS FILE SHIPPED THE BUG. !!
-- `revoke ... from anon, public` DOES NOT TOUCH `authenticated`, and
-- `authenticated` is the role the default grant goes to. The revokes
-- below cleared nothing that mattered and the grants that follow them
-- merely re-stated four of the seven privileges already present —
-- TRUNCATE, REFERENCES and TRIGGER stayed. Repaired by 0028 (these two
-- tables) and 0029 (the other thirty the sweep found).
--
-- DO NOT COPY THIS PATTERN. The correct form is
-- `revoke all on <table> from authenticated, anon;` followed by the
-- explicit grants — see the STANDING RULE at the top of
-- supabase/baseline/README.md. The SQL below is left exactly as it ran.
-- =====================================================================

alter table public.appointments  enable row level security;
alter table public.labor_catalog enable row level security;

-- ---- appointments ---------------------------------------------------
--
-- SELECT: the org sees its own; a salesperson sees ONLY what is
-- assigned to them. Kitify sees everything.
--
-- The salesperson clause is written as
--   role <> 'salesperson' or assigned_to_user_id = auth.uid()
-- so that a NULL role (no membership) is not silently treated as a
-- salesperson — it fails the org_id test first and sees nothing either
-- way, but the predicate says what it means.
drop policy if exists appointments_select_org on public.appointments;
create policy appointments_select_org on public.appointments
  for select to authenticated
  using (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and (
        coalesce(public.current_membership_role(), '') <> 'salesperson'
        or assigned_to_user_id = auth.uid()
      )
    )
  );

-- INSERT: owners and members only. ONE insert policy, deliberately —
-- multiple permissive policies OR together, so a second one added
-- later would re-open this without touching the policy below.
drop policy if exists appointments_insert_org on public.appointments;
create policy appointments_insert_org on public.appointments
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and public.appointment_role_may_create(public.current_membership_role())
    )
  );

-- UPDATE: owners and members reassign and reschedule. A salesperson
-- gets NO update in 0027 — the brief locked SELECT and no-INSERT and
-- said nothing about writes, and a bare UPDATE grant would let a rep
-- reassign their own appointment to someone else or move it to another
-- org. The rep-facing "mark visited / add notes" write is 4b, and needs
-- a column-scoped policy or an RPC, the same shape as 0023's profiles
-- lock. See the report.
drop policy if exists appointments_update_org on public.appointments;
create policy appointments_update_org on public.appointments
  for update to authenticated
  using (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and public.appointment_role_may_create(public.current_membership_role())
    )
  )
  with check (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and public.appointment_role_may_create(public.current_membership_role())
    )
  );

drop policy if exists appointments_delete_org on public.appointments;
create policy appointments_delete_org on public.appointments
  for delete to authenticated
  using (
    public.is_admin()
    or (org_id = public.current_org_id() and public.current_membership_role() = 'owner')
  );

revoke all on public.appointments from anon, public;
grant select, insert, update, delete on public.appointments to authenticated;

-- ---- labor_catalog --------------------------------------------------
--
-- "Owners set it. Members read it. Salespeople read it. Nobody but an
-- owner or admin writes it."
drop policy if exists labor_catalog_select_org on public.labor_catalog;
create policy labor_catalog_select_org on public.labor_catalog
  for select to authenticated
  using (org_id = public.current_org_id() or public.is_admin());

drop policy if exists labor_catalog_insert_owner on public.labor_catalog;
create policy labor_catalog_insert_owner on public.labor_catalog
  for insert to authenticated
  with check (
    public.is_admin()
    or (org_id = public.current_org_id() and public.current_membership_role() = 'owner')
  );

drop policy if exists labor_catalog_update_owner on public.labor_catalog;
create policy labor_catalog_update_owner on public.labor_catalog
  for update to authenticated
  using (
    public.is_admin()
    or (org_id = public.current_org_id() and public.current_membership_role() = 'owner')
  )
  with check (
    public.is_admin()
    or (org_id = public.current_org_id() and public.current_membership_role() = 'owner')
  );

drop policy if exists labor_catalog_delete_owner on public.labor_catalog;
create policy labor_catalog_delete_owner on public.labor_catalog
  for delete to authenticated
  using (
    public.is_admin()
    or (org_id = public.current_org_id() and public.current_membership_role() = 'owner')
  );

revoke all on public.labor_catalog from anon, public;
grant select, insert, update, delete on public.labor_catalog to authenticated;

-- ---- contractor_customers: a salesperson creates no customers -------
--
-- "A salesperson cannot create an appointment OR A CUSTOMER." 0024's
-- contractor_customers_insert_org admits anyone in the org; this
-- narrows it by role and changes nothing else.
--
-- SELECT IS DELIBERATELY UNCHANGED. A rep must be able to read the
-- customer attached to an appointment they are assigned, and narrowing
-- the read was not asked for. Recorded so the omission is visible.
drop policy if exists contractor_customers_insert_org on public.contractor_customers;
create policy contractor_customers_insert_org on public.contractor_customers
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and public.appointment_role_may_create(public.current_membership_role())
    )
  );

commit;


-- =====================================================================
-- =====================================================================
--                          VERIFY SCRIPT
--
-- READ-ONLY. Run in the SQL Editor after applying. Every row must read
-- pass = true.
--
-- pg_catalog "char" columns (polcmd, tgenabled) are cast to ::text
-- before comparison — same fix as 0023, 0024 and 0026.
--
-- Checks 1, 2 and 4 prove the RULES by calling the functions that
-- define them, rather than by pattern-matching policy text. That is why
-- those functions take parameters.
-- =====================================================================
-- =====================================================================

-- 1. salesperson is valid at a contractor org...
select
  '1. salesperson valid at contractor org'                          as check,
  o.name                                                            as detail,
  'true'                                                            as expected,
  public.membership_role_allowed(o.id, 'salesperson')::text         as actual,
  public.membership_role_allowed(o.id, 'salesperson')               as pass
from public.orgs o
where o.kind = 'contractor'

union all
-- 1b. ...and rejected at the Kitify org
select
  '1b. salesperson rejected at kitify org',
  o.name,
  'false',
  public.membership_role_allowed(o.id, 'salesperson')::text,
  not public.membership_role_allowed(o.id, 'salesperson')
from public.orgs o
where o.kind = 'kitify'

union all
-- 1c. owner and member stay valid at the Kitify org (the widened CHECK
--     must not have narrowed anything)
select
  '1c. owner/member still valid at kitify',
  r.role,
  'true',
  public.membership_role_allowed(o.id, r.role)::text,
  public.membership_role_allowed(o.id, r.role)
from public.orgs o
cross join (values ('owner'), ('member')) as r(role)
where o.kind = 'kitify'

union all
-- 1d. the guard trigger exists and is ENABLED (a disabled trigger is
--     the failure mode that looks exactly like a working one)
select
  '1d. memberships_role_guard enabled',
  t.tgname,
  'O',
  t.tgenabled::text,
  t.tgenabled::text = 'O'
from pg_trigger t
where t.tgrelid = 'public.memberships'::regclass
  and t.tgname = 'memberships_role_guard'

union all
-- 1e. no existing membership violates the new rule
select
  '1e. no kitify salespeople exist',
  'violating memberships',
  '0',
  count(*)::text,
  count(*) = 0
from public.memberships m
join public.orgs o on o.id = m.org_id
where o.kind = 'kitify' and m.role = 'salesperson'

union all
-- 2. a salesperson cannot INSERT an appointment — the rule itself
select
  '2. salesperson may not create appointments',
  r.role,
  r.want::text,
  public.appointment_role_may_create(r.role)::text,
  public.appointment_role_may_create(r.role) = r.want
from (values ('owner', true), ('member', true), ('salesperson', false)) as r(role, want)

union all
-- 2b. ...and NULL (no membership) is not accidentally permitted
select
  '2b. no-membership may not create appointments',
  'null role',
  'false',
  public.appointment_role_may_create(null)::text,
  public.appointment_role_may_create(null) = false

union all
-- 2c. EXACTLY ONE insert policy on appointments. Permissive policies OR
--     together, so a second one would re-open this silently.
select
  '2c. one INSERT policy on appointments',
  'insert policy count',
  '1',
  count(*)::text,
  count(*) = 1
from pg_policy pol
where pol.polrelid = 'public.appointments'::regclass
  and pol.polcmd::text = 'a'                    -- "char": a = INSERT

union all
-- 2d. ...and it routes through the rule function rather than inlining it
select
  '2d. appointments INSERT uses the rule fn',
  pol.polname,
  'true',
  (pg_get_expr(pol.polwithcheck, pol.polrelid) like '%appointment_role_may_create%')::text,
  pg_get_expr(pol.polwithcheck, pol.polrelid) like '%appointment_role_may_create%'
from pg_policy pol
where pol.polrelid = 'public.appointments'::regclass
  and pol.polcmd::text = 'a'

union all
-- 2e. the same guard reached contractor_customers
select
  '2e. contractor_customers INSERT role-gated',
  pol.polname,
  'true',
  (pg_get_expr(pol.polwithcheck, pol.polrelid) like '%appointment_role_may_create%')::text,
  pg_get_expr(pol.polwithcheck, pol.polrelid) like '%appointment_role_may_create%'
from pg_policy pol
where pol.polrelid = 'public.contractor_customers'::regclass
  and pol.polcmd::text = 'a'

union all
-- 3. submitted_at exists and the stamping trigger is enabled
select
  '3. orders_lifecycle_guard enabled',
  t.tgname,
  'O',
  t.tgenabled::text,
  t.tgenabled::text = 'O'
from pg_trigger t
where t.tgrelid = 'public.orders'::regclass
  and t.tgname = 'orders_lifecycle_guard'

union all
-- 3b. every submitted order carries a submission moment (the backfill
--     landed, and nothing has slipped through since)
select
  '3b. every order has submitted_at',
  'orders with null submitted_at',
  '0',
  count(*)::text,
  count(*) = 0
from public.orders
where submitted_at is null

union all
-- 3c. submitted_at is NOT client-defaulted — it must have no DEFAULT at
--     all, so the trigger is the only thing that can set it
select
  '3c. submitted_at has no column default',
  'pg_attrdef entry',
  'none',
  coalesce(pg_get_expr(d.adbin, d.adrelid), 'none'),
  d.adbin is null
from pg_attribute a
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where a.attrelid = 'public.orders'::regclass
  and a.attname = 'submitted_at'
  and not a.attisdropped

union all
-- 4. an order older than 48 hours is NOT changeable; one inside the
--    window is. Proven against the rule function at both sides of the
--    boundary, plus the null case.
select
  '4. 48-hour window boundary',
  w.label,
  w.want::text,
  public.order_change_window_open(w.ts)::text,
  public.order_change_window_open(w.ts) = w.want
from (values
  ('49 hours ago (locked)',  now() - interval '49 hours', false),
  ('47 hours ago (open)',    now() - interval '47 hours', true),
  ('1 minute ago (open)',    now() - interval '1 minute', true),
  ('never submitted (open)', null::timestamptz,           true)
) as w(label, ts, want)

union all
-- 4b. the row function delegates to it, so there is one definition
select
  '4b. order_is_changeable delegates',
  'order_is_changeable',
  'true',
  (p.prosrc like '%order_change_window_open%')::text,
  p.prosrc like '%order_change_window_open%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'order_is_changeable'

union all
-- 4c. ...and every real order agrees with the rule applied to its own
--     submitted_at (catches a row function that silently stopped
--     reading the column it is supposed to read)
--
--     `order_is_changeable(o)` — the BARE ALIAS, not `o.*`. See the
--     header above the function: `.*` expands to the column list and
--     would resolve to a ~29-argument call that does not exist.
select
  '4c. row fn agrees with rule fn',
  'disagreeing orders',
  '0',
  count(*)::text,
  count(*) = 0
from public.orders o
where public.order_is_changeable(o)
  is distinct from public.order_change_window_open(o.submitted_at)

union all
-- 5. discount_authority_pct defaults to 0
select
  '5. discount_authority_pct default',
  'column default',
  '0',
  coalesce(pg_get_expr(d.adbin, d.adrelid), '(none)'),
  coalesce(pg_get_expr(d.adbin, d.adrelid), '') like '0%'
from pg_attribute a
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where a.attrelid = 'public.orgs'::regclass
  and a.attname = 'discount_authority_pct'
  and not a.attisdropped

union all
-- 5b. ...and every existing org actually holds 0
select
  '5b. every org holds 0 today',
  'orgs with a non-zero authority',
  '0',
  count(*)::text,
  count(*) = 0
from public.orgs
where discount_authority_pct <> 0

union all
-- 6. anon holds NOTHING on either new table
select
  '6. anon has no grant',
  tbl.name || ' / ' || pr.priv,
  'false',
  has_table_privilege('anon', tbl.name, pr.priv)::text,
  not has_table_privilege('anon', tbl.name, pr.priv)
from (values ('public.appointments'), ('public.labor_catalog')) as tbl(name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES')) as pr(priv)

union all
-- 6b. authenticated holds exactly SELECT/INSERT/UPDATE/DELETE and
--     nothing more — TRUNCATE and REFERENCES are the two that arrive by
--     default grant and are never wanted
select
  '6b. authenticated holds only DML',
  tbl.name || ' / ' || pr.priv,
  pr.want::text,
  has_table_privilege('authenticated', tbl.name, pr.priv)::text,
  has_table_privilege('authenticated', tbl.name, pr.priv) = pr.want
from (values ('public.appointments'), ('public.labor_catalog')) as tbl(name)
cross join (values
  ('SELECT', true), ('INSERT', true), ('UPDATE', true), ('DELETE', true),
  ('TRUNCATE', false), ('REFERENCES', false)
) as pr(priv, want)

union all
-- 6c. RLS is actually ON. A grant without RLS is a table-wide read.
select
  '6c. RLS enabled',
  c.relname,
  'true',
  c.relrowsecurity::text,
  c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('appointments', 'labor_catalog')

union all
-- 6d. no USING (true) / WITH CHECK (true) crept in on the new tables
select
  '6d. no permissive-everything policy',
  'offending policies on the two new tables',
  '0',
  count(*)::text,
  count(*) = 0
from pg_policy pol
where pol.polrelid in ('public.appointments'::regclass, 'public.labor_catalog'::regclass)
  and (btrim(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')) = 'true'
    or btrim(coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) = 'true')

union all
-- 7. current_membership_role() and current_org_id() must resolve the
--    SAME membership row, or a user's role would be read from one org
--    while their rows were scoped to another. Both must carry the
--    identical tiebreak, and loadOrg() in components/AuthContext.tsx
--    carries it too. This is a drift check on the function bodies,
--    because with today's one-membership-per-user data any behavioural
--    comparison would pass whether they agreed or not.
select
  '7. role and org share the tiebreak',
  p.proname,
  'true',
  (p.prosrc like '%order by m.created_at, m.id%')::text,
  p.prosrc like '%order by m.created_at, m.id%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('current_org_id', 'current_membership_role')

order by 1, 2;
