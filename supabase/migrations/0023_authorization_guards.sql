-- =====================================================================
-- 0023_authorization_guards.sql
--
-- 0022 closed every path reachable with the anon key and no account.
-- Everything here is reachable WITH an account. 0022 enforced
-- authentication; this enforces authorization.
--
--   1. profiles privilege columns — column grants + a BEFORE UPDATE trigger
--   2. promote_permit_to_crm     — caller guard, and search_path = ''
--   3. auto_link_permits_to_companies — caller guard, and the 0008 drift
--                                       resolved by adopting production's body
--   4. the two unindexed foreign keys to companies(id)
--
-- Re-runnable. Wrapped in a transaction. Does NOT touch the companies
-- policies, the storage policies, or the job-photos bucket.
--
-- !! THE GRANT LIST IN PART 1 IS DERIVED FROM THE CODE, NOT CHOSEN. !!
-- !! It is exactly PROFILE_PATCH_COLUMNS in lib/store.ts:1318, which is  !!
-- !! the only authenticated UPDATE path against profiles in the app.     !!
-- !! It DIFFERS from the brief's proposed lock list on four columns —    !!
-- !! see the note above the grant. Read that before changing it.         !!
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- PART 0 — Pre-flight. Abort rather than half-apply.
--
-- The grant in Part 1 names columns explicitly, so it is only correct for
-- the column set it was written against. If profiles has gained or lost a
-- column since, the grant would silently leave the new one either
-- unwritable (breaking a flow) or writable (leaving a hole). Fail loudly.
-- ---------------------------------------------------------------------
do $$
declare
  v_expected text[] := array[
    'company','company_logo','company_tagline','company_website','created_at',
    'email','first_login_at','id','inventory_tracking_enabled','invited_at',
    'must_change_password','name','phone','profile_confirmed','role','status','territory'
  ];
  v_actual text[];
  v_missing text;
  v_extra text;
begin
  select array_agg(attname order by attname) into v_actual
  from pg_attribute
  where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped;

  select string_agg(c, ', ') into v_missing from unnest(v_expected) c where c <> all(v_actual);
  select string_agg(c, ', ') into v_extra   from unnest(v_actual)   c where c <> all(v_expected);

  if v_missing is not null or v_extra is not null then
    raise exception
      'ABORT 0023/0: public.profiles column set has changed. Missing: [%]. Unexpected: [%]. '
      'Re-derive the self-writable grant list from lib/store.ts PROFILE_PATCH_COLUMNS before running this.',
      coalesce(v_missing, 'none'), coalesce(v_extra, 'none');
  end if;
end $$;

-- Guard 0b: is_admin() must exist and be SECURITY DEFINER, since both the
-- trigger and the two function guards below call it.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin' and p.prosecdef
  ) then
    raise exception 'ABORT 0023/0b: public.is_admin() missing or not SECURITY DEFINER.';
  end if;
end $$;

-- Guard 0c: the INSERT design in Part 1 depends on DEFAULTS.
--
-- Revoking INSERT on role/status/inventory_tracking_enabled only produces a
-- safe row if omitting those columns yields 'contractor'/'active'/false. If a
-- default were ever dropped, a self-insert would fail on the NOT NULL instead
-- — or worse, succeed with something unintended. Assert them rather than
-- assume them.
do $$
declare
  v_missing text;
begin
  select string_agg(want.col || ' (want ' || want.def || ')', ', ')
    into v_missing
  from (values ('role','''contractor''::text'),
               ('status','''active''::text'),
               ('inventory_tracking_enabled','false'),
               ('created_at','now()')) as want(col, def)
  left join pg_attrdef d
    on d.adrelid = 'public.profiles'::regclass
   and d.adnum = (select attnum from pg_attribute
                  where attrelid = 'public.profiles'::regclass and attname = want.col)
  where d.adbin is null
     or pg_get_expr(d.adbin, d.adrelid) <> want.def;

  if v_missing is not null then
    raise exception
      'ABORT 0023/0c: public.profiles column defaults are not what the INSERT grant assumes: %. '
      'A self-insert omits these columns and relies on the default being correct.', v_missing;
  end if;
end $$;

-- =====================================================================
-- PART 1 — profiles privilege columns
--
-- Two layers, because either alone is insufficient:
--   Layer 1 (grants)  stops the write at the privilege check, but a later
--                     migration that says `grant update on profiles` undoes it.
--   Layer 2 (trigger) fires regardless of grants AND regardless of RLS, so
--                     it survives that mistake.
-- =====================================================================

-- ---------------------------------------------------------------------
-- LAYER 1 — column-level UPDATE grants.
--
-- Postgres cannot subtract a column from a table-wide grant, so the
-- table-wide grant goes first and the columns come back individually.
--
-- !! THIS LIST IS DERIVED, AND IT DEVIATES FROM THE BRIEF. !!
--
-- Granted (10) = PROFILE_PATCH_COLUMNS, lib/store.ts:1318. That type is the
-- ONLY authenticated UPDATE path against profiles anywhere in the app
-- (lib/store.ts:1330). Its two callers:
--     app/portal/settings/page.tsx:63   company, company_tagline,
--                                       company_website, phone, company_logo
--     components/OnboardingGate.tsx:51  must_change_password, first_login_at
--     components/OnboardingGate.tsx:97  name, company, phone, territory,
--                                       profile_confirmed, first_login_at
--
-- The brief asked to lock territory, must_change_password and first_login_at.
-- ALL THREE ARE WRITTEN BY OnboardingGate AS THE USER THEMSELVES, client-side,
-- during first login. Locking them does not harden anything a user can reach
-- another way — it breaks first-login onboarding for every admin-created
-- contractor, at the password step and again at the confirm step. They are
-- granted here, and the fix is architectural (move those writes to a
-- service-role route, then lock them) rather than a grant edit. See the
-- report accompanying this migration.
--
-- Locked (7) = every column with NO self-write path in the code:
--     id, role, status, email, inventory_tracking_enabled, invited_at, created_at
-- `email` is NOT on the brief's list and is locked anyway: nothing in the app
-- ever self-updates it, and a self-writable email is an account-takeover
-- primitive wherever email is treated as identity.
-- `inventory_tracking_enabled` has exactly one writer, set_inventory_tracking(),
-- which is SECURITY DEFINER and already checks is_admin().
-- ---------------------------------------------------------------------
revoke update on public.profiles from authenticated;

grant update (
  name,
  company,
  phone,
  territory,
  company_logo,
  company_tagline,
  company_website,
  must_change_password,
  profile_confirmed,
  first_login_at
) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- LAYER 1b — column-level INSERT grants.
--
-- Same mechanism, different verb, and it closes the hole the first draft of
-- this migration left open: profiles_insert_self is
-- `WITH CHECK (id = auth.uid())` with NO column restriction, so a user with
-- no profile row could self-insert with role = 'admin'. The UPDATE lockdown
-- above does nothing about that — an INSERT is not an UPDATE.
--
-- Granted (6) = exactly what components/AuthContext.tsx ensureProfile()
-- writes, and nothing else:
--     id, name, email, company, must_change_password, profile_confirmed
--
-- Omitted on purpose, so the row takes its DEFAULT instead of whatever the
-- client asked for (asserted by guard 0c above):
--     role                       -> 'contractor'
--     status                     -> 'active'
--     inventory_tracking_enabled -> false
--     created_at                 -> now()
--     invited_at                 -> NULL   (correct: a self-created account
--                                           was never invited by an admin)
--
-- ensureProfile USED TO SEND role AND status EXPLICITLY. A column-level
-- privilege is checked against the columns NAMED in the statement, so
-- sending `role: "contractor"` would be denied even though the value is the
-- same as the default. components/AuthContext.tsx has been changed in this
-- commit to omit both. The two service-role inserters — the create-contractor
-- route and scripts/create-admin.mjs — are unaffected: service_role bypasses
-- column privileges entirely, which is what lets an admin mint a contractor
-- with must_change_password = true and invited_at set.
--
-- phone, territory, first_login_at and the three company_* branding columns
-- are also omitted: ensureProfile does not write them, and they are all
-- nullable, so they arrive NULL and the user fills them in later through the
-- UPDATE path granted above.
-- ---------------------------------------------------------------------
revoke insert on public.profiles from authenticated;

grant insert (
  id,
  name,
  email,
  company,
  must_change_password,
  profile_confirmed
) on public.profiles to authenticated;

-- anon holds nothing on profiles as of 0022; this is belt and braces only.
revoke all on public.profiles from anon;

-- ---------------------------------------------------------------------
-- LAYER 2 — BEFORE INSERT OR UPDATE trigger.
--
-- Triggers fire regardless of RLS and regardless of grants, so this holds
-- even if someone restores a table-wide grant by accident later.
--
-- Both verbs, because they fail differently:
--   UPDATE — no locked column may change.
--   INSERT — the row must arrive as an ordinary contractor. `id = auth.uid()`
--            is already enforced by the profiles_insert_self policy and is
--            deliberately NOT repeated here; two places enforcing one rule is
--            how they drift apart.
--
-- Callers allowed through:
--   * the table owner — SECURITY DEFINER functions run as the owner, which
--     is how set_inventory_tracking() writes inventory_tracking_enabled.
--     Resolved from pg_class rather than hardcoded as 'postgres'.
--   * service_role — checked via current_user, NOT via is_admin(), because
--     is_admin() reads auth.uid() and that is null on a service-role
--     connection. reset-password.mjs:73 sets must_change_password this way.
--   * admins — via is_admin(), which is exactly what this trigger makes
--     trustworthy. is_admin() still reads profiles.role, deliberately: the
--     point of Part 1 is that role is no longer self-writable, so reading it
--     is now sound. Do not repoint is_admin() somewhere else.
-- ---------------------------------------------------------------------
create or replace function public.profiles_guard_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_col   text;
begin
  select pg_catalog.pg_get_userbyid(c.relowner) into v_owner
  from pg_catalog.pg_class c where c.oid = 'public.profiles'::regclass;

  -- Privileged callers pass straight through, on either verb. This is what
  -- keeps the create-contractor route working: it inserts with
  -- must_change_password = true, invited_at set and status supplied, all as
  -- service_role.
  if current_user = v_owner
     or current_user = 'service_role'
     or public.is_admin()
  then
    return new;
  end if;

  -- INSERT: an unprivileged caller may only create an ordinary, active
  -- contractor. The column grant above already forces this by making the
  -- columns take their defaults; this is the layer that still holds if the
  -- grant is ever restored.
  if TG_OP = 'INSERT' then
    if new.role is distinct from 'contractor' then
      raise exception
        'PROFILE_FORBIDDEN: a self-created profile must have role = ''contractor'' (got %)', new.role
        using errcode = '42501';
    end if;
    if new.status is distinct from 'active' then
      raise exception
        'PROFILE_FORBIDDEN: a self-created profile must have status = ''active'' (got %)', new.status
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE: no locked column may change. `is distinct from` rather than
  -- `<>` so a NULL on either side still counts as a change.
  v_col := case
    when new.id                         is distinct from old.id                         then 'id'
    when new.role                       is distinct from old.role                       then 'role'
    when new.status                     is distinct from old.status                     then 'status'
    when new.email                      is distinct from old.email                      then 'email'
    when new.inventory_tracking_enabled is distinct from old.inventory_tracking_enabled then 'inventory_tracking_enabled'
    when new.invited_at                 is distinct from old.invited_at                 then 'invited_at'
    when new.created_at                 is distinct from old.created_at                 then 'created_at'
    else null
  end;

  if v_col is not null then
    raise exception
      'PROFILE_FORBIDDEN: column "%" is not self-writable. Admin or service role required.', v_col
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.profiles_guard_privilege_columns() is
  'Added by 0023. Fires BEFORE INSERT OR UPDATE on public.profiles, regardless of RLS and '
  'regardless of grants, so it survives a table-wide grant being restored by mistake. '
  'On UPDATE: blocks any change to id, role, status, email, inventory_tracking_enabled, '
  'invited_at or created_at. '
  'On INSERT: requires role = ''contractor'' and status = ''active'', which closes the '
  'self-insert-as-admin path left open by profiles_insert_self having no column restriction. '
  'id = auth.uid() stays enforced by that policy and is not duplicated here. '
  'Admins, service_role and the table owner pass through on both verbs.';

drop trigger if exists profiles_guard_privilege_columns on public.profiles;
create trigger profiles_guard_privilege_columns
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_privilege_columns();

-- =====================================================================
-- PART 2 — promote_permit_to_crm
--
-- Two fixes in one create-or-replace:
--   a. A caller guard as the first statement, matching the shape
--      set_inventory_tracking already uses.
--   b. SET search_path TO 'public','leads'  ->  SET search_path TO ''.
--      Verified against Query D: every reference in the body is already
--      schema-qualified (leads.permits, public.companies, and
--      leads.permits%rowtype), so only the setting changes. The remaining
--      bare identifiers — coalesce, nullif, lower, substring, now — all
--      resolve from pg_catalog, which is always on the path.
--
-- A SECURITY DEFINER function with a mutable search_path is the classic
-- escalation shape, and this was the only definer function in the database
-- that still had one.
-- =====================================================================
create or replace function public.promote_permit_to_crm(p_permit_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  p   leads.permits%rowtype;
  cid uuid;
begin
  if not (current_user = 'service_role' or public.is_admin()) then
    raise exception 'PERMIT_FORBIDDEN: admin role required to promote a permit'
      using errcode = '42501';
  end if;

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

comment on function public.promote_permit_to_crm(bigint) is
  'SECURITY DEFINER. anon/PUBLIC execute revoked in 0022. '
  'Caller guard and search_path = '''' added in 0023. '
  'Called from app/portal/admin/leads/page.tsx:140 by an admin session.';

-- =====================================================================
-- PART 3 — auto_link_permits_to_companies, and the 0008 drift
--
-- The body below is PRODUCTION's (Query D, the `distinct on` form), not
-- migration 0008's (the `lateral` form). They produce identical results —
-- both select the lowest companies.id per lower-cased trimmed name — but
-- production's is what has actually been running. Adopting it here makes
-- 0023 the authoritative definition and resolves the drift permanently,
-- rather than resolving it in 0008's favour and changing what runs.
--
-- Only the guard is added; search_path was already '' and every reference
-- was already qualified.
--
-- !! CALLED BY sync.py, WEEKLY, FROM OUTSIDE THIS REPOSITORY. !!
-- The guard admits service_role for exactly that reason. If that job is NOT
-- using the service role key it is already broken as of 0022, which revoked
-- anon EXECUTE on this function and anon USAGE on schema leads — and it
-- would fail silently, unattended, once a week. See the 0023 report.
-- =====================================================================
create or replace function public.auto_link_permits_to_companies()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_by_license integer := 0;
  v_by_name    integer := 0;
begin
  if not (current_user = 'service_role' or public.is_admin()) then
    raise exception 'PERMIT_FORBIDDEN: admin or service role required to relink permits'
      using errcode = '42501';
  end if;

  -- Pass 1 — license_num (exact, trimmed)
  update leads.permits p
  set    crm_company_id = c.id,
         promoted_at    = now()
  from   public.companies c
  where  p.crm_company_id is null
    and  nullif(btrim(p.license_num), '') is not null
    and  nullif(btrim(c.license_num), '') is not null
    and  btrim(p.license_num) = btrim(c.license_num);
  get diagnostics v_by_license = row_count;

  -- Pass 2 — case-insensitive contractor name (still-unlinked only)
  update leads.permits p
  set    crm_company_id = m.company_id,
         promoted_at    = now()
  from   (
           select distinct on (lower(btrim(c.name)))
                  c.id as company_id,
                  lower(btrim(c.name)) as match_name
           from   public.companies c
           where  nullif(btrim(c.name), '') is not null
           order by lower(btrim(c.name)), c.id
         ) m
  where  p.crm_company_id is null
    and  nullif(btrim(p.contractor), '') is not null
    and  lower(btrim(p.contractor)) = m.match_name;
  get diagnostics v_by_name = row_count;

  return v_by_license + v_by_name;
end;
$function$;

comment on function public.auto_link_permits_to_companies() is
  'SECURITY DEFINER. anon/PUBLIC execute revoked in 0022; caller guard added in 0023. '
  'The body here is PRODUCTION''s distinct-on form, which supersedes the lateral form in '
  '0008 — 0023 is the authoritative definition. Called weekly by sync.py via service_role.';

-- =====================================================================
-- PART 4 — the two unindexed foreign keys
--
-- Postgres creates an index for a primary key or a unique constraint, never
-- for a foreign key. Both of these reference companies(id) with NO ACTION,
-- so every DELETE on companies scans the referencing table to enforce it.
--
-- Plain CREATE INDEX, not CONCURRENTLY: CONCURRENTLY cannot run inside a
-- transaction block, and both tables are small (877 permits at capture).
--
-- crm_company_id also backs the inside_leads LEFT JOIN and Pass 1 of the
-- function above, so that one is a read win as well as a delete win.
-- =====================================================================
create index if not exists projects_company_id_idx
  on public.projects (company_id);

create index if not exists permits_crm_company_id_idx
  on leads.permits (crm_company_id);

commit;


-- =====================================================================
-- =====================================================================
--                          VERIFY SCRIPT
--
-- Everything below this line is READ-ONLY and changes nothing. Run it in
-- the SQL Editor after applying the migration and review the rows.
-- Every row must read pass = true.
-- =====================================================================
-- =====================================================================

with locked(col) as (
  values ('id'),('role'),('status'),('email'),
         ('inventory_tracking_enabled'),('invited_at'),('created_at')
),
writable(col) as (
  values ('name'),('company'),('phone'),('territory'),
         ('company_logo'),('company_tagline'),('company_website'),
         ('must_change_password'),('profile_confirmed'),('first_login_at')
),
-- INSERT must be impossible on these, so a self-insert takes the defaults
ins_locked(col) as (
  values ('role'),('status'),('inventory_tracking_enabled'),
         ('invited_at'),('created_at')
),
-- INSERT must still work on exactly what ensureProfile() writes
ins_allowed(col) as (
  values ('id'),('name'),('email'),('company'),
         ('must_change_password'),('profile_confirmed')
)

-- 1. authenticated must NOT be able to UPDATE any locked column
select
  '1. locked column not updatable' as check,
  col                              as detail,
  'false'                          as expected,
  has_column_privilege('authenticated','public.profiles',col,'UPDATE')::text as actual,
  has_column_privilege('authenticated','public.profiles',col,'UPDATE') = false as pass
from locked

union all
-- 2. authenticated MUST still be able to UPDATE every column the app writes
select
  '2. app column still updatable',
  col,
  'true',
  has_column_privilege('authenticated','public.profiles',col,'UPDATE')::text,
  has_column_privilege('authenticated','public.profiles',col,'UPDATE') = true
from writable

union all
-- 3a. authenticated must NOT be able to INSERT any privilege column
select
  '3a. locked column not insertable',
  col,
  'false',
  has_column_privilege('authenticated','public.profiles',col,'INSERT')::text,
  has_column_privilege('authenticated','public.profiles',col,'INSERT') = false
from ins_locked

union all
-- 3b. authenticated MUST still be able to INSERT what ensureProfile writes
select
  '3b. ensureProfile column insertable',
  col,
  'true',
  has_column_privilege('authenticated','public.profiles',col,'INSERT')::text,
  has_column_privilege('authenticated','public.profiles',col,'INSERT') = true
from ins_allowed

union all
-- 3c. the trigger exists, is enabled ('O' = enabled/origin), and fires on
--     BEFORE (bit 2), INSERT (bit 4) and UPDATE (bit 16), per row (bit 1)
select
  '3c. trigger enabled, both verbs',
  coalesce(t.tgname,'profiles_guard_privilege_columns'),
  'enabled=O before=t insert=t update=t',
  coalesce(
    'enabled=' || t.tgenabled
      || ' before=' || ((t.tgtype &  2) <> 0)::text
      || ' insert=' || ((t.tgtype &  4) <> 0)::text
      || ' update=' || ((t.tgtype & 16) <> 0)::text,
    'MISSING'),
  coalesce(t.tgenabled,'X') = 'O'
    and coalesce((t.tgtype &  2) <> 0, false)
    and coalesce((t.tgtype &  4) <> 0, false)
    and coalesce((t.tgtype & 16) <> 0, false)
from (select 1) x
left join pg_trigger t
  on t.tgrelid = 'public.profiles'::regclass
 and t.tgname  = 'profiles_guard_privilege_columns'
 and not t.tgisinternal

union all
-- 4. both functions carry their guard
select
  '4. function guard present',
  p.proname,
  'true',
  (p.prosrc like '%42501%')::text,
  p.prosrc like '%42501%'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('promote_permit_to_crm','auto_link_permits_to_companies')

union all
-- 5. promote_permit_to_crm has search_path = '' (stored as search_path="")
select
  '5. search_path is empty',
  p.proname,
  'search_path=""',
  coalesce(array_to_string(p.proconfig,'; '),'(none)'),
  coalesce(array_to_string(p.proconfig,'; '),'') = 'search_path=""'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'promote_permit_to_crm'

union all
-- 6. both foreign-key indexes exist
select
  '6. fk index exists',
  want.idx,
  'true',
  (i.indexname is not null)::text,
  i.indexname is not null
from (values ('public','projects','projects_company_id_idx'),
             ('leads','permits','permits_crm_company_id_idx')) as want(sch,tbl,idx)
left join pg_indexes i
  on i.schemaname = want.sch and i.tablename = want.tbl and i.indexname = want.idx

order by 1, 2;
