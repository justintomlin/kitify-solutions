-- ============================================================================
-- Kitify Solutions — profile onboarding (admin-created contractors)
-- Migration: 0007_profile_onboarding
--
-- Adds the fields for the admin "Add Contractor" flow: contact/territory details plus
-- two onboarding gates the contractor must clear on first login.
--   • must_change_password — true on admin-created accounts (they log in with a temp
--     password and are forced to set a permanent one).
--   • profile_confirmed    — the contractor must confirm their info on first login.
--   • invited_at / first_login_at — invite + first-login timestamps.
--
-- Existing accounts (created before this flow) must NOT be forced into onboarding. They're
-- identified by invited_at IS NULL (admin-invited contractors always carry invited_at), so
-- the backfill below is safe to re-run: it only ever touches non-invited rows.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS everywhere; the backfill is scoped to invited_at IS NULL.
-- ============================================================================

alter table public.profiles
  add column if not exists phone                text,
  add column if not exists territory            text,   -- city / state / region
  add column if not exists must_change_password boolean not null default false,
  add column if not exists profile_confirmed    boolean not null default false,
  add column if not exists invited_at           timestamptz,
  add column if not exists first_login_at        timestamptz;

-- Exempt pre-existing accounts from onboarding (never touches admin-invited contractors,
-- which always have invited_at set — so this stays correct on a re-run).
update public.profiles
  set must_change_password = false,
      profile_confirmed = true
  where invited_at is null;
