-- ============================================================================
-- Kitify Solutions — admins can advance orders through the pipeline
-- Migration: 0010_admin_order_updates
--
-- 0002 gave orders an owner-only UPDATE policy (owner_id = auth.uid()). That's correct for
-- contractors, but it also blocks the admin fulfilment controls on the order detail page:
-- confirm → production → ready to ship → shipped → delivered (plus cancel) all run as the
-- signed-in admin against another contractor's row, so RLS matched nothing and the write
-- failed. This widens UPDATE to "owner or admin", matching the SELECT policy that has
-- allowed admins to read every order since 0002.
--
-- INSERT and DELETE are deliberately left owner-only: an admin moves an existing order
-- along, they don't create or destroy one (cancellation is a status change, never a row
-- delete — see updateOrderStatus in lib/store.ts).
--
-- Re-runnable: both the old and the new policy name are dropped first.
-- ============================================================================

drop policy if exists "orders_update_owner" on public.orders;
drop policy if exists "orders_update_owner_or_admin" on public.orders;

create policy "orders_update_owner_or_admin" on public.orders
  for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
