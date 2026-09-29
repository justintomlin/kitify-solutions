-- =====================================================================
-- 0032_transition_rules.sql
--
-- Phase 4b. Transition legality on proposals and orders, plus the
-- commercial-term freeze — on the proposal AND on the quote behind it.
--
--   0027  the salesperson role; the 48-hour order change window
--   0030  order creation by role: the salesperson closes, the office
--         converts
--   0031  the acceptance record and the customer book
--   0032  which state may follow which, and what may no longer move
--         once a customer has said yes
--
-- ---------------------------------------------------------------------
-- THE FINDING THAT CHANGED THE SCOPE
--
-- QUOTES ARE FULLY MUTABLE AFTER ACCEPTANCE. `saveQuote(id, ...)`
-- (lib/store.ts:531) updates any quote by id, including the one a
-- proposal names in accepted_quote_id, and the configurator reaches it
-- through getQuote/saveQuote like any other. Meanwhile
-- createOrderFromProposal reads `getQuote(proposal.acceptedQuoteId)` AT
-- CONVERSION TIME and freezes whatever it says then.
--
-- So freezing markup_pct on the proposal and stopping there would have
-- been theatre, exactly as the brief put it: the customer accepts a
-- $14,000 quote, someone edits the quote to $19,000, the proposal's
-- accepted_* columns still read clean, and the order snapshot records
-- the new number as though it were what was agreed. The quote is where
-- the money actually lives.
--
-- This migration therefore freezes BOTH. A quote is frozen when some
-- proposal names it as accepted_quote_id and that proposal is in
-- 'accepted' or 'ordered'. The other two tiers are deliberately NOT
-- frozen — the customer chose one, and the unchosen options are not
-- part of what was agreed.
--
-- QUOTE DELETION NEEDS NOTHING. 0003 made accepted_quote_id and the
-- three tier_* columns plain references with no ON DELETE action, so
-- Postgres already refuses to delete a quote any proposal points at.
-- The error is a bare 23503 rather than a named one, which is a 4c
-- message problem, not a hole.
--
-- ---------------------------------------------------------------------
-- WHERE THE RULES LIVE: A FUNCTION, NOT A TABLE
--
-- The brief left the shape open. This uses ONE function,
-- public.transition_min_role(entity, from, to), holding a VALUES list
-- for both entities — the same shape for both, as asked.
--
-- NOT A TABLE, and the reason is the whole of Phase 1. A table of
-- authorization rules is authorization data that someone can write to.
-- It would need RLS, policies, grants and the revoke-then-grant dance,
-- and it would join memberships and profiles.role on the list of things
-- whose compromise is total. 0023 exists because profiles.role was
-- self-writable. A VALUES list inside a SECURITY INVOKER IMMUTABLE
-- function has no grant surface, cannot be UPDATEd, and changes only
-- by migration — which is the review step a rule change should get.
--
-- The cost is honest: changing a rule needs a migration rather than an
-- INSERT. That is the point.
--
-- DEFAULTS. An unlisted (from, to) pair returns 'admin', so an admin
-- can repair anything — un-archive, correct a mis-set status — without
-- this file having to enumerate every recovery path. The two the ruling
-- forbids absolutely are listed EXPLICITLY as 'nobody', which outranks
-- admin and is the only thing that does.
--
-- ---------------------------------------------------------------------
-- TRIGGERS: TWO EXTENDED, ONE ADDED
--
-- Per the brief's preference, the existing guards are extended rather
-- than joined by new ones — so no fire-order question arises on either
-- table that already had a guard:
--
--   public.orders     orders_lifecycle_guard      (0027) — extended
--   public.proposals  proposals_acceptance_guard  (0031) — extended
--
-- Both bodies are reproduced in full below with the new sections added.
-- Nothing previously enforced is dropped, and the VERIFY block
-- re-asserts every check 0027 and 0031 shipped, because a
-- CREATE OR REPLACE that silently loses a branch is the failure mode of
-- extending a guard rather than adding one.
--
-- ONE NEW TRIGGER, on a table that had no guard:
--
--   public.quotes     quotes_acceptance_guard  — BEFORE UPDATE
--
-- public.quotes carries one trigger today, quotes_set_updated_at
-- (0001). Alphabetically:
--
--     quotes_acceptance_guard  <  quotes_set_updated_at
--
-- so the guard fires first and a refused update has not already had its
-- updated_at bumped. Triggers fire in name order.
--
-- ---------------------------------------------------------------------
-- DEPENDENCY ORDERING. One index is added and no column, so nothing
-- reads a field off a row type (0027's 42703) and no default references
-- a function at DDL time (0024's first-run bug). The binding order is
-- predicates before the guards that call them: PART 1 before PART 2.
--
-- NO TABLE IS CREATED — see above for why that is a decision rather
-- than an omission. Stated anyway: the rule is `revoke all on <table>
-- from authenticated, anon;` and `from anon, public` does NOT cover
-- `authenticated`, which is the one wording error behind all five prior
-- grant occurrences.
--
-- Re-runnable. Transactional.
-- =====================================================================

begin;

-- =====================================================================
-- PART 0 — Pre-flight. Abort rather than half-apply.
-- =====================================================================

-- 0a. Everything this migration reuses or rewrites must be present.
--     The two guards especially: this file REPLACES their bodies, and
--     replacing a function that is not there would quietly create a
--     trigger function with no trigger attached.
do $$
declare v_missing text;
begin
  select string_agg(want.fn, ', ') into v_missing
  from (values
    ('current_membership_role'), ('is_admin'),
    ('proposal_state_protected'), ('proposal_delete_role_allowed'),
    ('order_change_window_open'),
    ('orders_lifecycle_guard'), ('proposals_acceptance_guard')
  ) as want(fn)
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = want.fn
  );
  if v_missing is not null then
    raise exception
      'ABORT 0032/0a: missing function(s): %. Apply 0027, 0030 and 0031 first — this '
      'migration extends two of their guards and must not replace one that is absent.', v_missing;
  end if;
end $$;

-- 0b. Both guards must currently be ATTACHED. Replacing the function
--     bodies below does nothing if the triggers were dropped.
do $$
declare v_missing text;
begin
  select string_agg(want.tg, ', ') into v_missing
  from (values
    ('public.orders',    'orders_lifecycle_guard'),
    ('public.orders',    'orders_creation_guard'),
    ('public.proposals', 'proposals_acceptance_guard')
  ) as want(tbl, tg)
  where not exists (
    select 1 from pg_trigger t
    where t.tgrelid = want.tbl::regclass and t.tgname = want.tg and not t.tgisinternal
  );
  if v_missing is not null then
    raise exception
      'ABORT 0032/0b: trigger(s) not attached: %. Apply 0027, 0030 and 0031 first.', v_missing;
  end if;
end $$;

-- 0c. memberships.role must hold only the three known values, and both
--     status columns only their known values. Every rule below reasons
--     about these by name.
do $$
declare v_other text;
begin
  select string_agg(distinct m.role, ', ') into v_other
  from public.memberships m where m.role not in ('owner', 'member', 'salesperson');
  if v_other is not null then
    raise exception 'ABORT 0032/0c: unexpected memberships.role value(s): %.', v_other;
  end if;

  select string_agg(distinct p.status, ', ') into v_other
  from public.proposals p
  where p.status not in ('draft', 'shared', 'accepted', 'ordered', 'archived');
  if v_other is not null then
    raise exception
      'ABORT 0032/0c: unexpected proposals.status value(s): %. Add its rows to '
      'public.transition_min_role() before running — an unlisted state defaults to '
      'admin-only and would silently lock contractors out of it.', v_other;
  end if;

  select string_agg(distinct o.status, ', ') into v_other
  from public.orders o
  where o.status not in (
    'submitted', 'confirmed', 'in_production', 'ready_to_ship',
    'in_transit', 'delivered', 'completed', 'cancelled'
  );
  if v_other is not null then
    raise exception 'ABORT 0032/0c: unexpected orders.status value(s): %.', v_other;
  end if;
end $$;

-- 0d. Every column the two freezes name must exist. A freeze that
--     silently covers a subset is worse than no freeze, because it
--     reads as protection.
do $$
declare v_missing text;
begin
  select string_agg(want.tbl || '.' || want.col, ', ') into v_missing
  from (values
    ('proposals', 'markup_pct'), ('proposals', 'tier_good'), ('proposals', 'tier_better'),
    ('proposals', 'tier_best'), ('proposals', 'custom_line_items'),
    ('proposals', 'freight_override'), ('proposals', 'share_token'),
    ('quotes', 'room'), ('quotes', 'shower'), ('quotes', 'vanity'),
    ('quotes', 'plumbing'), ('quotes', 'total')
  ) as want(tbl, col)
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = ('public.' || want.tbl)::regclass
      and a.attname = want.col and not a.attisdropped
  );
  if v_missing is not null then
    raise exception 'ABORT 0032/0d: missing column(s): %.', v_missing;
  end if;
end $$;

-- =====================================================================
-- PART 1 — The rules
-- =====================================================================

-- ---------------------------------------------------------------------
-- role_rank — one ordering for every authority comparison below.
--
-- owner and member RANK EQUALLY, at 2. That is not an oversight: every
-- rule written across 0027, 0030, 0031 and this file grants them the
-- same thing, and inventing a gap between them here would be a rule
-- nobody asked for. If owner-only powers ever appear, this is the one
-- place to split them.
--
-- 'nobody' at 99 is the only rank that outranks admin. It exists for
-- the two transitions the ruling forbids absolutely.
-- ---------------------------------------------------------------------
create or replace function public.role_rank(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role
    when 'salesperson' then 1
    when 'member'      then 2
    when 'owner'       then 2
    when 'admin'       then 4
    when 'nobody'      then 99
    else 0                      -- null, or a role nobody has heard of
  end;
$$;

comment on function public.role_rank(text) is
  'Added by 0032. The authority ordering used by transition checks: salesperson 1, '
  'member/owner 2, admin 4, ''nobody'' 99, anything else 0. owner and member rank EQUALLY '
  'because every rule in the system grants them the same thing. ''nobody'' is the only rank '
  'above admin and exists for transitions no human may perform.';

-- ---------------------------------------------------------------------
-- transition_min_role — the legal transition set for both entities.
--
-- THE TABLE, and why each row reads as it does.
--
-- PROPOSALS
--   draft     -> shared     salesperson  a rep quotes and sends; that is the job
--   shared    -> draft      salesperson  unsharing their own un-accepted proposal
--   draft     -> archived   member       housekeeping on a dead draft
--   shared    -> archived   member       ditto
--   shared    -> accepted   NOBODY       the homeowner accepts through the public
--                                        route, which runs as service_role with no
--                                        session and bypasses this guard entirely.
--                                        So acceptance is literally unreachable from
--                                        any signed-in session. Not "discouraged" —
--                                        impossible.
--   accepted  -> ordered    member       conversion. 0030 gates the orders INSERT by
--                                        role; this is the matching proposal move.
--   accepted  -> archived   ADMIN        THE RULING. Closes gap 2: archiving hid a
--                                        deal and 404'd the public link, and any org
--                                        member could do it.
--   ordered   -> archived   ADMIN        same reasoning, later state
--   draft     -> accepted   NOBODY       THE RULING. Closes gap 1.
--   draft     -> ordered    NOBODY       THE RULING. Closes gap 1.
--   shared    -> ordered    NOBODY       MY EXTENSION, flagged in the report. The
--                                        ruling named the two draft-> pairs; this is
--                                        the same fabrication by one more step, and
--                                        createOrderFromProposal already refuses
--                                        anything but 'accepted'. Say the word and it
--                                        becomes 'admin' like the rest.
--
-- ORDERS — the admin pipeline, one adjacent step per row, exactly as
-- the NEXT_ACTION map in app/portal/orders/[id]/page.tsx performs them.
--   submitted     -> confirmed      admin
--   confirmed     -> in_production  admin
--   in_production -> ready_to_ship  admin
--   ready_to_ship -> in_transit     admin
--   in_transit    -> delivered      admin
--   delivered     -> completed      MEMBER  the contractor's terminal action. This is
--                                   the row that keeps "mark completed" working, and
--                                   it matches the UI, which shows that button only
--                                   when status = 'delivered'
--                                   (orders/[id]/page.tsx:437).
--   <any live>    -> cancelled      admin   cancellation is an admin button today
--
-- Everything unlisted returns 'admin'. For orders that means a SKIP
-- (submitted -> delivered) is admin-only rather than free, which is
-- narrower than canTransition() allows and matches what the buttons
-- actually do. It also means an admin can un-cancel or reopen a
-- completed order — canTransition() forbids that and this does not,
-- deliberately: a support fix should not require disabling a trigger.
-- ---------------------------------------------------------------------
create or replace function public.transition_min_role(p_entity text, p_from text, p_to text)
returns text
language sql
immutable
as $$
  select coalesce(
    (select r.min_role
     from (values
       -- entity      from             to               min_role
       ('proposal', 'draft',         'shared',        'salesperson'),
       ('proposal', 'shared',        'draft',         'salesperson'),
       ('proposal', 'draft',         'archived',      'member'),
       ('proposal', 'shared',        'archived',      'member'),
       ('proposal', 'shared',        'accepted',      'nobody'),
       ('proposal', 'accepted',      'ordered',       'member'),
       ('proposal', 'accepted',      'archived',      'admin'),
       ('proposal', 'ordered',       'archived',      'admin'),
       ('proposal', 'draft',         'accepted',      'nobody'),
       ('proposal', 'draft',         'ordered',       'nobody'),
       ('proposal', 'shared',        'ordered',       'nobody'),

       ('order',    'submitted',     'confirmed',     'admin'),
       ('order',    'confirmed',     'in_production', 'admin'),
       ('order',    'in_production', 'ready_to_ship', 'admin'),
       ('order',    'ready_to_ship', 'in_transit',    'admin'),
       ('order',    'in_transit',    'delivered',     'admin'),
       ('order',    'delivered',     'completed',     'member'),
       ('order',    'submitted',     'cancelled',     'admin'),
       ('order',    'confirmed',     'cancelled',     'admin'),
       ('order',    'in_production', 'cancelled',     'admin'),
       ('order',    'ready_to_ship', 'cancelled',     'admin'),
       ('order',    'in_transit',    'cancelled',     'admin')
     ) as r(entity, from_status, to_status, min_role)
     where r.entity = p_entity and r.from_status = p_from and r.to_status = p_to),
    'admin'
  );
$$;

comment on function public.transition_min_role(text, text, text) is
  'Added by 0032. The legal (from, to) transition set for entity ''proposal'' and ''order'', '
  'as the minimum role that may perform each. Unlisted pairs default to ''admin'' so support '
  'can repair anything; the pairs the ruling forbids absolutely are listed as ''nobody'', '
  'which is the only rank above admin. A FUNCTION rather than a table on purpose — a table of '
  'authorization rules is authorization data someone can write to. See the file header.';

revoke execute on function public.role_rank(text)                          from anon, public;
revoke execute on function public.transition_min_role(text, text, text)    from anon, public;
grant  execute on function public.role_rank(text)                          to authenticated, service_role;
grant  execute on function public.transition_min_role(text, text, text)    to authenticated, service_role;

-- ---------------------------------------------------------------------
-- quote_is_accepted — is this quote the one a customer said yes to?
--
-- SECURITY DEFINER because the guard that calls it must reach every
-- proposal regardless of the caller's RLS. In practice the caller is in
-- the same org and would see it anyway; relying on that would make the
-- freeze depend on a policy that is not about freezing.
--
-- Only accepted_quote_id counts. The unchosen tier_* quotes stay
-- editable: the customer picked one option, and the other two are not
-- part of what was agreed.
-- ---------------------------------------------------------------------
create index if not exists proposals_accepted_quote_id_idx
  on public.proposals (accepted_quote_id);

create or replace function public.quote_is_accepted(p_quote_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.proposals p
    where p.accepted_quote_id = p_quote_id
      and p.status in ('accepted', 'ordered')
  );
$$;

comment on function public.quote_is_accepted(uuid) is
  'Added by 0032. True when some proposal names this quote as accepted_quote_id and is in '
  '''accepted'' or ''ordered''. Backs the quotes freeze. Only the ACCEPTED tier counts — the '
  'other two options a customer did not choose stay editable.';

revoke execute on function public.quote_is_accepted(uuid) from anon, public;
grant  execute on function public.quote_is_accepted(uuid) to authenticated, service_role;

-- =====================================================================
-- PART 2 — The guards
-- =====================================================================

-- ---------------------------------------------------------------------
-- orders_lifecycle_guard — 0027's body, with transition legality added.
--
-- STRUCTURAL CHANGE FROM 0027: the single
-- `if public.is_admin() or auth.uid() is null then return new` bypass
-- is SPLIT. A session-less caller still bypasses everything. An admin
-- no longer does — admins are subject to the transition table, because
-- the table is what expresses "nobody may do this" and an admin who
-- skipped it could not be refused. Admins still bypass the 48-hour
-- window, which is what 0027 actually meant by that branch.
--
-- Orders has no 'nobody' rows today, so in practice nothing changes for
-- an admin. The structure is what matters: the rule is enforced in one
-- place for everyone, and the exemptions are named individually.
-- ---------------------------------------------------------------------
create or replace function public.orders_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed  text;
  v_min_role text;
begin
  -- ---- 1. stamp submitted_at, once (0027) ---------------------------
  if new.status = 'submitted' and new.submitted_at is null then
    new.submitted_at := now();
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  -- Never let an existing stamp be moved. The window is measured from
  -- it, so a writable submitted_at is a writable deadline. (0027)
  if old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then
    new.submitted_at := old.submitted_at;
  end if;

  -- No session: service_role, the SQL Editor, a SECURITY DEFINER
  -- function. Full bypass, as in 0027.
  if auth.uid() is null then
    return new;
  end if;

  -- ---- 2. transition legality (0032) --------------------------------
  -- Applies to ADMINS TOO. An unchanged status is not a transition and
  -- is skipped entirely, which is what lets every ordinary column
  -- update through.
  if new.status is distinct from old.status then
    v_min_role := public.transition_min_role('order', old.status, new.status);

    if public.role_rank(case when public.is_admin() then 'admin' else public.current_membership_role() end)
       < public.role_rank(v_min_role) then
      raise exception
        'ORDER_TRANSITION_FORBIDDEN: order % cannot move from "%" to "%" — that requires %. '
        'Contact Kitify.',
        old.order_number, old.status, new.status,
        case v_min_role when 'nobody' then 'no one; it is not a transition anybody performs'
                        else 'at least the ' || v_min_role || ' role' end
        using errcode = '42501';
    end if;
  end if;

  -- ---- 3. the 48-hour window (0027) ---------------------------------
  -- ADMIN BYPASS BELOW THE TRANSITION TABLE
  -- Admins bypass from here down, which is what 0027's combined branch
  -- was for. The marker line above is load-bearing: VERIFY check 6b
  -- asserts positionally that this bypass sits AFTER the transition
  -- check, because an admin bypass that jumped the table would make
  -- 'nobody' mean 'everyone but a contractor'.
  if public.is_admin() then
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

comment on function public.orders_lifecycle_guard() is
  'Added by 0027, extended by 0032. Stamps submitted_at once; enforces transition legality '
  'via transition_min_role(''order'', ...) for EVERY role including admin; then enforces the '
  '48-hour contractor change window, which admins bypass. Session-less callers bypass '
  'everything. Column-scoped on purpose so the contractor''s post-delivery work keeps '
  'working months after submission.';

-- ---------------------------------------------------------------------
-- proposals_acceptance_guard — 0031's body, with transition legality
-- and the commercial-term freeze added.
--
-- Extended rather than joined by a second trigger, per the brief, so
-- the fire order on public.proposals is unchanged:
--     proposals_acceptance_guard  <  proposals_set_updated_at
--
-- SAME STRUCTURAL SPLIT as orders: the session-less bypass stays total,
-- the admin bypass now sits AFTER transition legality so that 'nobody'
-- means nobody.
-- ---------------------------------------------------------------------
create or replace function public.proposals_acceptance_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role     text;
  v_frozen   text;
  v_terms    text;
  v_min_role text;
begin
  -- Session-less: service_role (the public accept route), the SQL
  -- Editor, a SECURITY DEFINER function. Total bypass — and it is what
  -- lets the homeowner's acceptance be written at all, since
  -- shared -> accepted is 'nobody' in the transition table.
  --
  -- if/then rather than a CASE mentioning NEW: in a row-level DELETE
  -- trigger NEW is not a row, and NULL returned from BEFORE DELETE
  -- silently CANCELS the delete.
  if auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_role := public.current_membership_role();

  -- ---- DELETE (0031) ------------------------------------------------
  if tg_op = 'DELETE' then
    if public.is_admin() then
      return old;
    end if;

    -- Role first, then state, deliberately: a salesperson gets the same
    -- answer whatever they try to delete.
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

  -- ---- UPDATE: status ------------------------------------------------
  if new.status is distinct from old.status then
    -- 0031's reversion error first: it is the specific, actionable
    -- message for the case users actually hit, and the generic
    -- transition error would otherwise swallow it. Admins may revert;
    -- accepted -> draft is unlisted and so defaults to admin.
    if not public.is_admin()
       and public.proposal_state_protected(old.status)
       and new.status in ('draft', 'shared') then
      raise exception
        'PROPOSAL_REVERT_FORBIDDEN: proposal "%" is % and cannot be returned to %. Unsharing '
        'it would discard the customer''s acceptance. Contact Kitify if it must be reopened.',
        old.name, old.status, new.status
        using errcode = '42501';
    end if;

    -- Transition legality (0032). Applies to ADMINS TOO — that is what
    -- makes 'nobody' mean nobody, and it is how draft -> accepted and
    -- draft -> ordered are refused even with an admin session.
    v_min_role := public.transition_min_role('proposal', old.status, new.status);

    if public.role_rank(case when public.is_admin() then 'admin' else v_role end)
       < public.role_rank(v_min_role) then
      raise exception
        'PROPOSAL_TRANSITION_FORBIDDEN: proposal "%" cannot move from "%" to "%" — that '
        'requires %.',
        old.name, old.status, new.status,
        case v_min_role
          when 'nobody' then 'no one; acceptance comes from the customer and ''ordered'' from conversion'
          else 'at least the ' || v_min_role || ' role' end
        using errcode = '42501';
    end if;
  end if;

  -- ADMIN BYPASS BELOW THE TRANSITION TABLE
  -- Admins bypass the freezes below. They do NOT bypass the transition
  -- table above. The marker line is load-bearing — see the same note in
  -- orders_lifecycle_guard, and VERIFY check 6b.
  if public.is_admin() then
    return new;
  end if;

  -- ---- UPDATE: the acceptance record (0031) --------------------------
  -- "Once set" is per column: accepted_phone is legitimately null when
  -- the homeowner leaves it blank, and a null old value is not yet a
  -- record to protect.
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

  -- ---- UPDATE: the commercial terms (0032) ---------------------------
  -- Only once accepted. Before that a proposal is a working document
  -- and every one of these is meant to be edited.
  --
  -- WHAT COUNTS AS COMMERCIAL, and what deliberately does not:
  --   markup_pct        the multiplier on the dealer total. THE hole
  --                     this closes — accept at one price, convert at
  --                     another, acceptance record still clean.
  --   tier_*            which quote backs each option. Re-pointing one
  --                     changes what the homeowner's live link shows.
  --   custom_line_items labour and extras; they are added to the price.
  --   freight_override  a real charged amount, frozen into the snapshot.
  --   share_token       MY EXTENSION, flagged in the report. Nulling it
  --                     404s the customer's link without touching a
  --                     status — the same burial that 'accepted ->
  --                     archived' now blocks, through another door.
  --
  -- NOT frozen: name and option_names (labels — 0019 says so in as many
  -- words), contractor_branding (frozen at share time already),
  -- last_sent_at (administrative), org_id/owner_id (tenancy, governed
  -- by RLS).
  if public.proposal_state_protected(old.status) then
    select string_agg(c.col, ', ') into v_terms
    from (values
      ('markup_pct',        new.markup_pct        is distinct from old.markup_pct),
      ('tier_good',         new.tier_good         is distinct from old.tier_good),
      ('tier_better',       new.tier_better       is distinct from old.tier_better),
      ('tier_best',         new.tier_best         is distinct from old.tier_best),
      ('custom_line_items', new.custom_line_items is distinct from old.custom_line_items),
      ('freight_override',  new.freight_override  is distinct from old.freight_override),
      ('share_token',       new.share_token       is distinct from old.share_token)
    ) as c(col, did_change)
    where c.did_change;

    if v_terms is not null then
      raise exception
        'PROPOSAL_TERMS_FROZEN: % on proposal "%" set the price the customer accepted and '
        'cannot be changed now. Contact Kitify.',
        v_terms, old.name
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.proposals_acceptance_guard() is
  'Added by 0031, extended by 0032. Protects the acceptance record (no delete, no reversion, '
  'six frozen accepted_* columns), enforces transition legality via '
  'transition_min_role(''proposal'', ...) for EVERY role including admin, and freezes the '
  'seven commercial-term columns once accepted. Session-less callers bypass everything, which '
  'is what lets the public accept route write the record. Admins bypass the freezes but NOT '
  'the transition table.';

-- ---------------------------------------------------------------------
-- quotes_acceptance_guard — NEW. The quote behind an acceptance.
--
-- Without this the proposal freeze is theatre: the money is in the
-- quote, createOrderFromProposal reads the quote at conversion time,
-- and saveQuote could rewrite it in between.
--
-- Fire order on public.quotes (name order):
--     quotes_acceptance_guard  <  quotes_set_updated_at
-- so a refused update has not already had its timestamp bumped.
--
-- BEFORE UPDATE only. INSERT cannot touch an accepted quote (it does
-- not exist yet), and DELETE is already refused by the foreign keys
-- 0003 put on accepted_quote_id and the three tier_* columns.
-- ---------------------------------------------------------------------
create or replace function public.quotes_acceptance_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_frozen text;
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if not public.quote_is_accepted(old.id) then
    return new;
  end if;

  -- `name` is deliberately absent: renaming "Option B" to "Master bath"
  -- changes nothing about what was agreed. `status` likewise — it is
  -- vestigial on quotes and nothing reads it for authorization.
  select string_agg(c.col, ', ') into v_frozen
  from (values
    ('room',      new.room      is distinct from old.room),
    ('shower',    new.shower    is distinct from old.shower),
    ('vanity',    new.vanity    is distinct from old.vanity),
    ('plumbing',  new.plumbing  is distinct from old.plumbing),
    ('bathrooms', new.bathrooms is distinct from old.bathrooms),
    ('total',     new.total     is distinct from old.total)
  ) as c(col, did_change)
  where c.did_change;

  if v_frozen is not null then
    raise exception
      'QUOTE_ACCEPTED_FROZEN: quote "%" was accepted by a customer and % cannot be changed. '
      'The order is built from this quote at conversion time. Copy it to a new quote instead.',
      old.name, v_frozen
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.quotes_acceptance_guard() is
  'Added by 0032. Freezes the contents and total of a quote once a proposal has accepted it. '
  'Without this the proposal freeze is theatre — createOrderFromProposal reads the quote at '
  'conversion time, so an edited quote silently changes what the order charges. Admins and '
  'session-less callers bypass. Unchosen tier quotes are not frozen.';

drop trigger if exists quotes_acceptance_guard on public.quotes;
create trigger quotes_acceptance_guard
  before update on public.quotes
  for each row execute function public.quotes_acceptance_guard();

commit;


-- =====================================================================
-- =====================================================================
--                          VERIFY SCRIPT
--
-- READ-ONLY. Run in the SQL Editor after applying. Every row must read
-- pass = true.
--
-- pg_catalog "char" columns (tgenabled, relkind) are cast to ::text.
-- tgtype is an int2 BITMASK, not "char": 2 BEFORE, 4 INSERT, 8 DELETE,
-- 16 UPDATE. BIT 1 IS ROW and is not what any assertion here wants.
--
-- Checks 1-4 prove the RULES by calling the functions that define them,
-- so they test what actually runs rather than matching policy text.
-- Checks 5-7 prove the guards still contain everything 0027 and 0031
-- shipped — the failure mode of EXTENDING a guard is a replacement that
-- quietly drops a branch.
-- =====================================================================
-- =====================================================================

-- 1. THE PROPOSAL TRANSITION SET, every pair that matters, by rule
select
  '1. proposal transition min_role'                                  as check,
  x.from_s || ' -> ' || x.to_s                                       as detail,
  x.want                                                             as expected,
  public.transition_min_role('proposal', x.from_s, x.to_s)           as actual,
  public.transition_min_role('proposal', x.from_s, x.to_s) = x.want  as pass
from (values
  ('draft',    'shared',   'salesperson'),
  ('shared',   'draft',    'salesperson'),
  ('draft',    'archived', 'member'),
  ('shared',   'archived', 'member'),
  ('accepted', 'ordered',  'member'),
  ('accepted', 'archived', 'admin'),      -- THE RULING: admin-only
  ('ordered',  'archived', 'admin'),
  ('shared',   'accepted', 'nobody'),     -- only the public route, which bypasses
  ('draft',    'accepted', 'nobody'),     -- THE RULING: illegal for everyone
  ('draft',    'ordered',  'nobody'),     -- THE RULING: illegal for everyone
  ('shared',   'ordered',  'nobody'),
  ('archived', 'draft',    'admin')       -- unlisted, so admin can un-archive
) as x(from_s, to_s, want)

union all
-- 2. THE ORDER TRANSITION SET
select
  '2. order transition min_role',
  x.from_s || ' -> ' || x.to_s,
  x.want,
  public.transition_min_role('order', x.from_s, x.to_s),
  public.transition_min_role('order', x.from_s, x.to_s) = x.want
from (values
  ('submitted',     'confirmed',     'admin'),
  ('confirmed',     'in_production', 'admin'),
  ('in_production', 'ready_to_ship', 'admin'),
  ('ready_to_ship', 'in_transit',    'admin'),
  ('in_transit',    'delivered',     'admin'),
  ('delivered',     'completed',     'member'),   -- the contractor's terminal action
  ('in_transit',    'cancelled',     'admin'),
  ('submitted',     'delivered',     'admin')     -- a SKIP: unlisted, admin-only
) as x(from_s, to_s, want)

union all
-- 3. THE RANKING. draft -> accepted must fail FOR AN ADMIN, which is
--    true only if 'nobody' outranks 'admin'. This is the check that
--    proves the ruling's "including admin" clause holds.
select
  '3. nobody outranks admin',
  'role_rank(nobody) > role_rank(admin)',
  'true',
  (public.role_rank('nobody') > public.role_rank('admin'))::text,
  public.role_rank('nobody') > public.role_rank('admin')

union all
-- 3b. ...and the full ordering, including that a null role ranks below
--      a salesperson and so satisfies nothing
select
  '3b. role_rank ordering',
  coalesce(r.role, '(null)'),
  r.want::text,
  public.role_rank(r.role)::text,
  public.role_rank(r.role) = r.want
from (values
  ('salesperson', 1), ('member', 2), ('owner', 2), ('admin', 4), ('nobody', 99), (null, 0)
) as r(role, want)

union all
-- 3c. THE DECISION, composed exactly as the guards compose it: can a
--     caller of each role perform each transition? This is the check
--     that would catch a correct table read through a wrong comparison.
select
  '3c. composed decision',
  x.who || ' : ' || x.entity || ' ' || x.from_s || ' -> ' || x.to_s,
  x.want::text,
  (public.role_rank(x.who) >= public.role_rank(public.transition_min_role(x.entity, x.from_s, x.to_s)))::text,
  (public.role_rank(x.who) >= public.role_rank(public.transition_min_role(x.entity, x.from_s, x.to_s))) = x.want
from (values
  -- the ruling: fabrication is refused even for admin
  ('admin',       'proposal', 'draft',     'accepted', false),
  ('admin',       'proposal', 'draft',     'ordered',  false),
  -- accepted -> archived is admin-only
  ('admin',       'proposal', 'accepted',  'archived', true),
  ('owner',       'proposal', 'accepted',  'archived', false),
  ('member',      'proposal', 'accepted',  'archived', false),
  ('salesperson', 'proposal', 'accepted',  'archived', false),
  -- a rep may share and unshare their own work
  ('salesperson', 'proposal', 'draft',     'shared',   true),
  ('salesperson', 'proposal', 'shared',    'draft',    true),
  -- but may not convert, nor archive a dead draft
  ('salesperson', 'proposal', 'accepted',  'ordered',  false),
  ('salesperson', 'proposal', 'draft',     'archived', false),
  ('member',      'proposal', 'accepted',  'ordered',  true),
  -- THE CONTRACTOR'S TERMINAL ACTION must survive
  ('member',      'order',    'delivered', 'completed', true),
  ('owner',       'order',    'delivered', 'completed', true),
  -- ...but a rep does not mark orders complete, and nobody below admin
  -- advances the pipeline or cancels
  ('salesperson', 'order',    'delivered', 'completed', false),
  ('member',      'order',    'submitted', 'confirmed', false),
  ('member',      'order',    'in_transit','cancelled', false),
  ('admin',       'order',    'in_transit','cancelled', true)
) as x(who, entity, from_s, to_s, want)

union all
-- 4. COMMERCIAL TERMS ARE FROZEN AFTER ACCEPTANCE. Each column named in
--    the guard, so a list that silently lost one fails here.
select
  '4. commercial term frozen',
  w.col,
  'true',
  (p.prosrc like '%' || w.col || '%')::text,
  p.prosrc like '%' || w.col || '%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values
  ('markup_pct'), ('tier_good'), ('tier_better'), ('tier_best'),
  ('custom_line_items'), ('freight_override'), ('share_token'),
  ('PROPOSAL_TERMS_FROZEN'), ('proposal_state_protected')
) as w(col)
where n.nspname = 'public' and p.proname = 'proposals_acceptance_guard'

union all
-- 4b. ...and the quote behind it. Without this the proposal freeze is
--      theatre — the money is in the quote.
select
  '4b. quote content frozen',
  w.col,
  'true',
  (p.prosrc like '%' || w.col || '%')::text,
  p.prosrc like '%' || w.col || '%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values
  ('room'), ('shower'), ('vanity'), ('plumbing'), ('bathrooms'), ('total'),
  ('QUOTE_ACCEPTED_FROZEN'), ('quote_is_accepted')
) as w(col)
where n.nspname = 'public' and p.proname = 'quotes_acceptance_guard'

union all
-- 4c. the quotes guard is attached, enabled, and BEFORE UPDATE only
select
  '4c. quotes guard is BEFORE UPDATE only',
  'enabled / before / update / not-insert / not-delete',
  'O/true/true/false/false',
  t.tgenabled::text || '/' || ((t.tgtype & 2) > 0)::text || '/' || ((t.tgtype & 16) > 0)::text
    || '/' || ((t.tgtype & 4) > 0)::text || '/' || ((t.tgtype & 8) > 0)::text,
  t.tgenabled::text = 'O' and (t.tgtype & 2) > 0 and (t.tgtype & 16) > 0
    and (t.tgtype & 4) = 0 and (t.tgtype & 8) = 0
from pg_trigger t
where t.tgrelid = 'public.quotes'::regclass and t.tgname = 'quotes_acceptance_guard'

union all
-- 4d. ...and it sorts before quotes_set_updated_at
select
  '4d. quotes guard fires first',
  'alphabetically first BEFORE-row trigger on quotes',
  'quotes_acceptance_guard',
  min(t.tgname),
  min(t.tgname) = 'quotes_acceptance_guard'
from pg_trigger t
where t.tgrelid = 'public.quotes'::regclass
  and not t.tgisinternal
  and (t.tgtype & 2) > 0                        -- BEFORE (bit 2; bit 1 is ROW)

union all
-- 5. NOTHING 0031 SHIPPED WAS LOST. This is the whole risk of extending
--    a guard instead of adding one: CREATE OR REPLACE silently accepts
--    a body with a branch missing.
select
  '5. proposals guard retains 0031',
  w.what,
  'true',
  (p.prosrc like w.pat)::text,
  p.prosrc like w.pat
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values
  ('PROPOSAL_DELETE_FORBIDDEN',      '%PROPOSAL_DELETE_FORBIDDEN%'),
  ('PROPOSAL_ACCEPTED_IMMUTABLE',    '%PROPOSAL_ACCEPTED_IMMUTABLE%'),
  ('PROPOSAL_REVERT_FORBIDDEN',      '%PROPOSAL_REVERT_FORBIDDEN%'),
  ('PROPOSAL_ACCEPTANCE_FROZEN',     '%PROPOSAL_ACCEPTANCE_FROZEN%'),
  ('accepted_tier frozen',           '%accepted_tier%'),
  ('accepted_quote_id frozen',       '%accepted_quote_id%'),
  ('accepted_by frozen',             '%accepted_by%'),
  ('accepted_email frozen',          '%accepted_email%'),
  ('accepted_phone frozen',          '%accepted_phone%'),
  ('accepted_at frozen',             '%accepted_at%'),
  ('delete returns OLD',             '%if tg_op = ''DELETE'' then%return old%'),
  ('session-less bypass',            '%auth.uid() is null%'),
  ('new: transition check',          '%PROPOSAL_TRANSITION_FORBIDDEN%')
) as w(what, pat)
where n.nspname = 'public' and p.proname = 'proposals_acceptance_guard'

union all
-- 6. NOTHING 0027 SHIPPED WAS LOST, same reasoning, on orders.
select
  '6. orders guard retains 0027',
  w.what,
  'true',
  (p.prosrc like w.pat)::text,
  p.prosrc like w.pat
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values
  ('ORDER_LOCKED',                 '%ORDER_LOCKED%'),
  ('submitted_at stamp',           '%new.submitted_at := now()%'),
  ('submitted_at pinned',          '%new.submitted_at := old.submitted_at%'),
  ('48-hour window',               '%order_change_window_open%'),
  ('snapshot frozen',              '%snapshot%'),
  ('customer_address frozen',      '%customer_address%'),
  ('completed still permitted',    '%<> ''completed''%'),
  ('session-less bypass',          '%auth.uid() is null%'),
  ('new: transition check',        '%ORDER_TRANSITION_FORBIDDEN%')
) as w(what, pat)
where n.nspname = 'public' and p.proname = 'orders_lifecycle_guard'

union all
-- 6b. BOTH GUARDS SUBJECT ADMINS TO THE TRANSITION TABLE. The admin
--     bypass must appear AFTER the transition check, or 'nobody' means
--     'everyone but a contractor' and the ruling's "including admin"
--     clause is silently false. Proven positionally.
--
--     Anchored on the marker COMMENT, not on `if public.is_admin()
--     then` — that string appears twice in the proposals guard (the
--     DELETE branch has its own, earlier, admin exit) and position()
--     returns the FIRST match, so the naive form would fail on a
--     correct function.
select
  '6b. admin bypass sits after the transition check',
  p.proname,
  'true',
  (position('transition_min_role' in p.prosrc)
     < position('ADMIN BYPASS BELOW THE TRANSITION TABLE' in p.prosrc))::text,
  position('transition_min_role' in p.prosrc) > 0
    and position('ADMIN BYPASS BELOW THE TRANSITION TABLE' in p.prosrc) > 0
    and position('transition_min_role' in p.prosrc)
        < position('ADMIN BYPASS BELOW THE TRANSITION TABLE' in p.prosrc)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('orders_lifecycle_guard', 'proposals_acceptance_guard')

union all
-- 7. ALL FOUR EARLIER GUARDS ARE STILL ATTACHED AND ENABLED.
select
  '7. earlier guards still enabled',
  n.nspname || '.' || c.relname || ' / ' || t.tgname,
  'O',
  t.tgenabled::text,
  t.tgenabled::text = 'O'
from pg_trigger t
join pg_class c     on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and t.tgname in (
    'orders_creation_guard', 'orders_lifecycle_guard',
    'proposals_acceptance_guard', 'memberships_role_guard'
  )

union all
-- 8. REGRESSION — 0029's whole-schema grant sweep.
select
  '8. no client role holds truncate/references/trigger',
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
-- 8b. ...one row per survivor, so the count is actionable
select
  '8b. surviving grant offender',
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
-- 9. THE OTHER DIRECTION. Three guards on three tables is exactly the
--    change that quietly breaks what it protects.
select
  '9. DML grants intact',
  tbl.name || ' / ' || pr.priv,
  'true',
  has_table_privilege('authenticated', tbl.name, pr.priv)::text,
  has_table_privilege('authenticated', tbl.name, pr.priv)
from (values ('public.proposals'), ('public.quotes'), ('public.orders')) as tbl(name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))       as pr(priv)

union all
-- 9b. ...and RLS is still on all three. The guards check STATE and
--      ROLE; RLS is still what checks the ORG.
select
  '9b. RLS still enabled',
  c.relname,
  'true',
  c.relrowsecurity::text,
  c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('proposals', 'quotes', 'orders')

union all
-- 10. the index the quotes freeze leans on. quote_is_accepted() runs on
--     every quote UPDATE; without this it is a seq scan of proposals.
select
  '10. accepted_quote_id indexed',
  'proposals_accepted_quote_id_idx',
  'true',
  (count(*) > 0)::text,
  count(*) > 0
from pg_index i
join pg_class ic on ic.oid = i.indexrelid
where i.indrelid = 'public.proposals'::regclass
  and ic.relname = 'proposals_accepted_quote_id_idx'

order by 1, 2;
