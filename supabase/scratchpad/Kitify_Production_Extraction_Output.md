# Kitify Solutions — Production Extraction Output
Captured 2026-09-28 from Supabase project `zsyvvosswizedvdtnbbx` (us-west-2) via the Supabase SQL Editor.
Raw CSV, unedited, one block per query.

STILL MISSING from this file, JT is re-running them:
- Query D (functions: `promote_permit_to_crm` definition, config, acl)
- Query E (storage: bucket JSON and the six policies on `storage.objects`)
- Query G (projects.company_id + leads sequences)

CONFIRMED DASHBOARD SETTINGS (no SQL equivalent):
- Exposed schemas: graphql_public, leads, public
- Exposed tables: 19 of 22. The three `leads` tables show warning icons, not checkmarks.
- "Automatically expose new tables": ON
- Auth: signup OFF, manual linking OFF, anonymous sign-ins OFF, confirm email OFF. Email is the only enabled provider.
- `docs/migrations/2026-08-04-proposal-enhancements.sql` IS applied in production (6 columns verified).


---

## QUERY A — Inventory of public and leads, schema ACL, authenticator config

```csv
schema,kind,name,detail
config,authenticator role settings,rolconfig,"session_preload_libraries=supautils, safeupdate; statement_timeout=8s; lock_timeout=8s"
config,schema,leads,"owner=postgres | acl={postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres,service_role=U/postgres}"
leads,sequence,permits_id_seq,owner=postgres
leads,sequence,sources_id_seq,owner=postgres
leads,sequence,weekly_pulls_id_seq,owner=postgres
leads,table,permits,owner=postgres
leads,table,sources,owner=postgres
leads,table,weekly_pulls,owner=postgres
public,enum,inventory_category,"wall-panel, plumbing, install-part, vanity, base, trim, accessory, sample-kit, sample-piece, other"
public,enum,inventory_movement_reason,"received, shipped, sample_sent, sample_replenish, adjustment, damaged, lost, initial"
public,enum,inventory_shipment_status,"success, partial, failed, skipped"
public,function,apply_inventory_movements(p_movements jsonb),owner=postgres
public,function,"apply_order_shipment(p_order_id uuid, p_force boolean)",owner=postgres
public,function,"apply_order_shipment_retry(p_order_id uuid, p_shipment_id uuid)",owner=postgres
public,function,"apply_partner_inventory_movements(p_owner_id uuid, p_movements jsonb)",owner=postgres
public,function,auto_link_permits_to_companies(),owner=postgres | SECURITY DEFINER
public,function,claims_set_claim_number(),owner=postgres
public,function,inventory_order_lines(p_snapshot jsonb),owner=postgres
public,function,"inventory_order_lines_section(p_scope jsonb, p_bathroom text)",owner=postgres
public,function,is_admin(),owner=postgres | SECURITY DEFINER
public,function,next_claim_number(),owner=postgres | SECURITY DEFINER
public,function,next_order_number(),owner=postgres | SECURITY DEFINER
public,function,orders_set_order_number(),owner=postgres
public,function,promote_permit_to_crm(p_permit_id bigint),owner=postgres | SECURITY DEFINER
public,function,"set_inventory_tracking(p_owner_id uuid, p_enabled boolean)",owner=postgres | SECURITY DEFINER
public,function,set_updated_at(),owner=postgres
public,table,claim_number_counters,owner=postgres
public,table,claims,owner=postgres
public,table,companies,owner=postgres
public,table,contractor_customers,owner=postgres
public,table,inventory_locations,owner=postgres
public,table,inventory_movements,owner=postgres
public,table,inventory_order_shipments,owner=postgres
public,table,inventory_skus,owner=postgres
public,table,inventory_stock,owner=postgres
public,table,order_number_counters,owner=postgres
public,table,orders,owner=postgres
public,table,partner_inventory_movements,owner=postgres
public,table,partner_inventory_skus,owner=postgres
public,table,partner_inventory_stock,owner=postgres
public,table,profiles,owner=postgres
public,table,projects,owner=postgres
public,table,proposals,owner=postgres
public,table,quotes,owner=postgres
public,view,inside_leads,owner=postgres
storage,bucket,job-photos,public=true
```

---

## QUERY B — public.companies + all three leads tables: columns, constraints, indexes, RLS, policies, grants, column privileges, raw ACL, triggers, row estimates

```csv
obj,section,item,detail
leads.permits,column,001 id,bigint NOT NULL GENERATED ALWAYS AS IDENTITY
leads.permits,column,002 permit_num,text NOT NULL
leads.permits,column,003 jurisdiction,text NOT NULL
leads.permits,column,004 county,text
leads.permits,column,005 date_filed,date
leads.permits,column,006 date_issued,date
leads.permits,column,007 status,text
leads.permits,column,008 permit_type,text
leads.permits,column,009 description,text
leads.permits,column,010 site_address,text
leads.permits,column,011 city,text
leads.permits,column,012 zip,text
leads.permits,column,013 valuation,numeric
leads.permits,column,014 sqft,numeric
leads.permits,column,015 contractor,text
leads.permits,column,016 contact,text
leads.permits,column,017 owner,text
leads.permits,column,018 license_num,text
leads.permits,column,019 match_confidence,text
leads.permits,column,020 lead_relevance,text
leads.permits,column,021 account_type,text
leads.permits,column,022 follow_up,text DEFAULT 'New'::text
leads.permits,column,023 claimed_by,text
leads.permits,column,024 notes,text
leads.permits,column,025 source_url,text
leads.permits,column,026 week_pulled,date
leads.permits,column,027 updated_at,timestamp with time zone DEFAULT now()
leads.permits,column,028 crm_company_id,uuid
leads.permits,column,029 promoted_at,timestamp with time zone
leads.permits,constraint,permits_crm_company_id_fkey,FOREIGN KEY (crm_company_id) REFERENCES companies(id)
leads.permits,constraint,permits_permit_num_jurisdiction_key,"UNIQUE (permit_num, jurisdiction)"
leads.permits,constraint,permits_pkey,PRIMARY KEY (id)
leads.permits,index,permits_permit_num_jurisdiction_key,"CREATE UNIQUE INDEX permits_permit_num_jurisdiction_key ON leads.permits USING btree (permit_num, jurisdiction)"
leads.permits,index,permits_pkey,CREATE UNIQUE INDEX permits_pkey ON leads.permits USING btree (id)
leads.permits,rls,status,enabled=t forced=f owner=postgres
leads.permits,policy,authenticated read,cmd=SELECT | permissive=t | roles=authenticated | USING: true | WITH CHECK: (none)
leads.permits,policy,authenticated update,cmd=UPDATE | permissive=t | roles=authenticated | USING: true | WITH CHECK: (none)
leads.permits,table_priv,anon,SELECT=f INSERT=f UPDATE=f DELETE=f TRUNCATE=f
leads.permits,table_priv,authenticated,SELECT=t INSERT=f UPDATE=t DELETE=f TRUNCATE=f
leads.permits,column_priv:authenticated,account_type,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,account_type,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,city,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,city,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,claimed_by,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,claimed_by,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,contact,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,contact,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:anon,contractor,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,contractor,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:authenticated,county,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,county,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,crm_company_id,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,crm_company_id,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:anon,date_filed,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,date_filed,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:authenticated,date_issued,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,date_issued,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:anon,description,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,description,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:authenticated,follow_up,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,follow_up,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,id,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,id,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:anon,jurisdiction,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,jurisdiction,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:authenticated,lead_relevance,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,lead_relevance,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,license_num,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,license_num,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,match_confidence,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,match_confidence,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:anon,notes,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,notes,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,owner,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,owner,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,permit_num,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,permit_num,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,permit_type,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,permit_type,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:authenticated,promoted_at,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,promoted_at,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:anon,site_address,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,site_address,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,source_url,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,source_url,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:authenticated,sqft,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,sqft,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,status,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,status,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:anon,updated_at,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,updated_at,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:authenticated,valuation,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,valuation,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,week_pulled,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,week_pulled,SELECT=f INSERT=f UPDATE=f
leads.permits,column_priv:authenticated,zip,SELECT=t INSERT=f UPDATE=t
leads.permits,column_priv:anon,zip,SELECT=f INSERT=f UPDATE=f
leads.permits,raw_acl,relacl,"{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=rw/postgres}"
leads.permits,row_estimate,reltuples,877
leads.sources,column,001 id,bigint NOT NULL GENERATED ALWAYS AS IDENTITY
leads.sources,column,002 county,text
leads.sources,column,003 jurisdiction,text
leads.sources,column,004 state,text
leads.sources,column,005 system,text
leads.sources,column,006 url,text
leads.sources,column,007 pull_method,text
leads.sources,column,008 verified,text
leads.sources,column,009 notes,text
leads.sources,constraint,sources_pkey,PRIMARY KEY (id)
leads.sources,index,sources_pkey,CREATE UNIQUE INDEX sources_pkey ON leads.sources USING btree (id)
leads.sources,rls,status,enabled=t forced=f owner=postgres
leads.sources,policy,authenticated read,cmd=SELECT | permissive=t | roles=authenticated | USING: true | WITH CHECK: (none)
leads.sources,table_priv,anon,SELECT=f INSERT=f UPDATE=f DELETE=f TRUNCATE=f
leads.sources,table_priv,authenticated,SELECT=t INSERT=f UPDATE=t DELETE=f TRUNCATE=f
leads.sources,column_priv:authenticated,county,SELECT=t INSERT=f UPDATE=t
leads.sources,column_priv:anon,county,SELECT=f INSERT=f UPDATE=f
leads.sources,column_priv:authenticated,id,SELECT=t INSERT=f UPDATE=t
leads.sources,column_priv:anon,id,SELECT=f INSERT=f UPDATE=f
leads.sources,column_priv:authenticated,jurisdiction,SELECT=t INSERT=f UPDATE=t
leads.sources,column_priv:anon,jurisdiction,SELECT=f INSERT=f UPDATE=f
leads.sources,column_priv:anon,notes,SELECT=f INSERT=f UPDATE=f
leads.sources,column_priv:authenticated,notes,SELECT=t INSERT=f UPDATE=t
leads.sources,column_priv:anon,pull_method,SELECT=f INSERT=f UPDATE=f
leads.sources,column_priv:authenticated,pull_method,SELECT=t INSERT=f UPDATE=t
leads.sources,column_priv:anon,state,SELECT=f INSERT=f UPDATE=f
leads.sources,column_priv:authenticated,state,SELECT=t INSERT=f UPDATE=t
leads.sources,column_priv:authenticated,system,SELECT=t INSERT=f UPDATE=t
leads.sources,column_priv:anon,system,SELECT=f INSERT=f UPDATE=f
leads.sources,column_priv:authenticated,url,SELECT=t INSERT=f UPDATE=t
leads.sources,column_priv:anon,url,SELECT=f INSERT=f UPDATE=f
leads.sources,column_priv:anon,verified,SELECT=f INSERT=f UPDATE=f
leads.sources,column_priv:authenticated,verified,SELECT=t INSERT=f UPDATE=t
leads.sources,raw_acl,relacl,"{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=rw/postgres}"
leads.sources,row_estimate,reltuples,22
leads.weekly_pulls,column,001 id,bigint NOT NULL GENERATED ALWAYS AS IDENTITY
leads.weekly_pulls,column,002 week_ending,date
leads.weekly_pulls,column,003 source,text
leads.weekly_pulls,column,004 pulled_on,date
leads.weekly_pulls,column,005 pulled_by,text
leads.weekly_pulls,column,006 record_count,integer
leads.weekly_pulls,column,007 complete,text
leads.weekly_pulls,column,008 notes,text
leads.weekly_pulls,constraint,weekly_pulls_pkey,PRIMARY KEY (id)
leads.weekly_pulls,index,weekly_pulls_pkey,CREATE UNIQUE INDEX weekly_pulls_pkey ON leads.weekly_pulls USING btree (id)
leads.weekly_pulls,rls,status,enabled=t forced=f owner=postgres
leads.weekly_pulls,policy,authenticated read,cmd=SELECT | permissive=t | roles=authenticated | USING: true | WITH CHECK: (none)
leads.weekly_pulls,table_priv,anon,SELECT=f INSERT=f UPDATE=f DELETE=f TRUNCATE=f
leads.weekly_pulls,table_priv,authenticated,SELECT=t INSERT=f UPDATE=t DELETE=f TRUNCATE=f
leads.weekly_pulls,column_priv:anon,complete,SELECT=f INSERT=f UPDATE=f
leads.weekly_pulls,column_priv:authenticated,complete,SELECT=t INSERT=f UPDATE=t
leads.weekly_pulls,column_priv:anon,id,SELECT=f INSERT=f UPDATE=f
leads.weekly_pulls,column_priv:authenticated,id,SELECT=t INSERT=f UPDATE=t
leads.weekly_pulls,column_priv:authenticated,notes,SELECT=t INSERT=f UPDATE=t
leads.weekly_pulls,column_priv:anon,notes,SELECT=f INSERT=f UPDATE=f
leads.weekly_pulls,column_priv:anon,pulled_by,SELECT=f INSERT=f UPDATE=f
leads.weekly_pulls,column_priv:authenticated,pulled_by,SELECT=t INSERT=f UPDATE=t
leads.weekly_pulls,column_priv:anon,pulled_on,SELECT=f INSERT=f UPDATE=f
leads.weekly_pulls,column_priv:authenticated,pulled_on,SELECT=t INSERT=f UPDATE=t
leads.weekly_pulls,column_priv:anon,record_count,SELECT=f INSERT=f UPDATE=f
leads.weekly_pulls,column_priv:authenticated,record_count,SELECT=t INSERT=f UPDATE=t
leads.weekly_pulls,column_priv:anon,source,SELECT=f INSERT=f UPDATE=f
leads.weekly_pulls,column_priv:authenticated,source,SELECT=t INSERT=f UPDATE=t
leads.weekly_pulls,column_priv:authenticated,week_ending,SELECT=t INSERT=f UPDATE=t
leads.weekly_pulls,column_priv:anon,week_ending,SELECT=f INSERT=f UPDATE=f
leads.weekly_pulls,raw_acl,relacl,"{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=rw/postgres}"
leads.weekly_pulls,row_estimate,reltuples,-1
public.companies,column,001 id,uuid NOT NULL DEFAULT gen_random_uuid()
public.companies,column,002 name,text NOT NULL
public.companies,column,003 license_num,text
public.companies,column,004 phone,text
public.companies,column,005 email,text
public.companies,column,006 contact_info,text
public.companies,column,007 address,text
public.companies,column,008 account_type,text
public.companies,column,009 lifecycle,text NOT NULL DEFAULT 'lead'::text
public.companies,column,010 converted_at,timestamp with time zone
public.companies,column,011 source,text DEFAULT 'manual'::text
public.companies,column,012 assigned_to,uuid
public.companies,column,013 status,text DEFAULT 'New'::text
public.companies,column,014 notes,text
public.companies,column,015 created_at,timestamp with time zone DEFAULT now()
public.companies,column,016 updated_at,timestamp with time zone DEFAULT now()
public.companies,constraint,companies_assigned_to_fkey,FOREIGN KEY (assigned_to) REFERENCES profiles(id)
public.companies,constraint,companies_license_num_key,UNIQUE (license_num)
public.companies,constraint,companies_lifecycle_check,"CHECK ((lifecycle = ANY (ARRAY['lead'::text, 'customer'::text])))"
public.companies,constraint,companies_pkey,PRIMARY KEY (id)
public.companies,referenced_by,leads.permits . permits_crm_company_id_fkey,FOREIGN KEY (crm_company_id) REFERENCES companies(id)
public.companies,referenced_by,projects . projects_company_id_fkey,FOREIGN KEY (company_id) REFERENCES companies(id)
public.companies,index,companies_license_num_key,CREATE UNIQUE INDEX companies_license_num_key ON public.companies USING btree (license_num)
public.companies,index,companies_pkey,CREATE UNIQUE INDEX companies_pkey ON public.companies USING btree (id)
public.companies,rls,status,enabled=t forced=f owner=postgres
public.companies,policy,auth insert companies,cmd=INSERT | permissive=t | roles=authenticated | USING: (none) | WITH CHECK: true
public.companies,policy,auth read companies,cmd=SELECT | permissive=t | roles=authenticated | USING: true | WITH CHECK: (none)
public.companies,policy,auth update companies,cmd=UPDATE | permissive=t | roles=authenticated | USING: true | WITH CHECK: (none)
public.companies,table_priv,anon,SELECT=t INSERT=t UPDATE=t DELETE=t TRUNCATE=t
public.companies,table_priv,authenticated,SELECT=t INSERT=t UPDATE=t DELETE=t TRUNCATE=t
public.companies,column_priv:anon,account_type,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,account_type,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,address,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,address,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,assigned_to,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,assigned_to,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,contact_info,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,contact_info,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,converted_at,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,converted_at,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,created_at,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,created_at,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,email,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,email,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,id,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,id,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,license_num,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,license_num,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,lifecycle,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,lifecycle,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,name,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,name,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,notes,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,notes,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,phone,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,phone,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,source,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,source,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,status,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,status,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:authenticated,updated_at,SELECT=t INSERT=t UPDATE=t
public.companies,column_priv:anon,updated_at,SELECT=t INSERT=t UPDATE=t
public.companies,raw_acl,relacl,"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"
public.companies,row_estimate,reltuples,-1
```

---

## QUERY C — Views in public and leads (inside_leads)

```csv
obj,section,item,detail
public.inside_leads,definition,view," SELECT c.id,
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
  GROUP BY c.id;"
public.inside_leads,options,owner / reloptions,"owner=postgres | reloptions=(none: runs with OWNER rights, bypasses RLS on the tables it reads)"
public.inside_leads,depends_on,companies,
public.inside_leads,depends_on,leads.permits,
public.inside_leads,table_priv,anon,SELECT=t INSERT=t UPDATE=t DELETE=t
public.inside_leads,table_priv,authenticated,SELECT=t INSERT=t UPDATE=t DELETE=t
public.inside_leads,raw_acl,relacl,"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"
```

---

## QUERY F — Grant audit across public and leads, worst first

```csv
severity,schema,name,kind,rls_enabled,rls_forced,view_invoker,policies,truncate_granted,anon_privs,authenticated_privs
"1 CRITICAL - anon can write, nothing guards it",public,inside_leads,view,false,false,false,0,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,claims,table,true,false,false,2,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,companies,table,true,false,false,3,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,contractor_customers,table,true,false,false,4,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,inventory_locations,table,true,false,false,1,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,inventory_movements,table,true,false,false,1,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,inventory_order_shipments,table,true,false,false,1,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,inventory_skus,table,true,false,false,2,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,inventory_stock,table,true,false,false,1,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,orders,table,true,false,false,5,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,partner_inventory_movements,table,true,false,false,2,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,partner_inventory_skus,table,true,false,false,1,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,partner_inventory_stock,table,true,false,false,1,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,profiles,table,true,false,false,3,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,projects,table,true,false,false,4,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,proposals,table,true,false,false,4,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
5 MEDIUM - anon holds write grants; RLS policies are the only guard,public,quotes,table,true,false,false,4,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
6 LOW - authenticated write grants; RLS policies are the only guard,leads,permits,table,true,false,false,2,false,,"SELECT, UPDATE"
6 LOW - authenticated write grants; RLS policies are the only guard,leads,sources,table,true,false,false,1,false,,"SELECT, UPDATE"
6 LOW - authenticated write grants; RLS policies are the only guard,leads,weekly_pulls,table,true,false,false,1,false,,"SELECT, UPDATE"
"7 OK - RLS on, no policies (clients denied)",public,claim_number_counters,table,true,false,false,0,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
"7 OK - RLS on, no policies (clients denied)",public,order_number_counters,table,true,false,false,0,true,"SELECT, INSERT, UPDATE, DELETE, TRUNCATE","SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
```

---

## PROFILES POLICY DUMP — supplementary, run separately

```csv
ord,section,item,detail
1,rls,profiles,enabled=t forced=f
2,policy,profiles_insert_self,cmd=INSERT | permissive=PERMISSIVE | roles={authenticated} | USING: (none) | WITH CHECK: (id = auth.uid())
2,policy,profiles_select_self_or_admin,cmd=SELECT | permissive=PERMISSIVE | roles={authenticated} | USING: ((id = auth.uid()) OR is_admin()) | WITH CHECK: (none)
2,policy,profiles_update_self,cmd=UPDATE | permissive=PERMISSIVE | roles={authenticated} | USING: (id = auth.uid()) | WITH CHECK: (id = auth.uid())
3,table_grant,anon,"DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE"
3,table_grant,authenticated,"DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE"
4,column_priv:anon,company,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,company_logo,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,company_tagline,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,company_website,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,created_at,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,email,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,first_login_at,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,id,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,inventory_tracking_enabled,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,invited_at,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,must_change_password,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,name,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,phone,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,profile_confirmed,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,role,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,status,SELECT=t INSERT=t UPDATE=t
4,column_priv:anon,territory,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,company,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,company_logo,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,company_tagline,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,company_website,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,created_at,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,email,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,first_login_at,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,id,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,inventory_tracking_enabled,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,invited_at,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,must_change_password,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,name,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,phone,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,profile_confirmed,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,role,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,status,SELECT=t INSERT=t UPDATE=t
4,column_priv:authenticated,territory,SELECT=t INSERT=t UPDATE=t
6,function,is_admin(),"security_definer=t | acl={=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres} | CREATE OR REPLACE FUNCTION public.is_admin()
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
```
