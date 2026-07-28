-- ============================================================================
-- Kitify Solutions — proposal acceptance
-- Migration: 0004_proposal_acceptance
--
-- Adds the columns the homeowner accept flow writes. `accepted_by` and `accepted_at`
-- already exist from 0003 — ADD COLUMN IF NOT EXISTS makes this safe/idempotent and
-- only adds the three genuinely new columns (accepted_tier / _email / _phone).
--
-- All nullable: they're populated only when a homeowner accepts a shared proposal
-- (status flips 'shared' → 'accepted'). The accept is one-way — there is no undo; a
-- contractor would create a new proposal instead.
--
-- Re-runnable: IF NOT EXISTS on every column.
-- ============================================================================

alter table public.proposals
  add column if not exists accepted_tier  text,        -- 'good' | 'better' | 'best'
  add column if not exists accepted_by    text,        -- homeowner full name (already from 0003)
  add column if not exists accepted_email text,        -- homeowner email
  add column if not exists accepted_phone text,        -- homeowner phone (optional)
  add column if not exists accepted_at    timestamptz; -- when accepted (already from 0003)

-- No RLS changes needed: the public accept path runs server-side with the service_role
-- key (RLS-bypassing), and the existing owner/admin policies from 0002/0003 already cover
-- contractor reads of the accepted_* columns in the portal.
