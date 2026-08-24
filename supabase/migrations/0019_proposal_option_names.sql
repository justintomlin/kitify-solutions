-- ============================================================================
-- Kitify Solutions — dealer-named proposal options (Phase C2)
-- Migration: 0019_proposal_option_names
--
-- A proposal offers up to three quotes, stored as tier_good / tier_better / tier_best. Those
-- names leak a sales ladder the dealer did not choose and cannot describe: the three options
-- on a real proposal are usually "SPC package" and "HPL package", not "good" and "better".
--
-- C2 renames them to Option 1 / 2 / 3 in the UI and lets a dealer name each one. The COLUMNS
-- keep their existing names — tier_good and friends are referenced by the accept flow, the
-- public API route, the order path and every saved row, and renaming them would be a large
-- and entirely cosmetic migration. Only the labels move.
--
-- Shape: { "good": string | null, "better": string | null, "best": string | null }
-- Null column, or a null member, means "unnamed" and the UI falls back to the numbered
-- placeholder. No backfill — an unnamed option is the correct reading of every existing row.
--
-- Depends on 0003 / 0004. Re-runnable.
-- ============================================================================

alter table public.proposals add column if not exists option_names jsonb;

comment on column public.proposals.option_names is
  'Dealer-supplied names for the three proposal options, keyed by the tier column they '
  'correspond to: { good, better, best }. NULL, or a null member, means unnamed — the UI '
  'shows a numbered placeholder. The tier_* columns are unchanged; this is labels only.';

-- ============================================================================
-- VERIFY (SQL editor, after running)
--
-- 1. Column exists and is nullable, with every existing row left alone:
--      select count(*) filter (where option_names is null) as unnamed,
--             count(*)                                     as total
--      from public.proposals;
--      -- expect unnamed = total; nothing was backfilled.
--
-- 2. A round-trip of the expected shape:
--      begin;
--        update public.proposals
--           set option_names = '{"good":"SPC package","better":null,"best":"HPL package"}'::jsonb
--         where id = (select id from public.proposals order by created_at desc limit 1)
--        returning option_names ->> 'good', option_names ->> 'better', option_names ->> 'best';
--        -- expect 'SPC package', NULL, 'HPL package'
--      rollback;
-- ============================================================================
