-- =====================================================================
-- B06_storage.sql
--
-- PRODUCTION SNAPSHOT — DOCUMENTATION ONLY — DO NOT RUN AGAINST PRODUCTION.
--
-- The storage schema as it stood on 2026-09-28, BEFORE migration 0022.
--
-- Source: Query E in supabase/scratchpad/Kitify_Production_Extraction_Addendum_DEG.md
--
-- !! RECONSTRUCTED. Query E ran AFTER 0022 and shows TWO buckets. Before
-- !! 0022 there was ONE. `company-logos` was created BY 0022 — its
-- !! created_at is 2026-09-28T18:39:25Z, which is the migration run, not
-- !! the original build. It is excluded below.
--
-- NOTE ON APPLICABILITY: on Supabase the storage schema is platform-managed.
-- These statements are a record of configuration, not a build script — a
-- fresh project gets buckets through the dashboard or the storage API, and
-- storage.objects policies are created there too. Treat this file as the
-- specification of what to reproduce, not as something to execute.
-- =====================================================================

-- ---------------------------------------------------------------------
-- GUARD.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from storage.buckets where id = 'job-photos') then
    raise exception
      'B06 ABORT: storage bucket "job-photos" already exists. This is a PRE-0022 production '
      'snapshot and must never be applied to a database that already has it. '
      'See supabase/baseline/README.md.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- THE ONE BUCKET THAT EXISTED.
--
--   Query E: {"id":"job-photos","name":"job-photos","owner":null,
--             "created_at":"2026-08-02T17:45:41.74721+00:00",
--             "public":true,
--             "file_size_limit":null,
--             "allowed_mime_types":null,
--             "avif_autodetection":false,"type":"STANDARD",
--             "versioning_status":"DISABLED"}
--
-- BOTH NULLS ARE THE FINDING. A public bucket with no size limit and no
-- MIME restriction means any authenticated user can upload a file of any
-- type at any size and receive a permanent, unauthenticated, guessable-
-- adjacent public URL on the Supabase domain. Not just images — anything.
--
-- Contrast company-logos as 0022 created it: 2 MB cap, and PNG/JPEG/WebP
-- only, explicitly excluding SVG because an SVG served directly can execute
-- script. job-photos has neither guard.
--
-- Object count at capture: 3 objects, 1 top-level folder ("orders").
-- Recorded because it sizes the 0023 backfill: the number of stored public
-- URLs that have to become paths is very small.
--
-- TODO 0023 — fold a file_size_limit and an image-only allowed_mime_types
-- into the same bucket UPDATE as the `public = false` flip. One row, one
-- statement, three fixes.
-- ---------------------------------------------------------------------
insert into storage.buckets
  (id, name, owner, public, avif_autodetection, file_size_limit, allowed_mime_types)
values
  ('job-photos', 'job-photos', null, true, false, null, null);

-- 0022 created the SECOND bucket. NOT part of this snapshot; listed so a
-- reader knows why Query E shows two and this file declares one:
--   company-logos, public=true, file_size_limit=2097152,
--   allowed_mime_types={image/png,image/jpeg,image/webp}
--   created 2026-09-28T18:39:25Z  <- the 0022 run

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY — on for both storage tables, pre- and post-0022.
--   Query E: rls,buckets,enabled=t forced=f
--            rls,objects,enabled=t forced=f
-- ---------------------------------------------------------------------
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

-- ---------------------------------------------------------------------
-- ALL SIX POLICIES ON storage.objects.
--
-- All six existed before 0022. Every one checks ONLY bucket_id — no user
-- check, no ownership check, no path check. Any authenticated caller who
-- reaches the bucket satisfies them.
--
-- Two are named "…their own…" and check nothing of the kind. A contractor
-- can delete another contractor's job photos, and another company's logo.
-- The names describe an intent the SQL does not implement.
--
-- THE THREE company-logos POLICIES REFERENCED A BUCKET THAT DID NOT EXIST.
-- This is the evidence for the silently-failing logo upload on the settings
-- page: app/portal/settings/page.tsx:96 uploads to 'company-logos', the
-- bucket was absent, Supabase returned "Bucket not found", and the page
-- surfaced it as a generic message. The policies were written in advance of
-- a bucket nobody created. 0022 Part 4 created it and closed the gap.
--
-- COUNT DISCREPANCY, recorded rather than smoothed over: migration 0022's
-- own Part 4 comment says "Four storage policies already reference it", and
-- the Session-1 brief repeated that number. Query E shows THREE policies
-- referencing company-logos (view / upload / delete) and three referencing
-- job-photos, six in total. The capture is the evidence; four appears to be
-- a miscount carried forward. Nothing was done differently because of it —
-- 0022 created the bucket either way — but do not treat "four" as verified.
-- ---------------------------------------------------------------------

-- --- company-logos (3) — the bucket did not exist when these were written
create policy "Anyone can view company logos"
  on storage.objects for select
  to public                       -- includes anon: see the CAUTION below
  using (bucket_id = 'company-logos'::text);

create policy "Authenticated users can upload company logos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'company-logos'::text);

create policy "Users can delete their own company logos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'company-logos'::text);     -- "their own" checks nothing of the kind

-- --- job-photos (3)
create policy "Authenticated users can upload job photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'job-photos'::text);

create policy "Authenticated users can view job photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'job-photos'::text);

create policy "Users can delete their own job photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'job-photos'::text);        -- "their own" checks nothing of the kind

-- NOTE: there is no UPDATE policy on either bucket. app/portal/settings/page.tsx:96
-- uploads with `upsert: true`, which needs UPDATE when the object key already
-- exists. It never collides today because the key carries a timestamp
-- (`logo-${Date.now()}.${ext}`), so every upload is a fresh INSERT. Worth
-- knowing before anyone makes the logo key stable.

-- ---------------------------------------------------------------------
-- GRANTS — and 0022 did NOT touch these.
--
--   Query E: table_priv:buckets,anon,   SELECT=t INSERT=t UPDATE=t DELETE=t
--            table_priv:buckets,authenticated, SELECT=t INSERT=t UPDATE=t DELETE=t
--            table_priv:objects,anon,   SELECT=t INSERT=t UPDATE=t DELETE=t
--            table_priv:objects,authenticated, SELECT=t INSERT=t UPDATE=t DELETE=t
--
-- anon holds full DML on both storage tables, before AND after 0022. 0022's
-- revokes were scoped to schemas `public` and `leads` (Part 3) and never
-- named `storage`. So this is one of the few places where the pre-0022 and
-- post-0022 pictures are identical, and it is still open.
--
-- RLS is what blocks it today: the policies above admit `authenticated` for
-- everything except the company-logos SELECT. Grants alone would not.
--
-- !! CAUTION FOR WHOEVER CLEANS THIS UP !!
-- "Anyone can view company logos" is roles=public, and PUBLIC includes anon.
-- That is not an oversight — it is load-bearing. The company logo renders on
-- the UNAUTHENTICATED proposal page (app/proposal/[token]/ProposalView.tsx:500),
-- where the reader has no account and no session. A blanket
-- `revoke select on storage.objects from anon` stops that logo rendering for
-- every homeowner looking at a proposal. Scope the cleanup; do not swing.
-- ---------------------------------------------------------------------
grant select, insert, update, delete on storage.buckets to anon;            -- UNCHANGED BY 0022
grant select, insert, update, delete on storage.buckets to authenticated;
grant select, insert, update, delete on storage.objects to anon;            -- UNCHANGED BY 0022
grant select, insert, update, delete on storage.objects to authenticated;

-- ---------------------------------------------------------------------
-- TODO Session 2 — path-prefix scoping by org.
-- Every policy above checks bucket_id alone. Uploads already land under
-- `orders/<id>/…` and `claims/<id>/…` (lib/storage.ts:71), so the prefix
-- convention exists to build on; what is missing is the mapping from prefix
-- to org, which needs the tenancy model.
-- ---------------------------------------------------------------------
