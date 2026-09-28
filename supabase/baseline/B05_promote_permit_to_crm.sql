-- =====================================================================
-- B05_promote_permit_to_crm.sql
--
-- PRODUCTION SNAPSHOT — DOCUMENTATION ONLY — DO NOT RUN AGAINST PRODUCTION.
--
-- public.promote_permit_to_crm(bigint) as it stood on 2026-09-28,
-- BEFORE migration 0022. No migration in supabase/migrations/ creates it.
--
-- Source: Query D in supabase/scratchpad/Kitify_Production_Extraction_Addendum_DEG.md
--
-- !! RECONSTRUCTED. Query D ran AFTER 0022, so the ACL it reports is the
-- !! FIXED one. The grants below are the PRE-0022 state, rebuilt per the
-- !! addendum's reading note. The function BODY is unchanged by 0022 and is
-- !! reproduced verbatim.
--
-- Requires B01 (schema leads), B02 (public.companies), B03 (leads.permits).
-- =====================================================================

-- ---------------------------------------------------------------------
-- GUARD.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'promote_permit_to_crm'
  ) then
    raise exception
      'B05 ABORT: public.promote_permit_to_crm already exists. This is a PRE-0022 production '
      'snapshot and must never be applied to a database that already has it. '
      'See supabase/baseline/README.md.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- THE FUNCTION — body verbatim from Query D, including the search_path.
--
-- TWO THINGS ARE WRONG WITH IT, AND BOTH ARE DELIBERATE RECORDS:
--
-- 1. NO AUTHORIZATION CHECK. The body does not ask who is calling. Any
--    caller holding EXECUTE can promote any permit by id, creating a
--    companies row as a side effect. Compare set_inventory_tracking, whose
--    very first statement is `if not public.is_admin() then raise`.
--    0022 revoked anon and PUBLIC, so it now needs an account — but every
--    authenticated user still qualifies.
--
-- 2. MUTABLE search_path ON A SECURITY DEFINER FUNCTION.
--    `SET search_path TO 'public', 'leads'` with unqualified references
--    inside (`leads.permits%rowtype` is qualified, but the resolution of
--    `public.companies` relies on the configured path being intact).
--    Every other SECURITY DEFINER function in this database — is_admin,
--    next_order_number, next_claim_number, auto_link_permits_to_companies,
--    set_inventory_tracking — uses `search_path = ''` with fully-qualified
--    names. This one is the exception, and a definer function with a
--    mutable search path is the classic privilege-escalation shape.
--
-- BOTH DEFERRED TO SESSION 2, and they are ONE edit: rewriting the body to
-- `search_path = ''` with fully-qualified references is the same change that
-- adds the guard. See scratchpad/Phase1_Session2_Notes.md.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_permit_to_crm(p_permit_id bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'leads'
AS $function$
declare
  p   leads.permits%rowtype;
  cid uuid;
begin
  select * into p from leads.permits where id = p_permit_id;
  if not found then
    raise exception 'permit % not found', p_permit_id;
  end if;

  if p.license_num is not null and p.license_num <> '' then
    select id into cid from public.companies
      where license_num = p.license_num;
  end if;
  if cid is null and p.contractor is not null then
    select id into cid from public.companies
      where lower(name) = lower(p.contractor) limit 1;
  end if;

  if cid is null then
    insert into public.companies
      (name, license_num, phone, contact_info, account_type, source, lifecycle)
    values (
      coalesce(p.contractor, 'Unknown - ' || p.permit_num),
      nullif(p.license_num, ''),
      substring(p.contact from '\(\d{3}\)\s?\d{3}-\d{4}'),
      p.contact,
      p.account_type,
      'permit-tracker',
      'lead')
    returning id into cid;
  end if;

  update leads.permits
     set crm_company_id = cid, promoted_at = now()
   where id = p_permit_id;

  return cid;
end $function$;

alter function public.promote_permit_to_crm(bigint) owner to postgres;

-- ---------------------------------------------------------------------
-- GRANTS — PRE-0022, RECONSTRUCTED. Do not take these from Query D's CSV.
--
-- Query D reports, POST-0022:
--     acl = {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--     anon_can_execute = false
--
-- The addendum's reading note gives the pre-0022 shape: anon held EXECUTE,
-- and the ACL carried a bare `=X/postgres` entry, which is PUBLIC.
--
-- That reconstruction is corroborated directly, not just asserted. The
-- ORIGINAL extraction file captured is_admin()'s ACL before 0022:
--     {=X/postgres,postgres=X/postgres,anon=X/postgres,
--      authenticated=X/postgres,service_role=X/postgres}
-- — the bare `=X/postgres` and the explicit anon entry, exactly as described.
-- The two files agree across the 0022 boundary.
--
-- PUBLIC matters more than anon here. A grant to PUBLIC covers every role
-- that exists or ever will, so it survives adding a new role and is not
-- removed by revoking from anon alone. 0022 revoked both, by name and by
-- exact signature.
-- ---------------------------------------------------------------------
grant execute on function public.promote_permit_to_crm(bigint) to public;           -- REVOKED BY 0022
grant execute on function public.promote_permit_to_crm(bigint) to anon;             -- REVOKED BY 0022
grant execute on function public.promote_permit_to_crm(bigint) to authenticated;
grant execute on function public.promote_permit_to_crm(bigint) to service_role;

-- ---------------------------------------------------------------------
-- RELATED, recorded here because Query D captured it and no baseline file
-- owns it: public.auto_link_permits_to_companies() ALSO has no
-- authorization check. Lower severity — it links permits to companies
-- rather than exposing anything — but any authenticated user can trigger a
-- full two-pass relink and stamp promoted_at across all 877 permits.
-- That function IS created by migration 0008, so it is not baseline
-- material. Carried into Session 2.
--
-- SEE ALSO: the drift note in supabase/baseline/README.md. Production's
-- copy of auto_link_permits_to_companies does not match 0008's source.
-- ---------------------------------------------------------------------
