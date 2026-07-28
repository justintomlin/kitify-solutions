-- ============================================================================
-- Kitify Solutions — order status lifecycle
-- Migration: 0006_order_statuses
--
-- The orders foundation (0001) allowed: submitted, in_production, ready_to_ship,
-- in_transit, delivered, cancelled. The Orders hub introduces two more lifecycle
-- states that the timeline + contractor actions rely on:
--   • 'confirmed'  — between submitted and in_production (admin advances it later)
--   • 'completed'  — the contractor's terminal state after delivery + install
--
-- Full ordered lifecycle:
--   submitted → confirmed → in_production → ready_to_ship → in_transit → delivered
--   → completed   (plus 'cancelled' at any point)
--
-- Re-runnable: drop-if-exists then add.
-- ============================================================================

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in (
    'submitted', 'confirmed', 'in_production', 'ready_to_ship',
    'in_transit', 'delivered', 'completed', 'cancelled'
  ));
