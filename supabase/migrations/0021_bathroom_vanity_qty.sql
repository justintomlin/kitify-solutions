-- ============================================================================
-- Kitify Solutions — twin vanities, extractor half
-- Migration: 0021_bathroom_vanity_qty
--
-- A bathroom has always taken ONE vanity. A primary bath with his-and-hers cabinets could not
-- be quoted as what it is.
--
-- The container needs NO schema change: a bathroom is already an opaque jsonb document inside
-- quotes.bathrooms, and `vanityQty` simply joins it. This migration exists for one reason —
-- inventory_order_lines_section() walks those documents in plpgsql and emits the vanity's
-- price lines at `requested` 1, hard-coded. Left alone, a bathroom taking two cabinets would
-- put ONE on the pick list, and under Phase 3's record-don't-apply strategy that is silent:
-- no error, nothing that looks wrong, just a second vanity nobody packs.
--
-- WHY A COUNT AND NOT AN ARRAY. His-and-hers is the same cabinet twice — same size, same door
-- style, same finish, same drilling. Two independent documents could disagree about drilling,
-- which is the one thing the plumbing module needs a single answer to, because a bathroom has
-- one faucet type. A count cannot drift. The app caps it at two (see lib/bathrooms.ts
-- MAX_VANITY_QTY); this function clamps to the same ceiling rather than trusting the document.
--
-- BYTE-IDENTICAL FOR ONE VANITY. `vanityQty` absent, null, 1, or any unusable value all give
-- requested = 1, which is exactly what this emitted before. Every snapshot ever frozen, and
-- every single-vanity bathroom written from here on, extracts unchanged.
--
-- ONLY the vanity section changes. Plumbing, the HPL shower BOM, the room section and the
-- bathroom walk in inventory_order_lines() are untouched.
--
-- Depends on 0018. Re-runnable.
-- ============================================================================

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
  -- How many of this bathroom's vanity to order. Absent / null / unusable → 1, clamped to 2.
  v_vqty   integer;
  v_qty    integer;
  -- Merged into every line so a two-bathroom order can be told apart at the ledger.
  -- Absent (not null) on a legacy snapshot, so those rows keep the exact shape they had.
  v_tag    jsonb := case when p_bathroom is null then '{}'::jsonb
                         else jsonb_build_object('bathroom', p_bathroom) end;
begin
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then
    return v_lines;
  end if;

  -- The vanity count, resolved once. A jsonb document can hold anything here, so this is
  -- deliberately total: anything that is not a usable number lands on 1.
  begin
    v_vqty := greatest(1, least(2, floor((p_scope ->> 'vanityQty')::numeric)::integer));
  exception when others then
    v_vqty := 1;
  end;
  if v_vqty is null then
    v_vqty := 1;
  end if;

  -- ---------------------------------------------------------------- plumbing
  v_sel   := p_scope -> 'plumbing' -> 'selections';
  v_order := v_sel -> 'order';

  if v_order is not null and jsonb_typeof(v_order) = 'object' then
    if nullif(btrim(coalesce(v_order ->> 'faucet', '')), '') is not null then
      -- NOT multiplied here. The faucet quantity is decided in the plumbing module, which is
      -- seeded from the bathroom's total sink count across both cabinets — so faucetQty
      -- already accounts for the twin. Multiplying again would double-order.
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
  -- Unchanged from 0017/0018: the one section carrying real SKU codes and real quantities.
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
  --
  -- The VANITY section is the only one that multiplies: every line of a twinned vanity is
  -- ordered twice, because it is literally the same cabinet twice. Room and shower are
  -- per-bathroom whatever the cabinet count is.
  foreach v_sec in array v_secs
  loop
    if v_sec = 'shower' and jsonb_typeof(v_bom) = 'array' then
      continue;
    end if;
    v_qty := case when v_sec = 'vanity' then v_vqty else 1 end;
    if jsonb_typeof(p_scope #> array[v_sec, 'price', 'lines']) = 'array' then
      for v_line in select value from jsonb_array_elements(p_scope #> array[v_sec, 'price', 'lines'])
      loop
        if nullif(btrim(coalesce(v_line ->> 'key', '')), '') is not null then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object(
            'sku_code',  null,
            'sku_label', v_line ->> 'key',
            'requested', v_qty,
            'source',    v_sec) || v_tag);
        end if;
      end loop;
    end if;
  end loop;

  return v_lines;
end;
$$;

-- ============================================================================
-- VERIFY (SQL editor, after running). Each block prints PASS or FAIL.
-- ============================================================================

-- 1. LEGACY SNAPSHOT — no vanityQty anywhere. requested is 1, exactly as before.
do $$
declare
  v jsonb;
begin
  v := public.inventory_order_lines('{
    "quote": { "vanity": { "price": { "lines": [ { "key": "configurator.priceLine.cabinet" } ] } } }
  }'::jsonb);
  if jsonb_array_length(v) = 1
     and (v -> 0 ->> 'source')    = 'vanity'
     and (v -> 0 ->> 'requested') = '1'
     and not (v -> 0 ? 'bathroom')
  then raise notice 'PASS 1 — legacy single vanity unchanged';
  else raise notice 'FAIL 1 — got %', jsonb_pretty(v);
  end if;
end $$;

-- 2. AN EXPLICIT vanityQty OF 1 is indistinguishable from an absent one.
do $$
declare
  v jsonb;
begin
  v := public.inventory_order_lines('{
    "quote": { "bathrooms": [ { "id": "b-1", "name": null, "vanityQty": 1,
      "vanity": { "price": { "lines": [ { "key": "configurator.priceLine.cabinet" } ] } } } ] }
  }'::jsonb);
  if (v -> 0 ->> 'requested') = '1'
  then raise notice 'PASS 2 — an explicit 1 changes nothing';
  else raise notice 'FAIL 2 — got %', jsonb_pretty(v);
  end if;
end $$;

-- 3. A TWIN VANITY orders every one of its lines twice.
do $$
declare
  v jsonb;
begin
  v := public.inventory_order_lines('{
    "quote": { "bathrooms": [ { "id": "b-1", "name": "Master", "vanityQty": 2,
      "vanity": { "price": { "lines": [ { "key": "cabinet" }, { "key": "countertop" } ] } } } ] }
  }'::jsonb);
  if jsonb_array_length(v) = 2
     and (v -> 0 ->> 'requested') = '2'
     and (v -> 1 ->> 'requested') = '2'
     and (v -> 0 ->> 'bathroom')  = 'Master'
  then raise notice 'PASS 3 — the second cabinet is no longer invisible';
  else raise notice 'FAIL 3 — got %', jsonb_pretty(v);
  end if;
end $$;

-- 4. THE COUNT MULTIPLIES ONLY THE VANITY. A second sink is not a second shower or a second
--    room, and the faucet line is NOT multiplied here — faucetQty already carries the twin.
do $$
declare
  v jsonb;
begin
  v := public.inventory_order_lines('{
    "quote": { "bathrooms": [ { "id": "b-1", "name": null, "vanityQty": 2,
      "plumbing": { "selections": { "faucetQty": 4, "order": { "faucet": "DELTA-1" } } },
      "vanity":   { "price": { "lines": [ { "key": "cabinet" } ] } },
      "room":     { "price": { "lines": [ { "key": "flooring" } ] } } } ] }
  }'::jsonb);
  if jsonb_array_length(v) = 3
     and (v -> 0 ->> 'sku_code')  = 'DELTA-1' and (v -> 0 ->> 'requested') = '4'
     and (v -> 1 ->> 'source')    = 'vanity'  and (v -> 1 ->> 'requested') = '2'
     and (v -> 2 ->> 'source')    = 'room'    and (v -> 2 ->> 'requested') = '1'
  then raise notice 'PASS 4 — vanity doubled, faucet passed through, room untouched';
  else raise notice 'FAIL 4 — got %', jsonb_pretty(v);
  end if;
end $$;

-- 5. A NONSENSE COUNT lands on something orderable rather than propagating. jsonb will hold
--    a string, a float, a negative or a 99 just as happily as a 2.
do $$
declare
  v   jsonb;
  bad text[] := array['"two"', '0', '-3', 'null', '99', '2.9'];
  exp text[] := array['1',     '1', '1',  '1',    '2',  '2'];
  i   integer;
  ok  boolean := true;
begin
  for i in 1 .. array_length(bad, 1) loop
    v := public.inventory_order_lines(format('{
      "quote": { "bathrooms": [ { "id": "b-1", "name": null, "vanityQty": %s,
        "vanity": { "price": { "lines": [ { "key": "cabinet" } ] } } } ] }
    }', bad[i])::jsonb);
    if (v -> 0 ->> 'requested') <> exp[i] then
      ok := false;
      raise notice 'FAIL 5 — vanityQty % gave %, expected %', bad[i], (v -> 0 ->> 'requested'), exp[i];
    end if;
  end loop;
  if ok then raise notice 'PASS 5 — every unusable count lands on something orderable'; end if;
end $$;

-- 6. TWO BATHROOMS, one twinned and one not — the counts do not leak across the walk.
do $$
declare
  v jsonb;
begin
  v := public.inventory_order_lines('{
    "quote": { "bathrooms": [
      { "id": "b-1", "name": "Master", "vanityQty": 2,
        "vanity": { "price": { "lines": [ { "key": "cabinet" } ] } } },
      { "id": "b-2", "name": "Hall",
        "vanity": { "price": { "lines": [ { "key": "cabinet" } ] } } }
    ] }
  }'::jsonb);
  if jsonb_array_length(v) = 2
     and (v -> 0 ->> 'bathroom') = 'Master' and (v -> 0 ->> 'requested') = '2'
     and (v -> 1 ->> 'bathroom') = 'Hall'   and (v -> 1 ->> 'requested') = '1'
  then raise notice 'PASS 6 — per-bathroom counts stay put';
  else raise notice 'FAIL 6 — got %', jsonb_pretty(v);
  end if;
end $$;
-- ============================================================================
