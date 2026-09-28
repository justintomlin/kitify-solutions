-- =====================================================================
-- B04_inside_leads_view.sql
--
-- PRODUCTION SNAPSHOT — DOCUMENTATION ONLY — DO NOT RUN AGAINST PRODUCTION.
--
-- public.inside_leads as it stood on 2026-09-28, BEFORE migration 0022.
--
-- Source: Query C in supabase/scratchpad/Kitify_Production_Extraction_Output.md
--         (captured BEFORE 0022, so it needs no reconstruction)
--
-- Requires B02 (public.companies) and B03 (leads.permits).
--
-- !! THIS FILE IS PRE-0022, AND IT IS THE CRITICAL FINDING.
-- !! Query F rated it "1 CRITICAL - anon can write, nothing guards it" —
-- !! the only item at severity 1 in the entire audit.
-- !! 0022 set security_invoker = true and revoked anon entirely.
-- =====================================================================

-- ---------------------------------------------------------------------
-- GUARD.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'inside_leads'
  ) then
    raise exception
      'B04 ABORT: public.inside_leads already exists. This is a PRE-0022 production snapshot '
      'and must never be applied to a database that already has it. See supabase/baseline/README.md.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- THE VIEW — definition verbatim from Query C.
--
-- NOTE THE ABSENCE. There is no `with (security_invoker = true)` here, and
-- that omission IS the pre-0022 state:
--
--   Query C: options,owner / reloptions,
--     "owner=postgres | reloptions=(none: runs with OWNER rights,
--                                   bypasses RLS on the tables it reads)"
--
-- A view with no reloptions runs with the rights of its OWNER, which is
-- postgres. So every SELECT through this view read public.companies and
-- leads.permits as postgres — RLS on both tables simply did not apply.
-- The view was a hole straight through the row-level security underneath it.
--
-- 0022 fixed this with `alter view public.inside_leads set (security_invoker = true)`.
-- Do not add that here. This file records what was wrong, not what fixed it.
-- ---------------------------------------------------------------------
create view public.inside_leads as
  SELECT c.id,
    c.name,
    c.license_num,
    c.phone,
    c.email,
    c.contact_info,
    c.address,
    c.account_type,
    c.lifecycle,
    c.converted_at,
    c.source,
    c.assigned_to,
    c.status,
    c.notes,
    c.created_at,
    c.updated_at,
    count(pm.id) AS permit_count,
    sum(pm.valuation) AS total_valuation,
    max(COALESCE(pm.date_issued, pm.date_filed)) AS latest_permit_date
   FROM companies c
     LEFT JOIN leads.permits pm ON pm.crm_company_id = c.id
  WHERE c.lifecycle = 'lead'::text
  GROUP BY c.id;

alter view public.inside_leads owner to postgres;

-- ---------------------------------------------------------------------
-- GRANTS — pre-0022, reproduced in full.
--
--   Query C raw_acl: {postgres=arwdDxtm/postgres,
--                     anon=arwdDxtm/postgres,
--                     authenticated=arwdDxtm/postgres,
--                     service_role=arwdDxtm/postgres}
--
-- anon held the complete privilege set on a view that bypassed RLS.
-- ---------------------------------------------------------------------
grant all on public.inside_leads to anon;            -- REVOKED BY 0022
grant all on public.inside_leads to authenticated;
grant all on public.inside_leads to service_role;

-- ---------------------------------------------------------------------
-- WHAT THE EXPOSURE ACTUALLY WAS — worth being precise about, because the
-- severity label and the mechanism are not quite the same thing.
--
-- READ: real, and serious. With owner rights and an anon grant, anybody
-- holding the anon key — which ships to the browser by design — could read
-- the entire inside-sales pipeline: every lead company, its contact details,
-- its assigned rep, its notes, and aggregated permit valuations. No account,
-- no RLS, no trace.
--
-- WRITE: granted but not reachable. This view aggregates (GROUP BY c.id),
-- so it is not auto-updatable; Postgres rejects INSERT/UPDATE/DELETE against
-- it regardless of the grant, and there is no INSTEAD OF trigger or rule to
-- make it writable. Query F's "anon can write" reflects the GRANT, not a
-- demonstrated write path.
--
-- The grant was still wrong, and revoking it was still right. Recording the
-- distinction so nobody re-derives it under pressure later.
-- ---------------------------------------------------------------------

-- Depends on: public.companies, leads.permits (Query C, depends_on rows).
