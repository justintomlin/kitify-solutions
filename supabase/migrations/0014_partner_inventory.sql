-- ============================================================================
-- Kitify Solutions — partner inventory, Phase 2 (schema)
-- Migration: 0014_partner_inventory
--
-- "Inventory tracking": a contractor logs THEIR OWN on-hand stock, behind a per-contractor
-- toggle an admin sets from the CRM. Three new tables, all owner-scoped, all deliberately
-- SEPARATE from the Phase 1 Kitify tables:
--
--     public.inventory_skus          Kitify's ops catalog   (Phase 1 — untouched here)
--     public.inventory_stock         Kitify's on-hand       (Phase 1 — NEVER visible to a contractor)
--     public.inventory_movements     Kitify's ledger        (Phase 1 — NEVER visible to a contractor)
--
--     public.partner_inventory_skus       a contractor's OWN catalog
--     public.partner_inventory_stock      a contractor's on-hand
--     public.partner_inventory_movements  a contractor's ledger
--
-- The separation is the point: contractors coining arbitrary SKUs must not pollute the
-- Kitify catalog, and their ledger must not co-mingle with Kitify's. What they CAN do is
-- reference a Kitify catalog entry — "I hold 12 of Kitify's SPC-AB-24x94.5" — which is why
-- the stock and movement rows carry two nullable SKU columns with a CHECK enforcing exactly
-- one. Referencing the catalog gives them the sku/name/dimensions; it never gives them
-- Kitify's quantities (that gate is RLS, in 0015).
--
-- Locations are free text ("Truck", "Shop", "Miller job") — no partner_inventory_locations
-- table this phase. Contractors have simple needs and a formal location table is overkill;
-- Phase 3 can add one without touching this shape.
--
-- No seed rows: partner inventory is entirely contractor-created, and the feature toggle
-- defaults to false, so nothing turns on for anyone until an admin flips it.
--
-- Depends on 0001 (profiles, set_updated_at) and 0012 (inventory_category,
-- inventory_movement_reason, inventory_skus). Re-runnable throughout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The feature toggle. Defaults false, so every existing contractor keeps the
--    portal exactly as it is until an admin turns tracking on for them.
--
--    NOTE: no RLS change on profiles. 0002 gives profiles an UPDATE policy of
--    id = auth.uid() ONLY — there is no admin-update policy — so an admin cannot write
--    this column on someone else's row through a plain UPDATE. Rather than widen profiles
--    UPDATE to admins (which would hand them every column, `role` included), 0015 adds a
--    narrowly-scoped set_inventory_tracking() RPC that can flip THIS COLUMN AND NOTHING ELSE.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists inventory_tracking_enabled boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2. partner_inventory_skus — the contractor's own catalog.
--
-- UNIQUE (owner_id, sku): scoped per contractor, so two contractors can each independently
-- coin "SPC-AB-24x94.5" without colliding. UNIQUE (id, owner_id) is redundant on its own
-- (id is already the PK) but it is what lets the stock and movement tables carry a COMPOSITE
-- foreign key on (partner_sku_id, owner_id) — which is what makes it structurally impossible
-- for contractor A to attach a stock row to contractor B's SKU. Without it, the FK would only
-- prove the SKU exists, not that it belongs to the owner writing the row.
--
-- No sample columns: is_sample / sample_kit_contents are Kitify concepts. Contractors do not
-- ship sample kits, so the fields would be dead weight on every row.
-- ----------------------------------------------------------------------------
create table if not exists public.partner_inventory_skus (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles (id) on delete cascade,
  sku                   text not null,
  name                  text not null,
  category              public.inventory_category not null default 'other',
  subcategory           text,
  uom                   text not null default 'each',
  default_cost_cents    integer,
  default_ship_weight_g integer,
  dimensions_note       text,
  notes                 text,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint partner_inventory_skus_uom_check
    check (uom in ('each', 'box', 'sheet', 'pair', 'set')),
  constraint partner_inventory_skus_cost_check
    check (default_cost_cents is null or default_cost_cents >= 0),
  constraint partner_inventory_skus_weight_check
    check (default_ship_weight_g is null or default_ship_weight_g >= 0),
  constraint partner_inventory_skus_owner_sku_key unique (owner_id, sku),
  constraint partner_inventory_skus_id_owner_key  unique (id, owner_id)
);

create index if not exists partner_inventory_skus_owner_idx    on public.partner_inventory_skus (owner_id);
create index if not exists partner_inventory_skus_category_idx on public.partner_inventory_skus (category);
create index if not exists partner_inventory_skus_active_idx   on public.partner_inventory_skus (active);

drop trigger if exists partner_inventory_skus_set_updated_at on public.partner_inventory_skus;
create trigger partner_inventory_skus_set_updated_at
  before update on public.partner_inventory_skus
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. partner_inventory_stock — on-hand per contractor per SKU per (free-text) location.
--
-- The exactly-one-SKU CHECK uses `<>` on two boolean tests, which is XOR: true when exactly
-- one side is set, false when both are set AND when neither is.
--
-- `location` is NOT NULL with a default rather than nullable, because the uniqueness rule
-- below has to treat it as a real key part — NULLs compare as distinct in a unique index, so
-- a nullable location would silently permit duplicate rows for the same SKU.
-- ----------------------------------------------------------------------------
create table if not exists public.partner_inventory_stock (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles (id) on delete cascade,
  kitify_sku_id     uuid references public.inventory_skus (id) on delete restrict,
  partner_sku_id    uuid,
  location          text not null default 'Main',
  quantity          integer not null default 0,
  reorder_threshold integer,
  updated_at        timestamptz not null default now(),
  constraint partner_inventory_stock_one_sku_check
    check ((kitify_sku_id is not null) <> (partner_sku_id is not null)),
  constraint partner_inventory_stock_quantity_check  check (quantity >= 0),
  constraint partner_inventory_stock_threshold_check check (reorder_threshold is null or reorder_threshold >= 0),
  constraint partner_inventory_stock_location_check  check (btrim(location) <> ''),
  -- Composite FK: the partner SKU must belong to the SAME owner as this stock row.
  constraint partner_inventory_stock_partner_sku_fkey
    foreign key (partner_sku_id, owner_id)
    references public.partner_inventory_skus (id, owner_id)
    on delete cascade
);

-- One row per contractor per SKU per location. COALESCE folds the two nullable SKU columns
-- into the single "which item is this" key — exactly one is ever set, so the coalesce is
-- unambiguous. lower(btrim(...)) on the location means "Truck", "truck" and " Truck " are the
-- same place: without it a typo silently splits a contractor's on-hand across phantom rows.
create unique index if not exists partner_inventory_stock_unique_idx
  on public.partner_inventory_stock (
    owner_id,
    (coalesce(kitify_sku_id, partner_sku_id)),
    (lower(btrim(location)))
  );

create index if not exists partner_inventory_stock_owner_idx      on public.partner_inventory_stock (owner_id);
create index if not exists partner_inventory_stock_kitify_sku_idx on public.partner_inventory_stock (kitify_sku_id);
create index if not exists partner_inventory_stock_partner_sku_idx on public.partner_inventory_stock (partner_sku_id);

drop trigger if exists partner_inventory_stock_set_updated_at on public.partner_inventory_stock;
create trigger partner_inventory_stock_set_updated_at
  before update on public.partner_inventory_stock
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. partner_inventory_movements — the contractor's append-only ledger.
--
-- `location` is captured at movement time rather than joined from the stock row: the stock
-- row can be renamed or removed, and an audit entry that changes its own history retroactively
-- is not an audit entry.
--
-- Reuses the Phase 1 reason enum. Contractors never write 'sample_sent' / 'sample_replenish'
-- — that is enforced in the RPC (0015), not by a CHECK, because an ADMIN acting on a
-- contractor's behalf is a legitimate (if unusual) reason to record one.
-- ----------------------------------------------------------------------------
create table if not exists public.partner_inventory_movements (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  kitify_sku_id  uuid references public.inventory_skus (id) on delete restrict,
  partner_sku_id uuid,
  location       text not null default 'Main',
  delta          integer not null,
  reason         public.inventory_movement_reason not null,
  reference      text,
  note           text,
  performed_by   uuid references public.profiles (id) on delete set null,
  performed_at   timestamptz not null default now(),
  constraint partner_inventory_movements_one_sku_check
    check ((kitify_sku_id is not null) <> (partner_sku_id is not null)),
  constraint partner_inventory_movements_delta_check check (delta <> 0),
  constraint partner_inventory_movements_partner_sku_fkey
    foreign key (partner_sku_id, owner_id)
    references public.partner_inventory_skus (id, owner_id)
    on delete cascade
);

create index if not exists partner_inventory_movements_owner_time_idx
  on public.partner_inventory_movements (owner_id, performed_at desc);
create index if not exists partner_inventory_movements_owner_idx       on public.partner_inventory_movements (owner_id);
create index if not exists partner_inventory_movements_kitify_sku_idx  on public.partner_inventory_movements (kitify_sku_id);
create index if not exists partner_inventory_movements_partner_sku_idx on public.partner_inventory_movements (partner_sku_id);
create index if not exists partner_inventory_movements_reason_idx      on public.partner_inventory_movements (reason);

-- ============================================================================
-- Verify after running:
--   select column_name from information_schema.columns
--    where table_name = 'profiles' and column_name = 'inventory_tracking_enabled';   -- 1 row
--
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name like 'partner_inventory%';
--   -- expect: partner_inventory_movements, partner_inventory_skus, partner_inventory_stock
--
--   select count(*) from public.profiles where inventory_tracking_enabled;  -- expect 0
--
-- Then run 0015_partner_inventory_rls.sql. Until it does, these three tables have RLS OFF
-- and are readable by any authenticated client. Do not stop between the two migrations.
-- ============================================================================

-- ============================================================================
-- PHASE 3 NOTES (context — none of this is built):
--   Sourcing automation (CSV import), order-inventory coupling (auto-decrement on ship),
--   cross-SKU historical reporting UI, and a formal partner locations table all slot in
--   without changing this shape: owner_id scopes every partner row, and the separate
--   movement table means an order-triggered write lands in exactly one ledger.
-- ============================================================================
