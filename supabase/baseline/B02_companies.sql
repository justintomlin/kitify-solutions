-- =====================================================================
-- B02_companies.sql
--
-- PRODUCTION SNAPSHOT — DOCUMENTATION ONLY — DO NOT RUN AGAINST PRODUCTION.
--
-- public.companies as it stood on 2026-09-28, BEFORE migration 0022, plus
-- public.projects.company_id, which exists in production and in no migration.
--
-- Source: Query B (public.companies block) and Query F in
--         supabase/scratchpad/Kitify_Production_Extraction_Output.md
--
-- !! THIS FILE IS PRE-0022. The blanket anon grant below was REVOKED by
-- !! migration 0022 (`revoke all on all tables in schema public from anon`),
-- !! and TRUNCATE was revoked from authenticated by the same migration.
-- !! What is written here is history, not current state.
--
-- !! The three policies are reproduced AS THEY ARE, which is USING (true).
-- !! They are not a mistake in transcription and they are not fixed here —
-- !! see rule 4 in supabase/baseline/README.md. Any authenticated user reads,
-- !! inserts and updates every company row. That is still true after 0022;
-- !! 0022 closed anon, not this.
-- =====================================================================

-- ---------------------------------------------------------------------
-- GUARD.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'companies'
  ) then
    raise exception
      'B02 ABORT: public.companies already exists. This is a PRE-0022 production snapshot '
      'and must never be applied to a database that already has it. See supabase/baseline/README.md.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- TABLE. Column order and types verbatim from Query B, positions 001-016.
--
-- The assigned_to FOREIGN KEY is NOT declared inline. It references
-- public.profiles, which migration 0001 creates — and baseline files run
-- BEFORE the migrations. See the DEFERRED section at the foot of this file.
-- ---------------------------------------------------------------------
create table public.companies (
  id            uuid                     not null default gen_random_uuid(),
  name          text                     not null,
  license_num   text,
  phone         text,
  email         text,
  contact_info  text,
  address       text,
  account_type  text,
  lifecycle     text                     not null default 'lead'::text,
  converted_at  timestamp with time zone,
  source        text                     default 'manual'::text,
  assigned_to   uuid,
  status        text                     default 'New'::text,
  notes         text,
  created_at    timestamp with time zone default now(),
  updated_at    timestamp with time zone default now(),
  constraint companies_pkey            primary key (id),
  constraint companies_license_num_key unique (license_num),
  constraint companies_lifecycle_check check (lifecycle = any (array['lead'::text, 'customer'::text]))
);

-- Indexes. Both are constraint-backed and are created by the constraints
-- above; listed here because Query B reports them as separate objects.
--   companies_pkey            CREATE UNIQUE INDEX ... USING btree (id)
--   companies_license_num_key CREATE UNIQUE INDEX ... USING btree (license_num)

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY.
--   Query B: rls,status,enabled=t forced=f owner=postgres
-- ---------------------------------------------------------------------
alter table public.companies enable row level security;

-- ---------------------------------------------------------------------
-- POLICIES — all three are USING (true) / WITH CHECK (true).
--
-- Reproduced faithfully. RLS is enabled and then immediately given away:
-- every authenticated user can read, insert and update every company
-- record, including rows assigned to someone else. There is no DELETE
-- policy, so DELETE is denied to clients despite the grant below.
--
-- TODO Phase 1 — scope these to the caller's org once tenancy exists.
-- ---------------------------------------------------------------------
create policy "auth read companies"   on public.companies
  for select to authenticated
  using (true);

create policy "auth insert companies" on public.companies
  for insert to authenticated
  with check (true);

create policy "auth update companies" on public.companies
  for update to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- GRANTS — the pre-0022 posture, reproduced including everything wrong
-- with it.
--
--   Query B raw_acl: {postgres=arwdDxtm/postgres,
--                     anon=arwdDxtm/postgres,
--                     authenticated=arwdDxtm/postgres,
--                     service_role=arwdDxtm/postgres}
--
-- arwdDxtm is the full set: INSERT, SELECT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES, TRIGGER, MAINTAIN. Both anon and authenticated held all of it.
--
-- Query F rated this "5 MEDIUM - anon holds write grants; RLS policies are
-- the only guard", with truncate_granted = true. TRUNCATE is the sharp edge:
-- it ignores RLS entirely, so the policies above were never a guard against
-- it for either role.
-- ---------------------------------------------------------------------
grant all on table public.companies to anon;            -- REVOKED BY 0022
grant all on table public.companies to authenticated;   -- TRUNCATE REVOKED BY 0022
grant all on table public.companies to service_role;

-- ---------------------------------------------------------------------
-- TRIGGERS — none captured.
--
-- Query B's section list promises triggers, but the output contains no
-- trigger rows for public.companies. `updated_at` carries DEFAULT now(),
-- which sets it on INSERT only; whether a set_updated_at() trigger refreshes
-- it on UPDATE is NOT ANSWERED by the extraction. public.set_updated_at()
-- does exist (Query A). Do not assume either way — re-capture before relying
-- on updated_at being current.
-- ---------------------------------------------------------------------

-- Row estimate at capture: reltuples = -1 (never analyzed).


-- =====================================================================
-- DEFERRED — run AFTER supabase/migrations/0001_initial_schema.sql
--
-- Both statements below reference objects that migration 0001 creates, so
-- they cannot run in the baseline pass. The README's run order accounts for
-- this: baseline, then 0001, then this section, then 0002 onward.
-- =====================================================================

-- companies.assigned_to -> profiles(id).
--   Query B: companies_assigned_to_fkey, FOREIGN KEY (assigned_to) REFERENCES profiles(id)
-- alter table public.companies
--   add constraint companies_assigned_to_fkey
--   foreign key (assigned_to) references public.profiles (id);

-- ---------------------------------------------------------------------
-- projects.company_id — exists in production, created by NO migration.
--
-- This is the second piece of undocumented drift this folder exists to
-- record, alongside the leads schema itself. Query B confirms it only
-- indirectly, as a reverse dependency of companies:
--
--   public.companies,referenced_by,projects . projects_company_id_fkey,
--     FOREIGN KEY (company_id) REFERENCES companies(id)
--
-- NOT CAPTURED, because Query G has not been run:
--   * the column's nullability and any DEFAULT
--   * whether an index backs it (an unindexed FK makes every
--     "projects for this company" lookup a sequential scan, and makes
--     deleting a company scan projects)
--   * the FK's ON DELETE / ON UPDATE actions
-- The type is uuid because companies.id is uuid; that much is forced.
-- Re-capture Query G and correct this block before trusting it.
-- ---------------------------------------------------------------------
-- alter table public.projects
--   add column if not exists company_id uuid;
-- alter table public.projects
--   add constraint projects_company_id_fkey
--   foreign key (company_id) references public.companies (id);
