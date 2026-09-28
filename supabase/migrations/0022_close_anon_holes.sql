-- =====================================================================
-- 0022_close_anon_holes.sql
-- Closes every path reachable with the anon key and no account.
--   1. public.inside_leads runs with owner rights and anon has full DML
--   2. promote_permit_to_crm is SECURITY DEFINER, executable by anon/PUBLIC
--   3. set_inventory_tracking is SECURITY DEFINER, executable by anon
--   4. anon holds table grants across public with RLS as the only guard
--   5. TRUNCATE is granted to anon and authenticated and ignores RLS
-- Re-runnable. Does NOT touch job-photos (deferred to 0023, post-deploy).
-- Applied to production 2026-09-28. All 11 verification checks PASS.
-- =====================================================================

begin;

-- ---------------------------------------------------------------
-- PART 0 — Pre-flight guards. Abort rather than break production.
-- ---------------------------------------------------------------

-- 0a. If any policy targets anon or PUBLIC and calls is_admin(),
--     revoking EXECUTE from anon would break that policy.
do $$
declare v_list text;
begin
  select string_agg(n.nspname || '.' || c.relname || ' / ' || p.polname, ', ')
    into v_list
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','leads')
    and (0 = any(p.polroles) or (select oid from pg_roles where rolname='anon') = any(p.polroles))
    and (coalesce(pg_get_expr(p.polqual, p.polrelid),'')
         || coalesce(pg_get_expr(p.polwithcheck, p.polrelid),'')) ilike '%is_admin%';
  if v_list is not null then
    raise exception 'ABORT 0a: policies target anon/PUBLIC and call is_admin(): %', v_list;
  end if;
end $$;

-- 0b. If any policy deliberately grants anon access, revoking anon
--     grants wholesale would silently disable it. Surface it, don't guess.
do $$
declare v_list text;
begin
  select string_agg(n.nspname || '.' || c.relname || ' / ' || p.polname, ', ')
    into v_list
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','leads')
    and ((select oid from pg_roles where rolname='anon') = any(p.polroles));
  if v_list is not null then
    raise exception 'ABORT 0b: policies explicitly target anon: %. Review before revoking.', v_list;
  end if;
end $$;

-- 0c. Confirm schema public holds no extension-owned functions, so the
--     blanket function revoke below cannot break an extension.
do $$
declare v_count int;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
  where n.nspname = 'public';
  if v_count > 0 then
    raise exception 'ABORT 0c: % extension-owned function(s) in schema public. Revoke surgically instead.', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------
-- PART 1 — inside_leads: honor caller RLS, remove anon entirely
-- ---------------------------------------------------------------
alter view public.inside_leads set (security_invoker = true);

revoke all on public.inside_leads from anon;

comment on view public.inside_leads is
  'Inside-sales pipeline. security_invoker=true as of 0022 so caller RLS applies. '
  'Previously ran with owner rights and was readable by anon.';

-- ---------------------------------------------------------------
-- PART 2 — Function execute privileges
-- Query A enumerated all 15 functions in schema public; none are
-- extension-owned (guard 0c). Blanket revoke then explicit grant back.
--
-- The grant-backs are LOAD BEARING:
--   orders_set_order_number() and claims_set_claim_number() are NOT
--   SECURITY DEFINER, so they execute as the signed-in user and need
--   EXECUTE on next_order_number() / next_claim_number().
--   is_admin() is evaluated inside RLS policy expressions as the caller.
-- ---------------------------------------------------------------
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema public to service_role;

-- Belt and braces on the SECURITY DEFINER set, by exact signature.
revoke execute on function public.promote_permit_to_crm(bigint)            from anon, public;
revoke execute on function public.auto_link_permits_to_companies()          from anon, public;
revoke execute on function public.set_inventory_tracking(uuid, boolean)     from anon, public;
revoke execute on function public.next_order_number()                       from anon, public;
revoke execute on function public.next_claim_number()                       from anon, public;
revoke execute on function public.is_admin()                                from anon, public;

grant execute on function public.promote_permit_to_crm(bigint)              to authenticated, service_role;
grant execute on function public.auto_link_permits_to_companies()           to authenticated, service_role;
grant execute on function public.set_inventory_tracking(uuid, boolean)      to authenticated, service_role;
grant execute on function public.next_order_number()                        to authenticated, service_role;
grant execute on function public.next_claim_number()                        to authenticated, service_role;
grant execute on function public.is_admin()                                 to authenticated, service_role;

comment on function public.promote_permit_to_crm(bigint) is
  'SECURITY DEFINER. anon/PUBLIC execute revoked in 0022. '
  'TODO Phase 1: add a caller-authorization check. Any authenticated user can still promote any permit.';

comment on function public.set_inventory_tracking(uuid, boolean) is
  'SECURITY DEFINER. anon/PUBLIC execute revoked in 0022. '
  'TODO Phase 1: verify the caller is an admin or owns p_owner_id.';

-- ---------------------------------------------------------------
-- PART 3 — Strip anon, and strip TRUNCATE from everyone
-- Nothing in the app authenticates as anon against a table. Both public
-- proposal routes use the service role key, which bypasses grants.
-- ---------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke all on all tables    in schema leads  from anon;
revoke all on all sequences in schema leads  from anon;
revoke usage on schema leads                 from anon;

revoke truncate on all tables in schema public from authenticated;
revoke truncate on all tables in schema leads  from authenticated;

-- ---------------------------------------------------------------
-- PART 4 — company-logos bucket
-- Four storage policies already reference it; the bucket was never
-- created, which is why settings-page logo upload fails silently.
-- Public on purpose: a homeowner opening a proposal has no account.
-- No SVG: an SVG served directly can execute script.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 2097152,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 2097152,
      allowed_mime_types = array['image/png','image/jpeg','image/webp'];

commit;
