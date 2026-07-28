-- ============================================================================
-- 0008_auto_link_permits.sql
--
-- auto_link_permits_to_companies(): batch-matches newly-ingested, still-unlinked
-- permits (leads.permits.crm_company_id IS NULL) to existing public.companies,
-- mirroring the matching logic of promote_permit_to_crm — license_num first
-- (most reliable), then case-insensitive contractor name.
--
-- Called by the weekly sync (sync.py) after it upserts permits:
--     supabase.rpc('auto_link_permits_to_companies')
--
-- Ownership contract: crm_company_id and promoted_at are PORTAL/PIPELINE-owned
-- link columns (same as promote_permit_to_crm sets). This function NEVER touches
-- follow_up / claimed_by / notes, so any portal edits survive re-runs.
--
-- Idempotent: only rows WHERE crm_company_id IS NULL are considered, so a run
-- with no new unlinked permits (or no new matches) updates nothing and returns 0.
--
-- SECURITY DEFINER + `set search_path = ''` + fully-qualified names: runs as the
-- function owner and is hardened against search-path hijacking, matching the
-- is_admin() convention in 0002_enable_rls.sql.
-- ----------------------------------------------------------------------------

create or replace function public.auto_link_permits_to_companies()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by_license integer := 0;
  v_by_name    integer := 0;
begin
  -- Pass 1 — license_num (exact, trimmed). Most reliable; license_num is UNIQUE on
  -- companies, so each permit license maps to at most one company. Skips null/empty
  -- on either side, and only ever fills a NULL crm_company_id (never overwrites).
  update leads.permits p
  set crm_company_id = c.id,
      promoted_at    = now()
  from public.companies c
  where p.crm_company_id is null
    and nullif(btrim(p.license_num), '') is not null
    and nullif(btrim(c.license_num), '') is not null
    and btrim(p.license_num) = btrim(c.license_num);
  get diagnostics v_by_license = row_count;

  -- Pass 2 — case-insensitive contractor name, only for permits STILL unlinked
  -- after pass 1. A name can map to more than one company, so the LATERAL picks the
  -- lowest company id → deterministic, re-run-stable.
  update leads.permits p
  set crm_company_id = m.id,
      promoted_at    = now()
  from lateral (
    select c.id
    from public.companies c
    where nullif(btrim(c.name), '') is not null
      and lower(btrim(c.name)) = lower(btrim(p.contractor))
    order by c.id
    limit 1
  ) m
  where p.crm_company_id is null
    and nullif(btrim(p.contractor), '') is not null;
  get diagnostics v_by_name = row_count;

  return v_by_license + v_by_name;
end;
$$;

grant execute on function public.auto_link_permits_to_companies() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Portal flagging: no schema change needed. After this function runs, matched
-- permits already carry crm_company_id, and the linked company's lifecycle
-- ('customer' vs 'lead') is read by the Leads page via a batch lookup on
-- public.companies (respecting the leads/public schema boundary). See
-- app/portal/admin/leads/page.tsx.
-- ----------------------------------------------------------------------------
