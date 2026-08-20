-- ============================================================================
-- Kitify Solutions — order→inventory seam + reporting support, Phase 3
-- Migration: 0016_inventory_reporting
--
-- Adds ONE table (inventory_order_shipments) and three functions. No new domain concepts:
-- reporting reads the Phase 1 tables as they stand, and CSV import writes inventory_skus
-- through the existing client path.
--
-- ============================================================================
-- WHICH STATUS IS "SHIPPED"
-- ============================================================================
-- There is no 'shipped' order status. public.orders runs:
--     submitted → confirmed → in_production → ready_to_ship → in_transit → delivered → completed
-- The hand-off where goods physically leave is ready_to_ship → in_transit, which is the
-- transition that stamps orders.shipped_at (see updateOrderStatus in lib/store.ts) and the
-- one the admin order page labels "Ship". So the coupling fires on entering 'in_transit'.
-- Nothing here reads or writes orders.status — the seam is invoked BY the app after the
-- status write succeeds, precisely so a coupling failure can never roll a ship back.
--
-- ============================================================================
-- SKU MAPPING STRATEGY: (c) SKIP AND RECORD — and why
-- ============================================================================
-- The three options were (a) an explicit product→SKU mapping table, (b) best-effort match on
-- SKU strings found in the snapshot, (c) record what WOULD move and apply nothing.
--
-- Shipping (c). The deciding fact is that public.inventory_skus is an admin-curated OPS
-- catalog that today holds a handful of hand-entered rows, while an order's snapshot
-- describes a configured bathroom. Even where a SKU string exists on both sides, the ops
-- catalog has not yet been populated to cover what orders actually contain — so (b) would
-- resolve almost nothing, silently decrement the two or three SKUs that happened to match,
-- and leave the rest invisible. A half-applied auto-decrement is worse than none: it makes
-- on-hand wrong in a way nobody can see, which is exactly what an inventory system exists to
-- prevent. (a) needs ops to fill in a mapping table they cannot yet specify, because nobody
-- has watched the auto-decrement run.
--
-- So v1 applies NOTHING. Every attempt records status='skipped', touches no stock, and
-- writes the full candidate line list to `unfulfillable` so an admin can see exactly what
-- would have moved.
--
-- WHAT MAKES THIS MORE THAN A STUB: the line extraction is real, and each line is resolved
-- against inventory_skus where it can be. The snapshot genuinely carries resolved order SKUs
-- for plumbing — PlumbingSelections.order is populated by resolveOrderSkus() on emit,
-- deliberately so "a saved quote can flow to an order later" — so those lines arrive with a
-- real Delta SKU string, and this function records whether that string matched the ops
-- catalog and what was on hand. Shower / vanity / room carry priced lines with i18n keys and
-- no SKU, so they record as label-only.
--
-- The effect is that after a few real shipments, an admin can read straight off these rows
-- how much of a typical order the ops catalog actually covers. Phase 4 promotes to (b) or (a)
-- from evidence rather than from a guess, and the promotion is: fill in matches (or add a
-- mapping table), then let this function apply what it already knows how to describe. The UI
-- does not change — it is already rendering per-line sku/label/requested/available.
--
-- ============================================================================
-- WHY THIS WRITES MOVEMENTS DIRECTLY RATHER THAN CALLING apply_inventory_movements
-- ============================================================================
-- It does neither today, because it applies nothing. When Phase 4 turns applying on, it
-- should call public.apply_inventory_movements(jsonb): that function already owns sign
-- derivation, the below-zero refusal, the row locking and the paired stock/ledger write, and
-- duplicating that logic here would give the system two places to disagree about what
-- "shipped" means. The one adaptation Phase 4 needs is that apply_inventory_movements RAISES
-- on a negative result and rolls back the whole batch, whereas this seam must degrade to
-- 'partial' — so the call belongs inside a BEGIN/EXCEPTION block per line group, not around
-- the batch. Noted here so that decision is not re-litigated later.
--
-- Depends on 0002 (is_admin), 0012/0013 (Phase 1). Re-runnable throughout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Attempt outcome.
--   success  — every candidate line resolved and applied
--   partial  — some applied, some could not (unfulfillable is populated)
--   failed   — nothing applied because extraction produced no lines at all
--   skipped  — mapping deliberately not attempted (the v1 state; see the header)
-- ----------------------------------------------------------------------------
do $$
begin
  create type public.inventory_shipment_status as enum ('success', 'partial', 'failed', 'skipped');
exception
  when duplicate_object then null;
end
$$;

-- ----------------------------------------------------------------------------
-- inventory_order_shipments — one row per coupling ATTEMPT, not per order.
--
-- Several attempts over time is the normal case: the first fires automatically on the ship
-- transition, and an admin can retry after receiving stock or after filling in a mapping.
-- Keeping every attempt is what makes the history readable — "we tried on the 4th, three
-- lines were short, we retried on the 9th and it cleared".
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_order_shipments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  attempted_at    timestamptz not null default now(),
  attempted_by    uuid references public.profiles (id) on delete set null,
  status          public.inventory_shipment_status not null,
  lines_attempted integer not null default 0,
  lines_applied   integer not null default 0,
  error_note      text,
  -- The movement rows this attempt wrote, so the UI can link straight into the ledger.
  -- Empty under strategy (c); the column exists because Phase 4 fills it without a migration.
  movement_ids    uuid[] not null default '{}',
  -- Per-line detail: [{ sku_id, sku_code, sku_label, requested, available, source, matched }]
  -- Named `unfulfillable` per spec, but under (c) it carries EVERY candidate line, not only
  -- the short ones — which is the whole diagnostic value in this phase.
  unfulfillable   jsonb not null default '[]'::jsonb,
  constraint inventory_order_shipments_order_attempt_key unique (order_id, attempted_at),
  constraint inventory_order_shipments_lines_check check (lines_applied >= 0 and lines_attempted >= 0)
);

create index if not exists inventory_order_shipments_order_idx
  on public.inventory_order_shipments (order_id, attempted_at desc);

-- ----------------------------------------------------------------------------
-- Reporting indexes.
--
-- Both already exist from 0012 — inventory_movements_sku_time_idx on (sku_id, performed_at
-- desc) and inventory_stock_sku_idx on (sku_id) — so these are IF NOT EXISTS no-ops kept
-- here only to make the dependency explicit for anyone reading the reporting queries.
-- ----------------------------------------------------------------------------
create index if not exists inventory_movements_sku_time_idx on public.inventory_movements (sku_id, performed_at desc);
create index if not exists inventory_stock_sku_idx          on public.inventory_stock (sku_id);

-- ----------------------------------------------------------------------------
-- RLS — admin-only, matching every other Kitify inventory table. Contractors never see
-- shipment records: they describe Kitify's own stock movements.
--
-- NO VIEW is created for reporting. A view (even with security_invoker=true) would need
-- PostgREST exposure and its own grant story for modest gain: the reporting screen reads a
-- few hundred rows across three small tables and aggregates in the client, which is fast
-- enough at this size and keeps RLS reasoning to the base tables alone. The spec explicitly
-- allows this fallback; revisit only if the SKU catalog grows past a few thousand rows.
-- ----------------------------------------------------------------------------
alter table public.inventory_order_shipments enable row level security;

drop policy if exists "inventory_order_shipments_admin_all" on public.inventory_order_shipments;
create policy "inventory_order_shipments_admin_all" on public.inventory_order_shipments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- inventory_order_lines() — snapshot → candidate shipment lines.
--
-- Isolated from apply_order_shipment on purpose: this is the ONE function Phase 4 rewrites
-- when the mapping strategy changes, and keeping it pure and IMMUTABLE means it can be run
-- against any historical order's snapshot to see what the current extractor would make of it.
--
-- Returns [{ sku_code, sku_label, requested, source }].
--   sku_code  — a real SKU string when the snapshot carries one (plumbing), else null
--   sku_label — human description for the admin UI
--   source    — which configurator the line came from
--
-- Tolerant by construction: every lookup is a jsonb path that yields NULL rather than
-- throwing on an unexpected shape, because snapshots are frozen documents going back to
-- before this function existed and must never make a ship transition fail.
-- ============================================================================
create or replace function public.inventory_order_lines(p_snapshot jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_quote  jsonb;
  v_sel    jsonb;
  v_order  jsonb;
  v_lines  jsonb := '[]'::jsonb;
  v_secs   text[] := array['shower', 'vanity', 'room'];
  v_sec    text;
  v_line   jsonb;
  k        text;
  v        text;
  q        integer;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    return v_lines;
  end if;

  v_quote := p_snapshot -> 'quote';
  if v_quote is null or jsonb_typeof(v_quote) <> 'object' then
    return v_lines;
  end if;

  -- ---------------------------------------------------------------- plumbing
  -- The one section carrying resolved order SKUs (see the header).
  v_sel   := v_quote -> 'plumbing' -> 'selections';
  v_order := v_sel -> 'order';

  if v_order is not null and jsonb_typeof(v_order) = 'object' then
    if nullif(btrim(coalesce(v_order ->> 'faucet', '')), '') is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'sku_code',  v_order ->> 'faucet',
        'sku_label', 'Faucet',
        'requested', greatest(coalesce((v_sel ->> 'faucetQty')::integer, 1), 1),
        'source',    'plumbing'));
    end if;

    if nullif(btrim(coalesce(v_order ->> 'bathTrim', '')), '') is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'sku_code',  v_order ->> 'bathTrim',
        'sku_label', 'Bath / shower trim',
        'requested', greatest(coalesce((v_order ->> 'bathTrimQty')::integer, 1), 1),
        'source',    'plumbing'));
    end if;

    if nullif(btrim(coalesce(v_order ->> 'roughInValve', '')), '') is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'sku_code',  v_order ->> 'roughInValve',
        'sku_label', 'Rough-in valve',
        'requested', greatest(coalesce((v_order ->> 'roughInValveQty')::integer, 1), 1),
        'source',    'plumbing'));
    end if;

    -- Waste & overflow records a null sku deliberately upstream ("so it can never be
    -- silently ordered"), so only emit a line when a real code is present.
    if nullif(btrim(coalesce(v_order #>> '{wasteOverflow,sku}', '')), '') is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'sku_code',  v_order #>> '{wasteOverflow,sku}',
        'sku_label', 'Waste & overflow',
        'requested', 1,
        'source',    'plumbing'));
    end if;

    if jsonb_typeof(v_order -> 'accessories') = 'object' then
      for k, v in select key, value from jsonb_each_text(v_order -> 'accessories')
      loop
        if nullif(btrim(coalesce(v, '')), '') is not null then
          -- Quantity lives on the SELECTIONS side, keyed the same way; a dealer stepping an
          -- accessory to 0 drops it from the order even though the SKU is still resolved.
          q := coalesce((v_sel #>> array['accessories', k])::integer, 1);
          if q > 0 then
            v_lines := v_lines || jsonb_build_array(jsonb_build_object(
              'sku_code',  v,
              'sku_label', 'Accessory: ' || k,
              'requested', q,
              'source',    'plumbing'));
          end if;
        end if;
      end loop;
    end if;
  end if;

  -- ------------------------------------------------- shower / vanity / room
  -- No SKUs on these — they carry priced lines keyed by i18n string. Recorded label-only so
  -- an admin can see the whole order, and so Phase 4 can measure how much of it is
  -- SKU-addressable at all.
  foreach v_sec in array v_secs
  loop
    if jsonb_typeof(v_quote #> array[v_sec, 'price', 'lines']) = 'array' then
      for v_line in select value from jsonb_array_elements(v_quote #> array[v_sec, 'price', 'lines'])
      loop
        if nullif(btrim(coalesce(v_line ->> 'key', '')), '') is not null then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object(
            'sku_code',  null,
            'sku_label', v_line ->> 'key',
            'requested', 1,
            'source',    v_sec));
        end if;
      end loop;
    end if;
  end loop;

  return v_lines;
end;
$$;

-- ============================================================================
-- apply_order_shipment() — record (and, from Phase 4, apply) an order's stock impact.
--
-- SECURITY INVOKER: admin RLS on inventory_order_shipments gates the write, and the order
-- read is gated by the orders SELECT policy which already admits admins network-wide.
--
-- NEVER RAISES for business reasons. The caller invokes this immediately after a successful
-- ship transition, so a raise here would surface as a failure of an operation that already
-- succeeded. Only a genuinely broken call (missing order, non-admin) raises; everything else
-- is recorded as an attempt with a status the UI renders.
--
-- Idempotent on ('success','partial','skipped') — wider than the spec's ('success','partial')
-- because under strategy (c) EVERY attempt is 'skipped', so guarding on the narrower set
-- would let a double-fired transition stack duplicate rows. p_force bypasses it; that is what
-- the retry wrapper uses.
-- ============================================================================
create or replace function public.apply_order_shipment(p_order_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
volatile
as $$
declare
  v_snapshot   jsonb;
  v_order_no   text;
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

  select o.snapshot, o.order_number into v_snapshot, v_order_no
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
  -- decremented — see the strategy note in the header.
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
    (order_id, attempted_by, status, lines_attempted, lines_applied, error_note, movement_ids, unfulfillable)
  values
    (p_order_id, auth.uid(), v_status, v_count, 0,
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
$$;

-- ----------------------------------------------------------------------------
-- apply_order_shipment_retry() — force a fresh attempt, keeping the old one as history.
--
-- p_shipment_id identifies the attempt being superseded. It is validated against the order
-- (so a mistyped id fails loudly instead of silently retrying the wrong order) but nothing is
-- mutated: the previous row stays exactly as recorded, which is the point of keeping attempts
-- rather than a single per-order row.
-- ----------------------------------------------------------------------------
create or replace function public.apply_order_shipment_retry(p_order_id uuid, p_shipment_id uuid)
returns jsonb
language plpgsql
volatile
as $$
begin
  if not public.is_admin() then
    raise exception 'INVENTORY_FORBIDDEN: admin role required to retry an order shipment'
      using errcode = '42501';
  end if;

  if p_shipment_id is not null and not exists (
    select 1 from public.inventory_order_shipments s
     where s.id = p_shipment_id and s.order_id = p_order_id
  ) then
    raise exception 'INVENTORY_NO_SHIPMENT: shipment % does not belong to order %', p_shipment_id, p_order_id
      using errcode = 'P0002';
  end if;

  return public.apply_order_shipment(p_order_id, true);
end;
$$;

revoke all on function public.inventory_order_lines(jsonb) from public;
revoke all on function public.apply_order_shipment(uuid, boolean) from public;
revoke all on function public.apply_order_shipment_retry(uuid, uuid) from public;
grant execute on function public.inventory_order_lines(jsonb) to authenticated;
grant execute on function public.apply_order_shipment(uuid, boolean) to authenticated;
grant execute on function public.apply_order_shipment_retry(uuid, uuid) to authenticated;

-- ============================================================================
-- VERIFY (run in the SQL editor after the migration)
--
-- 1. Table, enum, policy:
--      select relrowsecurity from pg_class where relname = 'inventory_order_shipments';  -- true
--      select policyname, cmd from pg_policies where tablename = 'inventory_order_shipments';
--      -- expect one ALL policy
--      select unnest(enum_range(null::public.inventory_shipment_status));
--      -- success, partial, failed, skipped
--
-- 2. A NON-ADMIN CANNOT SEE SHIPMENT RECORDS. The SQL editor runs as owner and bypasses
--    RLS, so impersonate a real contractor:
--      set local role authenticated;
--      set local request.jwt.claims to '{"sub":"<a non-admin profiles.id>","role":"authenticated"}';
--      select count(*) from public.inventory_order_shipments;          -- EXPECT 0
--      insert into public.inventory_order_shipments (order_id, status, lines_attempted, lines_applied)
--        values ('<any order id>', 'skipped', 0, 0);                   -- EXPECT: violates RLS policy
--      select public.apply_order_shipment('<any order id>');           -- EXPECT INVENTORY_FORBIDDEN
--      reset role;
--
-- 3. DRY RUN against a real order, leaving NO data behind. The whole block rolls back, so
--    the inserted attempt disappears — run this before wiring anything up:
--      begin;
--        -- what the extractor makes of this order's snapshot, with no writes at all:
--        select jsonb_pretty(public.inventory_order_lines(
--                 (select snapshot from public.orders order by placed_at desc limit 1)));
--
--        -- the full call, including the attempt row:
--        select jsonb_pretty(public.apply_order_shipment(
--                 (select id from public.orders order by placed_at desc limit 1)));
--        -- expect: status 'skipped', lines_applied 0, movement_ids [], and one entry per
--        -- candidate line in unfulfillable with matched true/false per line.
--
--        -- confirm NOTHING moved (this is the assertion that matters):
--        select count(*) from public.inventory_movements
--         where performed_at > now() - interval '1 minute';            -- EXPECT 0
--      rollback;
--
--      -- and confirm the rollback took:
--      select count(*) from public.inventory_order_shipments;          -- EXPECT unchanged
--
-- 4. Idempotency (also inside a transaction you roll back):
--      begin;
--        select public.apply_order_shipment('<order id>') -> 'already_recorded';  -- false
--        select public.apply_order_shipment('<order id>') -> 'already_recorded';  -- true
--        select public.apply_order_shipment('<order id>', true) -> 'already_recorded'; -- false
--      rollback;
-- ============================================================================

-- ============================================================================
-- PHASE 4 NOTES (context — not built):
--   Promote (c) → (b)/(a) by changing inventory_order_lines() alone, then letting
--   apply_order_shipment() call public.apply_inventory_movements(jsonb) per resolvable line
--   group inside a BEGIN/EXCEPTION block (so one short line degrades the attempt to 'partial'
--   instead of rolling the batch back). movement_ids and lines_applied already exist to be
--   filled; the admin UI already renders per-line detail. No UI rebuild, no table change.
--   A movement-import CSV (opening balances, bulk receiving) is the natural companion.
-- ============================================================================
