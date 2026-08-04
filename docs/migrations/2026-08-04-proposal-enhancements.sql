-- Proposal enhancements: labour & extras, partner branding, send tracking.
-- Run in the Supabase SQL editor. Safe to re-run (every statement is IF NOT EXISTS).
--
-- The app ships ahead of this migration on purpose and degrades rather than breaking: writes
-- that touch these columns retry without them and log a warning (see writeProposal and
-- updateProfile in lib/store.ts). Until this runs, custom line items, branding and the sent
-- stamp simply do not persist; everything else — creating, sharing and accepting proposals —
-- keeps working. After it runs the features light up with no code change and no backfill.

-- ---------------------------------------------------------------------------
-- 3.8  Labour & extras
-- Contractor-entered charges on a proposal: [{ id, description, amount }].
-- Deliberately NOT tier-specific — demolition costs the same whichever vanity wins — so this
-- lives on the proposal rather than on each tier's quote.
-- ---------------------------------------------------------------------------
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS custom_line_items JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 3.9  Partner branding
-- On profiles: what the contractor maintains.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_logo    TEXT,
  ADD COLUMN IF NOT EXISTS company_tagline TEXT,
  ADD COLUMN IF NOT EXISTS company_website TEXT;

-- On proposals: a frozen copy taken at share time.
-- A proposal is a document the homeowner may open months later, so it must keep saying what
-- it said. Reading branding live from the profile would silently rewrite estimates already
-- sent whenever the contractor renamed the company or changed a phone number.
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS contractor_branding JSONB;

-- ---------------------------------------------------------------------------
-- 3.10  Send tracking
-- Stamped when the contractor hands the link to a homeowner, for the "sent" indicator.
-- ---------------------------------------------------------------------------
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'proposals' AND column_name IN ('custom_line_items', 'contractor_branding', 'last_sent_at'))
    OR (table_name = 'profiles' AND column_name IN ('company_logo', 'company_tagline', 'company_website'))
  )
ORDER BY table_name, column_name;

-- Expected: 6 rows.
--
-- NOTE FOR JT — one manual step this SQL cannot do. The settings page uploads a company logo
-- to a Supabase Storage bucket named 'company-logos'. Create it (Storage → New bucket →
-- name: company-logos → Public), or skip it: the settings page also accepts a logo URL and
-- tells the contractor when the bucket is missing rather than failing silently.
