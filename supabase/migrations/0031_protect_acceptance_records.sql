-- =====================================================================
-- 0031_protect_acceptance_records.sql
--
-- Phase 4b-auth follow-up. Closes items 1 and 2 of the 4a/4b boundary
-- list — the two that DESTROY RECORDS rather than merely exceed
-- authority, and the second of which destroys the exact state 0030 was
-- built to protect.
--
--   0027  added the salesperson role; closed appointments and
--         contractor_customers INSERT
--   0030  closed order creation: the salesperson closes, the office
--         converts
--   0031  closes the customer-book inversion and protects the
--         acceptance record
--
-- Items 3 through 8 of that list are deliberately NOT touched. They
-- need the rep-isolation decision, which is a design question, not a
-- patch — see the note at the end of this header.
--
-- NO NEW TABLE, NO NEW COLUMN. Three predicates, one trigger, three
-- replaced policies.
--
-- ---------------------------------------------------------------------
-- ITEM 1 — THE CUSTOMER-BOOK INVERSION
--
-- 0027 stopped a salesperson CREATING a customer and left 0024's
-- org-wide `contractor_customers_update_org` and `_delete_org` in
-- place. So a rep could not add one row and could delete every row.
-- That is the wrong way round in the most literal sense.
--
-- Closed with POLICIES rather than a trigger, which is a departure from
-- 0030 and is deliberate. The rule here is role-and-org with NO STATE
-- component — there is no "this customer is protected because of what
-- happened to it" — and a policy expresses exactly that. 0027 already
-- put this table's INSERT rule in a policy; putting UPDATE in a trigger
-- and leaving INSERT in a policy would scatter one table's write rule
-- across two mechanisms.
--
-- KNOWN COST, accepted: a DELETE refused by a policy removes zero rows
-- rather than raising, so `deleteContractorCustomer` (lib/store.ts:1082)
-- sees no error and the list simply reloads unchanged. The rep is not
-- told why. That is a message-quality problem for 4c, not a hole — the
-- row is not deleted either way.
--
-- ALSO REPOINTED, no behaviour change: 0027's INSERT policy on this
-- table calls `appointment_role_may_create()`, a function named for a
-- different table. It now calls `customer_write_role_allowed()` like
-- the other two, so one table's write rule has one definition and one
-- name. The predicate body is identical; nothing about who may insert
-- changes.
--
-- NOT FIXED HERE, recorded so it stays visible:
-- `contractor_customers_select_org` is ORG-WIDE while 0027's
-- `appointments_select_org` scopes a rep to their own assignments. The
-- appointment list is scoped and the customer book behind it is not.
-- That is the systemic gap and it belongs with the rep-isolation
-- decision, not with this migration.
--
-- ---------------------------------------------------------------------
-- ITEM 2 — THE ACCEPTANCE RECORD
--
-- Two holes, one consequence. `proposals_delete_org` admits any org
-- member, so an accepted proposal could be deleted outright. And
-- `revokeProposal()` (lib/store.ts:608) sets status to 'draft' and
-- nulls the share token FROM ANY STATE with no check, which discards
-- the homeowner's name, email, phone, timestamp and chosen tier on a
-- deal the office has not converted yet.
--
-- THE RULE: once a proposal is accepted, its acceptance record is
-- immutable except by an admin.
--   * no role below admin may DELETE a proposal in 'accepted' or
--     'ordered'
--   * no role below admin may move one OUT of those states back to
--     'draft' or 'shared'. The forward move to 'ordered' is what 0030
--     governs and is untouched.
--   * the accepted_* columns may not be modified once set, by anyone
--     below admin
--   * a salesperson gets no DELETE on a proposal in ANY state
--
-- SIX COLUMNS, NOT FIVE. The brief said five; the schema has six —
-- accepted_quote_id, accepted_by and accepted_at from 0003, plus
-- accepted_tier, accepted_email and accepted_phone from 0004. All six
-- are frozen.
--
-- A TRIGGER here, per 0030's reasoning and for the reason that does not
-- apply to item 1: this rule IS state-dependent, and a policy cannot
-- say "this failed because the proposal is accepted" as distinct from
-- "this failed because it is not your org". 4c has to tell a rep which.
-- A DELETE policy would also refuse silently.
--
-- ---------------------------------------------------------------------
-- TRIGGER FIRE ORDER ON public.proposals
--
-- Triggers fire in NAME order, which mattered in 0030 and matters here.
-- public.proposals carries one trigger today, proposals_set_updated_at
-- (0003). The new one sorts first:
--
--     proposals_acceptance_guard  <  proposals_set_updated_at
--
-- which is the order wanted: a refused update does not first have its
-- updated_at bumped. Both are BEFORE ROW, so neither can see the
-- other's work in any case, but a guard that runs after a mutation is
-- a guard that has already let something happen.
--
-- ---------------------------------------------------------------------
-- DEPENDENCY ORDERING. No column is added, so nothing reads a field off
-- a row type (0027's 42703). No column default is added, so nothing
-- references a function at DDL time (0024's first-run bug). The only
-- ordering that binds is predicates before the trigger and the policies
-- that call them: PART 1 precedes PART 2 and PART 3.
--
-- NO TABLE IS CREATED, so the README's revoke-then-grant rule has
-- nothing to apply to. Stated rather than silently skipped: the rule is
-- `revoke all on <table> from authenticated, anon;` — `from anon,
-- public` does NOT cover `authenticated`, which is the one wording
-- error behind all five prior grant occurrences.
--
-- Re-runnable. Transactional.
-- =====================================================================

begin;

-- =====================================================================
-- PART 0 — Pre-flight. Abort rather than half-apply.
-- =====================================================================

-- 0a. 0027 and 0030 must be in place. current_membership_role() is the
--     role lookup this migration reuses rather than re-deriving.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_membership_role'
  ) then
    raise exception
      'ABORT 0031/0a: public.current_membership_role() missing. Apply '
      '0027_salesperson_tier.sql first — this migration must not write a second role lookup.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin' and p.prosecdef
  ) then
    raise exception 'ABORT 0031/0a: public.is_admin() missing or not SECURITY DEFINER.';
  end if;
end $$;

-- 0b. memberships.role must hold only the three known values. A fourth
--     would fall through every predicate below as "not permitted" and
--     silently strip that user of writes they are supposed to have.
do $$
declare v_other text;
begin
  select string_agg(distinct m.role, ', ') into v_other
  from public.memberships m
  where m.role not in ('owner', 'member', 'salesperson');

  if v_other is not null then
    raise exception
      'ABORT 0031/0b: unexpected memberships.role value(s): %. Extend the predicates in '
      'PART 1 before running.', v_other;
  end if;
end $$;

-- 0c. All six accepted_* columns must exist, or the freeze in PART 2
--     would silently protect fewer fields than it claims to.
do $$
declare v_missing text;
begin
  select string_agg(want.col, ', ') into v_missing
  from (values
    ('accepted_quote_id'), ('accepted_by'), ('accepted_at'),
    ('accepted_tier'), ('accepted_email'), ('accepted_phone')
  ) as want(col)
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.proposals'::regclass
      and a.attname = want.col and not a.attisdropped
  );
  if v_missing is not null then
    raise exception
      'ABORT 0031/0c: public.proposals is missing %. Apply 0003/0004 first — the freeze in '
      'PART 2 names every accepted_* column explicitly and must not protect a subset.', v_missing;
  end if;
end $$;

-- 0d. proposals.status must hold only the five known values. The guard
--     reasons about 'accepted', 'ordered', 'draft' and 'shared' by
--     name; an unknown state would take an unexamined branch.
do $$
declare v_other text;
begin
  select string_agg(distinct p.status, ', ') into v_other
  from public.proposals p
  where p.status not in ('draft', 'shared', 'accepted', 'ordered', 'archived');

  if v_other is not null then
    raise exception
      'ABORT 0031/0d: unexpected proposals.status value(s): %. Extend the guard in PART 2 '
      'before running.', v_other;
  end if;
end $$;

-- =====================================================================
-- PART 1 — The rules
--
-- Three predicates, each taking its input as a parameter so the VERIFY
-- block can prove the actual rule by calling it rather than by
-- pattern-matching policy text.
--
-- THE ROLE LOOKUP IS NOT REDEFINED. public.current_membership_role()
-- from 0027 is called by the trigger and by every policy below. One
-- definition of "which membership row is the caller's" — two would
-- drift, and a drifted role lookup is a user who is one role to the
-- policy and another to the trigger.
--
-- The predicates are separate from each other and from 0027's
-- appointment_role_may_create() and 0030's order_create_role_allowed()
-- even where they return identical answers. Same reasoning as 0030:
-- sharing the lookup prevents drift, sharing the rule creates coupling,
-- and "who may edit the customer book" and "who may convert a signed
-- proposal" are different questions that happen to have the same answer
-- today.
-- =====================================================================

-- ---- who may write the customer book -------------------------------
create or replace function public.customer_write_role_allowed(p_role text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_role in ('owner', 'member'), false);
$$;

comment on function public.customer_write_role_allowed(text) is
  'Added by 0031. True for owner and member, false for salesperson and for NULL (no '
  'membership). Backs all three write policies on public.contractor_customers — INSERT '
  '(repointed from 0027''s appointment_role_may_create, same body, correct name), UPDATE and '
  'DELETE. A rep works the book; they do not keep it. SELECT is deliberately unchanged and '
  'remains org-wide.';

-- ---- who may delete a proposal at all ------------------------------
create or replace function public.proposal_delete_role_allowed(p_role text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_role in ('owner', 'member'), false);
$$;

comment on function public.proposal_delete_role_allowed(text) is
  'Added by 0031. True for owner and member. A salesperson may not delete a proposal in ANY '
  'state, including one they created — separate from the state rule in '
  'proposal_state_protected(), which applies to every non-admin role.';

-- ---- which states carry a protected acceptance record --------------
create or replace function public.proposal_state_protected(p_status text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_status in ('accepted', 'ordered'), false);
$$;

comment on function public.proposal_state_protected(text) is
  'Added by 0031. True once a homeowner has accepted. A proposal in these states may not be '
  'deleted, nor reverted to draft/shared, by anyone below admin. ''archived'' is NOT included: '
  'archiving hides a proposal without erasing its acceptance record, and the ruling named '
  'draft and shared specifically.';

revoke execute on function public.customer_write_role_allowed(text)   from anon, public;
revoke execute on function public.proposal_delete_role_allowed(text)  from anon, public;
revoke execute on function public.proposal_state_protected(text)      from anon, public;

grant execute on function public.customer_write_role_allowed(text)    to authenticated, service_role;
grant execute on function public.proposal_delete_role_allowed(text)   to authenticated, service_role;
grant execute on function public.proposal_state_protected(text)       to authenticated, service_role;

-- =====================================================================
-- PART 2 — The acceptance guard
--
-- BEFORE UPDATE OR DELETE. Not INSERT: a proposal is always created in
-- 'draft' and there is nothing yet to protect.
--
-- THE auth.uid() IS NULL BYPASS IS LOAD-BEARING HERE, not merely
-- consistent with 0027 and 0030. app/api/proposal/[token]/accept/route.ts
-- runs with the SERVICE_ROLE key and no session, and it is what WRITES
-- the accepted_* columns in the first place. Without this branch the
-- freeze below would block the homeowner's acceptance itself.
-- =====================================================================
create or replace function public.proposals_acceptance_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   text;
  v_frozen text;
begin
  -- Two bypasses, one exit. Kitify support corrects records on a
  -- contractor's behalf; and a session-less caller is service_role (the
  -- public accept route), the SQL Editor, or a SECURITY DEFINER
  -- function — see the header, the accept route is what WRITES the
  -- record this trigger protects.
  --
  -- Written as if/then rather than `case when tg_op = 'DELETE' then old
  -- else new end` on purpose: in a row-level DELETE trigger NEW is not
  -- a row, and a branch that merely MENTIONS it is a branch that can
  -- fail on the delete path. Returning NULL from a BEFORE DELETE
  -- trigger silently cancels the delete, so this is the one place where
  -- getting it wrong looks like success.
  if public.is_admin() or auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_role := public.current_membership_role();

  -- ---- DELETE -------------------------------------------------------
  if tg_op = 'DELETE' then
    -- Role first, then state, deliberately: a salesperson gets the same
    -- answer whatever they try to delete, rather than "protected
    -- record" for one proposal and "not your authority" for the next.
    if not public.proposal_delete_role_allowed(v_role) then
      raise exception
        'PROPOSAL_DELETE_FORBIDDEN: a % may not delete a proposal. Ask an owner or a member '
        'of this organisation.',
        coalesce(v_role, 'user with no membership')
        using errcode = '42501';
    end if;

    if public.proposal_state_protected(old.status) then
      raise exception
        'PROPOSAL_ACCEPTED_IMMUTABLE: proposal "%" was accepted by % and may not be deleted. '
        'The acceptance record is what the order is built from. Contact Kitify if it must go.',
        old.name, coalesce(old.accepted_by, 'the customer')
        using errcode = '42501';
    end if;

    return old;
  end if;

  -- ---- UPDATE -------------------------------------------------------
  -- No reversion out of a protected state. The forward move to
  -- 'ordered' is 0030's business and passes straight through here.
  if public.proposal_state_protected(old.status)
     and new.status is distinct from old.status
     and new.status in ('draft', 'shared') then
    raise exception
      'PROPOSAL_REVERT_FORBIDDEN: proposal "%" is % and cannot be returned to %. Unsharing it '
      'would discard the customer''s acceptance. Contact Kitify if it must be reopened.',
      old.name, old.status, new.status
      using errcode = '42501';
  end if;

  -- The acceptance record itself is frozen once written. "Once set" is
  -- per column: accepted_phone is legitimately null when the homeowner
  -- leaves it blank, and a null old value is not yet a record to
  -- protect.
  select string_agg(c.col, ', ') into v_frozen
  from (values
    ('accepted_tier',     old.accepted_tier     is not null and new.accepted_tier     is distinct from old.accepted_tier),
    ('accepted_quote_id', old.accepted_quote_id is not null and new.accepted_quote_id is distinct from old.accepted_quote_id),
    ('accepted_by',       old.accepted_by       is not null and new.accepted_by       is distinct from old.accepted_by),
    ('accepted_email',    old.accepted_email    is not null and new.accepted_email    is distinct from old.accepted_email),
    ('accepted_phone',    old.accepted_phone    is not null and new.accepted_phone    is distinct from old.accepted_phone),
    ('accepted_at',       old.accepted_at       is not null and new.accepted_at       is distinct from old.accepted_at)
  ) as c(col, did_change)
  where c.did_change;

  if v_frozen is not null then
    raise exception
      'PROPOSAL_ACCEPTANCE_FROZEN: % on proposal "%" records what the customer agreed to and '
      'cannot be changed. Contact Kitify if it is wrong.',
      v_frozen, old.name
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.proposals_acceptance_guard() is
  'Added by 0031. Protects the homeowner acceptance record: no delete of an accepted/ordered '
  'proposal, no reversion out of those states to draft/shared, no change to any of the six '
  'accepted_* columns once set, and no delete at all by a salesperson. Named 42501 errors so '
  '4c can translate them. Admins and auth.uid() IS NULL sessions bypass — the latter is what '
  'lets the public accept route write the record in the first place.';

drop trigger if exists proposals_acceptance_guard on public.proposals;
create trigger proposals_acceptance_guard
  before update or delete on public.proposals
  for each row execute function public.proposals_acceptance_guard();

-- =====================================================================
-- PART 3 — contractor_customers write policies
--
-- SELECT IS NOT TOUCHED. A rep must be able to read the customer
-- attached to an appointment they are assigned, and narrowing the read
-- is the rep-isolation decision, not this one. See the header.
-- =====================================================================

-- INSERT — repointed from 0027's appointment_role_may_create() to the
-- correctly named predicate. Identical body; nobody's access changes.
drop policy if exists contractor_customers_insert_org on public.contractor_customers;
create policy contractor_customers_insert_org on public.contractor_customers
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and public.customer_write_role_allowed(public.current_membership_role())
    )
  );

-- UPDATE — 0024's org-wide policy, now role-gated. This is the hole.
drop policy if exists contractor_customers_update_org on public.contractor_customers;
create policy contractor_customers_update_org on public.contractor_customers
  for update to authenticated
  using (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and public.customer_write_role_allowed(public.current_membership_role())
    )
  )
  with check (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and public.customer_write_role_allowed(public.current_membership_role())
    )
  );

-- DELETE — the other half, and the worse one: 0027 blocked creation and
-- left deletion of the whole book open.
drop policy if exists contractor_customers_delete_org on public.contractor_customers;
create policy contractor_customers_delete_org on public.contractor_customers
  for delete to authenticated
  using (
    public.is_admin()
    or (
      org_id = public.current_org_id()
      and public.customer_write_role_allowed(public.current_membership_role())
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
-- pg_catalog "char" columns (polcmd, tgenabled, tgtype, relkind) are
-- cast to ::text before comparison — same fix as 0023 onward. tgtype is
-- an int2 bitmask, not "char": bit 2 is BEFORE, 4 INSERT, 8 DELETE,
-- 16 UPDATE. BIT 1 IS ROW, which is not what any assertion below wants.
--
-- Checks 1, 2 and 4 prove the RULES by calling the functions that
-- define them. Checks 3 and 5 prove the errors are the named ones
-- rather than a policy silence.
-- =====================================================================
-- =====================================================================

-- 1. a salesperson may not write the customer book; owner and member may
select
  '1. who may write the customer book'                        as check,
  r.role                                                      as detail,
  r.want::text                                                as expected,
  public.customer_write_role_allowed(r.role)::text            as actual,
  public.customer_write_role_allowed(r.role) = r.want         as pass
from (values ('owner', true), ('member', true), ('salesperson', false)) as r(role, want)

union all
-- 1b. ...and a session with no membership is not accidentally permitted
select
  '1b. no-membership may not write the book',
  'null role',
  'false',
  public.customer_write_role_allowed(null)::text,
  public.customer_write_role_allowed(null) = false

union all
-- 1c. all THREE write policies route through the one predicate, so
--     check 1 is testing what actually runs on every verb
select
  '1c. customer write policies role-gated',
  pol.polname || ' (' || pol.polcmd::text || ')',
  'true',
  (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
     || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
     like '%customer_write_role_allowed%')::text,
  coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
    || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    like '%customer_write_role_allowed%'
from pg_policy pol
where pol.polrelid = 'public.contractor_customers'::regclass
  and pol.polcmd::text in ('a', 'w', 'd')     -- "char": a INSERT, w UPDATE, d DELETE

union all
-- 1d. ...and there is exactly one policy per write verb. Permissive
--     policies OR together, so a second would reopen the hole without
--     touching the one above.
select
  '1d. one policy per customer write verb',
  'insert/update/delete policy count',
  '3',
  count(*)::text,
  count(*) = 3
from pg_policy pol
where pol.polrelid = 'public.contractor_customers'::regclass
  and pol.polcmd::text in ('a', 'w', 'd')

union all
-- 1e. A SALESPERSON CAN STILL READ. The SELECT policy must NOT have
--     picked up the role gate — narrowing the read was explicitly not
--     asked for, and a rep who cannot read their assigned appointment's
--     customer has an empty screen.
select
  '1e. customer SELECT still org-wide',
  pol.polname,
  'false',
  (pg_get_expr(pol.polqual, pol.polrelid) like '%customer_write_role_allowed%')::text,
  pg_get_expr(pol.polqual, pol.polrelid) not like '%customer_write_role_allowed%'
from pg_policy pol
where pol.polrelid = 'public.contractor_customers'::regclass
  and pol.polcmd::text = 'r'                  -- "char": r = SELECT

union all
-- 2. nobody below admin may delete an accepted proposal — the state
--    rule, proven by calling it
select
  '2. which states are protected',
  s.status,
  s.want::text,
  public.proposal_state_protected(s.status)::text,
  public.proposal_state_protected(s.status) = s.want
from (values
  ('accepted', true), ('ordered', true),
  ('draft', false), ('shared', false), ('archived', false)
) as s(status, want)

union all
-- 2b. ...and a salesperson may not delete one in ANY state
select
  '2b. who may delete a proposal',
  r.role,
  r.want::text,
  public.proposal_delete_role_allowed(r.role)::text,
  public.proposal_delete_role_allowed(r.role) = r.want
from (values ('owner', true), ('member', true), ('salesperson', false)) as r(role, want)

union all
-- 3. THE ERRORS ARE NAMED, NOT POLICY SILENCES. All four identifiers 4c
--    will switch on, plus the SQLSTATE.
select
  '3. error is the named one',
  w.what,
  'true',
  (p.prosrc like w.pat)::text,
  p.prosrc like w.pat
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values
  ('PROPOSAL_DELETE_FORBIDDEN',    '%PROPOSAL_DELETE_FORBIDDEN%'),
  ('PROPOSAL_ACCEPTED_IMMUTABLE',  '%PROPOSAL_ACCEPTED_IMMUTABLE%'),
  ('PROPOSAL_REVERT_FORBIDDEN',    '%PROPOSAL_REVERT_FORBIDDEN%'),
  ('PROPOSAL_ACCEPTANCE_FROZEN',   '%PROPOSAL_ACCEPTANCE_FROZEN%'),
  ('errcode 42501',                '%42501%')
) as w(what, pat)
where n.nspname = 'public' and p.proname = 'proposals_acceptance_guard'

union all
-- 3b. the guard reuses current_membership_role() rather than deriving a
--     second one, and routes through the rule functions
select
  '3b. guard reuses the shared lookup and rules',
  w.what,
  'true',
  (p.prosrc like w.pat)::text,
  p.prosrc like w.pat
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values
  ('current_membership_role',    '%current_membership_role()%'),
  ('proposal_state_protected',   '%proposal_state_protected%'),
  ('proposal_delete_role_allowed','%proposal_delete_role_allowed%'),
  ('is_admin override',          '%is_admin()%')
) as w(what, pat)
where n.nspname = 'public' and p.proname = 'proposals_acceptance_guard'

union all
-- 3c. the trigger exists and is ENABLED. A disabled trigger is the
--     failure mode that looks exactly like a working one.
select
  '3c. acceptance guard enabled',
  t.tgname,
  'O',
  t.tgenabled::text,
  t.tgenabled::text = 'O'
from pg_trigger t
where t.tgrelid = 'public.proposals'::regclass
  and t.tgname = 'proposals_acceptance_guard'

union all
-- 3d. ...BEFORE, UPDATE and DELETE, and NOT INSERT. A proposal is
--     always created in 'draft' with nothing to protect, and firing on
--     INSERT would run the freeze against a null OLD.
--       bits: 2 BEFORE · 4 INSERT · 8 DELETE · 16 UPDATE  (1 is ROW)
select
  '3d. guard is BEFORE UPDATE OR DELETE',
  'tgtype & 2 (before), & 16 (update), & 8 (delete), & 4 (insert)',
  'true/true/true/false',
  ((t.tgtype & 2) > 0)::text || '/' || ((t.tgtype & 16) > 0)::text || '/'
    || ((t.tgtype & 8) > 0)::text || '/' || ((t.tgtype & 4) > 0)::text,
  (t.tgtype & 2) > 0 and (t.tgtype & 16) > 0 and (t.tgtype & 8) > 0 and (t.tgtype & 4) = 0
from pg_trigger t
where t.tgrelid = 'public.proposals'::regclass
  and t.tgname = 'proposals_acceptance_guard'

union all
-- 3e. it sorts before proposals_set_updated_at, so a refused update has
--     not already had its updated_at bumped. Triggers fire in name order.
select
  '3e. guard fires first on proposals',
  'alphabetically first BEFORE-row trigger',
  'proposals_acceptance_guard',
  min(t.tgname),
  min(t.tgname) = 'proposals_acceptance_guard'
from pg_trigger t
where t.tgrelid = 'public.proposals'::regclass
  and not t.tgisinternal
  and (t.tgtype & 2) > 0            -- BEFORE (bit 2; bit 1 is ROW)

union all
-- 4. THE SIX accepted_* COLUMNS ARE ALL NAMED IN THE FREEZE. A freeze
--    that silently covered five of six would pass every other check
--    here — this is the one that catches a column added later and not
--    added to the guard.
--
--    Driven off pg_attribute rather than a hardcoded list, so a seventh
--    accepted_* column added later shows up here as a failure instead
--    of as a quietly unprotected field.
select
  '4. accepted_* column frozen',
  a.attname,
  'true',
  (g.prosrc like '%' || a.attname || '%')::text,
  g.prosrc like '%' || a.attname || '%'
from pg_attribute a
cross join (
  select p.prosrc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'proposals_acceptance_guard'
) g
where a.attrelid = 'public.proposals'::regclass
  and a.attname like 'accepted%'
  and not a.attisdropped

union all
-- 5. A SHARED PROPOSAL CAN STILL BE REVOKED NORMALLY. This is the path
--    users hit every day — 'shared' is not protected, so revokeProposal
--    sets it back to 'draft' untouched. Proven at the rule.
select
  '5. shared proposal still revocable',
  'proposal_state_protected(''shared'')',
  'false',
  public.proposal_state_protected('shared')::text,
  public.proposal_state_protected('shared') = false

union all
-- 5b. ...and the forward move accepted -> ordered is NOT blocked. That
--     transition is 0030's business; blocking it here would break
--     conversion for owners and members.
select
  '5b. forward move to ordered not blocked',
  'guard names only draft and shared as reversions',
  'true',
  (p.prosrc like '%(''draft'', ''shared'')%')::text,
  p.prosrc like '%(''draft'', ''shared'')%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'proposals_acceptance_guard'

union all
-- 6. AN ADMIN CAN STILL DO ALL OF IT. Both bypasses, proven where they
--    live — the predicates know nothing about admin by design.
select
  '6. admin and no-session bypasses present',
  w.what,
  'true',
  (p.prosrc like w.pat)::text,
  p.prosrc like w.pat
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values
  ('is_admin() first branch',   '%is_admin()%'),
  ('auth.uid() is null branch', '%auth.uid() is null%')
) as w(what, pat)
where n.nspname = 'public' and p.proname = 'proposals_acceptance_guard'

union all
-- 6b. ...and the bypass returns OLD on the DELETE path. Returning NEW
--     there returns NULL, and NULL from a BEFORE DELETE trigger
--     silently CANCELS the delete — an admin would click delete, see no
--     error, and find the row still present. The one bug in this file
--     that would look like success.
select
  '6b. delete allow-path returns OLD',
  'if tg_op = ''DELETE'' then return old',
  'true',
  (p.prosrc like '%if tg_op = ''DELETE'' then%return old%')::text,
  p.prosrc like '%if tg_op = ''DELETE'' then%return old%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'proposals_acceptance_guard'

union all
-- 7. REGRESSION — 0029's whole-schema grant sweep. This migration
--    creates no table, so it cannot have reintroduced the default-grant
--    problem; the check is here because the README rule says every
--    grant-related VERIFY sweeps the whole schema.
select
  '7. no client role holds truncate/references/trigger',
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
-- 7b. ...one row per survivor, so the count is actionable
select
  '7b. surviving grant offender',
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
-- 8. THE OTHER DIRECTION. These guards are exactly the change that
--    quietly breaks what they protect. The grants and RLS must survive
--    intact on both tables.
select
  '8. DML grants intact',
  tbl.name || ' / ' || pr.priv,
  'true',
  has_table_privilege('authenticated', tbl.name, pr.priv)::text,
  has_table_privilege('authenticated', tbl.name, pr.priv)
from (values ('public.proposals'), ('public.contractor_customers')) as tbl(name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))  as pr(priv)

union all
-- 8b. ...and RLS is still on. The trigger checks the STATE and the ROLE;
--     RLS is still what checks the ORG, and neither replaces the other.
select
  '8b. RLS still enabled',
  c.relname,
  'true',
  c.relrowsecurity::text,
  c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('proposals', 'contractor_customers')

union all
-- 9. 0030's creation guard and 0027's lifecycle guard are untouched.
--    This migration added a trigger to a different table, and the
--    failure mode worth excluding is a stray drop taking one with it.
select
  '9. earlier guards still enabled',
  t.tgname,
  'O',
  t.tgenabled::text,
  t.tgenabled::text = 'O'
from pg_trigger t
where t.tgrelid = 'public.orders'::regclass
  and t.tgname in ('orders_creation_guard', 'orders_lifecycle_guard')

order by 1, 2;
