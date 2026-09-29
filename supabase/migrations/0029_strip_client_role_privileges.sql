-- =====================================================================
-- 0029_strip_client_role_privileges.sql
--
-- Take TRUNCATE, REFERENCES and TRIGGER away from anon and
-- authenticated across every table in public and leads.
--
-- 0028 repaired two tables. Its check 6 — the public-wide sweep added
-- precisely because repairing only what a migration touched had already
-- failed three times — came back with THIRTY-TWO offending
-- combinations. This is the repair for the other thirty.
--
-- ---------------------------------------------------------------------
-- WHAT THE SWEEP ACTUALLY FOUND
--
-- 1. anon AND authenticated BOTH HELD TRUNCATE ON orgs, memberships
--    AND org_assignments. This is the serious one.
--
--    Those three tables were created by 0024 — AFTER 0022's blanket
--    revoke had run. 0022 cleared the privileges that existed when it
--    ran; it could not clear privileges on tables that did not exist
--    yet, and 0024 created them straight into a fresh default grant.
--    The revoke 0024 did write named anon and PUBLIC, not
--    authenticated, which is the same wording error that produced every
--    other occurrence.
--
--    TRUNCATE IGNORES ROW LEVEL SECURITY. Every policy 0024 wrote to
--    decide who may see which org was irrelevant to it. And of the
--    three, memberships is the load-bearing one: truncating it empties
--    the table that public.current_org_id() and public.is_admin() both
--    read, so every user resolves to no org, every org-scoped policy
--    matches nothing, every admin stops being an admin, and every row
--    in fifteen business tables is orphaned from the org it belongs to.
--    A single statement, available to any session, that unmakes the
--    entire authorization model.
--
--    NOT DIRECTLY REACHABLE THROUGH PostgREST, which exposes no
--    TRUNCATE operation — so this was not a live remote-exploit path
--    from the browser. It is being removed because a privilege that
--    should never have been granted is not made acceptable by the
--    current absence of a route to it. Routes change; grants should be
--    correct on their own terms.
--
-- 2. authenticated HELD TRIGGER on both tables 0027 created — the
--    seventh table privilege, from the same default grant, and the one
--    nobody had thought to look for. 0028's check 4 caught it, which is
--    the only reason it is named here.
--
-- 3. REFERENCES was held by authenticated on very nearly every table in
--    public. Low risk on its own: it permits creating a foreign key
--    that points at the table, which takes a lock and leaves a
--    dependency that can block later DDL. It cannot read a row.
--
-- NO CLIENT ROLE NEEDS ANY OF THE THREE. REFERENCES is only required to
-- create a foreign key, and foreign keys are created by migrations
-- running as postgres. TRIGGER likewise. TRUNCATE has no legitimate
-- client use at all.
--
-- ---------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES NOT DO
--
-- `revoke ... on all tables in schema` acts on the tables that exist
-- WHEN IT RUNS. It does not alter default privileges, so the NEXT
-- `create table` in `public` will hand `authenticated` a full grant
-- again, exactly as 0024 and 0027 did. This migration cleans up; it
-- does not prevent a recurrence.
--
-- What prevents a recurrence is the standing rule in
-- supabase/baseline/README.md: every `create table` is immediately
-- followed by `revoke all on <table> from authenticated, anon;` and
-- then the explicit grants. The revoke must name `authenticated`.
--
-- (An `ALTER DEFAULT PRIVILEGES ... REVOKE` would make the rule
-- self-enforcing, but it is a project-wide behaviour change affecting
-- every future table and every tool that creates one, so it is a
-- decision to take deliberately rather than to smuggle into a cleanup.
-- Recorded here as the option, not taken.)
--
-- ---------------------------------------------------------------------
-- ALREADY APPLIED. Run against production and verified before this file
-- was written, exactly as the two statements below.
--
-- Re-runnable: revoking a privilege nobody holds is a no-op. The
-- statements are also safe on an empty schema. Transactional.
-- =====================================================================

begin;

-- =====================================================================
-- PART 0 — Pre-flight
--
-- The leads schema must exist. public always does; leads is the one
-- that would make the second statement fail on a database where the
-- lead pipeline was never set up.
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'leads') then
    raise exception
      'ABORT 0029/0: schema "leads" does not exist. This database is not the one this '
      'migration was written for — investigate before running.';
  end if;
end $$;

-- =====================================================================
-- PART 1 — The revokes
--
-- Both client roles, all three privileges, both schemas. Named as the
-- intended END STATE rather than as a diff against what any earlier
-- migration happened to leave behind — which is what produced the
-- narrow, ineffective revokes this file is cleaning up after.
-- =====================================================================
revoke truncate, references, trigger on all tables in schema public from authenticated, anon;
revoke truncate, references, trigger on all tables in schema leads  from authenticated, anon;

commit;


-- =====================================================================
-- =====================================================================
--                          VERIFY SCRIPT
--
-- READ-ONLY. Run in the SQL Editor after applying. Every row must read
-- pass = true.
--
-- THE SWEEP SHAPE IS THE POINT. Check 1 does not look at the tables
-- this migration set out to fix — it looks at EVERY table and view in
-- both schemas, for both client roles, for all three privileges. That
-- is the shape every future grant-related VERIFY should use. Checking
-- only what a migration touched is what let thirty tables stay broken
-- while two were repaired.
--
-- pg_catalog "char" columns (relkind) are cast to ::text before
-- comparison — same fix as 0023, 0024, 0026 and 0028.
-- =====================================================================
-- =====================================================================

-- 1. THE SWEEP. Zero combinations of
--    (anon, authenticated) x (TRUNCATE, REFERENCES, TRIGGER)
--    across every table and view in public and leads.
select
  '1. no client role holds truncate/references/trigger'  as check,
  'offending role/relation/privilege combinations'       as detail,
  '0'                                                    as expected,
  count(*)::text                                         as actual,
  count(*) = 0                                           as pass
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as pr(priv)
cross join (values ('authenticated'), ('anon'))               as r(role)
where n.nspname in ('public', 'leads')
  and c.relkind::text in ('r', 'p', 'v', 'm', 'f')   -- table, partitioned, view, matview, foreign
  and has_table_privilege(r.role, c.oid::regclass::text, pr.priv)

union all
-- 1b. ...and one row per offender if any survive, so the count above is
--     actionable rather than merely alarming. Returns nothing when
--     clean, which is why 1 exists to say so.
select
  '1b. surviving offender',
  r.role || ' / ' || n.nspname || '.' || c.relname || ' / ' || pr.priv,
  'none',
  'held',
  false
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as pr(priv)
cross join (values ('authenticated'), ('anon'))               as r(role)
where n.nspname in ('public', 'leads')
  and c.relkind::text in ('r', 'p', 'v', 'm', 'f')
  and has_table_privilege(r.role, c.oid::regclass::text, pr.priv)

union all
-- 2. THE TENANCY TABLES, NAMED. The three that mattered, checked
--    individually as well as in the sweep, because "0 of everything"
--    and "these three specifically" fail differently when someone
--    edits this file later.
select
  '2. tenancy tables not truncatable',
  r.role || ' / ' || tbl.name,
  'false',
  has_table_privilege(r.role, tbl.name, 'TRUNCATE')::text,
  not has_table_privilege(r.role, tbl.name, 'TRUNCATE')
from (values ('public.orgs'), ('public.memberships'), ('public.org_assignments')) as tbl(name)
cross join (values ('authenticated'), ('anon'))                                   as r(role)

union all
-- 3. THE OVER-SWING CHECK. A blanket revoke across two whole schemas is
--    exactly the kind of statement that fixes the reported problem and
--    breaks the application. authenticated must still hold all four DML
--    privileges on the tables 0027 created.
select
  '3. authenticated keeps its DML',
  tbl.name || ' / ' || pr.priv,
  'true',
  has_table_privilege('authenticated', tbl.name, pr.priv)::text,
  has_table_privilege('authenticated', tbl.name, pr.priv)
from (values ('public.appointments'), ('public.labor_catalog')) as tbl(name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as pr(priv)

union all
-- 3b. ...and the same for the tenancy tables, which 0024 granted full
--     DML to authenticated and whose policies are what actually
--     restrict them. Stripping DML here would lock everyone out of
--     their own org.
select
  '3b. tenancy DML intact',
  tbl.name || ' / ' || pr.priv,
  'true',
  has_table_privilege('authenticated', tbl.name, pr.priv)::text,
  has_table_privilege('authenticated', tbl.name, pr.priv)
from (values ('public.orgs'), ('public.memberships'), ('public.org_assignments')) as tbl(name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as pr(priv)

union all
-- 4. RLS is still enabled on the two 0027 tables. It is what makes the
--    surviving DML safe, and a privilege audit that ignored it would be
--    measuring half the picture.
select
  '4. RLS still enabled',
  c.relname,
  'true',
  c.relrowsecurity::text,
  c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('appointments', 'labor_catalog')

union all
-- 5. events stays append-only. 0026 revoked UPDATE and DELETE on it;
--    this migration touched neither, and a sweep across a whole schema
--    is the sort of thing that could plausibly disturb an earlier
--    narrow revoke. Proving it did not is cheap.
select
  '5. events still append-only',
  'authenticated update/delete',
  'false',
  (has_table_privilege('authenticated', 'public.events', 'UPDATE')
    or has_table_privilege('authenticated', 'public.events', 'DELETE'))::text,
  not (has_table_privilege('authenticated', 'public.events', 'UPDATE')
    or has_table_privilege('authenticated', 'public.events', 'DELETE'))

order by 1, 2;
