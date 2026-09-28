-- =====================================================================
-- B03_leads_tables.sql
--
-- PRODUCTION SNAPSHOT — DOCUMENTATION ONLY — DO NOT RUN AGAINST PRODUCTION.
--
-- leads.permits, leads.sources and leads.weekly_pulls as they stood on
-- 2026-09-28, BEFORE migration 0022. No migration creates any of them, yet
-- 0008's auto_link_permits_to_companies() updates leads.permits.
--
-- Source: Query B (leads.* blocks) and Query F in
--         supabase/scratchpad/Kitify_Production_Extraction_Output.md
--
-- Requires B01 (schema) and B02 (companies, for the crm_company_id FK).
--
-- !! THIS FILE IS PRE-0022. 0022 ran `revoke all on all tables in schema
-- !! leads from anon` and `revoke truncate ... from authenticated` against
-- !! these tables. Both were effectively no-ops here — see the GRANTS note
-- !! below — because anon never held a table grant in this schema and
-- !! TRUNCATE was never granted. What 0022 actually changed for `leads` was
-- !! the schema-level anon USAGE grant in B01.
--
-- !! Every policy below is USING (true). Reproduced, not fixed — rule 4 in
-- !! supabase/baseline/README.md.
--
-- EXTERNAL WRITER: leads.permits is written weekly by sync.py, which is not
-- in this repository. Renaming a column here breaks that job silently, once
-- a week. See the README.
-- =====================================================================

-- ---------------------------------------------------------------------
-- GUARD.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'leads' and c.relname = 'permits'
  ) then
    raise exception
      'B03 ABORT: leads.permits already exists. This is a PRE-0022 production snapshot '
      'and must never be applied to a database that already has it. See supabase/baseline/README.md.';
  end if;
end $$;

-- =====================================================================
-- leads.permits — 29 columns, 877 rows at capture
-- =====================================================================
create table leads.permits (
  id               bigint                   not null generated always as identity,
  permit_num       text                     not null,
  jurisdiction     text                     not null,
  county           text,
  date_filed       date,
  date_issued      date,
  status           text,
  permit_type      text,
  description      text,
  site_address     text,
  city             text,
  zip              text,
  valuation        numeric,
  sqft             numeric,
  contractor       text,
  contact          text,
  owner            text,
  license_num      text,
  match_confidence text,
  lead_relevance   text,
  account_type     text,
  follow_up        text                     default 'New'::text,
  claimed_by       text,
  notes            text,
  source_url       text,
  week_pulled      date,
  updated_at       timestamp with time zone default now(),
  crm_company_id   uuid,
  promoted_at      timestamp with time zone,
  constraint permits_pkey                        primary key (id),
  constraint permits_permit_num_jurisdiction_key unique (permit_num, jurisdiction),
  constraint permits_crm_company_id_fkey         foreign key (crm_company_id)
                                                 references public.companies (id)
);

-- Indexes: both constraint-backed, created by the constraints above.
--   permits_pkey                        UNIQUE btree (id)
--   permits_permit_num_jurisdiction_key UNIQUE btree (permit_num, jurisdiction)
--
-- NOTE: crm_company_id carries NO index of its own. 0008's linking function
-- updates on it and public.inside_leads LEFT JOINs on it, so both scan.
-- Recorded, not fixed.

alter table leads.permits enable row level security;

-- Both policies are USING (true): any authenticated user reads and updates
-- every permit row, including another dealer's claimed_by and notes.
create policy "authenticated read"   on leads.permits
  for select to authenticated
  using (true);

create policy "authenticated update" on leads.permits
  for update to authenticated
  using (true);

-- =====================================================================
-- leads.sources — 9 columns, 22 rows at capture
-- =====================================================================
create table leads.sources (
  id           bigint not null generated always as identity,
  county       text,
  jurisdiction text,
  state        text,
  system       text,
  url          text,
  pull_method  text,
  verified     text,
  notes        text,
  constraint sources_pkey primary key (id)
);

alter table leads.sources enable row level security;

-- SELECT only. Note the asymmetry with the grants below, which also allow
-- UPDATE: the grant permits it, no policy admits it, so UPDATE is denied to
-- clients. The grant is over-broad rather than exploitable.
create policy "authenticated read" on leads.sources
  for select to authenticated
  using (true);

-- =====================================================================
-- leads.weekly_pulls — 8 columns, reltuples = -1 (never analyzed)
-- =====================================================================
create table leads.weekly_pulls (
  id           bigint not null generated always as identity,
  week_ending  date,
  source       text,
  pulled_on    date,
  pulled_by    text,
  record_count integer,
  complete     text,
  notes        text,
  constraint weekly_pulls_pkey primary key (id)
);

alter table leads.weekly_pulls enable row level security;

create policy "authenticated read" on leads.weekly_pulls
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- GRANTS — identical posture on all three tables.
--
--   Query B raw_acl (all three):
--     {postgres=arwdDxtm/postgres,
--      service_role=arwdDxtm/postgres,
--      authenticated=rw/postgres}
--
-- `rw` is SELECT + UPDATE only. anon appears in none of the three ACLs, and
-- Query F confirms it: anon_privs empty, truncate_granted = false, rated
-- "6 LOW - authenticated write grants; RLS policies are the only guard".
--
-- This is the good news in an otherwise poor picture, and it is worth being
-- precise about: these tables were never granted to anon. What made `leads`
-- reachable with the anon key was USAGE on the SCHEMA (B01), which 0022
-- revoked. 0022's table-level revoke here removed nothing.
--
-- UPDATE is granted on sources and weekly_pulls but no policy admits it,
-- so it is unreachable. Over-broad, not exploitable.
-- ---------------------------------------------------------------------
grant select, update on leads.permits      to authenticated;
grant select, update on leads.sources      to authenticated;
grant select, update on leads.weekly_pulls to authenticated;

grant all on leads.permits      to service_role;
grant all on leads.sources      to service_role;
grant all on leads.weekly_pulls to service_role;

-- ---------------------------------------------------------------------
-- COLUMN PRIVILEGES.
--
-- Query B enumerates column_priv rows for every column of all three tables.
-- They are uniform and exactly match the table-level grants above —
-- authenticated SELECT=t INSERT=f UPDATE=t on every column, anon all false —
-- so the table grants reproduce them and no per-column GRANT is needed.
-- Recorded here so a future diff knows the per-column data was checked and
-- found redundant, rather than skipped.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- TRIGGERS — none captured, for any of the three tables.
--
-- As with B02: Query B's section list promises triggers and returned no
-- trigger rows. leads.permits.updated_at has DEFAULT now(), which fires on
-- INSERT only. Whether anything refreshes it on UPDATE is NOT ANSWERED.
-- sync.py may be setting it explicitly. Re-capture before relying on it.
-- ---------------------------------------------------------------------
