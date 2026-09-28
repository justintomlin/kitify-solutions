# Kitify Solutions — Production Extraction Addendum (Queries D, E, G)
Captured 2026-09-28 from Supabase project `zsyvvosswizedvdtnbbx` (us-west-2) via the Supabase SQL Editor.
Companion to `Kitify_Production_Extraction_Output.md` (Queries A, B, C, F).
Raw CSV, unedited.

## !! CRITICAL READING NOTE — THESE THREE QUERIES RAN *AFTER* MIGRATION 0022 !!

Queries A, B, C and F were captured BEFORE 0022. These three were captured AFTER.
So D, E and G show the FIXED state, not the state a baseline file must document.

When writing B04, B05 and B06, reconstruct the PRE-0022 state as follows:

**Functions (B05).** D shows every function with `anon_can_execute = false` and ACLs
containing only postgres, authenticated and service_role. Before 0022 the state was:
- `anon_can_execute = true` on all of them
- the ACL contained a bare `=X/postgres` entry, meaning PUBLIC held EXECUTE
Document the pre-0022 grants. Add a comment at each one pointing to 0022.

**Storage (B06).** E shows TWO buckets. Before 0022 only `job-photos` existed.
`company-logos` was created BY 0022 (note its created_at of 2026-09-28T18:39:25Z,
which is the migration run, not the original build). Four of the six policies
referenced `company-logos` while the bucket did not exist, which is why the settings
page logo upload failed silently. Document that: it is the evidence for the bug.

**Sequences (B01/B03).** G shows anon holding nothing on the leads sequences. That was
ALSO true before 0022 — anon never had sequence privileges. Schema USAGE was the entire
reason `leads` was reachable with the anon key, consistent with the finding already
recorded in B01 and B03.

## Findings recorded from these three queries

- `set_inventory_tracking` ALREADY enforces `is_admin()` as its first statement and does
  NOT need an authorization guard written. It is guarded by a function that reads
  `profiles.role`, which is self-writable, so fixing the role write repairs this for free.
- `promote_permit_to_crm` has NO authorization check. Any authenticated caller can promote
  any permit. Needs a guard.
- `promote_permit_to_crm` is SECURITY DEFINER with `SET search_path TO 'public', 'leads'`.
  Every other definer function uses `search_path = ''` with fully-qualified references.
  A definer function with a mutable search path is the classic escalation shape. Rewrite it
  to `search_path = ''` with fully-qualified references, matching the other functions.
- `auto_link_permits_to_companies` has no authorization check either. Lower severity (it
  links rather than exposes) but any authenticated user can trigger a full two-pass relink
  and stamp `promoted_at` across all 877 permits.
- `job-photos` has `file_size_limit: null` and `allowed_mime_types: null` while public.
  Any authenticated user can upload any file type at any size and receive a permanent
  public URL on the Supabase domain. Fold a size limit and image-only MIME restriction
  into 0023 alongside the `public = false` flip.
- All six storage policies check only `bucket_id`. Two are named "their own" and check
  nothing of the kind.
- `storage.objects` and `storage.buckets` still grant anon full DML. 0022 covered `public`
  and `leads` only. RLS blocks it today. CAUTION: the "Anyone can view company logos"
  policy is `roles=public`, which includes anon, so do NOT blanket-revoke anon SELECT on
  `storage.objects` or the logo on the unauthenticated proposal page stops rendering.
- `projects.company_id` is uuid, nullable, no default, FK with no ON DELETE action, and
  has NO INDEX. Unindexed FK: every company delete scans projects.
- `permits_id_seq` last_value 1754 against 877 rows; `sources_id_seq` 44 against 22.
  Roughly half the IDs are burned by insert-on-conflict in the weekly sync. Sequence
  position is not a row count.


---

## QUERY D — Functions: definitions, security_definer, config, ACL, execute privileges

```csv
function,returns,language,security_definer,volatility,config,owner,acl,anon_can_execute,authenticated_can_execute,definition
public.auto_link_permits_to_companies(),integer,plpgsql,true,volatile,"search_path=""""",postgres,"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",false,true,"CREATE OR REPLACE FUNCTION public.auto_link_permits_to_companies()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_by_license integer := 0;
  v_by_name    integer := 0;
begin
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
$function$
"
public.claims_set_claim_number(),trigger,plpgsql,false,volatile,(none),postgres,"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",false,true,"CREATE OR REPLACE FUNCTION public.claims_set_claim_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.claim_number is null or new.claim_number = '' then
    new.claim_number := public.next_claim_number();
  end if;
  return new;
end;
$function$
"
public.is_admin(),boolean,sql,true,stable,"search_path=""""",postgres,"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",false,true,"CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$function$
"
public.next_claim_number(),text,plpgsql,true,volatile,"search_path=""""",postgres,"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",false,true,"CREATE OR REPLACE FUNCTION public.next_claim_number()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_period text := to_char(now(), 'YYYYMM');
  v_seq integer;
begin
  insert into public.claim_number_counters as c (period, last_seq)
  values (v_period, 1)
  on conflict (period) do update set last_seq = c.last_seq + 1
  returning c.last_seq into v_seq;
  return 'CLM-' || v_period || '-' || lpad(v_seq::text, 4, '0');
end;
$function$
"
public.next_order_number(),text,plpgsql,true,volatile,"search_path=""""",postgres,"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",false,true,"CREATE OR REPLACE FUNCTION public.next_order_number()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_period text := to_char(now(), 'YYYYMM');
  v_seq    integer;
begin
  insert into public.order_number_counters as c (period, last_seq)
  values (v_period, 1)
  on conflict (period) do update set last_seq = c.last_seq + 1
  returning c.last_seq into v_seq;
  return 'KIT-' || v_period || '-' || lpad(v_seq::text, 4, '0');
end;
$function$
"
public.orders_set_order_number(),trigger,plpgsql,false,volatile,(none),postgres,"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",false,true,"CREATE OR REPLACE FUNCTION public.orders_set_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := public.next_order_number();
  end if;
  return new;
end;
$function$
"
public.promote_permit_to_crm(p_permit_id bigint),uuid,plpgsql,true,volatile,"search_path=public, leads",postgres,"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",false,true,"CREATE OR REPLACE FUNCTION public.promote_permit_to_crm(p_permit_id bigint)
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
end $function$
"
"public.set_inventory_tracking(p_owner_id uuid, p_enabled boolean)",boolean,plpgsql,true,volatile,"search_path=""""",postgres,"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",false,true,"CREATE OR REPLACE FUNCTION public.set_inventory_tracking(p_owner_id uuid, p_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result boolean;
begin
  if not public.is_admin() then
    raise exception 'INVENTORY_FORBIDDEN: admin role required to change inventory tracking'
      using errcode = '42501';
  end if;
  if p_owner_id is null or p_enabled is null then
    raise exception 'INVENTORY_INVALID: owner id and enabled flag are both required'
      using errcode = '22023';
  end if;

  update public.profiles
     set inventory_tracking_enabled = p_enabled
   where id = p_owner_id
  returning inventory_tracking_enabled into v_result;

  if not found then
    raise exception 'INVENTORY_NO_PROFILE: no profile with id %', p_owner_id
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$function$
"
public.set_updated_at(),trigger,plpgsql,false,volatile,(none),postgres,"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",false,true,"CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
"
```

---

## QUERY E — Storage: buckets, RLS, all six policies, table grants, object counts

```csv
section,item,detail
bucket,company-logos,"{""id"":""company-logos"",""name"":""company-logos"",""owner"":null,""created_at"":""2026-09-28T18:39:25.491023+00:00"",""updated_at"":""2026-09-28T18:39:25.491023+00:00"",""public"":true,""avif_autodetection"":false,""file_size_limit"":2097152,""allowed_mime_types"":[""image/png"",""image/jpeg"",""image/webp""],""owner_id"":null,""type"":""STANDARD"",""versioning_status"":""DISABLED"",""lifecycle_configuration"":null,""lifecycle_configuration_generation"":null}"
bucket,job-photos,"{""id"":""job-photos"",""name"":""job-photos"",""owner"":null,""created_at"":""2026-08-02T17:45:41.74721+00:00"",""updated_at"":""2026-08-02T17:45:41.74721+00:00"",""public"":true,""avif_autodetection"":false,""file_size_limit"":null,""allowed_mime_types"":null,""owner_id"":null,""type"":""STANDARD"",""versioning_status"":""DISABLED"",""lifecycle_configuration"":null,""lifecycle_configuration_generation"":null}"
rls,buckets,enabled=t forced=f
rls,objects,enabled=t forced=f
policy:objects,Anyone can view company logos,cmd=SELECT | permissive=t | roles=public | USING: (bucket_id = 'company-logos'::text) | WITH CHECK: (none)
policy:objects,Authenticated users can upload company logos,cmd=INSERT | permissive=t | roles=authenticated | USING: (none) | WITH CHECK: (bucket_id = 'company-logos'::text)
policy:objects,Authenticated users can upload job photos,cmd=INSERT | permissive=t | roles=authenticated | USING: (none) | WITH CHECK: (bucket_id = 'job-photos'::text)
policy:objects,Authenticated users can view job photos,cmd=SELECT | permissive=t | roles=authenticated | USING: (bucket_id = 'job-photos'::text) | WITH CHECK: (none)
policy:objects,Users can delete their own company logos,cmd=DELETE | permissive=t | roles=authenticated | USING: (bucket_id = 'company-logos'::text) | WITH CHECK: (none)
policy:objects,Users can delete their own job photos,cmd=DELETE | permissive=t | roles=authenticated | USING: (bucket_id = 'job-photos'::text) | WITH CHECK: (none)
table_priv:buckets,anon,SELECT=t INSERT=t UPDATE=t DELETE=t
table_priv:buckets,authenticated,SELECT=t INSERT=t UPDATE=t DELETE=t
table_priv:objects,anon,SELECT=t INSERT=t UPDATE=t DELETE=t
table_priv:objects,authenticated,SELECT=t INSERT=t UPDATE=t DELETE=t
objects,job-photos,count=3 | top-level folders=1 | first folders: orders
```

---

## QUERY G — projects.company_id + leads sequences and their privileges

```csv
object,section,detail
leads.permits_id_seq,seq_priv:anon,USAGE=f SELECT=f UPDATE=f
leads.permits_id_seq,seq_priv:authenticated,USAGE=t SELECT=t UPDATE=f
leads.permits_id_seq,sequence,type=bigint start=1 increment=1 last_value=1754 owner=postgres
leads.sources_id_seq,seq_priv:anon,USAGE=f SELECT=f UPDATE=f
leads.sources_id_seq,seq_priv:authenticated,USAGE=t SELECT=t UPDATE=f
leads.sources_id_seq,sequence,type=bigint start=1 increment=1 last_value=44 owner=postgres
leads.weekly_pulls_id_seq,seq_priv:anon,USAGE=f SELECT=f UPDATE=f
leads.weekly_pulls_id_seq,seq_priv:authenticated,USAGE=t SELECT=t UPDATE=f
leads.weekly_pulls_id_seq,sequence,type=bigint start=1 increment=1 last_value=7 owner=postgres
public.projects.company_id,column,uuid
public.projects.company_id,constraint:projects_company_id_fkey,FOREIGN KEY (company_id) REFERENCES companies(id)
```
