-- ============================================================================
-- Kitify Solutions — orders foundation
-- Migration: 0005_orders_full
--
-- The orders table already exists (0001) with: id, project_id, quote_id, owner_id,
-- order_number, snapshot, status (+ shipping/tracking + timestamps). This migration adds
-- the order-hub columns (customer snapshot, fulfilment/warranty, lifecycle timestamps),
-- and hardens the two key fields:
--   • adds proposal_id (nullable FK → proposals) — the accepted proposal an order came
--     from (nullable so future orders can exist without a proposal) — plus the customer_*,
--     warranty_*, delivery/install, completion_photos, notes and confirmed/completed cols.
--   • order_number becomes UNIQUE NOT NULL, auto-generated at insert as KIT-YYYYMM-NNNN
--     (NNNN = a per-month sequence) by a race-safe DB trigger — never set by the client.
--   • snapshot becomes NOT NULL (an order always freezes its data).
--
-- owner_id keeps its existing FK to profiles(id) (which equals auth.users.id) — every
-- table and all RLS policies key off profiles(id); it is NOT re-pointed at auth.users.
-- Existing 0002/0003-style RLS (owner CRUD + admin read via is_admin()) already covers the
-- orders table, and applies to the new columns automatically — no policy changes needed.
--
-- Re-runnable: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS throughout, and
-- the SET NOT NULLs are no-ops once applied.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- New columns (all via ADD COLUMN IF NOT EXISTS — idempotent). proposal_id is a
-- nullable FK; the rest are the customer snapshot, fulfilment/warranty tracking, and
-- lifecycle timestamps from the order-hub data model.
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists proposal_id           uuid references public.proposals (id),
  add column if not exists customer_name         text,
  add column if not exists customer_email        text,
  add column if not exists customer_phone        text,
  add column if not exists customer_address      jsonb,   -- {street, city, state, zip}
  add column if not exists actual_delivery       date,
  add column if not exists install_date          date,
  add column if not exists completion_photos     jsonb,   -- array of storage URLs
  add column if not exists warranty_status       text not null default 'unregistered'
                             check (warranty_status in ('unregistered', 'registered', 'claim_open', 'claim_resolved')),
  add column if not exists warranty_registered_at timestamptz,
  add column if not exists notes                 text,
  add column if not exists confirmed_at          timestamptz,
  add column if not exists completed_at          timestamptz;

create index if not exists orders_proposal_id_idx on public.orders (proposal_id);

-- ----------------------------------------------------------------------------
-- Pipeline: let a proposal advance to 'ordered' once converted. Deliberately NOT
-- 'archived' — the read + accept routes exclude only 'archived', so an 'ordered'
-- proposal's public confirmation link keeps working. Re-runnable via drop-if-exists.
-- ----------------------------------------------------------------------------
alter table public.proposals drop constraint if exists proposals_status_check;
alter table public.proposals add constraint proposals_status_check
  check (status in ('draft', 'shared', 'accepted', 'ordered', 'archived'));

-- ----------------------------------------------------------------------------
-- Order number generation — KIT-YYYYMM-NNNN, sequence resets each calendar month.
--
-- A tiny counter table holds the last sequence per YYYYMM period. next_order_number()
-- bumps it atomically via INSERT … ON CONFLICT DO UPDATE … RETURNING, which takes a row
-- lock on the period row — so concurrent inserts serialize and never collide. It's
-- SECURITY DEFINER (runs as the owner) so it can write the counter regardless of RLS.
-- ----------------------------------------------------------------------------
create table if not exists public.order_number_counters (
  period   text primary key,           -- 'YYYYMM'
  last_seq integer not null default 0
);

-- Lock the counter table down: RLS on, no policies → no client can read/write it
-- directly. Only the SECURITY DEFINER function (as owner) and service_role touch it.
alter table public.order_number_counters enable row level security;

create or replace function public.next_order_number()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_period text := to_char(now(), 'YYYYMM');
  v_seq    integer;
begin
  insert into public.order_number_counters as c (period, last_seq)
    values (v_period, 1)
  on conflict (period) do update
    set last_seq = c.last_seq + 1
  returning c.last_seq into v_seq;
  return 'KIT-' || v_period || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- BEFORE INSERT trigger: assign an order number when the row doesn't already carry one.
-- The client never supplies order_number, so it's always generated here.
create or replace function public.orders_set_order_number()
returns trigger
language plpgsql
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := public.next_order_number();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_order_number on public.orders;
create trigger orders_set_order_number
  before insert on public.orders
  for each row execute function public.orders_set_order_number();

-- ----------------------------------------------------------------------------
-- Enforce order_number UNIQUE NOT NULL and snapshot NOT NULL.
-- Backfill any pre-existing rows first (there normally are none) so SET NOT NULL is safe.
-- ----------------------------------------------------------------------------
update public.orders set order_number = public.next_order_number() where order_number is null or order_number = '';
update public.orders set snapshot = '{}'::jsonb where snapshot is null;

alter table public.orders alter column order_number set not null;
alter table public.orders alter column snapshot     set not null;

create unique index if not exists orders_order_number_key on public.orders (order_number);
