-- =====================================================================
-- B01_leads_schema.sql
--
-- PRODUCTION SNAPSHOT — DOCUMENTATION ONLY — DO NOT RUN AGAINST PRODUCTION.
--
-- The `leads` schema as it stood on 2026-09-28, BEFORE migration 0022.
-- No migration in supabase/migrations/ creates this schema, yet 0008's
-- auto_link_permits_to_companies() updates leads.permits. That gap is why
-- supabase/baseline/ exists — see supabase/baseline/README.md.
--
-- Source: Query A in supabase/scratchpad/Kitify_Production_Extraction_Output.md
--
-- !! THIS FILE IS PRE-0022. The anon USAGE grant below was REVOKED by
-- !! migration 0022 (`revoke usage on schema leads from anon`). What is
-- !! written here is history, not current state.
-- =====================================================================

-- ---------------------------------------------------------------------
-- GUARD. Stops at statement one if the schema is already here, which it
-- will be on any real database. This is what makes an accidental run
-- against production a no-op instead of a partial apply.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'leads') then
    raise exception
      'B01 ABORT: schema "leads" already exists. This is a PRE-0022 production snapshot '
      'and must never be applied to a database that already has it. See supabase/baseline/README.md.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- The schema.
--   Query A: config,schema,leads,
--     owner=postgres | acl={postgres=UC/postgres,anon=U/postgres,
--                           authenticated=U/postgres,service_role=U/postgres}
-- ---------------------------------------------------------------------
create schema leads authorization postgres;

-- USAGE for all three PostgREST roles. Reproduced faithfully, including anon.
--
-- anon's USAGE was the load-bearing half of the pre-0022 exposure: the leads
-- TABLES never granted anon anything (see B03 — authenticated holds rw, anon
-- holds nothing), so USAGE on the schema was what made `leads` reachable at
-- all with the anon key. 0022 revoked exactly this line; its table-level
-- `revoke all ... from anon` on schema leads was a no-op by comparison.
grant usage on schema leads to postgres;
grant create on schema leads to postgres;
grant usage on schema leads to anon;             -- REVOKED BY 0022
grant usage on schema leads to authenticated;
grant usage on schema leads to service_role;

-- ---------------------------------------------------------------------
-- Sequences — NOT created here, on purpose.
--
-- Query A lists three sequences owned by postgres:
--     leads.permits_id_seq, leads.sources_id_seq, leads.weekly_pulls_id_seq
-- All three are IDENTITY sequences. Each is created implicitly by its
-- `GENERATED ALWAYS AS IDENTITY` column in B03, and creating them here
-- would collide with that. They are listed for completeness only.
--
-- NOT CAPTURED: sequence-level ACLs. Query A reports ownership only, and
-- Query G (which would have covered leads sequences) has not been run. If
-- the sequences carry grants beyond the defaults, this file does not know.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Role configuration, for reference. Set on the `authenticator` role by
-- Supabase, not by us, and reproduced here only so a fresh project can be
-- compared against production.
--
--   Query A: config,authenticator role settings,rolconfig,
--     "session_preload_libraries=supautils, safeupdate;
--      statement_timeout=8s; lock_timeout=8s"
--
-- Not executed: on a Supabase project the platform sets this itself, and
-- on a bare Postgres the `authenticator` role may not exist.
-- ---------------------------------------------------------------------
-- alter role authenticator set session_preload_libraries = 'supautils', 'safeupdate';
-- alter role authenticator set statement_timeout = '8s';
-- alter role authenticator set lock_timeout = '8s';
