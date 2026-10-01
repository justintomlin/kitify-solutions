-- =====================================================================
-- 0035_rep_write_authority.sql
--
-- The write half. A salesperson closes deals; they do not run the
-- business afterwards.
--
--   0030  order creation by role
--   0031  the acceptance record and the customer book
--   0032  transition legality and the commercial-term freeze
--   0033  attribution for the close
--   0034  read access: assigned visits, their customers, own work
--   0035  the three write surfaces 0034 left open
--
-- THE RULINGS, locked:
--   ORDERS            no UPDATE, no DELETE, full stop. The 48-hour
--                     window belongs to the office, which collects
--                     payment and runs the SOP.
--   PARTNER INVENTORY SELECT only. Stock movement is a warehouse and
--                     office function. A rep may look; never move.
--   CLAIMS            no INSERT, no UPDATE, no DELETE. A warranty claim
--                     is a commercial commitment in the contractor''s
--                     name, made long after the rep has gone.
--
-- Owners, members and Kitify admins are unaffected throughout.
--
-- ---------------------------------------------------------------------
-- THE FINDING THAT MATTERS, AND IT IS NOT THE ONE EXPECTED
--
-- The worry going in was that narrowing partner inventory would break
-- quoting. It does not: the configurator reads NO inventory at all. Its
-- catalogue is static TypeScript — lib/catalog.ts, delta-catalog.ts,
-- naturepanel-catalog.ts — and its only database reads are the quote
-- and project it is resuming. Partner stock is confined to
-- /portal/inventory/*, behind the inventory_tracking_enabled toggle.
--
-- THE REAL BREAK IS ORDERS, and it is bigger than it looks.
--
-- A REP OWNS ORDERS. createOrderFromProposal sets the order''s owner_id
-- from the PROPOSAL''s owner_id, not from whoever converted it. So when
-- the office converts a rep''s accepted proposal, the resulting order
-- belongs to the rep. That is correct for attribution and it means
-- listOrders({ownerId}) on my-jobs returns real rows for a rep.
--
-- And my-jobs is where the contractor closes the loop: one write sets
-- status completed, install date, completion photos, notes, warranty
-- registered. All of it is an UPDATE on orders. So "no UPDATE for a
-- salesperson" makes my-jobs read-only for them — the register-a-job
-- form and the claim form both have to go.
--
-- THAT IS THE RULING WORKING, NOT THE RULING BREAKING. Registering an
-- install and activating a warranty are commitments in the
-- contractor''s name, made after the handover 0030 established. But it
-- is a visible change to a page a rep can reach today, so the controls
-- are hidden rather than left to fail.
--
-- ---------------------------------------------------------------------
-- TRIGGER FOR ORDERS, POLICIES FOR THE OTHER TWO. WHY THE SPLIT.
--
-- ORDERS GETS A TRIGGER. A rep can SEE their own orders — 0034 did not
-- narrow that, and the office needs them to see where their deals got
-- to. So a policy refusal here is the bad case: an UPDATE whose USING
-- clause fails FILTERS rather than raises, PostgREST returns zero rows,
-- lib/store.ts turns that into PGRST116, and the rep is told "that
-- didn''t work" about a row sitting in front of them. A named error at
-- 42501 says which rule and why.
--
-- The policies on orders are DELIBERATELY LEFT ALONE. The trigger is
-- strictly stronger — it fires regardless of RLS and of grants — so
-- adding the same rule to the policy would be two definitions of one
-- rule, which is how they drift. Same reasoning as 0030.
--
-- PARTNER INVENTORY AND CLAIMS GET POLICIES. The rule is role-and-org
-- with no state component, which is what a policy expresses well, and
-- the realistic attempt in both cases is an INSERT — recording a
-- movement, filing a claim — where a failing WITH CHECK RAISES rather
-- than filtering. lib/db-errors.ts already recognises that wording and
-- resolves it to dbError.notPermitted. A trigger would add a better
-- message to a case the UI no longer offers.
--
-- AND IT IS THE POLICY, NOT A TRIGGER, THAT REACHES THE RPC.
-- apply_partner_inventory_movements is SECURITY INVOKER (0026 kept it
-- that way deliberately), so every statement inside it runs under the
-- caller''s RLS. Narrowing the table policies closes the function with
-- no change to the function. A role check inside it would be a third
-- place for the rule and would not be reached by anything else.
--
-- ---------------------------------------------------------------------
-- A NEW TRIGGER ON orders, AND THE FIRE ORDER IT LANDS IN
--
-- public.orders now carries, in name order:
--
--     orders_attribution_guard    0033  BEFORE UPDATE
--     orders_authority_guard      0035  BEFORE UPDATE OR DELETE   <-- new
--     orders_creation_guard       0030  BEFORE INSERT
--     orders_lifecycle_guard      0027  BEFORE INSERT OR UPDATE
--     orders_set_order_number     0005  BEFORE INSERT
--     orders_set_updated_at       0001  BEFORE UPDATE
--
-- The new one sorts second, ahead of the lifecycle guard, so a rep is
-- refused before the 48-hour window logic runs. It sits after the
-- attribution freeze, which does not matter: both are deny-only, and a
-- raise from either rolls the whole statement back.
--
-- EXTENDING AN EXISTING GUARD WAS REJECTED. orders_lifecycle_guard is
-- the natural host, and rewriting it would mean reproducing 0027 and
-- 0032 in full again — the third time — for a rule that shares nothing
-- with the window logic. 0033 already showed what that costs. A nine
-- line trigger of its own is cheaper and reads better.
--
-- NO EXISTING GUARD BODY IS REWRITTEN BY THIS FILE, so nothing from
-- 0027, 0030, 0031, 0032, 0033 or 0034 can be lost. VERIFY query 3
-- proves it across all seven anyway.
--
-- ---------------------------------------------------------------------
-- DEPENDENCY ORDERING. No column is added, so nothing reads a field off
-- a row type. No default references a function. The guard function
-- precedes its trigger; the policies reference only functions that
-- predate this file.
--
-- NO TABLE IS CREATED. The rule if one ever is:
-- `revoke all on <table> from authenticated, anon;` then the explicit
-- grants. `from anon, public` does NOT cover `authenticated`.
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
    raise exception 'ABORT 0035/0a: missing function(s): %. Apply 0024 and 0027 first.', v_missing;
  end if;
end $$;

-- 0b. The five tables must exist and carry org_id, which every policy
--     below reads. A missing column would produce a policy that
--     silently matches nothing.
do $$
declare v_missing text;
begin
  select string_agg(want.tbl, ', ') into v_missing
  from (values
    ('orders'), ('claims'),
    ('partner_inventory_skus'), ('partner_inventory_stock'), ('partner_inventory_movements')
  ) as want(tbl)
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = ('public.' || want.tbl)::regclass
      and a.attname = 'org_id' and not a.attisdropped
  );
  if v_missing is not null then
    raise exception 'ABORT 0035/0b: org_id missing on %. Apply 0024 first.', v_missing;
  end if;
end $$;

-- 0c. memberships.role must still hold only the three known values.
--     Every policy and the guard below branch on salesperson by name.
do $$
declare v_other text;
begin
  select string_agg(distinct m.role, ', ') into v_other
  from public.memberships m where m.role not in ('owner', 'member', 'salesperson');
  if v_other is not null then
    raise exception 'ABORT 0035/0c: unexpected memberships.role value(s): %.', v_other;
  end if;
end $$;

-- 0d. apply_partner_inventory_movements must still be SECURITY INVOKER.
--     The whole argument for using policies on the partner tables is
--     that the function runs under the caller RLS. If somebody has made
--     it a definer since 0026, the policies below would not reach it and
--     this migration would be closing a door with a window open.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'apply_partner_inventory_movements'
      and p.prosecdef
  ) then
    raise exception
      'ABORT 0035/0d: apply_partner_inventory_movements is SECURITY DEFINER. The partner '
      'inventory policies below would not reach it — it needs its own role check first.';
  end if;
end $$;

-- =====================================================================
-- PART 1 — Orders: the authority guard
--
-- BEFORE UPDATE OR DELETE. Not INSERT: 0030 already refuses a rep
-- there, with its own named error, and two guards raising about the
-- same statement would be noise.
--
-- Returns OLD on the DELETE path via if/then rather than a CASE
-- mentioning NEW. In a row-level DELETE trigger NEW is not a row, and
-- NULL returned from BEFORE DELETE silently CANCELS the delete — the
-- one bug here that would look like success. Same lesson as 0031.
-- =====================================================================
create or replace function public.orders_authority_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  -- Session-less callers — service_role, the SQL Editor, a definer
  -- function — and admins, as everywhere else in this system.
  if auth.uid() is null or public.is_admin() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_role := public.current_membership_role();

  if v_role = 'salesperson' then
    raise exception
      'ORDER_WRITE_FORBIDDEN: a salesperson may not change an order. The office owns it once '
      'it is placed — they collect payment and run the production schedule. Ask an owner or a '
      'member of this organisation.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.orders_authority_guard() is
  'Added by 0035. Refuses UPDATE and DELETE on public.orders from a salesperson, with a named '
  'ORDER_WRITE_FORBIDDEN at 42501 rather than the zero-row silence a narrowed UPDATE policy '
  'would give — a rep CAN see their own orders (0034 did not narrow that), so a refusal has to '
  'say which rule it is. INSERT is 0030''s business. Admins and session-less callers bypass. '
  'The orders POLICIES are deliberately untouched: this is strictly stronger, and one rule in '
  'two places drifts.';

drop trigger if exists orders_authority_guard on public.orders;
create trigger orders_authority_guard
  before update or delete on public.orders
  for each row execute function public.orders_authority_guard();

-- =====================================================================
-- PART 2 — Partner inventory: SELECT only for a rep
--
-- The three write policies on each of the three tables, narrowed to the
-- shape 0027 established and 0034 settled on:
--
--     is_admin() or (own org AND not a salesperson)
--
-- Written as `role <> salesperson` rather than `role in (owner, member)`
-- so a NULL role — a session with no membership — is not silently
-- treated as a rep. It fails the org test first and is refused either
-- way, but the predicate says what it means.
--
-- SELECT IS NOT TOUCHED on any of the three. A rep may look at stock;
-- the ruling is that they never move it. See (e) in the report: nothing
-- in the quoting path reads these tables today, so this is headroom
-- rather than a current requirement.
-- =====================================================================
do $$
declare v_t text;
begin
  foreach v_t in array array[
    'partner_inventory_skus', 'partner_inventory_stock', 'partner_inventory_movements'
  ] loop
    execute format('drop policy if exists %I on public.%I', v_t || '_insert_org', v_t);
    execute format($f$
      create policy %I on public.%I for insert to authenticated
      with check (
        public.is_admin()
        or (
          org_id = public.current_org_id()
          and coalesce(public.current_membership_role(), '') <> 'salesperson'
        )
      )
    $f$, v_t || '_insert_org', v_t);

    execute format('drop policy if exists %I on public.%I', v_t || '_update_org', v_t);
    execute format($f$
      create policy %I on public.%I for update to authenticated
      using (
        public.is_admin()
        or (
          org_id = public.current_org_id()
          and coalesce(public.current_membership_role(), '') <> 'salesperson'
        )
      )
      with check (
        public.is_admin()
        or (
          org_id = public.current_org_id()
          and coalesce(public.current_membership_role(), '') <> 'salesperson'
        )
      )
    $f$, v_t || '_update_org', v_t);

    execute format('drop policy if exists %I on public.%I', v_t || '_delete_org', v_t);
    execute format($f$
      create policy %I on public.%I for delete to authenticated
      using (
        public.is_admin()
        or (
          org_id = public.current_org_id()
          and coalesce(public.current_membership_role(), '') <> 'salesperson'
        )
      )
    $f$, v_t || '_delete_org', v_t);
  end loop;
end $$;

-- =====================================================================
-- PART 3 — Claims: no write of any kind for a rep
--
-- Same shape. SELECT is left org-wide: a rep seeing that a claim exists
-- against a job they sold is harmless and occasionally useful, and
-- narrowing reads was 0034''s job, not this one.
-- =====================================================================
drop policy if exists claims_insert_org on public.claims;
create policy claims_insert_org on public.claims
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and coalesce(public.current_membership_role(), '') <> 'salesperson'
    )
  );

drop policy if exists claims_update_org on public.claims;
create policy claims_update_org on public.claims
  for update to authenticated
  using (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and coalesce(public.current_membership_role(), '') <> 'salesperson'
    )
  )
  with check (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and coalesce(public.current_membership_role(), '') <> 'salesperson'
    )
  );

drop policy if exists claims_delete_org on public.claims;
create policy claims_delete_org on public.claims
  for delete to authenticated
  using (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and coalesce(public.current_membership_role(), '') <> 'salesperson'
    )
  );

commit;


-- =====================================================================
-- =====================================================================
--                          VERIFY SCRIPT
--
-- READ-ONLY. Three plain queries. Run each in the SQL Editor and read
-- the rows.
--
-- Same format 0033 settled on and 0034 reused, after 0033''s
-- single-statement assertion block failed to execute three times
-- through the SQL Editor for reasons never identified. No assertions to
-- construct, no needle containing a dot.
-- =====================================================================
-- =====================================================================


-- ---------------------------------------------------------------------
-- QUERY 1 — the policies as they now read.
--
-- Expect, for the five tables below:
--
--   orders                       UNCHANGED. No policy here should
--                                mention current_membership_role — the
--                                rule lives in the trigger, on purpose.
--   partner_inventory_* x3        insert, update and delete each mention
--                                current_membership_role and
--                                salesperson. select does NOT.
--   claims                       same: three write policies narrowed,
--                                select left alone.
--
-- A salesperson appearing in an orders policy, or in any select policy
-- on these five, means somebody put the rule in a second place.
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
  and tablename in (
    'orders', 'claims',
    'partner_inventory_skus', 'partner_inventory_stock', 'partner_inventory_movements'
  )
order by tablename, cmd, policyname;


-- ---------------------------------------------------------------------
-- QUERY 2 — every non-internal trigger in public, with timing and
-- events. Expect EIGHT of ours, all enabled:
--
--   memberships_role_guard        0027
--   proposals_acceptance_guard    0031, extended 0032 and 0033
--   quotes_acceptance_guard       0032
--   orders_creation_guard         0030, extended 0033
--   orders_lifecycle_guard        0027, extended 0032
--   orders_attribution_guard      0033
--   projects_appointment_guard    0034
--   orders_authority_guard        0035, new
--
-- plus profiles_guard_privilege_columns from 0023 and the set_updated_at
-- triggers from 0001. Listed unfiltered rather than matched against a
-- name list, so a renamed guard or an unexpected extra shows up.
--
-- ON public.orders SPECIFICALLY, the name order decides which refusal a
-- rep meets first. Expect attribution, then authority, then creation,
-- then lifecycle. authority ahead of lifecycle is the point: a rep is
-- refused before the 48-hour window logic runs.
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
-- 0035 rewrites no existing guard body, so every column here should
-- read exactly as it did after 0034, with one new row and one new
-- column. Run anyway: the cost is one query and the failure it catches
-- — a branch lost to a CREATE OR REPLACE — is expensive and silent.
--
-- Read it as a grid. Each guard true for its own identifiers, false for
-- everybody else:
--
--   orders_creation_guard        order_create_forbidden
--   orders_lifecycle_guard       order_locked, order_transition_forbidden
--   orders_attribution_guard     order_attribution_frozen
--   orders_authority_guard       order_write_forbidden            <-- new
--   proposals_acceptance_guard   the five proposal_ columns
--   quotes_acceptance_guard      quote_accepted_frozen
--   projects_appointment_guard   project_appointment_invalid
--
-- Needles are bare error identifiers: no dots, nothing to escape.
-- ---------------------------------------------------------------------
select
  p.proname as guard,
  position('ORDER_CREATE_FORBIDDEN'        in p.prosrc) > 0 as order_create_forbidden,
  position('ORDER_WRITE_FORBIDDEN'         in p.prosrc) > 0 as order_write_forbidden,
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
    'orders_authority_guard',
    'orders_lifecycle_guard',
    'orders_attribution_guard',
    'proposals_acceptance_guard',
    'quotes_acceptance_guard',
    'projects_appointment_guard'
  )
order by p.proname;
