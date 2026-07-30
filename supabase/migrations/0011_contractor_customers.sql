-- ============================================================================
-- Kitify Solutions — contractor-level customer CRM
-- Migration: 0011_contractor_customers
--
-- NOTE ON THE NUMBER: this was specced as 0010, but 0010_admin_order_updates.sql already
-- exists (admin order pipeline RLS). Renumbered to 0011 so the sequence stays unique.
--
-- The homeowners a contractor serves — deliberately NOT public.companies, which is the
-- ADMIN CRM entity (permit-pipeline leads/customers that are themselves contractors).
-- Two different levels of the network, two tables:
--     public.companies            → admin's view of contractors/businesses
--     public.contractor_customers → a contractor's own view of their homeowners
--
-- Rows arrive two ways: typed in by hand (source='manual') or auto-created the first time
-- a project is saved carrying a customer email (source='project', project_id set to the
-- project that introduced them — see saveProject in lib/store.ts). The link is by email,
-- matched case-insensitively, so the list builds itself as the contractor works.
--
-- RLS is the same owner-scoped shape as 0002/0003: the owner does everything on
-- owner_id = auth.uid(); admins can read all via public.is_admin(). Note the app still
-- filters by owner_id on read, so an admin browsing this page sees THEIR own customers,
-- not the network's — the admin read policy exists for future reporting, not for the UI.
--
-- Depends on 0001 (set_updated_at, profiles, projects) and 0002 (is_admin).
-- Re-runnable: IF NOT EXISTS / DROP … IF EXISTS throughout.
-- ============================================================================

create table if not exists public.contractor_customers (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id),
  name       text not null,
  email      text,
  phone      text,
  address    jsonb,                     -- {street, city, state, zip}
  notes      text,
  source     text default 'manual',     -- 'manual' | 'project'
  project_id uuid references public.projects (id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists contractor_customers_owner_idx on public.contractor_customers (owner_id);

-- updated_at refresh (reuses the shared trigger function from 0001).
drop trigger if exists contractor_customers_set_updated_at on public.contractor_customers;
create trigger contractor_customers_set_updated_at
  before update on public.contractor_customers
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security — owner does everything, admin reads.
-- ----------------------------------------------------------------------------
alter table public.contractor_customers enable row level security;

drop policy if exists "contractor_customers_select_owner_or_admin" on public.contractor_customers;
create policy "contractor_customers_select_owner_or_admin" on public.contractor_customers
  for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "contractor_customers_insert_owner" on public.contractor_customers;
create policy "contractor_customers_insert_owner" on public.contractor_customers
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "contractor_customers_update_owner" on public.contractor_customers;
create policy "contractor_customers_update_owner" on public.contractor_customers
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "contractor_customers_delete_owner" on public.contractor_customers;
create policy "contractor_customers_delete_owner" on public.contractor_customers
  for delete to authenticated
  using (owner_id = auth.uid());
