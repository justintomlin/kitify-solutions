-- ============================================================================
-- Kitify Solutions — inventory management, Phase 1 (schema + seed)
-- Migration: 0012_inventory
--
-- Kitify's OWN stock: the SKU/component-level pieces we physically hold (wall panels,
-- install parts, plumbing fixtures) plus our sample stock (kits and individual pieces).
-- Admin-only in every respect — RLS lands in 0013_inventory_rls.sql, which also carries
-- the RPC that is the ONLY supported way to change stock.
--
-- Four tables:
--   inventory_locations  where stock physically sits (one seeded default; multi-location ready)
--   inventory_skus       the OPS catalog — deliberately separate from the pricing/vanity/
--                        plumbing/durasein catalogs in lib/*-catalog.ts. Those describe what
--                        we SELL; this describes what we SHIP, and is admin-maintained by hand.
--   inventory_stock      current on-hand per (sku, location) — derived from movements but
--                        materialised, so the dashboard reads one row per pair instead of
--                        summing the whole audit log.
--   inventory_movements  the append-only audit log. Every stock change writes one row here.
--
-- Deliberately NOT in this phase (see the Phase notes at the bottom):
--   • no reservations, no contractor/customer visibility of Kitify stock at any surface
--   • no coupling to orders/quotes/proposals — admins decrement by hand when they ship
--   • none of the five existing tables (profiles, projects, quotes, orders, proposals) change
--
-- Depends on 0001 (profiles, set_updated_at) and 0002 (is_admin, used by 0013).
-- Re-runnable: IF NOT EXISTS / guarded enum creation / idempotent seed throughout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums. Wrapped in a DO block because Postgres has no CREATE TYPE IF NOT EXISTS,
-- and this migration is meant to be safe to paste twice.
-- ----------------------------------------------------------------------------
do $$
begin
  create type public.inventory_category as enum (
    'wall-panel', 'plumbing', 'install-part', 'vanity', 'base',
    'trim', 'accessory', 'sample-kit', 'sample-piece', 'other'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.inventory_movement_reason as enum (
    'received',          -- +  stock arrived from a supplier
    'shipped',           -- -  sent out against an order
    'sample_sent',       -- -  sample kit or piece sent to a contractor/prospect
    'sample_replenish',  -- +  sample stock topped back up
    'adjustment',        -- ±  manual correction / cycle count / inter-location move
    'damaged',           -- -  written off damaged
    'lost',              -- -  written off missing
    'initial'            -- +  opening balance when a SKU is first tracked
  );
exception
  when duplicate_object then null;
end
$$;

-- ----------------------------------------------------------------------------
-- inventory_locations — where stock sits.
--
-- `active` is not in the original column sketch but the Locations screen has to be able to
-- retire a location without deleting it (deleting would orphan historical movements, which
-- reference location_id and must stay readable forever). Same retire-don't-delete reasoning
-- as inventory_skus.active.
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- inventory_skus — the ops-level catalog of trackable items.
--
-- `sku` is free-form and unique: "SPC-AB-24x94.5", "DELTA-T14262". No format is imposed
-- because these mirror whatever the supplier prints on the box.
--
-- Samples are SKUs like anything else; `is_sample` distinguishes them. A sample KIT is
-- is_sample = true AND category = 'sample-kit', and its `sample_kit_contents` lists the
-- child sample SKUs it is composed of:
--     [{"sku_id": "<uuid>", "qty": 1}, ...]
-- Children are themselves is_sample = true with a category OTHER than 'sample-kit' (kits
-- do not nest). The contents list is a DECLARATION of what the kit normally contains — it
-- is not itself stock. Shipping a kit decrements the child pieces, which is what the
-- "ship a sample kit" flow in the admin UI expands to.
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_skus (
  id                    uuid primary key default gen_random_uuid(),
  sku                   text not null unique,
  name                  text not null,
  category              public.inventory_category not null default 'other',
  subcategory           text,                       -- free-form: "SPC", "HPL", "Kaolifina", "Nature Panel"
  uom                   text not null default 'each',
  default_cost_cents    integer,                    -- cost basis if known; cents, never floats
  default_ship_weight_g integer,
  dimensions_note       text,                       -- free-form, "24×94.5×0.16in" style
  is_sample             boolean not null default false,
  sample_kit_contents   jsonb,                      -- kits only; see the note above
  active                boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint inventory_skus_uom_check
    check (uom in ('each', 'box', 'sheet', 'pair', 'set')),
  constraint inventory_skus_cost_check
    check (default_cost_cents is null or default_cost_cents >= 0),
  constraint inventory_skus_weight_check
    check (default_ship_weight_g is null or default_ship_weight_g >= 0)
);

create index if not exists inventory_skus_category_idx    on public.inventory_skus (category);
create index if not exists inventory_skus_active_idx      on public.inventory_skus (active);
create index if not exists inventory_skus_is_sample_idx   on public.inventory_skus (is_sample);

drop trigger if exists inventory_skus_set_updated_at on public.inventory_skus;
create trigger inventory_skus_set_updated_at
  before update on public.inventory_skus
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- inventory_stock — on-hand per SKU per location.
--
-- quantity >= 0 is the ONE hard block in this system (everything else warns rather than
-- refuses). The RPC in 0013 pre-checks and raises a friendlier error before this constraint
-- can fire, but the constraint is the backstop that keeps the invariant true no matter how
-- a row is written.
--
-- on delete restrict for location_id: a location with stock cannot be deleted out from
-- under its rows. The Locations screen deactivates instead.
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_stock (
  id                uuid primary key default gen_random_uuid(),
  sku_id            uuid not null references public.inventory_skus (id) on delete cascade,
  location_id       uuid not null references public.inventory_locations (id) on delete restrict,
  quantity          integer not null default 0,
  reorder_threshold integer,                        -- null = no low-stock alerting for this pair
  updated_at        timestamptz not null default now(),
  constraint inventory_stock_quantity_check  check (quantity >= 0),
  constraint inventory_stock_threshold_check check (reorder_threshold is null or reorder_threshold >= 0),
  constraint inventory_stock_sku_location_key unique (sku_id, location_id)
);

create index if not exists inventory_stock_sku_idx      on public.inventory_stock (sku_id);
create index if not exists inventory_stock_location_idx on public.inventory_stock (location_id);

drop trigger if exists inventory_stock_set_updated_at on public.inventory_stock;
create trigger inventory_stock_set_updated_at
  before update on public.inventory_stock
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- inventory_movements — the append-only audit log and the historical record.
--
-- delta is SIGNED and already reason-consistent when written by the RPC: positive for
-- received / sample_replenish / initial, negative for shipped / sample_sent / damaged /
-- lost, either sign for adjustment. delta <> 0 because a no-op movement is a data-entry
-- mistake, not a fact worth recording.
--
-- performed_by is ON DELETE SET NULL rather than a hard reference: the audit row must
-- outlive the admin account that created it.
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_movements (
  id           uuid primary key default gen_random_uuid(),
  sku_id       uuid not null references public.inventory_skus (id) on delete cascade,
  location_id  uuid not null references public.inventory_locations (id) on delete restrict,
  delta        integer not null,
  reason       public.inventory_movement_reason not null,
  reference    text,                                -- order #, PO #, ship-to — free-form, labelled by reason in the UI
  note         text,
  performed_by uuid references public.profiles (id) on delete set null,
  performed_at timestamptz not null default now(),
  constraint inventory_movements_delta_check check (delta <> 0)
);

create index if not exists inventory_movements_sku_time_idx on public.inventory_movements (sku_id, performed_at desc);
create index if not exists inventory_movements_time_idx     on public.inventory_movements (performed_at desc);
create index if not exists inventory_movements_reason_idx   on public.inventory_movements (reason);

-- ============================================================================
-- SEED — one location and ONE smoke-test SKU.
--
-- Deliberately minimal. The ops SKU list is NOT auto-seeded from lib/plumbing-catalog.ts,
-- lib/durasein-catalog.ts or any other sales catalog: those describe sellable configurations,
-- this describes shippable pieces, and conflating them would put hundreds of rows we do not
-- stock into the on-hand view. Admins build this catalog by hand.
--
-- Both inserts are guarded by NOT EXISTS so re-running the migration will not duplicate
-- them and will not clobber a renamed location.
-- ============================================================================
insert into public.inventory_locations (name, notes)
select 'Kitify Main', 'Default location created with the inventory system — rename to the real warehouse.'
where not exists (select 1 from public.inventory_locations);

insert into public.inventory_skus (sku, name, category, subcategory, uom, dimensions_note, notes)
select 'SPC-AB-24x94.5',
       'SPC Wall Panel — Amber Beige',
       'wall-panel',
       'SPC',
       'each',
       '24×94.5×0.16in',
       'Seed SKU created with the inventory system as a smoke test.'
where not exists (select 1 from public.inventory_skus where sku = 'SPC-AB-24x94.5');

-- ============================================================================
-- Verify after running:
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name like 'inventory%';
--   -- expect: inventory_locations, inventory_movements, inventory_skus, inventory_stock
--
--   select name from public.inventory_locations;   -- expect: Kitify Main
--   select sku, name from public.inventory_skus;   -- expect: SPC-AB-24x94.5
--
-- Then run 0013_inventory_rls.sql — until it does, these tables have RLS OFF and are
-- readable by any authenticated client. Do not stop between the two migrations.
-- ============================================================================

-- ============================================================================
-- PHASE NOTES (context for whoever picks this up next — none of this is built):
--   Phase 2 adds partner inventory as a SEPARATE partner_inventory_items table with an
--     owner shape, precisely so contractors adding arbitrary SKUs cannot pollute this
--     Kitify-owned catalog. Nothing here needs to change to accommodate it.
--   Phase 3+ adds sourcing automation (CSV/PO import — the movement RPC already accepts a
--     batch, which is the seam), the order-inventory coupling, and cross-SKU historical
--     reporting UI. inventory_movements is already the complete historical record; until
--     that UI exists, custom cuts are queried directly in the SQL editor.
-- ============================================================================
