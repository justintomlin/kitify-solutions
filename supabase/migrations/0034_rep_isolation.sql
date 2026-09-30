-- =====================================================================
-- 0034_rep_isolation.sql
--
-- The access half of rep isolation. A salesperson sees what they were
-- assigned and what they made, and nothing else.
--
--   0027  the salesperson role, appointments, assigned_to_user_id
--   0030  order creation by role
--   0031  the acceptance record and the customer book
--   0032  transition legality and the commercial-term freeze
--   0033  attribution for the close
--   0034  visibility
--
-- THE RULING, locked. Option A, narrow. A salesperson sees the
-- appointments assigned to them, the customers attached to those
-- appointments, and the projects, quotes and proposals they themselves
-- created. Nothing else. Owners, members and Kitify admins are
-- unaffected.
--
-- ---------------------------------------------------------------------
-- WHY THIS CHANGES ALMOST NOTHING ON SCREEN, AND WHY THAT IS THE POINT
--
-- Every contractor-facing read in the app ALREADY passes the signed-in
-- user id: listProjects(ownerId), listQuotes({ownerId}),
-- listProposals({ownerId}), listOrders({ownerId}),
-- listContractorCustomers(userId). The client has been narrower than
-- the policy since 0024 — recorded at the time as item 8 of the Phase 1
-- notes, "the read filters scope by USER, RLS scopes by ORG".
--
-- So narrowing these policies mostly makes the database agree with what
-- the client was already asking for. That is defence in depth rather
-- than a behaviour change, and it means a rep who reaches past the UI
-- gets nothing rather than the whole org.
--
-- THE ONE PLACE IT IS A REAL CHANGE is the project detail page, which
-- reads by project_id rather than by owner: a rep opening their own
-- project now sees only the quotes and proposals THEY created on it.
-- An owner who adds a quote to a rep''s project becomes invisible to
-- that rep. That is what the ruling says, and it is worth knowing
-- before someone reports it as a bug.
--
-- THE ONE PLACE IT BREAKS is contractor_customers, and it needs a
-- client change rather than only a policy. See the note on that policy
-- in PART 3.
--
-- ---------------------------------------------------------------------
-- owner_id IS THE RIGHT COLUMN HERE, AND THIS IS NOT THE OVERLOAD 0033
-- WARNED ABOUT
--
-- 0033 refused owner_id for ATTRIBUTION, because credit is a commercial
-- fact that must be able to differ from who typed the row, and because
-- coupling the money to the tenancy anchor means the next person to
-- change one breaks the other.
--
-- Visibility is the opposite case. "The rows I created" is precisely
-- what owner_id means, it is set at insert and never moves, and reading
-- it in a policy redefines nothing. Using it here is using it for its
-- actual meaning, not borrowing it for a second one.
--
-- ---------------------------------------------------------------------
-- THE APPOINTMENT LINK GOES ON projects, AND ON NOTHING ELSE
--
-- Work flows appointment -> project -> quotes -> proposals -> order.
-- Quotes and proposals already reach the appointment through
-- project_id, so putting appointment_id on all three would be three
-- places for one fact and three chances for them to disagree.
--
-- NULLABLE. Work created outside an appointment is legitimate for an
-- owner or a member, and every project that exists today has no
-- appointment to point at.
--
-- NOT REQUIRED FOR A SALESPERSON, and that is a recommendation rather
-- than an omission. It is perfectly enforceable — a trigger asserting
-- appointment_id is not null when current_membership_role() is
-- salesperson is four lines — but the rep-facing project creation flow
-- does not exist yet, and shipping the constraint first means a rep
-- hits a wall with no way over it. Add it when that flow is real.
--
-- WHAT IS ENFORCED NOW is the half that is about security rather than
-- process: IF an appointment_id is set, it must point at an appointment
-- in the caller''s own org, and a salesperson may only point at one
-- assigned to them. Without that, appointment_id is a visibility
-- escalation vector the moment anything reads through it — a rep could
-- attach their project to somebody else''s appointment and inherit the
-- customer. See projects_appointment_guard in PART 4.
--
-- ---------------------------------------------------------------------
-- DEPENDENCY ORDERING. Column (PART 2) before the guard that reads it
-- (PART 4) and before the policies that reference it (PART 3). Nothing
-- defaults to a function. The appointments table and
-- current_membership_role() both predate this file.
--
-- NO TABLE IS CREATED. The rule if one ever is:
-- `revoke all on <table> from authenticated, anon;` then the explicit
-- grants. `from anon, public` does NOT cover `authenticated`.
--
-- VERIFY IS THREE PLAIN QUERIES, in the shape 0033 ended up with after
-- its assertion block failed to execute three times. No constructed
-- assertions, no needle containing a dot.
--
-- Re-runnable. Transactional.
-- =====================================================================

begin;

-- =====================================================================
-- PART 0 — Pre-flight
-- =====================================================================

-- 0a. Everything this file reuses must exist.
do $$
declare v_missing text;
begin
  select string_agg(want.fn, ', ') into v_missing
  from (values ('current_membership_role'), ('is_admin'), ('current_org_id')) as want(fn)
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = want.fn
  );
  if v_missing is not null then
    raise exception 'ABORT 0034/0a: missing function(s): %. Apply 0024 and 0027 first.', v_missing;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'appointments'
  ) then
    raise exception 'ABORT 0034/0a: public.appointments is missing. Apply 0027 first.';
  end if;
end $$;

-- 0b. The four tables whose SELECT policy is rewritten must each carry
--     the columns those policies read. A missing owner_id would produce
--     a policy that silently matches nothing.
do $$
declare v_missing text;
begin
  select string_agg(want.tbl || '.' || want.col, ', ') into v_missing
  from (values
    ('projects', 'owner_id'), ('projects', 'org_id'),
    ('quotes', 'owner_id'), ('quotes', 'org_id'),
    ('proposals', 'owner_id'), ('proposals', 'org_id'),
    ('contractor_customers', 'org_id'),
    ('appointments', 'assigned_to_user_id'), ('appointments', 'customer_id')
  ) as want(tbl, col)
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = ('public.' || want.tbl)::regclass
      and a.attname = want.col and not a.attisdropped
  );
  if v_missing is not null then
    raise exception 'ABORT 0034/0b: missing column(s): %.', v_missing;
  end if;
end $$;

-- 0c. memberships.role must still hold only the three known values.
--     Every policy below branches on salesperson by name.
do $$
declare v_other text;
begin
  select string_agg(distinct m.role, ', ') into v_other
  from public.memberships m where m.role not in ('owner', 'member', 'salesperson');
  if v_other is not null then
    raise exception 'ABORT 0034/0c: unexpected memberships.role value(s): %.', v_other;
  end if;
end $$;

-- =====================================================================
-- PART 2 — The appointment link
-- =====================================================================
alter table public.projects
  add column if not exists appointment_id uuid references public.appointments (id);

-- Partial: most projects will never have one, and indexing the nulls
-- buys nothing. The rep dashboard joins the other way, from a rep to
-- their appointments to the work.
create index if not exists projects_appointment_id_idx
  on public.projects (appointment_id)
  where appointment_id is not null;

comment on column public.projects.appointment_id is
  'Added by 0034. The visit this project came out of, or NULL for work created without one, '
  'which is legitimate for an owner or a member. Quotes and proposals reach it through '
  'project_id rather than carrying their own copy. Not required for a salesperson yet — see '
  'the file header — but validated when set by projects_appointment_guard, because an '
  'unchecked appointment_id is a visibility escalation vector.';

-- =====================================================================
-- PART 3 — The narrowed SELECT policies
--
-- One shape, matching 0027 appointments_select_org exactly:
--
--     is_admin()
--     or (own org AND (not a salesperson OR mine))
--
-- The salesperson clause is written as `role <> salesperson or ...`
-- rather than `role = salesperson and ...` so that a NULL role — a
-- session with no membership — is not silently treated as a
-- salesperson. It fails the org test first and sees nothing either way,
-- but the predicate says what it means.
--
-- ONLY SELECT IS TOUCHED. INSERT, UPDATE and DELETE keep the org-scoped
-- policies 0024 wrote and 0031 narrowed. A rep who can see only their
-- own rows cannot write anybody else''s regardless, because the write
-- policies still require the org and RLS applies the USING clause of
-- the relevant command.
-- =====================================================================

-- ---- projects --------------------------------------------------------
drop policy if exists projects_select_org on public.projects;
create policy projects_select_org on public.projects
  for select to authenticated
  using (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and (
        coalesce(public.current_membership_role(), '') <> 'salesperson'
        or owner_id = auth.uid()
      )
    )
  );

-- ---- quotes ----------------------------------------------------------
drop policy if exists quotes_select_org on public.quotes;
create policy quotes_select_org on public.quotes
  for select to authenticated
  using (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and (
        coalesce(public.current_membership_role(), '') <> 'salesperson'
        or owner_id = auth.uid()
      )
    )
  );

-- ---- proposals -------------------------------------------------------
--
-- NOTE ON THE PUBLIC PROPOSAL ROUTE: it reads by share_token as
-- service_role, which bypasses RLS entirely, so narrowing here cannot
-- break a homeowner''s link.
drop policy if exists proposals_select_org on public.proposals;
create policy proposals_select_org on public.proposals
  for select to authenticated
  using (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and (
        coalesce(public.current_membership_role(), '') <> 'salesperson'
        or owner_id = auth.uid()
      )
    )
  );

-- ---- contractor_customers -------------------------------------------
--
-- THE ASYMMETRY 0031 FLAGGED, now closed: appointments were scoped to a
-- rep and the customer book behind them was not, so a rep could read
-- every homeowner the contractor had ever worked with.
--
-- A salesperson now sees a customer only while an appointment assigned
-- to them points at it. Note what that does NOT give them: the
-- customer''s history from before the assignment lives in projects,
-- orders and claims, which are scoped separately and stay invisible.
-- That is the ruling — they get the customer, not the file.
--
-- !! THIS ONE NEEDS A CLIENT CHANGE TO BE USEFUL. !!
-- app/portal/my-customers calls listContractorCustomers(userId), which
-- filters on owner_id = the signed-in user. A rep owns no customers —
-- 0031 stopped them creating any — so the intersection of "mine" and
-- "attached to my appointments" is empty and the page shows nothing.
-- The client must stop passing an owner id for a salesperson and let
-- the policy do the scoping. Shipped alongside this migration.
drop policy if exists contractor_customers_select_org on public.contractor_customers;
create policy contractor_customers_select_org on public.contractor_customers
  for select to authenticated
  using (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and (
        coalesce(public.current_membership_role(), '') <> 'salesperson'
        or exists (
          select 1 from public.appointments ap
          where ap.customer_id = contractor_customers.id
            and ap.assigned_to_user_id = auth.uid()
        )
      )
    )
  );

-- The lookup the policy above runs on every customer row a rep reads.
create index if not exists appointments_customer_assigned_idx
  on public.appointments (customer_id, assigned_to_user_id);

-- =====================================================================
-- PART 4 — The appointment link guard
--
-- A NEW TRIGGER ON A TABLE THAT HAD NONE OF OURS. public.projects
-- carries one trigger today, projects_set_updated_at (0001).
-- Alphabetically:
--
--     projects_appointment_guard  <  projects_set_updated_at
--
-- so the guard fires first and a refused write has not already had its
-- updated_at bumped. Triggers fire in name order.
--
-- No existing guard is rewritten by this migration, so nothing from
-- 0027, 0030, 0031, 0032 or 0033 can be lost here. VERIFY query 3
-- proves that across every guard anyway.
-- =====================================================================
create or replace function public.projects_appointment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role     text;
  v_org      uuid;
  v_assigned uuid;
begin
  -- Nothing to check.
  if new.appointment_id is null then
    return new;
  end if;

  -- Session-less callers — service_role, the SQL Editor, a definer
  -- function — and admins, as everywhere else in this system.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  select ap.org_id, ap.assigned_to_user_id
    into v_org, v_assigned
  from public.appointments ap
  where ap.id = new.appointment_id;

  if v_org is null then
    raise exception
      'PROJECT_APPOINTMENT_INVALID: that appointment does not exist.'
      using errcode = '42501';
  end if;

  if v_org is distinct from new.org_id then
    raise exception
      'PROJECT_APPOINTMENT_INVALID: that appointment belongs to a different organisation.'
      using errcode = '42501';
  end if;

  -- The escalation this exists to stop: a rep attaching their project
  -- to somebody else''s appointment to inherit its customer.
  v_role := public.current_membership_role();
  if v_role = 'salesperson' and v_assigned is distinct from auth.uid() then
    raise exception
      'PROJECT_APPOINTMENT_INVALID: that appointment is not assigned to you.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.projects_appointment_guard() is
  'Added by 0034. Validates projects.appointment_id when it is set: the appointment must '
  'exist, must belong to the same org, and for a salesperson must be assigned to them. Does '
  'NOT require one — see the file header. Admins and session-less callers bypass.';

drop trigger if exists projects_appointment_guard on public.projects;
create trigger projects_appointment_guard
  before insert or update on public.projects
  for each row execute function public.projects_appointment_guard();

commit;


-- =====================================================================
-- =====================================================================
--                          VERIFY SCRIPT
--
-- READ-ONLY. Three plain queries. Run each in the SQL Editor and read
-- the rows.
--
-- Same format 0033 settled on after its single-statement assertion
-- block failed to execute three times through the SQL Editor, for
-- reasons never identified. No assertions to construct, no needles to
-- quote, no string literal containing a dot.
-- =====================================================================
-- =====================================================================


-- ---------------------------------------------------------------------
-- QUERY 1 — the policies as they now read.
--
-- Expect the four rewritten SELECT policies to mention both
-- current_membership_role and salesperson. Every other policy on these
-- tables should be unchanged and should mention neither: only SELECT
-- was narrowed.
--
-- Also expect projects to carry the new appointment_id column, shown in
-- the second half of this query.
-- ---------------------------------------------------------------------
select
  tablename,
  policyname,
  cmd,
  roles::text,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('projects', 'quotes', 'proposals', 'contractor_customers', 'appointments')
order by tablename, cmd, policyname;


-- ---------------------------------------------------------------------
-- QUERY 2 — every non-internal trigger in public, with timing and
-- events. Expect SEVEN of ours, all enabled:
--
--   memberships_role_guard        0027
--   proposals_acceptance_guard    0031, extended 0032 and 0033
--   quotes_acceptance_guard       0032
--   orders_creation_guard         0030, extended 0033
--   orders_lifecycle_guard        0027, extended 0032
--   orders_attribution_guard      0033
--   projects_appointment_guard    0034, new
--
-- plus profiles_guard_privilege_columns from 0023 and the set_updated_at
-- triggers from 0001. Listed unfiltered rather than matched against a
-- name list, so a renamed guard or an unexpected extra shows up.
--
-- tgenabled is a pg_catalog "char" column, cast to text:
--   O = enabled (origin), D = disabled, R = replica, A = always.
-- ---------------------------------------------------------------------
select
  c.relname            as table_name,
  t.tgname             as trigger_name,
  t.tgenabled::text    as enabled,
  case when (t.tgtype & 2) > 0 then 'BEFORE' else 'AFTER' end as timing,
  case when (t.tgtype & 4)  > 0 then 'INSERT ' else '' end
    || case when (t.tgtype & 8)  > 0 then 'DELETE ' else '' end
    || case when (t.tgtype & 16) > 0 then 'UPDATE' else '' end as events
from pg_trigger t
join pg_class     c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
order by c.relname, t.tgname;


-- ---------------------------------------------------------------------
-- QUERY 3 — branch retention across every guard function.
--
-- 0034 rewrites no existing guard body, so every column here should
-- read exactly as it did after 0033. It is run anyway because the cost
-- is one query and the failure it catches — a branch lost in a
-- CREATE OR REPLACE — is expensive and silent.
--
-- Read it as a grid. Each guard true for its own identifiers, false for
-- everybody else:
--
--   orders_creation_guard        order_create_forbidden
--   orders_lifecycle_guard       order_locked, order_transition_forbidden
--   orders_attribution_guard     order_attribution_frozen
--   proposals_acceptance_guard   the five proposal_ columns
--   quotes_acceptance_guard      quote_accepted_frozen
--   projects_appointment_guard   project_appointment_invalid
--
-- Needles are bare error identifiers: no dots, nothing to escape.
-- ---------------------------------------------------------------------
select
  p.proname as guard,
  position('ORDER_CREATE_FORBIDDEN'        in p.prosrc) > 0 as order_create_forbidden,
  position('ORDER_LOCKED'                  in p.prosrc) > 0 as order_locked,
  position('ORDER_TRANSITION_FORBIDDEN'    in p.prosrc) > 0 as order_transition_forbidden,
  position('ORDER_ATTRIBUTION_FROZEN'      in p.prosrc) > 0 as order_attribution_frozen,
  position('PROPOSAL_ACCEPTED_IMMUTABLE'   in p.prosrc) > 0 as proposal_accepted_immutable,
  position('PROPOSAL_ACCEPTANCE_FROZEN'    in p.prosrc) > 0 as proposal_acceptance_frozen,
  position('PROPOSAL_DELETE_FORBIDDEN'     in p.prosrc) > 0 as proposal_delete_forbidden,
  position('PROPOSAL_REVERT_FORBIDDEN'     in p.prosrc) > 0 as proposal_revert_forbidden,
  position('PROPOSAL_TERMS_FROZEN'         in p.prosrc) > 0 as proposal_terms_frozen,
  position('PROPOSAL_TRANSITION_FORBIDDEN' in p.prosrc) > 0 as proposal_transition_forbidden,
  position('QUOTE_ACCEPTED_FROZEN'         in p.prosrc) > 0 as quote_accepted_frozen,
  position('PROJECT_APPOINTMENT_INVALID'   in p.prosrc) > 0 as project_appointment_invalid
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'orders_creation_guard',
    'orders_lifecycle_guard',
    'orders_attribution_guard',
    'proposals_acceptance_guard',
    'quotes_acceptance_guard',
    'projects_appointment_guard'
  )
order by p.proname;
