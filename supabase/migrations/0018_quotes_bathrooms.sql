-- ============================================================================
-- Kitify Solutions — Bathroom as a first-class entity, schema half (Phase C1)
-- Migration: 0018_quotes_bathrooms
--
-- A quote has always been ONE bathroom's worth of work: four singular jsonb columns
-- (room / shower / vanity / plumbing), one of each, no way to express a second. A dealer
-- quoting a two-bathroom job today cannot do it in one quote at all.
--
-- This adds the container. It does NOT change what anything looks like: Phase C1 is
-- deliberately invisible, and the UX that produces multi-bathroom quotes lands in C2.
--
-- WHY THE COLUMN AND NOT A TABLE: configurations are opaque jsonb documents. Nothing in the
-- system queries INSIDE one — the closest thing is inventory_order_lines() below, which walks
-- jsonb paths in plpgsql and goes on doing exactly that. A bathrooms table would buy
-- relational rigour for data that is never used relationally, and would charge for it at
-- orders.quote_id NOT NULL, which is the constraint that makes "one order = one quote" true.
--
-- NO BACKFILL, DELIBERATELY. Every existing row keeps bathrooms = null and its four legacy
-- columns, and is read through an accessor that synthesises a single default bathroom from
-- them (lib/store.ts quoteBathrooms). Backfilling would rewrite live rows to gain nothing and
-- would have to be re-run for anything created between the deploy and the migration.
--
-- Depends on 0017. Re-runnable.
-- ============================================================================

alter table public.quotes add column if not exists bathrooms jsonb;

comment on column public.quotes.bathrooms is
  'Bathroom[] — [{ id, name, room, shower, vanity, plumbing }]. NULL means one implicit '
  'bathroom composed from the legacy room/shower/vanity/plumbing columns; the app resolves '
  'that through quoteBathrooms(). A one-bathroom quote dual-writes BOTH shapes so a UI '
  'rollback stays readable; only a genuinely multi-bathroom quote writes this alone.';

-- ============================================================================
-- inventory_order_lines() — snapshot → candidate shipment lines, now bathroom-aware.
--
-- Phase 3 shipped this with mapping strategy (c): extract what it can, apply nothing, record
-- everything. 0017 taught it to read the HPL shower BOM. This teaches it to read bathrooms.
--
-- THE RULE THAT MATTERS MOST: historical snapshots must keep extracting IDENTICALLY. Every
-- order already placed froze a flat `quote.{room,shower,vanity,plumbing}` — snapshots are
-- immutable documents and are never rewritten — so the flat paths stay, and the bathrooms
-- loop is additive. Getting this wrong would be near-silent: strategy (c) records rather than
-- applies, so a historical order that suddenly yielded zero lines would not fail anything
-- loudly. It would just quietly stop counting.
--
-- Structure: the per-section extraction is factored into inventory_order_lines_section(),
-- which is called once per bathroom for a new snapshot, or once over the flat quote object
-- for a legacy one. One implementation, so the two shapes cannot drift apart.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- One bathroom's worth of a snapshot → lines. `p_scope` is the object holding the four
-- config slots: a bathroom element on a new snapshot, or the quote itself on a legacy one.
-- `p_bathroom` labels the source and is null for the legacy single-bathroom case, so the
-- output for a pre-C1 order is byte-identical to what 0017 produced.
-- ----------------------------------------------------------------------------
create or replace function public.inventory_order_lines_section(
  p_scope jsonb,
  p_bathroom text default null
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_lines  jsonb := '[]'::jsonb;
  v_sel    jsonb;
  v_order  jsonb;
  v_bom    jsonb;
  v_line   jsonb;
  v_secs   text[] := array['shower', 'vanity', 'room'];
  v_sec    text;
  k        text;
  v        text;
  q        integer;
  -- Merged into every line so a two-bathroom order can be told apart at the ledger.
  -- Absent (not null) on a legacy snapshot, so those rows keep the exact shape they had.
  v_tag    jsonb := case when p_bathroom is null then '{}'::jsonb
                         else jsonb_build_object('bathroom', p_bathroom) end;
begin
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then
    return v_lines;
  end if;

  -- ---------------------------------------------------------------- plumbing
  v_sel   := p_scope -> 'plumbing' -> 'selections';
  v_order := v_sel -> 'order';

  if v_order is not null and jsonb_typeof(v_order) = 'object' then
    if nullif(btrim(coalesce(v_order ->> 'faucet', '')), '') is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'sku_code',  v_order ->> 'faucet',
        'sku_label', 'Faucet',
        'requested', greatest(coalesce((v_sel ->> 'faucetQty')::integer, 1), 1),
        'source',    'plumbing') || v_tag);
    end if;

    if nullif(btrim(coalesce(v_order ->> 'bathTrim', '')), '') is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'sku_code',  v_order ->> 'bathTrim',
        'sku_label', 'Bath / shower trim',
        'requested', greatest(coalesce((v_order ->> 'bathTrimQty')::integer, 1), 1),
        'source',    'plumbing') || v_tag);
    end if;

    if nullif(btrim(coalesce(v_order ->> 'roughInValve', '')), '') is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'sku_code',  v_order ->> 'roughInValve',
        'sku_label', 'Rough-in valve',
        'requested', greatest(coalesce((v_order ->> 'roughInValveQty')::integer, 1), 1),
        'source',    'plumbing') || v_tag);
    end if;

    if nullif(btrim(coalesce(v_order #>> '{wasteOverflow,sku}', '')), '') is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'sku_code',  v_order #>> '{wasteOverflow,sku}',
        'sku_label', 'Waste & overflow',
        'requested', 1,
        'source',    'plumbing') || v_tag);
    end if;

    if jsonb_typeof(v_order -> 'accessories') = 'object' then
      for k, v in select key, value from jsonb_each_text(v_order -> 'accessories')
      loop
        if nullif(btrim(coalesce(v, '')), '') is not null then
          q := coalesce((v_sel #>> array['accessories', k])::integer, 1);
          if q > 0 then
            v_lines := v_lines || jsonb_build_array(jsonb_build_object(
              'sku_code',  v,
              'sku_label', 'Accessory: ' || k,
              'requested', q,
              'source',    'plumbing') || v_tag);
          end if;
        end if;
      end loop;
    end if;
  end if;

  -- --------------------------------------------------------- HPL shower BOM
  -- Unchanged from 0017: the one section carrying real SKU codes and real quantities.
  v_bom := p_scope #> array['shower', 'hplBom', 'lines'];
  if jsonb_typeof(v_bom) = 'array' then
    for v_line in select value from jsonb_array_elements(v_bom)
    loop
      if nullif(btrim(coalesce(v_line ->> 'skuCode', '')), '') is not null then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'sku_code',  v_line ->> 'skuCode',
          'sku_label', coalesce(v_line ->> 'kind', 'hpl item')
                       || case when coalesce((v_line ->> 'upsell')::boolean, false) then ' (upsell)' else '' end,
          'requested', greatest(coalesce((v_line ->> 'qty')::integer, 1), 1),
          'source',    'shower-hpl') || v_tag);
      end if;
    end loop;
  end if;

  -- ------------------------------------------------- shower / vanity / room
  -- Label-only. The shower is SKIPPED when an hplBom was read above — its price lines are
  -- the same BOM, and recording both would count every panel twice.
  foreach v_sec in array v_secs
  loop
    if v_sec = 'shower' and jsonb_typeof(v_bom) = 'array' then
      continue;
    end if;
    if jsonb_typeof(p_scope #> array[v_sec, 'price', 'lines']) = 'array' then
      for v_line in select value from jsonb_array_elements(p_scope #> array[v_sec, 'price', 'lines'])
      loop
        if nullif(btrim(coalesce(v_line ->> 'key', '')), '') is not null then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object(
            'sku_code',  null,
            'sku_label', v_line ->> 'key',
            'requested', 1,
            'source',    v_sec) || v_tag);
        end if;
      end loop;
    end if;
  end loop;

  return v_lines;
end;
$$;

-- ----------------------------------------------------------------------------
-- The entry point. Chooses the shape, then delegates.
-- ----------------------------------------------------------------------------
create or replace function public.inventory_order_lines(p_snapshot jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_quote     jsonb;
  v_bathrooms jsonb;
  v_bath      jsonb;
  v_lines     jsonb := '[]'::jsonb;
  v_idx       integer := 0;
  v_label     text;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    return v_lines;
  end if;

  v_quote := p_snapshot -> 'quote';
  if v_quote is null or jsonb_typeof(v_quote) <> 'object' then
    return v_lines;
  end if;

  v_bathrooms := v_quote -> 'bathrooms';

  -- LEGACY SHAPE — every order placed before C1, and every single-bathroom order after it
  -- (the app dual-writes, so the flat slots are still populated). Walk the quote itself.
  if jsonb_typeof(v_bathrooms) <> 'array' or jsonb_array_length(v_bathrooms) = 0 then
    return public.inventory_order_lines_section(v_quote, null);
  end if;

  -- BATHROOM SHAPE — one pass per bathroom, each tagged so the ledger can tell them apart.
  for v_bath in select value from jsonb_array_elements(v_bathrooms)
  loop
    v_idx := v_idx + 1;
    -- Prefer the dealer's own name; fall back to the id, then to the ordinal. Never null —
    -- an untagged line in a multi-bathroom order is indistinguishable from the others.
    v_label := coalesce(
      nullif(btrim(coalesce(v_bath ->> 'name', '')), ''),
      nullif(btrim(coalesce(v_bath ->> 'id', '')), ''),
      'bathroom ' || v_idx::text);
    v_lines := v_lines || public.inventory_order_lines_section(v_bath, v_label);
  end loop;

  return v_lines;
end;
$$;

-- ============================================================================
-- VERIFY (SQL editor, after running). Each block prints PASS or FAIL.
-- ============================================================================

-- 1. LEGACY SNAPSHOT extracts exactly as it did under 0017 — no bathroom key on any line.
do $$
declare
  v jsonb;
begin
  v := public.inventory_order_lines('{
    "quote": {
      "shower": {
        "price":  { "lines": [ { "key": "configurator.shower.hplBom.panel" } ] },
        "hplBom": { "lines": [
          { "kind": "panel",   "skuCode": "HPL-MP638",       "qty": 7 },
          { "kind": "end-cap", "skuCode": "HPL-TRIM-EC-945", "qty": 4 }
        ] }
      },
      "vanity": { "price": { "lines": [ { "key": "configurator.priceLine.cabinet" } ] } }
    }
  }'::jsonb);

  if jsonb_array_length(v) = 3
     and (v -> 0 ->> 'sku_code') = 'HPL-MP638'
     and (v -> 0 ->> 'requested') = '7'
     and (v -> 1 ->> 'sku_code') = 'HPL-TRIM-EC-945'
     and (v -> 2 ->> 'source')   = 'vanity'
     and not (v -> 0 ? 'bathroom')          -- legacy lines carry NO bathroom tag
     and not (v -> 2 ? 'bathroom')
  then
    raise notice 'PASS 1 — legacy flat snapshot extracts unchanged (3 lines, untagged)';
  else
    raise warning 'FAIL 1 — legacy extraction changed: %', jsonb_pretty(v);
  end if;
end $$;

-- 2. TWO-BATHROOM SNAPSHOT — both bathrooms' SKUs land, each tagged with its own name.
do $$
declare
  v jsonb;
  n_master integer;
  n_hall   integer;
begin
  v := public.inventory_order_lines('{
    "quote": {
      "bathrooms": [
        { "id": "b1", "name": "Master",
          "shower": { "hplBom": { "lines": [ { "kind": "panel", "skuCode": "HPL-MP638", "qty": 7 } ] } },
          "plumbing": { "selections": { "faucetQty": 2, "order": { "faucet": "DELTA-1234" } } } },
        { "id": "b2", "name": "Hall bath",
          "shower": { "hplBom": { "lines": [ { "kind": "panel", "skuCode": "HPL-MP775", "qty": 5 } ] } },
          "vanity": { "price": { "lines": [ { "key": "configurator.priceLine.cabinet" } ] } } }
      ]
    }
  }'::jsonb);

  select count(*) into n_master from jsonb_array_elements(v) e where e ->> 'bathroom' = 'Master';
  select count(*) into n_hall   from jsonb_array_elements(v) e where e ->> 'bathroom' = 'Hall bath';

  if jsonb_array_length(v) = 4 and n_master = 2 and n_hall = 2
     and exists (select 1 from jsonb_array_elements(v) e
                 where e ->> 'sku_code' = 'HPL-MP638' and (e ->> 'requested') = '7' and e ->> 'bathroom' = 'Master')
     and exists (select 1 from jsonb_array_elements(v) e
                 where e ->> 'sku_code' = 'HPL-MP775' and (e ->> 'requested') = '5' and e ->> 'bathroom' = 'Hall bath')
     and exists (select 1 from jsonb_array_elements(v) e
                 where e ->> 'sku_code' = 'DELTA-1234' and (e ->> 'requested') = '2' and e ->> 'bathroom' = 'Master')
  then
    raise notice 'PASS 2 — two-bathroom snapshot extracts both, tagged (4 lines: 2 + 2)';
  else
    raise warning 'FAIL 2 — multi-bathroom extraction wrong: %', jsonb_pretty(v);
  end if;
end $$;

-- 3. SAME DECOR IN BOTH BATHROOMS stays two lines, not one merged line — a fulfilment
--    ledger has to know which room each panel is for.
do $$
declare v jsonb;
begin
  v := public.inventory_order_lines('{
    "quote": { "bathrooms": [
      { "id": "b1", "name": "Master",
        "shower": { "hplBom": { "lines": [ { "kind": "panel", "skuCode": "HPL-MP638", "qty": 7 } ] } } },
      { "id": "b2", "name": "Guest",
        "shower": { "hplBom": { "lines": [ { "kind": "panel", "skuCode": "HPL-MP638", "qty": 6 } ] } } }
    ] }
  }'::jsonb);

  if jsonb_array_length(v) = 2
     and (v -> 0 ->> 'bathroom') = 'Master' and (v -> 0 ->> 'requested') = '7'
     and (v -> 1 ->> 'bathroom') = 'Guest'  and (v -> 1 ->> 'requested') = '6'
  then
    raise notice 'PASS 3 — a shared decor stays per-bathroom (2 lines, 7 + 6)';
  else
    raise warning 'FAIL 3 — bathrooms merged or mislabelled: %', jsonb_pretty(v);
  end if;
end $$;

-- 4. DEGENERATE SHAPES do not throw. Snapshots are frozen documents going back to before any
--    of this existed, so an unexpected shape must return nothing rather than break the order.
do $$
declare ok boolean := true;
begin
  if jsonb_array_length(public.inventory_order_lines('{"quote": {"bathrooms": []}}'::jsonb)) <> 0 then ok := false; end if;
  if jsonb_array_length(public.inventory_order_lines('{"quote": {"bathrooms": null}}'::jsonb)) <> 0 then ok := false; end if;
  if jsonb_array_length(public.inventory_order_lines('{"quote": {"bathrooms": "nonsense"}}'::jsonb)) <> 0 then ok := false; end if;
  if jsonb_array_length(public.inventory_order_lines('{"quote": {}}'::jsonb)) <> 0 then ok := false; end if;
  if jsonb_array_length(public.inventory_order_lines('null'::jsonb)) <> 0 then ok := false; end if;
  if jsonb_array_length(public.inventory_order_lines('{}'::jsonb)) <> 0 then ok := false; end if;
  -- A bathroom with no id and no name still gets a label rather than a null tag.
  if (public.inventory_order_lines('{"quote": {"bathrooms": [
        { "shower": { "hplBom": { "lines": [ { "kind": "panel", "skuCode": "X", "qty": 1 } ] } } } ] }}'::jsonb)
      -> 0 ->> 'bathroom') <> 'bathroom 1' then ok := false; end if;

  if ok then raise notice 'PASS 4 — degenerate shapes return empty and never throw';
       else raise warning 'FAIL 4 — a degenerate shape misbehaved'; end if;
end $$;

-- 5. REAL HISTORICAL ORDERS still extract. Run against live data — this is the check that
--    actually matters, because 1-4 are synthetic. Expect the same counts as before 0018.
--      select o.order_number,
--             jsonb_array_length(public.inventory_order_lines(o.snapshot)) as lines
--      from public.orders o
--      order by o.placed_at desc nulls last
--      limit 20;

-- 6. Nothing is applied — strategy (c) is unchanged.
--      begin;
--        select public.apply_order_shipment((select id from public.orders order by placed_at desc limit 1));
--        select count(*) from public.inventory_movements where performed_at > now() - interval '1 minute';  -- 0
--      rollback;
-- ============================================================================
