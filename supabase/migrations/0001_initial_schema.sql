-- ============================================================================
-- Kitify Solutions — initial database schema
-- Migration: 0001_initial_schema
--
-- Creates the core tables (profiles, projects, quotes, orders) that back the
-- dealer portal. Column names and enum values mirror the TypeScript types in
-- lib/store.ts so the app can move off localStorage onto Supabase without
-- reshaping any payloads:
--   * projects.status        -> Project.status
--   * projects.job_registration -> Project.jobRegistration
--   * quotes.status          -> Quote.status
--   * quotes.{room,shower,vanity,plumbing} jsonb -> emitted configurator payloads
--
-- Conventions: uuid PKs with gen_random_uuid() defaults, timestamptz timestamps
-- with now() defaults on created_at, and a shared trigger that refreshes
-- updated_at on every UPDATE.
--
-- NOTE: Row-level security is intentionally NOT enabled here. See the block at
-- the bottom — policies land in a later migration once auth is wired, so we can
-- verify table structure first without locking ourselves out.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto. It's preinstalled on Supabase, but make
-- the dependency explicit so this migration is reproducible on a bare Postgres.
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- updated_at helper: a single trigger function reused by every table that has
-- an updated_at column. Refreshes the column to now() on each UPDATE.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- profiles — one row per authenticated user, keyed to Supabase's built-in auth.
-- The id IS the auth.users id (no generated default): a profile is created for
-- an existing auth user, so the two share a primary key.
-- ----------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  email      text not null,
  company    text,
  role       text not null default 'contractor' check (role in ('contractor', 'admin')),
  status     text not null default 'active'      check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- projects — a job for a customer, owned by a dealer (profile). The nested
-- customer/address objects in lib/store.ts are flattened into columns here.
-- ----------------------------------------------------------------------------
create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.profiles (id),
  name             text not null,
  customer_name    text not null,
  customer_phone   text,
  customer_email   text,
  address_street   text,
  address_city     text,
  address_state    text,
  address_zip      text,
  status           text not null default 'estimating'
                     check (status in ('estimating', 'ordered', 'complete', 'lost')),
  job_registration text not null default 'started'
                     check (job_registration in ('not_started', 'started', 'complete')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- quotes — a priced option within a project. The four configurator payloads are
-- stored verbatim as jsonb (nullable: a quote may not include every module).
-- Deleting a project cascades to its quotes.
-- ----------------------------------------------------------------------------
create table public.quotes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id   uuid not null references public.profiles (id),
  name       text not null,
  room       jsonb,
  shower     jsonb,
  vanity     jsonb,
  plumbing   jsonb,
  total      numeric not null default 0,
  status     text not null default 'draft'
               check (status in ('draft', 'sent', 'accepted', 'ordered', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- orders — a placed order that freezes a quote at order time in `snapshot`.
-- ----------------------------------------------------------------------------
create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id),
  quote_id           uuid not null references public.quotes (id),
  owner_id           uuid not null references public.profiles (id),
  order_number       text,
  snapshot           jsonb,
  status             text not null default 'submitted'
                       check (status in ('submitted', 'in_production', 'ready_to_ship', 'in_transit', 'delivered', 'cancelled')),
  carrier            text,
  tracking_number    text,
  estimated_delivery date,
  placed_at          timestamptz,
  shipped_at         timestamptz,
  delivered_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- updated_at triggers (profiles has no updated_at, so it is intentionally omitted)
-- ----------------------------------------------------------------------------
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Foreign-key indexes — these columns are filtered on constantly (list a
-- dealer's projects, a project's quotes, a project's orders, etc.). Primary
-- keys (including profiles.id) are already indexed automatically.
-- ----------------------------------------------------------------------------
create index projects_owner_id_idx on public.projects (owner_id);
create index quotes_project_id_idx on public.quotes (project_id);
create index quotes_owner_id_idx   on public.quotes (owner_id);
create index orders_project_id_idx on public.orders (project_id);
create index orders_quote_id_idx   on public.orders (quote_id);
create index orders_owner_id_idx   on public.orders (owner_id);

-- ============================================================================
-- ROW-LEVEL SECURITY — DEFERRED. DO NOT ENABLE IN THIS MIGRATION.
--
-- RLS is intentionally left OFF here so we can verify table structure first
-- without locking ourselves out before auth is wired. The policies below
-- (dealer-owns-their-rows + admin-sees-all) belong in a SEPARATE, later
-- migration once Supabase auth is connected and profiles are being created.
-- They are shown here, commented out, only as the intended shape.
--
-- Example future migration (do NOT run yet):
--
--   -- Turn RLS on for every table:
--   alter table public.profiles enable row level security;
--   alter table public.projects enable row level security;
--   alter table public.quotes   enable row level security;
--   alter table public.orders   enable row level security;
--
--   -- Helper: is the current user an admin?
--   create or replace function public.is_admin()
--   returns boolean
--   language sql stable
--   as $$
--     select exists (
--       select 1 from public.profiles p
--       where p.id = auth.uid() and p.role = 'admin'
--     );
--   $$;
--
--   -- profiles: a user sees/edits their own row; admins see all.
--   create policy "profiles self or admin (select)" on public.profiles
--     for select using (id = auth.uid() or public.is_admin());
--   create policy "profiles self (update)" on public.profiles
--     for update using (id = auth.uid());
--
--   -- projects / quotes / orders: dealer owns their rows; admins see all.
--   create policy "projects owner or admin (select)" on public.projects
--     for select using (owner_id = auth.uid() or public.is_admin());
--   create policy "projects owner (write)" on public.projects
--     for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
--
--   create policy "quotes owner or admin (select)" on public.quotes
--     for select using (owner_id = auth.uid() or public.is_admin());
--   create policy "quotes owner (write)" on public.quotes
--     for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
--
--   create policy "orders owner or admin (select)" on public.orders
--     for select using (owner_id = auth.uid() or public.is_admin());
--   create policy "orders owner (write)" on public.orders
--     for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- ============================================================================
