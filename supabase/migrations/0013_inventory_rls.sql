-- ============================================================================
-- Kitify Solutions — inventory RLS + the atomic movement RPC
-- Migration: 0013_inventory_rls
--
-- ADMIN-ONLY, all four inventory tables, read AND write. Non-admin authenticated users get
-- nothing: no select, no insert, no update, no delete. This is stricter than the
-- owner-scoped shape used by projects/quotes/orders/contractor_customers, and deliberately
-- so — Kitify's own stock levels are never visible to a contractor or a customer at any
-- surface (quote, configurator, proposal, order), in this phase or any later one.
--
-- Because there is no owner column to key off, each table gets ONE `for all` policy gated on
-- public.is_admin() (defined in 0002_enable_rls.sql). `for all` covers select/insert/update/
-- delete; USING gates the rows you may see or touch, WITH CHECK gates the rows you may write.
-- Both must be present — USING alone would leave inserts unchecked.
--
-- NOTE for Phase 2: these policies are intentionally NOT written in a way that would be
-- permissive once partner inventory arrives. partner_inventory_items will be a separate
-- table with its own owner-scoped policies; nothing here grants a non-admin anything that
-- would have to be walked back.
--
-- Depends on 0002 (public.is_admin) and 0012 (the four tables).
-- Re-runnable: every policy is dropped first; ENABLE ROW LEVEL SECURITY is idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Guard: is_admin() must already exist (0002). Fail loudly rather than silently
-- creating policies that reference a missing function.
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() is missing — run 0002_enable_rls.sql before this migration';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- inventory_locations
-- ----------------------------------------------------------------------------
alter table public.inventory_locations enable row level security;

drop policy if exists "inventory_locations_admin_all" on public.inventory_locations;
create policy "inventory_locations_admin_all" on public.inventory_locations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- inventory_skus
-- ----------------------------------------------------------------------------
alter table public.inventory_skus enable row level security;

drop policy if exists "inventory_skus_admin_all" on public.inventory_skus;
create policy "inventory_skus_admin_all" on public.inventory_skus
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- inventory_stock
-- ----------------------------------------------------------------------------
alter table public.inventory_stock enable row level security;

drop policy if exists "inventory_stock_admin_all" on public.inventory_stock;
create policy "inventory_stock_admin_all" on public.inventory_stock
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- inventory_movements
-- ----------------------------------------------------------------------------
alter table public.inventory_movements enable row level security;

drop policy if exists "inventory_movements_admin_all" on public.inventory_movements;
create policy "inventory_movements_admin_all" on public.inventory_movements
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- apply_inventory_movements() — the ONLY supported way to change stock.
--
-- Takes a jsonb ARRAY of movements and applies every one of them, or none. A single
-- receive, a bulk shipment, an inter-location move (an out-row plus an in-row) and an
-- expanded sample kit (one row per included piece) are all the same call with a different
-- number of elements — which is what makes "atomic — either the whole batch commits or
-- none does" true for free: a plpgsql function body IS one transaction, so any RAISE
-- rolls the entire batch back.
--
-- Each element:
--   { "sku_id": uuid, "location_id": uuid, "reason": <inventory_movement_reason>,
--     "delta": int, "reference": text|null, "note": text|null }
--
-- SIGN IS DECIDED HERE, NOT BY THE CLIENT. The admin UI always collects a positive
-- quantity ("ship 3") and the sign is derived from the reason, so the browser cannot
-- disagree with the ledger about what "shipped" means. `adjustment` is the sole exception:
-- it is inherently bidirectional (a cycle count can go either way, and an inter-location
-- move is a negative paired with a positive), so for that reason alone the caller's sign
-- is honoured as given.
--
-- SECURITY INVOKER (the default — deliberately NOT definer): the function runs as the
-- caller, so the RLS policies above apply to every statement inside it and a non-admin
-- gets nothing even if they call the RPC directly. The explicit is_admin() check on entry
-- is belt-and-braces, and turns a silent zero-row no-op into a clear 403-shaped error.
--
-- Concurrency: the stock row is upserted-then-SELECT ... FOR UPDATE locked before it is
-- read, so two admins receiving the same SKU at the same moment serialise instead of
-- racing on a read-modify-write.
-- ============================================================================
create or replace function public.apply_inventory_movements(p_movements jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  m           jsonb;
  v_sku       uuid;
  v_loc       uuid;
  v_reason    public.inventory_movement_reason;
  v_input     integer;
  v_delta     integer;
  v_current   integer;
  v_new       integer;
  v_sku_code  text;
  v_applied   integer := 0;
  v_results   jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'INVENTORY_FORBIDDEN: admin role required to move inventory'
      using errcode = '42501';
  end if;

  if p_movements is null
     or jsonb_typeof(p_movements) <> 'array'
     or jsonb_array_length(p_movements) = 0 then
    raise exception 'INVENTORY_EMPTY: no movements supplied'
      using errcode = '22023';
  end if;

  for m in select value from jsonb_array_elements(p_movements)
  loop
    v_sku    := (m ->> 'sku_id')::uuid;
    v_loc    := (m ->> 'location_id')::uuid;
    v_reason := (m ->> 'reason')::public.inventory_movement_reason;
    v_input  := coalesce((m ->> 'delta')::integer, 0);

    if v_sku is null or v_loc is null then
      raise exception 'INVENTORY_INVALID: every movement needs a sku_id and a location_id'
        using errcode = '22023';
    end if;

    if v_input = 0 then
      raise exception 'INVENTORY_ZERO: a movement quantity cannot be zero'
        using errcode = '22023';
    end if;

    -- Reason decides direction; 'adjustment' keeps the caller's sign (see the header note).
    v_delta := case
      when v_reason in ('received', 'sample_replenish', 'initial') then abs(v_input)
      when v_reason in ('shipped', 'sample_sent', 'damaged', 'lost') then -abs(v_input)
      else v_input
    end;

    -- Materialise the (sku, location) pair on first touch so a brand-new SKU can be
    -- received into a location that has never held it.
    insert into public.inventory_stock (sku_id, location_id, quantity)
    values (v_sku, v_loc, 0)
    on conflict (sku_id, location_id) do nothing;

    select quantity into v_current
      from public.inventory_stock
     where sku_id = v_sku and location_id = v_loc
       for update;

    v_current := coalesce(v_current, 0);
    v_new := v_current + v_delta;

    -- The one hard block in the whole system. Everything else (low-stock crossing,
    -- deactivating a location that still holds stock) warns in the UI and proceeds.
    if v_new < 0 then
      select sku into v_sku_code from public.inventory_skus where id = v_sku;
      raise exception
        'INVENTORY_NEGATIVE: % has % on hand at this location — cannot apply a change of %',
        coalesce(v_sku_code, v_sku::text), v_current, v_delta
        using errcode = 'P0001';
    end if;

    update public.inventory_stock
       set quantity = v_new
     where sku_id = v_sku and location_id = v_loc;

    insert into public.inventory_movements
      (sku_id, location_id, delta, reason, reference, note, performed_by)
    values
      (v_sku, v_loc, v_delta, v_reason,
       nullif(btrim(coalesce(m ->> 'reference', '')), ''),
       nullif(btrim(coalesce(m ->> 'note', '')), ''),
       auth.uid());

    v_applied := v_applied + 1;
    v_results := v_results || jsonb_build_object(
      'sku_id', v_sku, 'location_id', v_loc, 'delta', v_delta, 'quantity', v_new
    );
  end loop;

  return jsonb_build_object('applied', v_applied, 'results', v_results);
end;
$$;

-- Only signed-in users may even attempt the call; the is_admin() check inside does the
-- real gating. Revoking from PUBLIC keeps the anon role from probing it.
revoke all on function public.apply_inventory_movements(jsonb) from public;
grant execute on function public.apply_inventory_movements(jsonb) to authenticated;

-- ============================================================================
-- VERIFY RLS (run these in the SQL editor after the migration):
--
-- 1. Policies exist and RLS is on for all four tables:
--      select relname, relrowsecurity
--        from pg_class
--       where relname in ('inventory_locations','inventory_skus','inventory_stock','inventory_movements');
--      -- expect relrowsecurity = true on all four rows
--
--      select tablename, policyname, cmd
--        from pg_policies
--       where tablename like 'inventory%'
--       order by tablename;
--      -- expect exactly one ALL policy per table
--
-- 2. NON-ADMIN GETS NOTHING. The SQL editor runs as the table owner and BYPASSES RLS, so
--    it cannot prove this — the check has to run as a real non-admin user. Two ways:
--
--    a) In the browser, signed in as a contractor, from the devtools console:
--         const { data, error } = await window.supabase.from('inventory_skus').select('*')
--       expect data = [] (RLS filters to zero rows — a SELECT that matches nothing is not
--       an error), and an insert to fail with code 42501:
--         await window.supabase.from('inventory_skus').insert({ sku: 'X', name: 'X' })
--
--    b) Or simulate the role here, which does exercise the policies:
--         set local role authenticated;
--         set local request.jwt.claims to '{"sub":"<a non-admin profiles.id>","role":"authenticated"}';
--         select count(*) from public.inventory_skus;                    -- expect 0
--         insert into public.inventory_skus (sku, name) values ('X','X'); -- expect: new row violates RLS policy
--         select public.apply_inventory_movements('[]'::jsonb);           -- expect: INVENTORY_FORBIDDEN
--         reset role;
--
--    Repeat (b) with an ADMIN profiles.id and `select count(*) from public.inventory_skus`
--    should return 1 (the seed SKU) — proving the policy admits admins, not just that it
--    denies everyone.
-- ============================================================================
