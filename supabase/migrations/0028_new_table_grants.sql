-- =====================================================================
-- 0028_new_table_grants.sql
--
-- Take TRUNCATE and REFERENCES back off the two tables 0027 created.
--
-- THE FOURTH OCCURRENCE OF THE SAME MISTAKE. profiles in 0022, events
-- in 0024, and now both of 0027's tables. The standing rule that comes
-- out of it is written into supabase/baseline/README.md; this file is
-- the repair.
--
-- ---------------------------------------------------------------------
-- WHAT WENT WRONG
--
-- 0027 ended each new table with:
--
--     revoke all on public.appointments from anon, public;
--     grant select, insert, update, delete on public.appointments
--       to authenticated;
--
-- The revoke names anon and PUBLIC. It does NOT name `authenticated`,
-- and `authenticated` is exactly who Supabase's ALTER DEFAULT
-- PRIVILEGES hands a full table grant to the moment a table is created
-- in `public`. So the grant on the next line did not GRANT four
-- privileges — it re-stated four of the seven that were already there,
-- and TRUNCATE and REFERENCES stayed.
--
-- "Automatically expose new tables" being OFF does not prevent this.
-- That setting governs PostgREST EXPOSURE; default role privileges are
-- a Postgres-level grant and are applied regardless. The two were
-- conflated in 0027's PART 5 comment, which is why the revoke was
-- written narrowly.
--
-- ---------------------------------------------------------------------
-- WHY IT MATTERS, AND WHY IT IS NOT MERELY UNTIDY
--
-- TRUNCATE IGNORES ROW LEVEL SECURITY. RLS filters rows for
-- SELECT/INSERT/UPDATE/DELETE; TRUNCATE is a table-level operation and
-- no policy applies to it. Every org-scoping policy 0027 wrote is
-- irrelevant to it. Any authenticated user — any contractor, any
-- salesperson, anyone with a session — could have emptied
-- public.appointments or public.labor_catalog in full, across every
-- org, and the org scoping would not have looked at them once.
--
-- REFERENCES is far milder: it lets a role point a foreign key at the
-- table, which takes a lock and creates a dependency that blocks later
-- DDL. Removed in the same statement because there is no reason for a
-- client role to hold it either.
--
-- Caught by 0027's own VERIFY check 6b, which asserted that
-- `authenticated` holds exactly SELECT/INSERT/UPDATE/DELETE and nothing
-- more. It returned four failing rows — two privileges on two tables.
-- Catching it in VERIFY is not the same as preventing it: the window
-- between the migration committing and someone reading the VERIFY
-- output is a window in which the grant is live.
--
-- ---------------------------------------------------------------------
-- ALREADY APPLIED. Run against production and verified before this file
-- was written, exactly as the two statements below. Committed so the
-- repo stops disagreeing with the database — the same reason 0026
-- absorbed the events revoke rather than back-dating a 0025.
--
-- Re-runnable: revoking a privilege nobody holds is a no-op, so this is
-- safe to apply any number of times. Transactional.
-- =====================================================================

begin;

-- =====================================================================
-- PART 0 — Pre-flight
--
-- Both tables must exist. If they do not, 0027 has not been applied and
-- this file is running out of order against a database where the two
-- statements below would simply error on a missing relation.
-- =====================================================================
do $$
declare v_missing text;
begin
  select string_agg(want.tbl, ', ') into v_missing
  from (values ('appointments'), ('labor_catalog')) as want(tbl)
  where not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = want.tbl
  );
  if v_missing is not null then
    raise exception
      'ABORT 0028/0: missing table(s): %. Apply 0027_salesperson_tier.sql first.', v_missing;
  end if;
end $$;

-- =====================================================================
-- PART 1 — The revokes
--
-- anon is named alongside authenticated even though 0027's
-- `revoke all ... from anon` already cleared it. A revoke of a
-- privilege nobody holds costs nothing, and naming both roles means
-- this statement states the whole intended end state rather than a diff
-- against what 0027 happened to do.
-- =====================================================================
revoke truncate, references on public.appointments  from authenticated, anon;
revoke truncate, references on public.labor_catalog from authenticated, anon;

commit;


-- =====================================================================
-- =====================================================================
--                          VERIFY SCRIPT
--
-- READ-ONLY. Run in the SQL Editor after applying. Every row must read
-- pass = true.
--
-- This is 0027's check 6b, kept whole rather than narrowed to the two
-- privileges this migration removes. A check that only looked at
-- TRUNCATE and REFERENCES would pass just as happily if this migration
-- had taken SELECT away too.
-- =====================================================================
-- =====================================================================

-- 1. the two privileges this migration removes are gone, for both
--    client roles, on both tables
select
  '1. truncate/references revoked'                              as check,
  r.role || ' / ' || tbl.name || ' / ' || pr.priv               as detail,
  'false'                                                       as expected,
  has_table_privilege(r.role, tbl.name, pr.priv)::text          as actual,
  not has_table_privilege(r.role, tbl.name, pr.priv)            as pass
from (values ('public.appointments'), ('public.labor_catalog')) as tbl(name)
cross join (values ('TRUNCATE'), ('REFERENCES'))                as pr(priv)
cross join (values ('authenticated'), ('anon'))                 as r(role)

union all
-- 2. ...and the DML 0027 intended is still intact for authenticated.
--    The failure mode this guards against is a repair that over-swings
--    and leaves the tables unusable rather than merely unTRUNCATEable.
select
  '2. authenticated keeps its DML',
  tbl.name || ' / ' || pr.priv,
  'true',
  has_table_privilege('authenticated', tbl.name, pr.priv)::text,
  has_table_privilege('authenticated', tbl.name, pr.priv)
from (values ('public.appointments'), ('public.labor_catalog')) as tbl(name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as pr(priv)

union all
-- 3. anon holds nothing at all on either table
select
  '3. anon holds nothing',
  tbl.name || ' / ' || pr.priv,
  'false',
  has_table_privilege('anon', tbl.name, pr.priv)::text,
  not has_table_privilege('anon', tbl.name, pr.priv)
from (values ('public.appointments'), ('public.labor_catalog')) as tbl(name)
cross join (values
  ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
) as pr(priv)

union all
-- 4. TRIGGER, the seventh table privilege, is not held by either client
--    role. Not part of the reported failure, checked because the same
--    default grant is what would have delivered it.
select
  '4. trigger privilege not held',
  r.role || ' / ' || tbl.name,
  'false',
  has_table_privilege(r.role, tbl.name, 'TRIGGER')::text,
  not has_table_privilege(r.role, tbl.name, 'TRIGGER')
from (values ('public.appointments'), ('public.labor_catalog')) as tbl(name)
cross join (values ('authenticated'), ('anon'))                 as r(role)

union all
-- 5. RLS is still on. It is what makes the surviving DML safe, and a
--    grant audit that ignored it would be measuring half the picture.
select
  '5. RLS still enabled',
  c.relname,
  'true',
  c.relrowsecurity::text,
  c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('appointments', 'labor_catalog')

union all
-- 6. THE SAME AUDIT ACROSS EVERY TABLE IN public. This is the check
--    that would have caught all four occurrences, and it is here rather
--    than in a scratchpad because the mistake has now been made once
--    per new-table migration.
--
--    Expected to be EMPTY. Any row returned names a table where a
--    client role holds TRUNCATE or REFERENCES, and pass is false so it
--    cannot be skimmed past.
select
  '6. no client role holds truncate/references anywhere',
  r.role || ' / ' || c.relname || ' / ' || pr.priv,
  'no rows',
  'held',
  false
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('TRUNCATE'), ('REFERENCES')) as pr(priv)
cross join (values ('authenticated'), ('anon'))  as r(role)
where n.nspname = 'public'
  and c.relkind::text = 'r'                 -- "char": r = ordinary table
  and has_table_privilege(r.role, c.oid::regclass::text, pr.priv)

union all
-- 6b. ...and a row that says so, because check 6 returns nothing when
--     clean and "no rows" is easy to misread as "not run".
select
  '6b. public-wide truncate/references total',
  'offending table/role/privilege combinations',
  '0',
  count(*)::text,
  count(*) = 0
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('TRUNCATE'), ('REFERENCES')) as pr(priv)
cross join (values ('authenticated'), ('anon'))  as r(role)
where n.nspname = 'public'
  and c.relkind::text = 'r'
  and has_table_privilege(r.role, c.oid::regclass::text, pr.priv)

order by 1, 2;
