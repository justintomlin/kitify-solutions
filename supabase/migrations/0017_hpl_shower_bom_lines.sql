-- ============================================================================
-- Kitify Solutions — teach the order-shipment extractor about the HPL shower BOM
-- Migration: 0017_hpl_shower_bom_lines
--
-- Phase 3 shipped inventory_order_lines() with mapping strategy (c): extract what it can,
-- apply nothing, record everything. It reads real SKU codes from the plumbing selections and
-- records shower / vanity / room as label-only lines, because none of those carried SKUs.
--
-- The shower half now does. A shower clad in HPL emits a real bill of materials —
-- quote.shower.hplBom.lines, each with a skuCode and a qty — written by
-- lib/hpl-shower-takeoff.ts. This migration is the seam Phase 3 was explicitly designed for:
-- it turns the shower from a label into countable SKUs.
--
-- WHAT STAYS THE SAME, deliberately:
--   • Nothing is applied. Strategy (c) is unchanged — apply_order_shipment still records and
--     decrements nothing. This only improves WHAT is recorded.
--   • Vanity and room stay label-only. They have no BOM yet.
--   • SPC showers stay label-only. SPC is a different physical product whose takeoff has not
--     been specced; an SPC shower carries no hplBom, falls through to the price-line branch,
--     and behaves exactly as it did before this migration.
--
-- THE DOUBLE-COUNT THIS AVOIDS: when a shower has an hplBom, its price.lines ALSO contain the
-- same BOM (that is what the dealer sees priced). Extracting both would record every panel
-- twice — once as a real SKU and once as a label. So the shower section reads the BOM when
-- present and the price lines only when it is absent, never both.
--
-- Depends on 0016. Re-runnable: CREATE OR REPLACE.
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
  v_bom    jsonb;
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
  -- Unchanged from 0016: the one section that already carried resolved order SKUs.
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

  -- --------------------------------------------------------- HPL shower BOM
  -- New in 0017. Each entry already carries an inventory SKU code and a real quantity, so
  -- unlike every other section these lines can actually be matched and counted.
  v_bom := v_quote #> array['shower', 'hplBom', 'lines'];
  if jsonb_typeof(v_bom) = 'array' then
    for v_line in select value from jsonb_array_elements(v_bom)
    loop
      if nullif(btrim(coalesce(v_line ->> 'skuCode', '')), '') is not null then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'sku_code',  v_line ->> 'skuCode',
          -- `kind` is the stable machine label ("panel", "end-cap", …); the human string is
          -- an i18n key resolved in the browser, so it would be meaningless here.
          'sku_label', coalesce(v_line ->> 'kind', 'hpl item')
                       || case when coalesce((v_line ->> 'upsell')::boolean, false) then ' (upsell)' else '' end,
          'requested', greatest(coalesce((v_line ->> 'qty')::integer, 1), 1),
          'source',    'shower-hpl'));
      end if;
    end loop;
  end if;

  -- ------------------------------------------------- shower / vanity / room
  -- Label-only, as before. The shower is SKIPPED here when an hplBom was read above —
  -- its price lines are the same BOM, and recording both would count every panel twice.
  foreach v_sec in array v_secs
  loop
    if v_sec = 'shower' and jsonb_typeof(v_bom) = 'array' then
      continue;
    end if;
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
-- VERIFY (SQL editor, after running)
--
-- 1. A synthetic HPL shower snapshot yields real SKU codes and no duplicate label lines:
--      select jsonb_pretty(public.inventory_order_lines('{
--        "quote": {
--          "shower": {
--            "price": { "lines": [ { "key": "configurator.shower.hplBom.panel" } ] },
--            "hplBom": { "lines": [
--              { "kind": "panel",       "skuCode": "HPL-MP638",        "qty": 7 },
--              { "kind": "end-cap",     "skuCode": "HPL-TRIM-EC-945",  "qty": 4 },
--              { "kind": "panel",       "skuCode": "HPL-MP638",        "qty": 1, "upsell": true }
--            ] }
--          }
--        }
--      }'::jsonb));
--      -- expect THREE lines, all source 'shower-hpl', requested 7 / 4 / 1,
--      -- the third labelled "panel (upsell)", and NO 'shower' label-only line.
--
-- 2. An SPC shower is untouched — no hplBom, so the price line is recorded as before:
--      select jsonb_pretty(public.inventory_order_lines('{
--        "quote": { "shower": { "price": { "lines": [
--          { "key": "configurator.priceLine.wallPanels" } ] } } }
--      }'::jsonb));
--      -- expect ONE line, source 'shower', sku_code null.
--
-- 3. Nothing is applied — strategy (c) is unchanged. Re-run 0016's dry run and confirm
--    inventory_movements still gains nothing:
--      begin;
--        select public.apply_order_shipment((select id from public.orders order by placed_at desc limit 1));
--        select count(*) from public.inventory_movements where performed_at > now() - interval '1 minute';  -- 0
--      rollback;
-- ============================================================================
