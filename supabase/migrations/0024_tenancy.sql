-- =====================================================================
-- 0024_tenancy.sql
--
-- Orgs, memberships, assignments and an append-only event log — and the
-- move of every business table from "owned by a user" to "owned by an org".
--
--   0022  closed every path reachable with the anon key
--   0023  closed privilege escalation on profiles, guarded both definer
--         functions, indexed the two foreign keys
--   0024  gives authorization something to scope BY
--
-- ADDITIVE ONLY. This migration deletes nothing. Existing rows are assigned
-- to an org and stay exactly where they are. The wipe is a separate step,
-- run later, by hand.
--
-- THE ONE THING TO UNDERSTAND BEFORE READING FURTHER
-- org_id is added as `not null default public.current_org_id()`. The default
-- is what makes this migration deployable ahead of the lib/* changes: there
-- are 20 INSERT sites across lib/store.ts and lib/partner-inventory.ts that
-- name owner_id and know nothing about org_id, and every one of them would
-- fail a bare NOT NULL. With the default, they keep working untouched and
-- land in the caller's own org. See the deploy-gap note in the report.
-- =====================================================================

begin;

-- =====================================================================
-- PART 0 — Pre-flight. Abort rather than half-apply.
-- =====================================================================

-- 0a. None of the four tables may already exist. Re-running this after a
--     partial apply would seed a second Kitify org and orphan the first.
do $$
declare v_found text;
begin
  select string_agg(c.relname, ', ') into v_found
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('orgs','memberships','org_assignments','events');
  if v_found is not null then
    raise exception
      'ABORT 0024/0a: tenancy tables already exist (%). This migration is not re-runnable '
      'once seeded — it would create a second root org. Investigate before re-running.', v_found;
  end if;
end $$;

-- 0b. The seed in Part 2 assumes exactly the three known users, split
--     2 admin / 1 contractor. A fourth profile would come out of this
--     migration with no org and no membership — orphaned, invisible, and
--     silently unable to read anything once the policies land. Fail loudly.
do $$
declare
  v_total int; v_admins int; v_contractors int; v_other text;
begin
  select count(*) into v_total from public.profiles;
  select count(*) into v_admins from public.profiles where role = 'admin';
  select count(*) into v_contractors from public.profiles where role = 'contractor';
  select string_agg(distinct role, ', ') into v_other
  from public.profiles where role not in ('admin','contractor');

  if v_total <> 3 or v_admins <> 2 or v_contractors <> 1 or v_other is not null then
    raise exception
      'ABORT 0024/0b: expected exactly 3 profiles (2 admin, 1 contractor). Found % total, '
      '% admin, % contractor%. Every profile must end this migration with a membership; '
      'extend the seed in Part 2 before running.',
      v_total, v_admins, v_contractors,
      coalesce(', plus unexpected role(s): ' || v_other, '');
  end if;
end $$;

-- 0c. is_admin() is about to be repointed from profiles.role to memberships.
--     It must exist and be SECURITY DEFINER first — every policy below calls it.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin' and p.prosecdef
  ) then
    raise exception 'ABORT 0024/0c: public.is_admin() missing or not SECURITY DEFINER. Apply 0002/0023 first.';
  end if;
end $$;

-- =====================================================================
-- PART 1 — The tables
-- =====================================================================

-- ---------------------------------------------------------------------
-- orgs — the tenancy root.
--
-- Two kinds. A 'kitify' org is the house: exactly one, no parent, sees
-- everything. A 'contractor' org is a dealer: always parented to a kitify
-- org. The CHECK enforces that rather than leaving it to convention, because
-- a contractor org with a null parent would be invisible to every policy
-- below and would look like a data problem rather than a schema one.
--
-- company_id is nullable on purpose: an org can exist before anyone has
-- created its CRM record, which is exactly what happens when a rep signs a
-- dealer up before the paperwork catches up.
-- ---------------------------------------------------------------------
create table public.orgs (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('kitify','contractor')),
  name               text not null,
  parent_org_id      uuid references public.orgs (id),
  company_id         uuid references public.companies (id),
  is_demo            boolean not null default false,
  sourced_by_user_id uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint orgs_parent_matches_kind check (
    (kind = 'kitify'     and parent_org_id is null) or
    (kind = 'contractor' and parent_org_id is not null)
  )
);

create index orgs_parent_org_id_idx on public.orgs (parent_org_id);
create index orgs_company_id_idx    on public.orgs (company_id);
-- One root. A second kitify org would make current_org_id() and is_admin()
-- ambiguous in a way no policy could resolve.
create unique index orgs_single_kitify_root_idx on public.orgs ((kind)) where kind = 'kitify';

-- ---------------------------------------------------------------------
-- memberships — who belongs to which org, and in what capacity.
-- ---------------------------------------------------------------------
create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id)     on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_org_user_key unique (org_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_org_id_idx  on public.memberships (org_id);

-- ---------------------------------------------------------------------
-- org_assignments — which Kitify reps cover which contractor orgs.
-- Separate from memberships on purpose: a rep covering a dealer is not a
-- member of that dealer, and conflating the two would give reps the
-- dealer's own row-level access.
-- ---------------------------------------------------------------------
create table public.org_assignments (
  id          uuid primary key default gen_random_uuid(),
  rep_user_id uuid not null references public.profiles (id) on delete cascade,
  org_id      uuid not null references public.orgs (id)     on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint org_assignments_rep_org_key unique (rep_user_id, org_id)
);

create index org_assignments_org_id_idx      on public.org_assignments (org_id);
create index org_assignments_rep_user_id_idx on public.org_assignments (rep_user_id);

-- ---------------------------------------------------------------------
-- events — append-only.
--
-- No UPDATE policy and no DELETE policy for anyone, including admins. That
-- is the whole point: a log that can be edited is not a log. Corrections go
-- in as new rows.
--
-- entity_id is TEXT, not uuid, and deliberately carries no foreign key.
-- Two reasons: entity ids in this system are not uniformly uuid
-- (leads.permits.id is bigint), and an audit row must survive the deletion
-- of the thing it describes — an FK would either block the delete or cascade
-- the evidence away.
-- ---------------------------------------------------------------------
create table public.events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id),
  actor_user_id uuid references public.profiles (id),
  entity_type   text not null,
  entity_id     text,
  action        text not null,
  payload       jsonb,
  created_at    timestamptz not null default now()
);

create index events_org_id_created_at_idx on public.events (org_id, created_at desc);
create index events_entity_idx            on public.events (entity_type, entity_id);

-- =====================================================================
-- PART 2 — Seed, in this same transaction
--
-- Derived from the data rather than from hardcoded names or emails: the two
-- admins become owners of the Kitify org, and the single contractor gets a
-- demo org of their own. Guard 0b has already asserted that shape, so this
-- cannot silently seed something else.
-- =====================================================================
do $$
declare
  v_kitify_id uuid;
  v_contractor record;
  v_org_id uuid;
  v_orphans int;
begin
  insert into public.orgs (kind, name, parent_org_id, is_demo)
  values ('kitify', 'Kitify Solutions', null, false)
  returning id into v_kitify_id;

  -- Both admins own the house.
  insert into public.memberships (org_id, user_id, role)
  select v_kitify_id, p.id, 'owner'
  from public.profiles p
  where p.role = 'admin';

  -- The one contractor gets a demo org parented to Kitify, and owns it.
  for v_contractor in select id, name from public.profiles where role = 'contractor' loop
    insert into public.orgs (kind, name, parent_org_id, is_demo, sourced_by_user_id)
    values ('contractor', coalesce(nullif(btrim(v_contractor.name), ''), 'Demo Contractor'),
            v_kitify_id, true, null)
    returning id into v_org_id;

    insert into public.memberships (org_id, user_id, role)
    values (v_org_id, v_contractor.id, 'owner');
  end loop;

  -- Belt and braces on guard 0b: nobody leaves this migration orphaned.
  select count(*) into v_orphans
  from public.profiles p
  where not exists (select 1 from public.memberships m where m.user_id = p.id);

  if v_orphans > 0 then
    raise exception
      'ABORT 0024/2: % profile(s) have no membership after seeding. Nobody may be orphaned.', v_orphans;
  end if;
end $$;

-- =====================================================================
-- PART 3 — Role source of truth moves to memberships
--
-- is_admin() stops reading profiles.role and starts reading membership of
-- the Kitify org. profiles.role STAYS, in place and in sync — removing it is
-- a later cleanup, and several pages still read it for display.
--
-- Note what this does to 0023: that migration locked profiles.role so that
-- is_admin() could be trusted. Now is_admin() no longer reads it, so the
-- lock is belt to this braces rather than the only thing holding. Both stay.
--
-- Both functions SECURITY DEFINER, search_path = '', fully qualified —
-- matching the pattern 0023 established across the whole database.
-- =====================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.orgs o on o.id = m.org_id
    where m.user_id = auth.uid()
      and o.kind = 'kitify'
  );
$$;

comment on function public.is_admin() is
  'Repointed by 0024 from profiles.role to Kitify-org membership. True for any member of the '
  'kitify org, owner or member. profiles.role is kept in sync for display but is no longer '
  'the source of truth. The 0023 column lock on profiles.role stays as defence in depth.';

-- current_org_id() — the caller''s own org, used by every policy below and
-- by the org_id DEFAULT. A user in more than one org resolves to their
-- earliest membership, deterministically, and the backfill in Part 3 used
-- the same rule so the two cannot disagree.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at, m.id
  limit 1;
$$;

comment on function public.current_org_id() is
  'Added by 0024. The caller''s own org id, or NULL for an unauthenticated or membership-less '
  'session. Used by every org-scoped policy and as the DEFAULT on every business table''s '
  'org_id, which is what lets the lib/* INSERT sites keep working before they are updated.';

revoke execute on function public.is_admin()       from anon, public;
revoke execute on function public.current_org_id() from anon, public;
grant  execute on function public.is_admin()       to authenticated, service_role;
grant  execute on function public.current_org_id() to authenticated, service_role;

-- =====================================================================
-- PART 4 — org_id on the business tables
--
-- WHICH TABLES, AND WHY
--
-- 9 tables carry owner_id (uuid -> profiles) and are backfilled through it:
--   projects, quotes, orders, proposals, claims, contractor_customers,
--   partner_inventory_skus, partner_inventory_stock, partner_inventory_movements
--
-- 4 tables are Kitify's own warehouse and have NO owner column at all —
-- they are admin-only today and belong to the house:
--   inventory_locations, inventory_skus, inventory_stock, inventory_movements
--
-- 1 table derives its org from its parent order:
--   inventory_order_shipments (order_id -> orders)
--
-- 1 table is the CRM and belongs to the house:
--   companies (assigned_to is a rep pointer, not an owner)
--
-- DELIBERATELY NOT GIVEN org_id:
--   claim_number_counters, order_number_counters — infrastructure. Keyed by
--     period, no rows belong to anyone, zero policies today (clients denied
--     outright), and reachable only through next_*_number() which is
--     SECURITY DEFINER. An org_id here would be a column nothing could fill.
--   leads.permits / leads.sources / leads.weekly_pulls — Kitify's own lead
--     pipeline, written weekly by an external job. They are house data by
--     definition; their policies are rewritten in Part 5 to require Kitify
--     membership rather than gaining a column that would always hold one value.
-- =====================================================================
do $$
declare
  v_demo_org uuid;
  v_t record;
  v_unresolved int;
  v_total_unresolved int := 0;
begin
  select o.id into v_demo_org from public.orgs o where o.kind = 'contractor' and o.is_demo limit 1;
  if v_demo_org is null then
    raise exception 'ABORT 0024/4: no demo org found to catch unresolvable rows.';
  end if;

  -- ---- the nine owner_id tables, mechanically ------------------------
  for v_t in
    select unnest(array[
      'projects','quotes','orders','proposals','claims','contractor_customers',
      'partner_inventory_skus','partner_inventory_stock','partner_inventory_movements'
    ]) as tbl
  loop
    execute format('alter table public.%I add column org_id uuid references public.orgs (id)', v_t.tbl);

    -- Resolve through the owner's membership. A user in more than one org
    -- resolves to their earliest, which matches current_org_id().
    execute format($f$
      update public.%I t
         set org_id = (
           select m.org_id from public.memberships m
           where m.user_id = t.owner_id
           order by m.created_at, m.id
           limit 1)
       where t.org_id is null
    $f$, v_t.tbl);

    -- Anything still unresolved goes to the demo org. NOT deleted.
    execute format('select count(*) from public.%I where org_id is null', v_t.tbl) into v_unresolved;
    if v_unresolved > 0 then
      raise notice '0024/4: %.org_id — % row(s) had no resolvable owner; assigned to the demo org.',
        v_t.tbl, v_unresolved;
      v_total_unresolved := v_total_unresolved + v_unresolved;
      execute format('update public.%I set org_id = %L where org_id is null', v_t.tbl, v_demo_org);
    end if;

    execute format('create index %I on public.%I (org_id)', v_t.tbl || '_org_id_idx', v_t.tbl);
  end loop;

  -- ---- the four house inventory tables -------------------------------
  for v_t in
    select unnest(array['inventory_locations','inventory_skus','inventory_stock','inventory_movements']) as tbl
  loop
    execute format('alter table public.%I add column org_id uuid references public.orgs (id)', v_t.tbl);
    execute format('update public.%I set org_id = (select id from public.orgs where kind = ''kitify'')', v_t.tbl);
    execute format('create index %I on public.%I (org_id)', v_t.tbl || '_org_id_idx', v_t.tbl);
  end loop;

  -- ---- shipments, through their order --------------------------------
  alter table public.inventory_order_shipments add column org_id uuid references public.orgs (id);
  update public.inventory_order_shipments s
     set org_id = o.org_id
    from public.orders o
   where o.id = s.order_id and s.org_id is null;
  select count(*) into v_unresolved from public.inventory_order_shipments where org_id is null;
  if v_unresolved > 0 then
    raise notice '0024/4: inventory_order_shipments.org_id — % orphan row(s); assigned to the demo org.', v_unresolved;
    v_total_unresolved := v_total_unresolved + v_unresolved;
    update public.inventory_order_shipments set org_id = v_demo_org where org_id is null;
  end if;
  create index inventory_order_shipments_org_id_idx on public.inventory_order_shipments (org_id);

  -- ---- companies: the house's CRM ------------------------------------
  alter table public.companies add column org_id uuid references public.orgs (id);
  update public.companies set org_id = (select id from public.orgs where kind = 'kitify');
  create index companies_org_id_idx on public.companies (org_id);

  raise notice '0024/4: backfill complete. % row(s) total fell back to the demo org.', v_total_unresolved;
end $$;

-- ---------------------------------------------------------------------
-- NOT NULL + DEFAULT, once the backfill has landed.
--
-- Every table above was filled unconditionally (unresolvable rows went to
-- the demo org rather than being left null or deleted), so zero rows remain
-- unresolved by construction and NOT NULL is safe. The guard re-checks
-- anyway — if it ever fails, the column stays nullable and the migration
-- aborts rather than shipping a half-enforced constraint.
--
-- The DEFAULT is the deploy-gap bridge. See the header.
-- ---------------------------------------------------------------------
do $$
declare v_t record; v_nulls int;
begin
  for v_t in
    select unnest(array[
      'projects','quotes','orders','proposals','claims','contractor_customers',
      'partner_inventory_skus','partner_inventory_stock','partner_inventory_movements',
      'inventory_locations','inventory_skus','inventory_stock','inventory_movements',
      'inventory_order_shipments','companies'
    ]) as tbl
  loop
    execute format('select count(*) from public.%I where org_id is null', v_t.tbl) into v_nulls;
    if v_nulls > 0 then
      raise exception
        'ABORT 0024/4b: %.org_id still has % null row(s) after backfill. Leaving the column '
        'nullable and aborting rather than enforcing a constraint the data does not meet.',
        v_t.tbl, v_nulls;
    end if;
    execute format('alter table public.%I alter column org_id set not null', v_t.tbl);
    execute format('alter table public.%I alter column org_id set default public.current_org_id()', v_t.tbl);
  end loop;
end $$;

-- =====================================================================
-- PART 5 — Policies
--
-- One shape, applied everywhere:
--     org_id = public.current_org_id() or public.is_admin()
-- A contractor org sees its own rows; the Kitify org sees everything.
--
-- NO `using (true)` SURVIVES THIS MIGRATION, on any table in public or
-- leads. companies had three of them and leads had four.
--
-- The one deliberate cross-org read is inventory_skus_select_catalog,
-- `using (active and not is_sample)` — every contractor must be able to read
-- Kitify's product catalogue to configure anything at all. It is not
-- `using (true)`: it exposes active, non-sample SKUs and nothing else, and
-- stock/locations/movements stay house-only. Preserved deliberately.
-- =====================================================================

-- ---- the nine contractor-owned tables --------------------------------
-- owner_id policies are replaced, not supplemented: leaving the old
-- owner_id = auth.uid() policies in place would OR with the new ones and
-- re-open cross-org reads for anyone who owned a row before the move.
do $$
declare v_t text; v_p record;
begin
  foreach v_t in array array[
    'projects','quotes','orders','proposals','claims','contractor_customers',
    'partner_inventory_skus','partner_inventory_stock','partner_inventory_movements',
    'inventory_locations','inventory_skus','inventory_stock','inventory_movements',
    'inventory_order_shipments','companies'
  ] loop
    for v_p in
      select polname from pg_policy
      where polrelid = format('public.%I', v_t)::regclass
        and polname <> 'inventory_skus_select_catalog'   -- preserved, see above
    loop
      execute format('drop policy %I on public.%I', v_p.polname, v_t);
    end loop;

    execute format($f$
      create policy %I on public.%I for select to authenticated
      using (org_id = public.current_org_id() or public.is_admin())
    $f$, v_t || '_select_org', v_t);

    execute format($f$
      create policy %I on public.%I for insert to authenticated
      with check (org_id = public.current_org_id() or public.is_admin())
    $f$, v_t || '_insert_org', v_t);

    execute format($f$
      create policy %I on public.%I for update to authenticated
      using (org_id = public.current_org_id() or public.is_admin())
      with check (org_id = public.current_org_id() or public.is_admin())
    $f$, v_t || '_update_org', v_t);

    execute format($f$
      create policy %I on public.%I for delete to authenticated
      using (org_id = public.current_org_id() or public.is_admin())
    $f$, v_t || '_delete_org', v_t);
  end loop;
end $$;

-- companies, inventory_* and shipments are house data: writes are admin-only.
-- The generic policies above are replaced for those five.
do $$
declare v_t text;
begin
  foreach v_t in array array[
    'companies','inventory_locations','inventory_stock','inventory_movements',
    'inventory_order_shipments'
  ] loop
    execute format('drop policy %I on public.%I', v_t || '_insert_org', v_t);
    execute format('drop policy %I on public.%I', v_t || '_update_org', v_t);
    execute format('drop policy %I on public.%I', v_t || '_delete_org', v_t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', v_t || '_insert_admin', v_t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', v_t || '_update_admin', v_t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', v_t || '_delete_admin', v_t);
  end loop;
end $$;

-- inventory_skus: admin writes, but keep the catalogue read for everyone.
drop policy if exists inventory_skus_insert_org on public.inventory_skus;
drop policy if exists inventory_skus_update_org on public.inventory_skus;
drop policy if exists inventory_skus_delete_org on public.inventory_skus;
create policy inventory_skus_insert_admin on public.inventory_skus
  for insert to authenticated with check (public.is_admin());
create policy inventory_skus_update_admin on public.inventory_skus
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy inventory_skus_delete_admin on public.inventory_skus
  for delete to authenticated using (public.is_admin());

-- A contractor org also needs to read the company record its org is linked to.
create policy companies_select_own_linked on public.companies
  for select to authenticated
  using (id = (select o.company_id from public.orgs o where o.id = public.current_org_id()));

-- ---- the tenancy tables themselves -----------------------------------
alter table public.orgs            enable row level security;
alter table public.memberships     enable row level security;
alter table public.org_assignments enable row level security;
alter table public.events          enable row level security;

create policy orgs_select_own_or_admin on public.orgs
  for select to authenticated
  using (id = public.current_org_id() or public.is_admin());
create policy orgs_insert_admin on public.orgs
  for insert to authenticated with check (public.is_admin());
create policy orgs_update_admin on public.orgs
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy orgs_delete_admin on public.orgs
  for delete to authenticated using (public.is_admin());

-- MEMBERSHIPS WRITES ARE ADMIN-ONLY, and this is the same hole 0023 closed
-- on profiles arriving by a different door: a self-writable membership row
-- is a self-granted role. A member may READ the memberships of their own org
-- and nothing else.
create policy memberships_select_own_org_or_admin on public.memberships
  for select to authenticated
  using (org_id = public.current_org_id() or public.is_admin());
create policy memberships_insert_admin on public.memberships
  for insert to authenticated with check (public.is_admin());
create policy memberships_update_admin on public.memberships
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy memberships_delete_admin on public.memberships
  for delete to authenticated using (public.is_admin());

create policy org_assignments_select_own_or_admin on public.org_assignments
  for select to authenticated
  using (org_id = public.current_org_id() or rep_user_id = auth.uid() or public.is_admin());
create policy org_assignments_insert_admin on public.org_assignments
  for insert to authenticated with check (public.is_admin());
create policy org_assignments_update_admin on public.org_assignments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy org_assignments_delete_admin on public.org_assignments
  for delete to authenticated using (public.is_admin());

-- events — SELECT and INSERT only. No UPDATE policy, no DELETE policy, for
-- anyone, admins included. Append-only is enforced by the absence.
create policy events_select_own_org_or_admin on public.events
  for select to authenticated
  using (org_id = public.current_org_id() or public.is_admin());
create policy events_insert_own_org on public.events
  for insert to authenticated
  with check (org_id = public.current_org_id() or public.is_admin());

grant select, insert, update, delete on public.orgs            to authenticated;
grant select, insert, update, delete on public.memberships     to authenticated;
grant select, insert, update, delete on public.org_assignments to authenticated;
-- events: no UPDATE, no DELETE grant either. Belt to the policy's braces.
grant select, insert on public.events to authenticated;

-- ---- leads.* — house data, Kitify membership only ---------------------
-- These had `using (true)` for every authenticated user, which meant one
-- dealer could read and overwrite another's claimed_by and notes on any
-- permit. They carry no org_id (see Part 3) because they are house data by
-- definition; is_admin() is the correct scope.
drop policy if exists "authenticated read"   on leads.permits;
drop policy if exists "authenticated update" on leads.permits;
drop policy if exists "authenticated read"   on leads.sources;
drop policy if exists "authenticated read"   on leads.weekly_pulls;

create policy leads_permits_select_admin on leads.permits
  for select to authenticated using (public.is_admin());
create policy leads_permits_update_admin on leads.permits
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy leads_sources_select_admin on leads.sources
  for select to authenticated using (public.is_admin());
create policy leads_weekly_pulls_select_admin on leads.weekly_pulls
  for select to authenticated using (public.is_admin());

commit;


-- =====================================================================
-- =====================================================================
--                          VERIFY SCRIPT
--
-- READ-ONLY. Run in the SQL Editor after applying. Every row must read
-- pass = true.
--
-- NOTE: pg_catalog "char" columns (polcmd, tgenabled, relkind) are cast to
-- ::text before comparison — same fix as 0023's VERIFY.
-- =====================================================================
-- =====================================================================

with org_tables(tbl) as (
  values ('projects'),('quotes'),('orders'),('proposals'),('claims'),
         ('contractor_customers'),('partner_inventory_skus'),
         ('partner_inventory_stock'),('partner_inventory_movements'),
         ('inventory_locations'),('inventory_skus'),('inventory_stock'),
         ('inventory_movements'),('inventory_order_shipments'),('companies')
)

-- 1. every profile has a membership
select
  '1. every profile has a membership' as check,
  'orphan count'                      as detail,
  '0'                                 as expected,
  count(*)::text                      as actual,
  count(*) = 0                        as pass
from public.profiles p
where not exists (select 1 from public.memberships m where m.user_id = p.id)

union all
-- 2. no table anywhere retains a USING (true) policy
select
  '2. no USING (true) policy',
  n.nspname || '.' || c.relname || ' / ' || pol.polname,
  'none',
  coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''),
  false
from pg_policy pol
join pg_class c     on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','leads')
  and btrim(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')) = 'true'

union all
-- 2b. ...and the same for WITH CHECK (true)
select
  '2b. no WITH CHECK (true) policy',
  n.nspname || '.' || c.relname || ' / ' || pol.polname,
  'none',
  coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
  false
from pg_policy pol
join pg_class c     on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','leads')
  and btrim(coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) = 'true'

union all
-- 2c. a row that says the two checks above found nothing (they return no
--     rows when clean, and "no rows" is easy to misread as "not run")
select
  '2c. USING/WITH CHECK (true) total',
  'offending policies',
  '0',
  count(*)::text,
  count(*) = 0
from pg_policy pol
join pg_class c     on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','leads')
  and (btrim(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')) = 'true'
    or btrim(coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) = 'true')

union all
-- 3. is_admin() is true for exactly the two Kitify-org members
select
  '3. is_admin via kitify membership',
  p.name || ' (' || p.role || ')',
  'true',
  exists (
    select 1 from public.memberships m
    join public.orgs o on o.id = m.org_id
    where m.user_id = p.id and o.kind = 'kitify'
  )::text,
  exists (
    select 1 from public.memberships m
    join public.orgs o on o.id = m.org_id
    where m.user_id = p.id and o.kind = 'kitify'
  )
from public.profiles p
where p.role = 'admin'

union all
-- 3b. ...and false for the contractor
select
  '3b. contractor is not admin',
  p.name,
  'false',
  exists (
    select 1 from public.memberships m
    join public.orgs o on o.id = m.org_id
    where m.user_id = p.id and o.kind = 'kitify'
  )::text,
  not exists (
    select 1 from public.memberships m
    join public.orgs o on o.id = m.org_id
    where m.user_id = p.id and o.kind = 'kitify'
  )
from public.profiles p
where p.role = 'contractor'

union all
-- 4. every business row has an org_id, and the column is NOT NULL
select
  '4. org_id not null on table',
  t.tbl,
  'true',
  coalesce(a.attnotnull, false)::text,
  coalesce(a.attnotnull, false)
from org_tables t
left join pg_attribute a
  on a.attrelid = ('public.' || t.tbl)::regclass
 and a.attname = 'org_id'
 and not a.attisdropped

union all
-- 4b. ...and it defaults to current_org_id(), which is what keeps the
--     un-updated lib/* INSERT sites working
select
  '4b. org_id defaults to current_org_id',
  t.tbl,
  'true',
  (coalesce(pg_get_expr(d.adbin, d.adrelid), '') like '%current_org_id%')::text,
  coalesce(pg_get_expr(d.adbin, d.adrelid), '') like '%current_org_id%'
from org_tables t
join pg_attribute a
  on a.attrelid = ('public.' || t.tbl)::regclass and a.attname = 'org_id' and not a.attisdropped
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum

union all
-- 5. events has NO update and NO delete policy — append-only by absence
select
  '5. events append-only',
  'update/delete policies',
  '0',
  count(*)::text,
  count(*) = 0
from pg_policy pol
where pol.polrelid = 'public.events'::regclass
  and pol.polcmd::text in ('w','d')        -- "char": w = UPDATE, d = DELETE

union all
-- 5b. ...and no UPDATE/DELETE grant either
select
  '5b. events no write grant',
  'authenticated update/delete',
  'false',
  (has_table_privilege('authenticated','public.events','UPDATE')
    or has_table_privilege('authenticated','public.events','DELETE'))::text,
  not (has_table_privilege('authenticated','public.events','UPDATE')
    or has_table_privilege('authenticated','public.events','DELETE'))

union all
-- 6. exactly one kitify root org, and it has no parent
select
  '6. single kitify root',
  'kitify orgs with null parent',
  '1',
  count(*)::text,
  count(*) = 1
from public.orgs where kind = 'kitify' and parent_org_id is null

union all
-- 6b. every contractor org has a parent (the CHECK enforces it; prove it held)
select
  '6b. contractor orgs parented',
  'unparented contractor orgs',
  '0',
  count(*)::text,
  count(*) = 0
from public.orgs where kind = 'contractor' and parent_org_id is null

order by 1, 2;
