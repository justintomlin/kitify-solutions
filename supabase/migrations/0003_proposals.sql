-- ============================================================================
-- Kitify Solutions — proposals (shareable, tiered)
-- Migration: 0003_proposals
--
-- A proposal bundles up to three quotes (good / better / best tiers) for one
-- project and can be shared with a homeowner via a revocable `share_token`.
--   • share_token is UNIQUE and NULLABLE — NULL means "not shared / revoked".
--   • A public server route reads a shared proposal past RLS using the service_role
--     key (see app/api/proposal/[token]/route.ts); the browser never gets that key.
--
-- Depends on 0001 (set_updated_at trigger fn) and 0002 (is_admin helper). RLS mirrors
-- the exact owner-scoped pattern from 0002_enable_rls.sql: contractors read/write only
-- their own proposals; admins can read all.
--
-- Re-runnable: table/trigger/index are idempotent, and every policy is dropped before
-- create, so running this twice is harmless.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- proposals
-- ----------------------------------------------------------------------------
create table if not exists public.proposals (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles (id),
  project_id        uuid not null references public.projects (id) on delete cascade,
  name              text not null,
  -- Revocable public share handle. UNIQUE so a token maps to at most one proposal;
  -- NULL = not shared / revoked (so it can never be looked up publicly).
  share_token       text unique,
  markup_pct        numeric not null default 0,
  -- The three tier quotes (any may be unset). Plain references — deleting a quote that a
  -- proposal still points at is blocked rather than silently emptying a tier.
  tier_good         uuid references public.quotes (id),
  tier_better       uuid references public.quotes (id),
  tier_best         uuid references public.quotes (id),
  -- Which tier the homeowner accepted, and who/when (captured at accept time).
  accepted_quote_id uuid references public.quotes (id),
  accepted_by       text,
  accepted_at       timestamptz,
  status            text not null default 'draft'
                      check (status in ('draft', 'shared', 'accepted', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- updated_at refresh (reuses the shared trigger function from 0001).
drop trigger if exists proposals_set_updated_at on public.proposals;
create trigger proposals_set_updated_at
  before update on public.proposals
  for each row execute function public.set_updated_at();

-- Indexes: public reads look up by share_token; the app lists a contractor's proposals
-- by owner_id. (share_token is already backed by its UNIQUE index; owner_id is added here.)
create index if not exists proposals_owner_id_idx on public.proposals (owner_id);
create index if not exists proposals_share_token_idx on public.proposals (share_token);

-- ----------------------------------------------------------------------------
-- Row Level Security — same owner-scoped shape as 0002 (owner does everything on
-- owner_id = auth.uid(); admins can read all via is_admin()). RLS is NOT forced, so
-- the service_role client used by the public route still bypasses it.
-- ----------------------------------------------------------------------------
alter table public.proposals enable row level security;

drop policy if exists "proposals_select_owner_or_admin" on public.proposals;
create policy "proposals_select_owner_or_admin" on public.proposals
  for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "proposals_insert_owner" on public.proposals;
create policy "proposals_insert_owner" on public.proposals
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "proposals_update_owner" on public.proposals;
create policy "proposals_update_owner" on public.proposals
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "proposals_delete_owner" on public.proposals;
create policy "proposals_delete_owner" on public.proposals
  for delete to authenticated
  using (owner_id = auth.uid());

-- ============================================================================
-- Note: the public homeowner read does NOT go through these policies. It runs in a
-- server route with the service_role key (RLS-bypassing) and hand-filters to a safe,
-- minimal payload — precisely because an anonymous homeowner has no auth.uid() and so
-- would match none of the authenticated-only policies above.
-- ============================================================================
