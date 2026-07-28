-- ============================================================================
-- Kitify Solutions — enable Row Level Security
-- Migration: 0002_enable_rls
--
-- Turns RLS ON for profiles / projects / quotes / orders and adds owner-scoped
-- policies, based on the shape drafted at the bottom of 0001_initial_schema.sql:
--   • Contractors can read AND write ONLY their own rows.
--   • Admins can READ (select) every row. Admins are NOT granted write access to
--     other users' rows — read-all only, per spec.
--   • Signup can create the signed-in user's own profile row (insert where
--     id = auth.uid()).
--
-- All policies target the `authenticated` role and key off auth.uid() (the current
-- user's uuid from their JWT; NULL when unauthenticated, so anonymous requests match
-- nothing and are denied).
--
-- Re-runnable: the helper is CREATE OR REPLACE, every policy is dropped first, and
-- ENABLE ROW LEVEL SECURITY is idempotent — running this twice is harmless.
--
-- Note: RLS is NOT forced (no FORCE ROW LEVEL SECURITY), so the table owner /
-- service_role still bypass it — the Supabase SQL editor can still see all rows,
-- which is what lets you verify the data is really there after enabling RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- is_admin(): true when the current authenticated user's profiles.role is 'admin'.
--
-- SECURITY DEFINER so the function runs as its owner (postgres) and is therefore NOT
-- subject to RLS on profiles. This is what prevents infinite recursion: the profiles
-- SELECT policy calls is_admin(), which reads profiles — if that read re-triggered the
-- profiles policy we'd recurse. Running as definer (which bypasses RLS) breaks the loop.
--
-- `set search_path = ''` + fully-qualified names harden the definer function against
-- search-path hijacking. Returns false for anonymous users (auth.uid() IS NULL).
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ----------------------------------------------------------------------------
-- profiles — a user sees/edits/creates only their own row; admins can read all.
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Signup / first-sign-in creates the user's OWN profile (id must equal auth.uid()).
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ----------------------------------------------------------------------------
-- projects — owner can select/insert/update/delete their own; admins can read all.
-- ----------------------------------------------------------------------------
alter table public.projects enable row level security;

drop policy if exists "projects_select_owner_or_admin" on public.projects;
create policy "projects_select_owner_or_admin" on public.projects
  for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "projects_insert_owner" on public.projects;
create policy "projects_insert_owner" on public.projects
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "projects_update_owner" on public.projects;
create policy "projects_update_owner" on public.projects
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "projects_delete_owner" on public.projects;
create policy "projects_delete_owner" on public.projects
  for delete to authenticated
  using (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- quotes — same owner pattern; admins can read all. (Quotes are also removed via the
-- projects ON DELETE CASCADE, which runs at the system level and isn't blocked by RLS.)
-- ----------------------------------------------------------------------------
alter table public.quotes enable row level security;

drop policy if exists "quotes_select_owner_or_admin" on public.quotes;
create policy "quotes_select_owner_or_admin" on public.quotes
  for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "quotes_insert_owner" on public.quotes;
create policy "quotes_insert_owner" on public.quotes
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "quotes_update_owner" on public.quotes;
create policy "quotes_update_owner" on public.quotes
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "quotes_delete_owner" on public.quotes;
create policy "quotes_delete_owner" on public.quotes
  for delete to authenticated
  using (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- orders — same owner pattern; admins can read all.
-- ----------------------------------------------------------------------------
alter table public.orders enable row level security;

drop policy if exists "orders_select_owner_or_admin" on public.orders;
create policy "orders_select_owner_or_admin" on public.orders
  for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "orders_insert_owner" on public.orders;
create policy "orders_insert_owner" on public.orders
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "orders_update_owner" on public.orders;
create policy "orders_update_owner" on public.orders
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "orders_delete_owner" on public.orders;
create policy "orders_delete_owner" on public.orders
  for delete to authenticated
  using (owner_id = auth.uid());

-- ============================================================================
-- Verify after running (optional):
--   • As the app (signed-in contractor): you should see only your own projects/quotes.
--   • In the SQL editor (runs as owner, bypasses RLS): select count(*) should still
--     show every row — proving the data is intact, just filtered for the app.
--   • select public.is_admin();  -- run while impersonating a user via the API, not here
-- ============================================================================
