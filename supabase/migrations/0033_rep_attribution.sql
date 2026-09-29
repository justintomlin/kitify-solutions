-- =====================================================================
-- 0033_rep_attribution.sql
--
-- Who closed the deal, and what they earn on it.
--
--   0027  the salesperson role
--   0030  order creation by role: the salesperson closes, the office
--         converts
--   0031  the acceptance record and the customer book
--   0032  transition legality and the commercial-term freeze
--   0033  credit for the close, frozen with the rest of it
--
-- SCHEMA ONLY. No UI, no dashboard, no commission calculation.
--
-- ---------------------------------------------------------------------
-- THE PROBLEM, WHICH IS NOT OBVIOUS UNTIL YOU LOOK AT THE ACCEPT ROUTE
--
-- Credit is meant to be stamped AT ACCEPTANCE. But acceptance happens in
-- app/api/proposal/[token]/accept/route.ts, which runs with the
-- SERVICE_ROLE key and NO SESSION — the homeowner is not signed in, and
-- neither is the rep. auth.uid() is null for the entire transaction.
-- The request payload carries tier, name, email and phone and nothing
-- else, and anything it did carry would be asserted by the homeowner’s
-- browser rather than proven.
--
-- So there is no authenticated rep at the moment of acceptance, and any
-- scheme that tries to read one there is reading something a stranger
-- could have typed.
--
-- THE ONE MOMENT AN AUTHENTICATED REP IS PROVABLY INVOLVED with the
-- outward-facing document is when the share link is minted.
-- shareProposal() (lib/store.ts:592) runs in the rep’s own session
-- against their own RLS. That is a fact the database can witness.
--
-- Hence TWO columns, not one:
--
--   shared_by_user_id  stamped from auth.uid() when a proposal enters
--                      ’shared’. The witnessed fact.
--   closed_by_user_id  copied from it when the proposal enters
--                      ’accepted’. The credit.
--
-- Both are stamped BY THE GUARD, not by application code. The accept
-- route needs no change at all and cannot forget to do it — which
-- matters, because the route is the one code path in this system that
-- runs without RLS.
--
-- WHY NOT owner_id. It is the only existing candidate and it is a proxy,
-- not a record:
--   * it means "who created this row", which is the office whenever an
--     office member builds a proposal from a rep’s measure
--   * it exists on drafts that are never shared, so it is not evidence
--     of anyone having worked a deal
--   * it is the tenancy and RLS anchor on nine tables. Overloading it
--     with commission meaning couples the money to the access model,
--     and the next person to change one breaks the other.
--
-- NULLABLE, AND NOTHING IS BACKFILLED. A proposal already sitting in
-- ’shared’ when this migration runs has no shared_by_user_id, so it
-- will accept with closed_by_user_id null. That is correct: nobody
-- recorded who shared it and guessing from owner_id would manufacture
-- evidence. It self-heals — the next share of any proposal stamps it.
--
-- ---------------------------------------------------------------------
-- FIRST SHARE WINS — THE RULING
--
-- shared_by_user_id is stamped ONLY when it is still null, so the first
-- person to send the estimate keeps the credit however many times it is
-- revoked and re-sent afterwards. An owner re-sending a rep’s proposal
-- as a favour does not take the deal off them.
--
-- This deliberately diverges from contractor_branding, which 0003
-- re-snapshots on every re-share on the reasoning that "that is a new
-- link and a new send". Both are right: branding is a property of the
-- DOCUMENT that went out, and credit is a property of the WORK that was
-- done. Re-sending somebody else’s estimate is a new document and is
-- not new work.
--
-- Consequence worth knowing: a proposal genuinely handed from one rep
-- to another keeps the first rep’s name, and no UI exists to reassign
-- it. An admin can, since the freeze exempts them. If reassignment
-- becomes routine it wants a deliberate action rather than a side
-- effect of re-sharing.
--
-- ---------------------------------------------------------------------
-- COMMISSION: COLUMNS, NOT A TABLE
--
-- The rulings are one rate per rep and one basis per contractor, and no
-- prescribed model. Two nullable columns express exactly that:
--
--   memberships.commission_rate_pct   per rep, per org — the same user
--                                     in two orgs can be on two rates
--   orgs.commission_basis             per contractor, so one dealer is
--                                     not accidentally running three
--                                     schemes at once
--
-- A table would be needed for rate HISTORY, tiered rates, or per-deal
-- overrides. None of those are ruled in, and a join table for a single
-- scalar is a schema that has to be explained.
--
-- !! BUT A RATE THAT LIVES ONLY ON THE MEMBERSHIP IS A BUG WAITING. !!
-- Change a rep’s rate next March and every commission ever computed
-- from it changes with it.
--
-- THIS MIRRORS 0032 EXACTLY, and is kept for that reason. 0032 froze
-- markup_pct on an accepted proposal, and then had to freeze the quote
-- behind it too, because createOrderFromProposal reads the quote AT
-- CONVERSION TIME — so an edit after acceptance silently changed what
-- the order charged while the acceptance record still read clean. A
-- commission rate read live at report time is the same shape one layer
-- out: the number a rep was told they earned would move when somebody
-- edited a setting months later, and nothing in the record would show
-- that it had.
--
-- The rule 0032 established, applied here: WHAT WAS AGREED MUST NOT
-- MOVE WHEN THE SOURCE DATA DOES. So the rate and the basis are
-- SNAPSHOT ONTO THE ORDER at conversion, beside the attribution. Two
-- extra columns, no logic.
--
-- (This began as an extension beyond the brief — which asked only that
-- closed_by_user_id carry across — and was confirmed on review.)
--
-- ---------------------------------------------------------------------
-- GUARDS EXTENDED, NOT DUPLICATED
--
--   public.proposals  proposals_acceptance_guard  (0031/0032) — extended
--   public.orders     orders_creation_guard       (0030)      — extended
--
-- No new trigger on either table, so no fire order changes anywhere.
-- Both bodies are reproduced in full, and VERIFY re-asserts every
-- branch 0030, 0031 and 0032 shipped — a CREATE OR REPLACE that quietly
-- drops one is the standing risk of extending a guard.
--
-- ONE ORDERING SUBTLETY IN orders_creation_guard: the attribution copy
-- runs BEFORE the admin and session-less bypasses. Those exits return
-- early, and an order converted by an admin on a contractor’s behalf
-- must still carry the rep’s credit.
--
-- ---------------------------------------------------------------------
-- DEPENDENCY ORDERING. Columns (PART 2) before the guards that read
-- them (PART 3) — 0027’s 42703 was a function created before the column
-- it read. Nothing here defaults to a function, so 0024’s opposite bug
-- does not arise. The enum precedes the columns typed by it.
--
-- NO TABLE IS CREATED. Stated rather than skipped: the rule is
-- `revoke all on <table> from authenticated, anon;` — `from anon,
-- public` does NOT cover `authenticated`, the one wording error behind
-- all five prior grant occurrences.
--
-- ---------------------------------------------------------------------
-- THE ORIGINAL VERIFY BLOCK COULD NOT BE RUN. DO NOT REBUILD IT.
--
-- This migration shipped with a single-statement VERIFY block of the
-- kind 0023 through 0032 all use. It could not be executed through the
-- Supabase SQL Editor across THREE attempts. The body committed every
-- time; only the block below commit; failed.
--
--     attempt 1   ERROR: 3F000: schema "new" does not exist
--     attempt 2   ERROR: 3F000: schema "new" does not exist
--     attempt 3   ERROR: 42P01: relation "new" does not exist
--
-- No line number on any of them. THE CAUSE WAS NEVER IDENTIFIED.
--
-- What was ruled out, so nobody repeats it:
--   * the SQL itself. Lexing the block three separate ways found zero
--     occurrences of new. or old. outside a string literal, balanced
--     quotes throughout, and balanced dollar quoting.
--   * apostrophes in -- comments. The block held eleven, an odd number,
--     which a client that scans for quotes before it recognises
--     comments would choke on. They were removed. No change.
--   * the dotted needles themselves. All thirty were rewritten as
--     runtime concatenation, so the characters new. and old. appeared
--     nowhere below commit;. The error MOVED — 3F000 became 42P01 —
--     rather than going away, which says the mangling happens after
--     the string is assembled and is not about the source text at all.
--
-- The block was then deleted rather than debugged a fourth time. It
-- asserted nothing that direct catalog inspection does not, and it had
-- cost three runs. What replaced it is three plain catalog queries,
-- below, which ran against production without complaint.
--
-- IF YOU ADD A CHECK HERE, KEEP IT A PLAIN SELECT. No constructed
-- assertions, no needles containing a dot.
--
-- ---------------------------------------------------------------------
-- FIRST SHARE WINS IS VERIFIED BY CODE REVIEW, NOT BY VERIFY.
--
-- Three checks were dropped with the block: they asserted that the gate
-- `and old.shared_by_user_id is null` sits between the status test and
-- the assignment, by comparing source POSITIONS within prosrc. That is
-- the only assertion here that requires dotted needles, and dotted
-- needles are exactly what could not be made to survive the editor.
--
-- The rule is one clause in one if-condition, about twenty lines into
-- proposals_acceptance_guard in PART 3. A reviewer confirms it by
-- reading it, which is cheaper than three runs and at least as
-- reliable. Query 3 below still proves the guard kept every branch it
-- is supposed to raise; what it no longer proves is the ORDER of the
-- lines inside one of them.
--
-- ---------------------------------------------------------------------
-- RE-RUNNABLE AGAINST A DATABASE THAT ALREADY HAS IT.
--
-- Which is now the state of production: the first run committed the
-- body. Every statement is idempotent — add column if not exists,
-- create or replace function, drop trigger if exists before create,
-- create index if not exists, drop constraint if exists before add, and
-- an exception-guarded create type. Pre-flight 0b compares the types of
-- columns that now exist and passes, rather than finding nothing and
-- passing vacuously. Transactional.
-- =====================================================================

begin;

-- =====================================================================
-- PART 0 — Pre-flight
-- =====================================================================

-- 0a. Both guards must exist AND be attached. This file replaces their
--     bodies; replacing a function that is not there would leave a
--     trigger function with no trigger, and replacing one whose trigger
--     was dropped would enforce nothing.
do $$
declare v_missing text;
begin
  select string_agg(want.fn, ', ') into v_missing
  from (values
    ('current_membership_role'), ('is_admin'),
    ('proposal_state_protected'), ('proposal_delete_role_allowed'),
    ('order_create_role_allowed'), ('transition_min_role'), ('role_rank')
  ) as want(fn)
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = want.fn
  );
  if v_missing is not null then
    raise exception
      'ABORT 0033/0a: missing function(s): %. Apply 0027 through 0032 first.', v_missing;
  end if;

  select string_agg(want.tg, ', ') into v_missing
  from (values
    ('public.proposals', 'proposals_acceptance_guard'),
    ('public.orders',    'orders_creation_guard'),
    ('public.orders',    'orders_lifecycle_guard')
  ) as want(tbl, tg)
  where not exists (
    select 1 from pg_trigger t
    where t.tgrelid = want.tbl::regclass and t.tgname = want.tg and not t.tgisinternal
  );
  if v_missing is not null then
    raise exception 'ABORT 0033/0a: trigger(s) not attached: %.', v_missing;
  end if;
end $$;

-- 0b. Nothing may already occupy the four column names, unless this
--     migration put them there. A pre-existing closed_by_user_id of a
--     different shape would be silently adopted by the guards below.
do $$
declare v_bad text;
begin
  select string_agg(x.tbl || '.' || x.col || ' (' || x.found || ', expected ' || x.want || ')', '; ')
    into v_bad
  from (
    select want.tbl, want.col, want.want, format_type(a.atttypid, a.atttypmod) as found
    from (values
      ('proposals', 'shared_by_user_id',  'uuid'),
      ('proposals', 'closed_by_user_id',  'uuid'),
      ('orders',    'closed_by_user_id',  'uuid')
    ) as want(tbl, col, want)
    join pg_attribute a
      on a.attrelid = ('public.' || want.tbl)::regclass
     and a.attname = want.col
     and not a.attisdropped
    where format_type(a.atttypid, a.atttypmod) <> want.want
  ) x;
  if v_bad is not null then
    raise exception 'ABORT 0033/0b: column(s) already exist with the wrong type: %.', v_bad;
  end if;
end $$;

-- 0c. memberships.role must still hold only the three known values —
--     the rate column below is meaningful only for a salesperson today,
--     and an unknown role means somebody has changed the model.
do $$
declare v_other text;
begin
  select string_agg(distinct m.role, ', ') into v_other
  from public.memberships m where m.role not in ('owner', 'member', 'salesperson');
  if v_other is not null then
    raise exception 'ABORT 0033/0c: unexpected memberships.role value(s): %.', v_other;
  end if;
end $$;

-- =====================================================================
-- PART 1 — The enum
--
-- Three bases, which is what the ruling named. The platform holds the
-- SHAPE; the contractor picks which one. Deliberately no default
-- anywhere — an unset basis means "this contractor has not decided",
-- which is different from "job total", and a default would erase that
-- distinction on every org the moment this runs.
-- =====================================================================
do $$
begin
  create type public.commission_basis as enum ('job_total', 'gross_margin', 'labor_portion');
exception
  when duplicate_object then null;
end $$;

-- =====================================================================
-- PART 2 — Columns
--
-- BEFORE PART 3, because the guards read every one of these. 0027 lost
-- a run to a function created ahead of the column it read.
-- =====================================================================

-- ---- proposals: the witnessed share, and the credit ------------------
alter table public.proposals
  add column if not exists shared_by_user_id uuid references public.profiles (id),
  add column if not exists closed_by_user_id uuid references public.profiles (id);

-- A rep dashboard filters on exactly this. Partial, because the vast
-- majority of proposals will never be accepted and indexing the nulls
-- buys nothing.
create index if not exists proposals_closed_by_user_id_idx
  on public.proposals (closed_by_user_id)
  where closed_by_user_id is not null;

comment on column public.proposals.shared_by_user_id is
  'Added by 0033. Who FIRST minted a share link, from auth.uid() at the moment the proposal '
  'entered ''shared''. THE ONLY MOMENT an authenticated rep is provably involved with the '
  'outward-facing document — the public accept route runs as service_role with no session. '
  'FIRST SHARE WINS: stamped only while null, so an owner revoking and re-sending a rep''s '
  'estimate does not take the deal off them. Deliberately unlike contractor_branding, which '
  're-snapshots on every re-share.';

comment on column public.proposals.closed_by_user_id is
  'Added by 0033. The rep credited with the close, copied from shared_by_user_id when the '
  'proposal entered ''accepted'' and frozen with the rest of the acceptance record. NULL for '
  'proposals accepted before 0033, and for any shared before it — nobody recorded who sent '
  'those, and owner_id is who CREATED the row, which is the office whenever an office member '
  'builds a proposal from a rep''s measure. Not guessed.';

-- ---- orders: the attribution, and what it was worth -------------------
--
-- Carried across so credit survives the proposal being archived, and
-- so a commission report reads orders rather than joining back through
-- a document that may since have been reopened.
alter table public.orders
  add column if not exists closed_by_user_id  uuid references public.profiles (id),
  add column if not exists commission_rate_pct numeric(6, 3),
  add column if not exists commission_basis    public.commission_basis;

alter table public.orders drop constraint if exists orders_commission_rate_pct_check;
alter table public.orders add constraint orders_commission_rate_pct_check
  check (commission_rate_pct is null or (commission_rate_pct >= 0 and commission_rate_pct <= 100));

create index if not exists orders_closed_by_user_id_idx
  on public.orders (closed_by_user_id)
  where closed_by_user_id is not null;

comment on column public.orders.closed_by_user_id is
  'Added by 0033. Copied from the source proposal at conversion by orders_creation_guard, so '
  'attribution survives the proposal being archived. Frozen afterwards.';

comment on column public.orders.commission_rate_pct is
  'Added by 0033. The rep''s rate AS IT STOOD AT CONVERSION, snapshot from their membership. '
  'Reading memberships.commission_rate_pct live at report time would mean changing a rate in '
  'March silently rewrote every commission ever earned — the same shape 0032 closed on '
  'markup_pct and quote totals. NULL when no rate was set, which is not zero.';

comment on column public.orders.commission_basis is
  'Added by 0033. The org''s basis as it stood at conversion, snapshot beside the rate for the '
  'same reason. NULL means the contractor had not chosen one.';

-- ---- the configuration itself -----------------------------------------
--
-- Rate per MEMBERSHIP, not per profile: the same person in two orgs can
-- be on two different rates, and a rate is a term of one engagement.
-- Basis per ORG, so a contractor runs one scheme rather than three by
-- accident.
alter table public.memberships
  add column if not exists commission_rate_pct numeric(6, 3);

alter table public.memberships drop constraint if exists memberships_commission_rate_pct_check;
alter table public.memberships add constraint memberships_commission_rate_pct_check
  check (commission_rate_pct is null or (commission_rate_pct >= 0 and commission_rate_pct <= 100));

comment on column public.memberships.commission_rate_pct is
  'Added by 0033. What this person earns on a deal in THIS org, as a percentage of whatever '
  'orgs.commission_basis names. NO DEFAULT and nullable: the contractor sets it, Kitify does '
  'not prescribe one, and NULL means "not configured" rather than zero. Per membership '
  'because the same user in two orgs is two engagements.';

alter table public.orgs
  add column if not exists commission_basis public.commission_basis;

comment on column public.orgs.commission_basis is
  'Added by 0033. What this contractor pays commission ON: job_total, gross_margin or '
  'labor_portion. Org-level so one dealer runs one scheme. NO DEFAULT — an unset basis means '
  '"not decided", which is a different thing from job_total, and defaulting would erase that '
  'distinction on every org the moment 0033 ran.';

-- =====================================================================
-- PART 3 — The guards, extended
-- =====================================================================

-- ---------------------------------------------------------------------
-- proposals_acceptance_guard — 0031’s body as 0032 extended it, plus
-- the two attribution stamps and their freeze.
--
-- THE STAMPS RUN BEFORE THE SESSION-LESS BYPASS, deliberately and
-- unlike everything else in this file’s ancestry. The accept route IS
-- the session-less caller, and it is the transition that needs
-- stamping; an exit above the stamp would mean credit was never
-- recorded on the one path that records acceptances.
--
-- auth.uid() is null there, which is exactly why closed_by_user_id is
-- COPIED from shared_by_user_id rather than read from the session.
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
  -- ---- 0033: attribution stamps, before any exit --------------------
  -- Entering 'shared' witnesses a rep. auth.uid() is the signed-in
  -- sharer; null for a service_role re-share, which leaves the previous
  -- value rather than erasing it.
  --
  -- FIRST SHARE WINS. `old.shared_by_user_id is null` is the whole
  -- ruling: a rep shares, an owner later revokes and re-sends, and the
  -- credit stays with the rep. Without that clause the re-send would
  -- quietly reassign the deal to whoever pressed the button last, which
  -- is exactly the favour an owner does without thinking about it.
  --
  -- This deliberately diverges from contractor_branding, which DOES
  -- re-snapshot on re-share (0003). Branding is a property of the
  -- document that was sent; credit is a property of the work that was
  -- done, and re-sending somebody else's estimate is not doing it.
  if tg_op = 'UPDATE'
     and new.status = 'shared'
     and old.status is distinct from 'shared'
     and old.shared_by_user_id is null
     and auth.uid() is not null then
    new.shared_by_user_id := auth.uid();
  end if;

  -- Entering 'accepted' converts the witnessed share into credit. Only
  -- when not already set, so this can never overwrite a recorded close.
  if tg_op = 'UPDATE'
     and new.status = 'accepted'
     and old.status is distinct from 'accepted'
     and new.closed_by_user_id is null then
    new.closed_by_user_id := old.shared_by_user_id;
  end if;

  -- Session-less: service_role (the public accept route), the SQL
  -- Editor, a SECURITY DEFINER function. Total bypass of the RULES —
  -- and it is what lets the homeowner's acceptance be written at all,
  -- since shared -> accepted is 'nobody' in the transition table.
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

  -- ---- UPDATE: status (0031 + 0032) ----------------------------------
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
  -- table above. The marker line is load-bearing — VERIFY asserts
  -- positionally that this sits after the transition check.
  if public.is_admin() then
    return new;
  end if;

  -- ---- UPDATE: the acceptance record (0031) --------------------------
  -- "Once set" is per column: accepted_phone is legitimately null when
  -- the homeowner leaves it blank, and a null old value is not yet a
  -- record to protect.
  --
  -- 0033 adds closed_by_user_id to this set rather than to the
  -- commercial-terms set below, because it is part of WHAT HAPPENED at
  -- acceptance, not part of what was priced — and because it must be
  -- frozen even on a proposal whose status somehow is not protected.
  select string_agg(c.col, ', ') into v_frozen
  from (values
    ('accepted_tier',     old.accepted_tier     is not null and new.accepted_tier     is distinct from old.accepted_tier),
    ('accepted_quote_id', old.accepted_quote_id is not null and new.accepted_quote_id is distinct from old.accepted_quote_id),
    ('accepted_by',       old.accepted_by       is not null and new.accepted_by       is distinct from old.accepted_by),
    ('accepted_email',    old.accepted_email    is not null and new.accepted_email    is distinct from old.accepted_email),
    ('accepted_phone',    old.accepted_phone    is not null and new.accepted_phone    is distinct from old.accepted_phone),
    ('accepted_at',       old.accepted_at       is not null and new.accepted_at       is distinct from old.accepted_at),
    ('closed_by_user_id', old.closed_by_user_id is not null and new.closed_by_user_id is distinct from old.closed_by_user_id)
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
  'Added by 0031, extended by 0032 and 0033. Stamps shared_by_user_id on entry into ''shared'' '
  'and copies it to closed_by_user_id on entry into ''accepted'' — both BEFORE the '
  'session-less bypass, because the public accept route IS the session-less caller. Then '
  'protects the acceptance record, enforces transition legality for every role including '
  'admin, and freezes the commercial terms.';

-- ---------------------------------------------------------------------
-- orders_creation_guard — 0030’s body, plus the attribution carry.
--
-- THE CARRY RUNS FIRST, ahead of both bypasses. An admin converting on
-- a contractor’s behalf must still record the rep’s credit, and the
-- admin branch returns early.
--
-- The rate and basis are read AT THIS MOMENT and stored, rather than
-- being looked up at report time. See the column comments: a live
-- lookup would mean changing a rate rewrote history.
-- ---------------------------------------------------------------------
create or replace function public.orders_creation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  -- ---- 0033: carry attribution from the source proposal -------------
  -- Only when the client did not supply one (it never does today) and
  -- only when there is a proposal to read it from — an order created
  -- without one simply has no attribution.
  if new.closed_by_user_id is null and new.proposal_id is not null then
    select p.closed_by_user_id into new.closed_by_user_id
    from public.proposals p
    where p.id = new.proposal_id;
  end if;

  -- The rate as it stands now, snapshot rather than referenced. Read
  -- from the credited rep's membership IN THIS ORDER'S ORG, so a rep
  -- who also belongs elsewhere cannot pick up the other org's rate.
  if new.closed_by_user_id is not null and new.commission_rate_pct is null then
    select m.commission_rate_pct into new.commission_rate_pct
    from public.memberships m
    where m.user_id = new.closed_by_user_id
      and m.org_id = new.org_id
    limit 1;
  end if;

  if new.commission_basis is null then
    select o.commission_basis into new.commission_basis
    from public.orgs o
    where o.id = new.org_id;
  end if;

  -- ---- 0030: who may create an order --------------------------------
  -- Kitify support converts on a contractor's behalf.
  if public.is_admin() then
    return new;
  end if;

  -- No session: service_role, the SQL Editor, or a SECURITY DEFINER
  -- function. Same bypass orders_lifecycle_guard takes, for the same
  -- reason — these are not a rep exceeding their authority, and
  -- refusing them would mean a support fix required disabling a
  -- trigger.
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
  'Added by 0030, extended by 0033. Carries closed_by_user_id from the source proposal and '
  'snapshots the rep''s commission rate and the org''s basis — all BEFORE the admin and '
  'session-less bypasses, so an admin converting on a contractor''s behalf still records the '
  'credit. Then refuses an INSERT from a salesperson with a named ORDER_CREATE_FORBIDDEN.';

-- ---------------------------------------------------------------------
-- The orders-side freeze.
--
-- 0027’s orders_lifecycle_guard already freezes eight columns, but only
-- AFTER the 48-hour window closes — inside it, a contractor may edit
-- freely. Attribution and the rate snapshot are not window-scoped: they
-- record what happened, like the acceptance columns, and must not move
-- at hour one either.
--
-- Added as a small BEFORE UPDATE trigger of its own rather than folded
-- into orders_lifecycle_guard, BECAUSE the rule differs in kind: the
-- lifecycle guard’s freezes are conditional on the window and on role,
-- and this one is conditional on nothing below admin. Burying an
-- unconditional rule inside a function whose every other branch is
-- conditional is how the next reader misses it.
--
-- FIRE ORDER on public.orders, by name:
--     orders_attribution_guard
--   < orders_creation_guard      (INSERT only, no overlap)
--   < orders_lifecycle_guard
--   < orders_set_order_number    (INSERT only)
--   < orders_set_updated_at
-- so it runs before the lifecycle guard, and a refused attribution edit
-- never reaches the window logic.
-- ---------------------------------------------------------------------
create or replace function public.orders_attribution_guard()
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

  select string_agg(c.col, ', ') into v_frozen
  from (values
    ('closed_by_user_id',   old.closed_by_user_id   is not null and new.closed_by_user_id   is distinct from old.closed_by_user_id),
    ('commission_rate_pct', old.commission_rate_pct is not null and new.commission_rate_pct is distinct from old.commission_rate_pct),
    ('commission_basis',    old.commission_basis    is not null and new.commission_basis    is distinct from old.commission_basis)
  ) as c(col, did_change)
  where c.did_change;

  if v_frozen is not null then
    raise exception
      'ORDER_ATTRIBUTION_FROZEN: % on order % records who closed the deal and what it was '
      'worth, and cannot be changed. Contact Kitify.',
      v_frozen, old.order_number
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.orders_attribution_guard() is
  'Added by 0033. Freezes closed_by_user_id, commission_rate_pct and commission_basis on an '
  'order once set, for every role below admin, REGARDLESS of the 48-hour window — these '
  'record what happened rather than what may still be changed. Separate from '
  'orders_lifecycle_guard because that guard''s freezes are all window- and role-conditional '
  'and this one is not.';

drop trigger if exists orders_attribution_guard on public.orders;
create trigger orders_attribution_guard
  before update on public.orders
  for each row execute function public.orders_attribution_guard();

commit;


-- =====================================================================
-- =====================================================================
--                          VERIFY SCRIPT
--
-- READ-ONLY. Three separate queries. Run each in the SQL Editor after
-- applying and read the rows.
--
-- WHY THREE QUERIES AND NOT ONE BLOCK OF ASSERTIONS. See the header
-- note above: the original single-statement VERIFY block could not be
-- executed through the Supabase SQL Editor across three attempts, the
-- cause was never found, and production was confirmed by direct
-- catalog inspection instead. These are those queries. They are
-- deliberately plain — no assertions to construct, no needles to quote,
-- nothing that can be mangled between the file and the parser.
--
-- They also prove MORE than the block they replace: query 3 reads every
-- guard function at once rather than one per check.
--
-- NO DOTTED STRING LITERAL APPEARS ANYWHERE BELOW. Every needle in
-- query 3 is a bare error identifier. Table aliases still use dots, as
-- all SQL does; what is avoided is a dot INSIDE a quoted needle.
-- =====================================================================
-- =====================================================================


-- ---------------------------------------------------------------------
-- QUERY 1 — the seven columns. Expect SEVEN ROWS.
--
-- A missing row means the column was never added. is_nullable must read
-- YES on all seven and column_default must be null on all seven: a
-- default would manufacture attribution or a rate nobody set.
-- ---------------------------------------------------------------------
select
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and (
       (table_name = 'proposals'   and column_name in ('shared_by_user_id', 'closed_by_user_id'))
    or (table_name = 'orders'      and column_name in ('closed_by_user_id', 'commission_rate_pct', 'commission_basis'))
    or (table_name = 'memberships' and column_name = 'commission_rate_pct')
    or (table_name = 'orgs'        and column_name = 'commission_basis')
  )
order by table_name, column_name;


-- ---------------------------------------------------------------------
-- QUERY 2 — every non-internal trigger in public. Expect the six guards
-- to appear with tgenabled = O.
--
--   memberships_role_guard        0027
--   proposals_acceptance_guard    0031, extended 0032 and 0033
--   quotes_acceptance_guard       0032
--   orders_creation_guard         0030, extended 0033
--   orders_lifecycle_guard        0027, extended 0032
--   orders_attribution_guard      0033
--
-- Listed unfiltered rather than matched against a name list, so a guard
-- that was renamed or a seventh that nobody expected both show up.
-- profiles_guard_privilege_columns from 0023 is expected here too.
--
-- tgenabled is a pg_catalog "char" column and is cast to text:
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
-- QUERY 3 — branch retention. Expect FOUR ROWS.
--
-- THIS IS THE ONE THAT MATTERS. 0033 replaced the bodies of
-- proposals_acceptance_guard and orders_creation_guard in full, and the
-- standing risk of extending a guard that way is a CREATE OR REPLACE
-- that silently drops a branch. Each column below is one named error a
-- guard is supposed to be able to raise.
--
-- Read it as a grid. Every guard should show true for its own
-- identifiers and false for everybody else:
--
--   orders_creation_guard        order_create_forbidden
--   orders_lifecycle_guard       order_locked, order_transition_forbidden
--   orders_attribution_guard     order_attribution_frozen
--   proposals_acceptance_guard   the five proposal_ columns
--
-- A false where a true belongs is a lost branch and the migration
-- should be re-run. Needles are bare identifiers: no dots, no quotes
-- inside quotes, nothing to escape.
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
  position('PROPOSAL_TRANSITION_FORBIDDEN' in p.prosrc) > 0 as proposal_transition_forbidden
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'orders_creation_guard',
    'orders_lifecycle_guard',
    'orders_attribution_guard',
    'proposals_acceptance_guard'
  )
order by p.proname;
