-- =====================================================================
-- 0026_org_scoping_fixes.sql
--
-- 0024 added org_id to fifteen business tables with
-- `not null default public.current_org_id()`. The default is correct
-- whenever the row belongs to the person creating it. It is WRONG in the
-- one place this system already lets an admin act on someone else's
-- behalf, and that place has been live since 0015.
--
--   A. apply_partner_inventory_movements — an admin recording a movement
--      for a dealer wrote owner_id = the dealer and org_id = KITIFY. The
--      dealer could not see their own ledger row. No error, no warning.
--   B. apply_order_shipment — same shape. 0024's backfill set historical
--      inventory_order_shipments.org_id from the parent ORDER, so new rows
--      written by an admin disagreed with every row already there.
--   C. The events revoke that was run against production by hand after
--      0024 and never committed.
--   D. A corrective pass over any rows already written the wrong way.
--
-- RULING ON SHIPMENTS (carried from the brief, recorded here so it is not
-- re-litigated): a shipment belongs to the ORDER's org, not Kitify's. The
-- contractor needs their own fulfilment history, 0024's backfill already
-- set historical rows that way, and Kitify sees everything through
-- is_admin() regardless. Making new rows match keeps the column meaning
-- one thing.
--
-- ---------------------------------------------------------------------
-- WHY THERE IS NO 0025
--
-- There is no 0025 and there should not be. The `revoke ... on
-- public.events` in Part C was applied to production by hand immediately
-- after 0024, before it had been written down anywhere. Rather than
-- back-date a file for a statement that is already in production, it is
-- folded into this migration, which is re-runnable and therefore harmless
-- to apply a second time.
--
-- Nobody should go looking for a missing 0025. The sequence is
-- 0024 -> 0026 on purpose.
-- ---------------------------------------------------------------------
--
-- Re-runnable. Transactional. Changes nothing in these functions except
-- what is named above — apply_inventory_movements is deliberately NOT
-- touched: it writes house inventory from an admin session, so the
-- default already resolves to the Kitify org, which is correct.
-- =====================================================================

begin;

-- =====================================================================
-- PART 0 — Pre-flight
-- =====================================================================

-- 0a. The three tables must already carry org_id, or there is nothing to
--     set and this migration is being applied out of order.
do $$
declare v_missing text;
begin
  select string_agg(want.tbl, ', ') into v_missing
  from (values ('partner_inventory_stock'),
               ('partner_inventory_movements'),
               ('inventory_order_shipments')) as want(tbl)
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = ('public.' || want.tbl)::regclass
      and a.attname = 'org_id'
      and not a.attisdropped
  );
  if v_missing is not null then
    raise exception
      'ABORT 0026/0a: org_id missing on %. Apply 0024_tenancy.sql first.', v_missing;
  end if;
end $$;

-- 0b. current_org_id() must exist — the replacement bodies below resolve
--     an org the same way it does, and the two must not drift.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_org_id'
  ) then
    raise exception 'ABORT 0026/0b: public.current_org_id() missing. Apply 0024_tenancy.sql first.';
  end if;
end $$;

-- =====================================================================
-- PART A — apply_partner_inventory_movements
--
-- Two changes and nothing else:
--   1. v_owner_org is resolved from p_owner_id's membership, using the
--      SAME rule current_org_id() uses (earliest membership, by
--      created_at then id) so the two cannot disagree.
--   2. org_id is named on both inserts — the stock row and the ledger row.
--
-- If p_owner_id resolves to no membership this RAISES. It does not fall
-- back to the default: a row nobody can see is worse than a failed insert,
-- and a contractor with no membership is a broken account that should be
-- fixed rather than written around.
--
-- NOTE ON VISIBILITY: this function is SECURITY INVOKER, so the membership
-- lookup runs under the caller's RLS. Both callers are admitted by 0024's
-- memberships_select_own_org_or_admin —
--   * an admin, by is_admin()
--   * a contractor reading their own, by org_id = current_org_id()
-- so the lookup cannot come back empty for a reason other than the
-- membership genuinely not existing.
-- =====================================================================
create or replace function public.apply_partner_inventory_movements(p_owner_id uuid, p_movements jsonb)
returns jsonb
language plpgsql
volatile
as $fn$
declare
  m           jsonb;
  v_is_admin  boolean;
  v_owner_org uuid;          -- 0026: the org the ROW belongs to, not the caller's
  v_kitify    uuid;
  v_partner   uuid;
  v_ref       uuid;
  v_location  text;
  v_reason    public.inventory_movement_reason;
  v_input     integer;
  v_delta     integer;
  v_stock_id  uuid;
  v_current   integer;
  v_new       integer;
  v_applied   integer := 0;
  v_results   jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'PARTNER_INVENTORY_FORBIDDEN: sign-in required'
      using errcode = '42501';
  end if;

  v_is_admin := public.is_admin();

  if p_owner_id is null then
    raise exception 'PARTNER_INVENTORY_INVALID: owner id is required'
      using errcode = '22023';
  end if;

  -- A contractor may only ever write their own ledger. RLS enforces this too; raising here
  -- makes the failure legible instead of surfacing as a policy violation on the insert.
  if not v_is_admin and p_owner_id <> auth.uid() then
    raise exception 'PARTNER_INVENTORY_FORBIDDEN: you can only record movements on your own inventory'
      using errcode = '42501';
  end if;

  -- 0026: the row's org comes from the OWNER, never from the caller. Same
  -- resolution rule as current_org_id().
  select mem.org_id into v_owner_org
    from public.memberships mem
   where mem.user_id = p_owner_id
   order by mem.created_at, mem.id
   limit 1;

  if v_owner_org is null then
    raise exception
      'PARTNER_INVENTORY_NO_ORG: contractor % has no org membership; refusing to write a row nobody could read', p_owner_id
      using errcode = 'P0002';
  end if;

  if p_movements is null
     or jsonb_typeof(p_movements) <> 'array'
     or jsonb_array_length(p_movements) = 0 then
    raise exception 'PARTNER_INVENTORY_EMPTY: no movements supplied'
      using errcode = '22023';
  end if;

  for m in select value from jsonb_array_elements(p_movements)
  loop
    -- Reset per iteration: a NOT FOUND select leaves the previous row's values in place,
    -- which would silently attach this movement to the last item's stock row.
    v_stock_id := null;
    v_current  := null;

    v_kitify  := nullif(btrim(coalesce(m ->> 'kitify_sku_id', '')), '')::uuid;
    v_partner := nullif(btrim(coalesce(m ->> 'partner_sku_id', '')), '')::uuid;

    if (v_kitify is not null) = (v_partner is not null) then
      raise exception 'PARTNER_INVENTORY_SKU_REF: set exactly one of kitify_sku_id or partner_sku_id'
        using errcode = '22023';
    end if;

    v_ref      := coalesce(v_kitify, v_partner);
    v_location := coalesce(nullif(btrim(coalesce(m ->> 'location', '')), ''), 'Main');
    v_reason   := (m ->> 'reason')::public.inventory_movement_reason;
    v_input    := coalesce((m ->> 'delta')::integer, 0);

    if v_input = 0 then
      raise exception 'PARTNER_INVENTORY_ZERO: a movement quantity cannot be zero'
        using errcode = '22023';
    end if;

    -- Sample reasons are Kitify's, not a contractor's. An admin acting on a contractor's
    -- behalf may still record one, which is why this is a role check and not a CHECK constraint.
    if not v_is_admin and v_reason in ('sample_sent', 'sample_replenish') then
      raise exception 'PARTNER_INVENTORY_REASON: % is not available on partner inventory', v_reason
        using errcode = '22023';
    end if;

    -- The referenced SKU must exist AND be legitimately referenceable by this owner. Both
    -- checks run under the caller's RLS, which is what makes them meaningful:
    --   • partner SKU — must belong to p_owner_id (the composite FK enforces this at write
    --     time too; checking first yields a readable error).
    --   • Kitify SKU  — a contractor's visible set is exactly `active and not is_sample`, so
    --     a retired or sample SKU is rejected for them and allowed for an admin.
    if v_partner is not null then
      if not exists (
        select 1 from public.partner_inventory_skus s
         where s.id = v_partner and s.owner_id = p_owner_id
      ) then
        raise exception 'PARTNER_INVENTORY_UNKNOWN_SKU: that SKU does not belong to this contractor'
          using errcode = '22023';
      end if;
    else
      if not exists (select 1 from public.inventory_skus k where k.id = v_kitify) then
        raise exception 'PARTNER_INVENTORY_UNKNOWN_SKU: that Kitify catalog SKU is not available'
          using errcode = '22023';
      end if;
    end if;

    v_delta := case
      when v_reason in ('received', 'sample_replenish', 'initial') then abs(v_input)
      when v_reason in ('shipped', 'sample_sent', 'damaged', 'lost') then -abs(v_input)
      else v_input
    end;

    -- Find the stock row case-insensitively on location, so "Truck" and "truck" are one place
    -- (the unique index in 0014 folds them the same way).
    select st.id, st.quantity into v_stock_id, v_current
      from public.partner_inventory_stock st
     where st.owner_id = p_owner_id
       and coalesce(st.kitify_sku_id, st.partner_sku_id) = v_ref
       and lower(btrim(st.location)) = lower(v_location)
     for update;

    if v_stock_id is null then
      begin
        insert into public.partner_inventory_stock
          (owner_id, org_id, kitify_sku_id, partner_sku_id, location, quantity)
        values
          (p_owner_id, v_owner_org, v_kitify, v_partner, v_location, 0)
        returning id, quantity into v_stock_id, v_current;
      exception when unique_violation then
        -- Another session created the same (owner, sku, location) between the select and the
        -- insert; take theirs and lock it.
        select st.id, st.quantity into v_stock_id, v_current
          from public.partner_inventory_stock st
         where st.owner_id = p_owner_id
           and coalesce(st.kitify_sku_id, st.partner_sku_id) = v_ref
           and lower(btrim(st.location)) = lower(v_location)
         for update;
      end;
    end if;

    v_current := coalesce(v_current, 0);
    v_new := v_current + v_delta;

    -- The one hard block. Threshold crossings warn in the UI and proceed.
    if v_new < 0 then
      raise exception
        'PARTNER_INVENTORY_NEGATIVE: % on hand at % — cannot apply a change of %',
        v_current, v_location, v_delta
        using errcode = 'P0001';
    end if;

    update public.partner_inventory_stock
       set quantity = v_new
     where id = v_stock_id;

    insert into public.partner_inventory_movements
      (owner_id, org_id, kitify_sku_id, partner_sku_id, location, delta, reason, reference, note, performed_by)
    values
      (p_owner_id, v_owner_org, v_kitify, v_partner, v_location, v_delta, v_reason,
       nullif(btrim(coalesce(m ->> 'reference', '')), ''),
       nullif(btrim(coalesce(m ->> 'note', '')), ''),
       auth.uid());

    v_applied := v_applied + 1;
    v_results := v_results || jsonb_build_object(
      'sku_id', v_ref, 'location', v_location, 'delta', v_delta, 'quantity', v_new
    );
  end loop;

  return jsonb_build_object('applied', v_applied, 'results', v_results);
end;
$fn$;

comment on function public.apply_partner_inventory_movements(uuid, jsonb) is
  'SECURITY INVOKER. 0026: org_id on both inserts now comes from p_owner_id''s membership, '
  'not from the caller''s current_org_id(). Before that, an admin recording a movement for a '
  'dealer produced a row the dealer could not see.';

-- =====================================================================
-- PART B — apply_order_shipment
--
-- One change and nothing else: v_org_id is read from the order alongside
-- the snapshot it was already reading, and named on the insert.
--
-- No null guard is added for v_org_id, deliberately. orders.org_id is
-- NOT NULL as of 0024, and the `if not found` on the order select above
-- already covers the only case where there is no order to read it from.
-- A second check would be unreachable code pretending to be a safeguard.
--
-- apply_order_shipment_retry is NOT rewritten. It performs no insert of
-- its own — its last statement is `return public.apply_order_shipment(
-- p_order_id, true)` — so it inherits this fix whole. Reproducing twenty
-- unchanged lines to satisfy a literal reading of "fix all three" would
-- add transcription risk for no behavioural gain, which is exactly how
-- 0008 drifted from production. VERIFY asserts the delegation instead.
-- =====================================================================
create or replace function public.apply_order_shipment(p_order_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
volatile
as $fn$
declare
  v_snapshot   jsonb;
  v_order_no   text;
  v_org_id     uuid;          -- 0026: the ORDER's org, not the admin's
  v_existing   public.inventory_order_shipments%rowtype;
  v_lines      jsonb;
  v_line       jsonb;
  v_detail     jsonb := '[]'::jsonb;
  v_count      integer := 0;
  v_sku_id     uuid;
  v_available  integer;
  v_status     public.inventory_shipment_status;
  v_shipment   public.inventory_order_shipments%rowtype;
begin
  if not public.is_admin() then
    raise exception 'INVENTORY_FORBIDDEN: admin role required to record an order shipment'
      using errcode = '42501';
  end if;

  select o.snapshot, o.order_number, o.org_id into v_snapshot, v_order_no, v_org_id
    from public.orders o where o.id = p_order_id;

  if not found then
    raise exception 'INVENTORY_NO_ORDER: no order with id %', p_order_id
      using errcode = 'P0002';
  end if;

  if not p_force then
    select * into v_existing
      from public.inventory_order_shipments s
     where s.order_id = p_order_id
       and s.status in ('success', 'partial', 'skipped')
     order by s.attempted_at desc
     limit 1;

    if found then
      return jsonb_build_object(
        'already_recorded', true,
        'shipment_id',      v_existing.id,
        'status',           v_existing.status,
        'lines_attempted',  v_existing.lines_attempted,
        'lines_applied',    v_existing.lines_applied,
        'unfulfillable',    v_existing.unfulfillable,
        'movement_ids',     to_jsonb(v_existing.movement_ids));
    end if;
  end if;

  v_lines := public.inventory_order_lines(v_snapshot);

  -- Resolve each candidate against the ops catalog and note what is on hand. Nothing is
  -- decremented — see the strategy note in 0016's header.
  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_count := v_count + 1;
    v_sku_id := null;
    v_available := null;

    if nullif(btrim(coalesce(v_line ->> 'sku_code', '')), '') is not null then
      -- Case-insensitive: supplier codes get transcribed by hand at both ends.
      select k.id into v_sku_id
        from public.inventory_skus k
       where lower(k.sku) = lower(v_line ->> 'sku_code')
       limit 1;

      if v_sku_id is not null then
        select coalesce(sum(st.quantity), 0) into v_available
          from public.inventory_stock st where st.sku_id = v_sku_id;
      end if;
    end if;

    v_detail := v_detail || jsonb_build_array(jsonb_build_object(
      'sku_id',    v_sku_id,
      'sku_code',  v_line ->> 'sku_code',
      'sku_label', v_line ->> 'sku_label',
      'requested', coalesce((v_line ->> 'requested')::integer, 1),
      'available', v_available,
      'source',    v_line ->> 'source',
      'matched',   v_sku_id is not null));
  end loop;

  -- 'failed' means extraction produced nothing at all — a snapshot shape the extractor does
  -- not understand, which is worth flagging. Otherwise 'skipped': lines were found and
  -- recorded, and applying them is deliberately not this phase's job.
  v_status := case when v_count = 0 then 'failed' else 'skipped' end::public.inventory_shipment_status;

  insert into public.inventory_order_shipments
    (order_id, org_id, attempted_by, status, lines_attempted, lines_applied, error_note, movement_ids, unfulfillable)
  values
    (p_order_id, v_org_id, auth.uid(), v_status, v_count, 0,
     case when v_count = 0
          then 'No shipment lines could be read from this order snapshot.'
          else 'Automatic decrement is not enabled — lines recorded for review (order ' || coalesce(v_order_no, '?') || ').'
     end,
     '{}', v_detail)
  returning * into v_shipment;

  return jsonb_build_object(
    'already_recorded', false,
    'shipment_id',      v_shipment.id,
    'status',           v_shipment.status,
    'lines_attempted',  v_shipment.lines_attempted,
    'lines_applied',    v_shipment.lines_applied,
    'unfulfillable',    v_shipment.unfulfillable,
    'movement_ids',     to_jsonb(v_shipment.movement_ids));
end;
$fn$;

comment on function public.apply_order_shipment(uuid, boolean) is
  'SECURITY INVOKER. 0026: inventory_order_shipments.org_id now comes from the ORDER, not '
  'from the admin''s current_org_id(). A shipment belongs to the order''s org — which is also '
  'how 0024 backfilled the historical rows. apply_order_shipment_retry delegates here and '
  'inherits this.';

-- =====================================================================
-- PART C — the events revoke that was applied by hand
--
-- 0024 created public.events with SELECT and INSERT policies and no
-- UPDATE or DELETE policy, which makes it append-only through RLS. This is
-- the grant-level half of the same statement: without it the privilege is
-- still held even though no policy admits its use, and a future migration
-- that adds an UPDATE policy would silently make the table editable.
--
-- Already applied to production by hand. Re-running a revoke is a no-op.
-- =====================================================================
revoke update, delete, truncate on public.events from authenticated, anon;

-- =====================================================================
-- PART D — repair rows already written the wrong way
--
-- All three tables were empty before 0024, so the expected count is zero.
-- Confirmed rather than assumed: the counts are reported either way, and
-- the UPDATEs are idempotent, so a second run finds nothing to do.
--
-- "Mis-scoped" means org_id disagrees with the org implied by the row's
-- own owner_id (partner tables) or by its parent order (shipments).
-- Rows whose owner has no membership at all are reported separately and
-- left alone — there is no correct value to write, and guessing one would
-- bury the problem.
-- =====================================================================
do $$
declare
  v_fixed int;
  v_orphan int;
  v_total int := 0;
begin
  -- --- partner_inventory_stock -----------------------------------------
  with want as (
    select s.id,
           (select mem.org_id from public.memberships mem
             where mem.user_id = s.owner_id
             order by mem.created_at, mem.id limit 1) as org_id
    from public.partner_inventory_stock s
  )
  update public.partner_inventory_stock s
     set org_id = want.org_id
    from want
   where want.id = s.id
     and want.org_id is not null
     and s.org_id is distinct from want.org_id;
  get diagnostics v_fixed = row_count;
  v_total := v_total + v_fixed;
  if v_fixed > 0 then
    raise notice '0026/D: partner_inventory_stock — % row(s) re-scoped to the owner''s org.', v_fixed;
  end if;

  -- --- partner_inventory_movements --------------------------------------
  with want as (
    select mv.id,
           (select mem.org_id from public.memberships mem
             where mem.user_id = mv.owner_id
             order by mem.created_at, mem.id limit 1) as org_id
    from public.partner_inventory_movements mv
  )
  update public.partner_inventory_movements mv
     set org_id = want.org_id
    from want
   where want.id = mv.id
     and want.org_id is not null
     and mv.org_id is distinct from want.org_id;
  get diagnostics v_fixed = row_count;
  v_total := v_total + v_fixed;
  if v_fixed > 0 then
    raise notice '0026/D: partner_inventory_movements — % row(s) re-scoped to the owner''s org.', v_fixed;
  end if;

  -- --- inventory_order_shipments ----------------------------------------
  update public.inventory_order_shipments s
     set org_id = o.org_id
    from public.orders o
   where o.id = s.order_id
     and s.org_id is distinct from o.org_id;
  get diagnostics v_fixed = row_count;
  v_total := v_total + v_fixed;
  if v_fixed > 0 then
    raise notice '0026/D: inventory_order_shipments — % row(s) re-scoped to the order''s org.', v_fixed;
  end if;

  -- --- owners with no membership: reported, not guessed at ---------------
  select count(*) into v_orphan
  from (
    select s.owner_id from public.partner_inventory_stock s
    union all
    select mv.owner_id from public.partner_inventory_movements mv
  ) x
  where not exists (select 1 from public.memberships mem where mem.user_id = x.owner_id);

  if v_orphan > 0 then
    raise notice
      '0026/D: % partner row(s) have an owner with NO membership. Left as-is — there is no '
      'correct org to write. Fix the membership, then re-run this migration.', v_orphan;
  end if;

  raise notice '0026/D: repair complete. % row(s) re-scoped, % orphan row(s) skipped.', v_total, v_orphan;
end $$;

commit;


-- =====================================================================
-- =====================================================================
--                          VERIFY SCRIPT
--
-- READ-ONLY. Run in the SQL Editor after applying. Every row must read
-- pass = true.
--
-- pg_catalog "char" columns are cast to ::text before comparison — same
-- fix as 0023 and 0024.
-- =====================================================================
-- =====================================================================

-- 1. the two rewritten functions name org_id on their inserts
select
  '1. function names org_id'  as check,
  p.proname                   as detail,
  'true'                      as expected,
  (p.prosrc like '%org_id%')::text as actual,
  p.prosrc like '%org_id%'    as pass
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('apply_partner_inventory_movements','apply_order_shipment')

union all
-- 1b. the retry wrapper carries the fix by DELEGATION, not by its own
--     insert. Asserting the real property rather than pretending it has
--     an org_id of its own: it must call apply_order_shipment and must
--     not insert into inventory_order_shipments itself.
select
  '1b. retry delegates, does not insert',
  'apply_order_shipment_retry',
  'delegates=true inserts=false',
  'delegates=' || (p.prosrc like '%apply_order_shipment(p_order_id%')::text
    || ' inserts=' || (p.prosrc like '%insert into public.inventory_order_shipments%')::text,
  p.prosrc like '%apply_order_shipment(p_order_id%'
    and p.prosrc not like '%insert into public.inventory_order_shipments%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'apply_order_shipment_retry'

union all
-- 1c. the partner function refuses rather than defaulting when the owner
--     has no membership
select
  '1c. partner fn raises on no membership',
  'apply_partner_inventory_movements',
  'true',
  (p.prosrc like '%PARTNER_INVENTORY_NO_ORG%')::text,
  p.prosrc like '%PARTNER_INVENTORY_NO_ORG%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'apply_partner_inventory_movements'

union all
-- 1d. apply_inventory_movements was NOT touched — it should still have no
--     org_id reference, because the default is correct for house inventory
select
  '1d. house fn left alone',
  'apply_inventory_movements',
  'false',
  (p.prosrc like '%org_id%')::text,
  p.prosrc not like '%org_id%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'apply_inventory_movements'

union all
-- 2. neither authenticated nor anon holds update/delete/truncate on events
select
  '2. events write privilege revoked',
  r.rolename || ' / ' || r.priv,
  'false',
  has_table_privilege(r.rolename,'public.events',r.priv)::text,
  has_table_privilege(r.rolename,'public.events',r.priv) = false
from (values ('authenticated','UPDATE'),('authenticated','DELETE'),('authenticated','TRUNCATE'),
             ('anon','UPDATE'),('anon','DELETE'),('anon','TRUNCATE')) as r(rolename, priv)

union all
-- 2b. ...and SELECT/INSERT still work, or events would be write-only
select
  '2b. events read/insert intact',
  'authenticated / ' || r.priv,
  'true',
  has_table_privilege('authenticated','public.events',r.priv)::text,
  has_table_privilege('authenticated','public.events',r.priv) = true
from (values ('SELECT'),('INSERT')) as r(priv)

union all
-- 3. zero mis-scoped rows remain in partner_inventory_stock
select
  '3. no mis-scoped rows',
  'partner_inventory_stock',
  '0',
  count(*)::text,
  count(*) = 0
from public.partner_inventory_stock s
where exists (select 1 from public.memberships mem where mem.user_id = s.owner_id)
  and s.org_id is distinct from (
    select mem.org_id from public.memberships mem
    where mem.user_id = s.owner_id order by mem.created_at, mem.id limit 1)

union all
-- 3b. ...in partner_inventory_movements
select
  '3. no mis-scoped rows',
  'partner_inventory_movements',
  '0',
  count(*)::text,
  count(*) = 0
from public.partner_inventory_movements mv
where exists (select 1 from public.memberships mem where mem.user_id = mv.owner_id)
  and mv.org_id is distinct from (
    select mem.org_id from public.memberships mem
    where mem.user_id = mv.owner_id order by mem.created_at, mem.id limit 1)

union all
-- 3c. ...and in inventory_order_shipments, against the parent order
select
  '3. no mis-scoped rows',
  'inventory_order_shipments',
  '0',
  count(*)::text,
  count(*) = 0
from public.inventory_order_shipments s
join public.orders o on o.id = s.order_id
where s.org_id is distinct from o.org_id

union all
-- 3d. rows whose owner has no membership at all — reported, not repaired.
--     Non-zero here is not a failure of this migration; it is an account
--     that needs a membership before the repair can mean anything.
select
  '3d. owners with no membership',
  'partner rows left unrepaired',
  '0',
  count(*)::text,
  count(*) = 0
from (
  select s.owner_id from public.partner_inventory_stock s
  union all
  select mv.owner_id from public.partner_inventory_movements mv
) x
where not exists (select 1 from public.memberships mem where mem.user_id = x.owner_id)

order by 1, 2;
