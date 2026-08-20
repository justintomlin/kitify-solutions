-- ============================================================================
-- Kitify Solutions — partner inventory RLS + RPCs
-- Migration: 0015_partner_inventory_rls
--
-- Owner-scoped, matching the shape 0002 uses for projects/quotes/orders: a contractor does
-- everything on their own rows (owner_id = auth.uid()), admins see and act across the network.
--
-- The one asymmetry is partner_inventory_movements, which is APPEND-ONLY: it gets SELECT and
-- INSERT policies and deliberately no UPDATE or DELETE policy at all. With RLS on, a command
-- with no permissive policy matches nothing, so an edit or a delete silently affects zero
-- rows — the ledger cannot be rewritten by anyone going through PostgREST, contractor or admin.
--
-- Also here: the ONE crack opened in Phase 1's admin-only wall. Contractors need to browse
-- Kitify's SKU CATALOG to log stock of a Kitify item, so inventory_skus gains a SELECT policy
-- for active, non-sample rows. inventory_stock and inventory_movements gain NOTHING — Kitify's
-- quantities and ledger stay admin-only, which is what keeps "contractors never see Kitify's
-- on-hand" true at the database rather than merely in the UI.
--
-- Depends on 0002 (is_admin), 0012/0013 (Phase 1) and 0014 (the three partner tables).
-- Re-runnable: every policy is dropped first.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() is missing — run 0002_enable_rls.sql before this migration';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- partner_inventory_skus — owner does everything on their own; admins on any.
-- ----------------------------------------------------------------------------
alter table public.partner_inventory_skus enable row level security;

drop policy if exists "partner_inventory_skus_owner_or_admin" on public.partner_inventory_skus;
create policy "partner_inventory_skus_owner_or_admin" on public.partner_inventory_skus
  for all to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- ----------------------------------------------------------------------------
-- partner_inventory_stock — same shape.
-- ----------------------------------------------------------------------------
alter table public.partner_inventory_stock enable row level security;

drop policy if exists "partner_inventory_stock_owner_or_admin" on public.partner_inventory_stock;
create policy "partner_inventory_stock_owner_or_admin" on public.partner_inventory_stock
  for all to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- ----------------------------------------------------------------------------
-- partner_inventory_movements — append-only. SELECT + INSERT only, by design.
--
-- INSERT is granted to admins as well as owners because the admin partner view records
-- movements on a contractor's behalf through the RPC below. (The spec described admins as
-- read-only here while also requiring that they can write on a contractor's behalf; the
-- write is the feature, so the policy allows it and the audit row keeps performed_by =
-- the admin's uuid, which is what makes the action attributable.)
-- ----------------------------------------------------------------------------
alter table public.partner_inventory_movements enable row level security;

drop policy if exists "partner_inventory_movements_select_owner_or_admin" on public.partner_inventory_movements;
create policy "partner_inventory_movements_select_owner_or_admin" on public.partner_inventory_movements
  for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "partner_inventory_movements_insert_owner_or_admin" on public.partner_inventory_movements;
create policy "partner_inventory_movements_insert_owner_or_admin" on public.partner_inventory_movements
  for insert to authenticated
  with check (owner_id = auth.uid() or public.is_admin());

-- No UPDATE policy. No DELETE policy. Intentional — see the header.

-- ----------------------------------------------------------------------------
-- inventory_skus — add the read-only reference catalog for contractors.
--
-- Phase 1 (0013) left this table with a single `for all` admin policy. Policies are OR'd, so
-- adding a SELECT policy widens reads without touching the admin one: admins keep full
-- read/write via inventory_skus_admin_all, and everyone else authenticated gains SELECT on
-- active, non-sample rows only. Retired SKUs stay hidden (a contractor should not log stock
-- of something Kitify no longer carries) and sample SKUs stay hidden (Kitify's sample
-- programme is not a contractor concern).
--
-- This grants the CATALOG, never the QUANTITIES: inventory_stock and inventory_movements are
-- untouched and remain admin-only.
-- ----------------------------------------------------------------------------
drop policy if exists "inventory_skus_select_catalog" on public.inventory_skus;
create policy "inventory_skus_select_catalog" on public.inventory_skus
  for select to authenticated
  using (active and not is_sample);

-- inventory_locations, inventory_stock and inventory_movements are deliberately NOT given
-- any contractor-readable policy. Kitify's warehouse names, on-hand counts and ledger stay
-- admin-only. Do not "helpfully" add one.

-- ============================================================================
-- set_inventory_tracking() — flip the per-contractor feature toggle.
--
-- Why an RPC instead of a plain UPDATE: 0002 gives public.profiles an UPDATE policy of
-- `id = auth.uid()` and no admin equivalent, so an admin updating another contractor's row
-- matches zero rows and the write silently does nothing. The obvious fix — widen profiles
-- UPDATE to `owner or admin`, as 0010 did for orders — would hand admins every column on
-- every profile, `role` and `status` included, to enable one boolean. This function grants
-- exactly the capability needed and nothing more.
--
-- SECURITY DEFINER (so it can bypass the profiles UPDATE policy) + an explicit is_admin()
-- gate + `set search_path = ''` with fully-qualified names, matching how is_admin() itself
-- is hardened in 0002.
-- ============================================================================
create or replace function public.set_inventory_tracking(p_owner_id uuid, p_enabled boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result boolean;
begin
  if not public.is_admin() then
    raise exception 'INVENTORY_FORBIDDEN: admin role required to change inventory tracking'
      using errcode = '42501';
  end if;
  if p_owner_id is null or p_enabled is null then
    raise exception 'INVENTORY_INVALID: owner id and enabled flag are both required'
      using errcode = '22023';
  end if;

  update public.profiles
     set inventory_tracking_enabled = p_enabled
   where id = p_owner_id
  returning inventory_tracking_enabled into v_result;

  if not found then
    raise exception 'INVENTORY_NO_PROFILE: no profile with id %', p_owner_id
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function public.set_inventory_tracking(uuid, boolean) from public;
grant execute on function public.set_inventory_tracking(uuid, boolean) to authenticated;

-- ============================================================================
-- apply_partner_inventory_movements() — the ONLY supported way to change partner stock.
--
-- The partner-side twin of Phase 1's apply_inventory_movements: a jsonb ARRAY applied
-- all-or-none (a plpgsql body is one transaction, so any RAISE rolls the whole batch back),
-- writing the ledger row and the on-hand row together so the two cannot drift apart.
--
-- Each element:
--   { "kitify_sku_id": uuid|null, "partner_sku_id": uuid|null, "location": text,
--     "reason": <inventory_movement_reason>, "delta": int,
--     "reference": text|null, "note": text|null }
-- Exactly one of the two sku columns must be set — the same rule the CHECK constraint
-- enforces, validated here first so the caller gets a legible error instead of a constraint
-- violation.
--
-- SECURITY INVOKER (the default — NOT definer): every statement inside runs under the
-- caller's RLS, so a contractor passing someone else's p_owner_id is rejected by the policies
-- even before the explicit guard below. The guard exists to turn that into a clear error
-- rather than a confusing zero-row result.
--
-- Sign is derived from the reason HERE, not in the browser, exactly as in Phase 1 — the UI
-- always collects a positive quantity and only 'adjustment' is bidirectional.
-- ============================================================================
create or replace function public.apply_partner_inventory_movements(p_owner_id uuid, p_movements jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  m           jsonb;
  v_is_admin  boolean;
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
          (owner_id, kitify_sku_id, partner_sku_id, location, quantity)
        values
          (p_owner_id, v_kitify, v_partner, v_location, 0)
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
      (owner_id, kitify_sku_id, partner_sku_id, location, delta, reason, reference, note, performed_by)
    values
      (p_owner_id, v_kitify, v_partner, v_location, v_delta, v_reason,
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
$$;

revoke all on function public.apply_partner_inventory_movements(uuid, jsonb) from public;
grant execute on function public.apply_partner_inventory_movements(uuid, jsonb) to authenticated;

-- ============================================================================
-- VERIFY (run in the SQL editor after the migration):
--
-- 1. RLS on and policies present:
--      select relname, relrowsecurity from pg_class
--       where relname like 'partner_inventory%';                    -- all true
--      select tablename, policyname, cmd from pg_policies
--       where tablename like 'partner_inventory%' or tablename = 'inventory_skus'
--       order by tablename, cmd;
--      -- partner_inventory_movements: SELECT + INSERT only (no UPDATE/DELETE row)
--      -- inventory_skus: the Phase 1 ALL policy PLUS inventory_skus_select_catalog (SELECT)
--
-- 2. THE CRITICAL CHECK — a contractor can read Kitify's CATALOG but not its STOCK.
--    The SQL editor runs as owner and bypasses RLS, so impersonate:
--      set local role authenticated;
--      set local request.jwt.claims to '{"sub":"<a non-admin profiles.id>","role":"authenticated"}';
--      select count(*) from public.inventory_skus;        -- > 0  (active, non-sample only)
--      select count(*) from public.inventory_skus where is_sample;   -- expect 0
--      select count(*) from public.inventory_stock;       -- EXPECT 0  <- the one that matters
--      select count(*) from public.inventory_movements;   -- EXPECT 0  <- and this one
--      select count(*) from public.inventory_locations;   -- EXPECT 0
--      select public.set_inventory_tracking('<any uuid>', true);     -- expect INVENTORY_FORBIDDEN
--      reset role;
--
-- 3. Cross-contractor isolation:
--      set local role authenticated;
--      set local request.jwt.claims to '{"sub":"<contractor A>","role":"authenticated"}';
--      select count(*) from public.partner_inventory_stock;   -- only A's rows
--      -- and A cannot write to B's ledger:
--      select public.apply_partner_inventory_movements(
--        '<contractor B>'::uuid,
--        '[{"partner_sku_id":"<any>","location":"Truck","reason":"received","delta":1}]'::jsonb);
--      -- expect PARTNER_INVENTORY_FORBIDDEN
--      reset role;
--
-- 4. Ledger is append-only, even for an admin:
--      set local role authenticated;
--      set local request.jwt.claims to '{"sub":"<an admin profiles.id>","role":"authenticated"}';
--      update public.partner_inventory_movements set delta = 999;  -- expect UPDATE 0
--      delete from public.partner_inventory_movements;             -- expect DELETE 0
--      reset role;
-- ============================================================================
