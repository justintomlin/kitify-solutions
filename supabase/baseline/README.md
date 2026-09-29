# `supabase/baseline/` — production snapshot

> **PRODUCTION SNAPSHOT — DOCUMENTATION ONLY — DO NOT RUN AGAINST PRODUCTION.**
> Every file in this folder describes schema that *already exists* in production. Running one
> against production will fail at its guard, or — if the guard is removed — will damage live
> data. These files exist so a **fresh** database can be built, and so the drift between
> production and `supabase/migrations/` is written down instead of remembered.

## Why this folder exists

**`supabase/migrations/` cannot rebuild a working database on its own.** Production holds
schema that no migration creates, so applying 0001–0021 to an empty project produces a
database that is missing objects the migrations themselves depend on.

The clearest case is migration **0008**, `0008_auto_link_permits.sql`. It defines
`public.auto_link_permits_to_companies()`, which:

- `update leads.permits p … set crm_company_id = …`
- `from public.companies c`

Neither `leads.permits` nor `public.companies` is created by any migration in this repo. There
is no `create schema leads`, no `create table … companies` and no `create table … permits`
anywhere under `supabase/migrations/`. Both objects were created by hand in the dashboard or
by the external ingest job, and production has simply carried them ever since.

That is what these baseline files capture.

## The rules

1. **Documentation only.** Nothing here is applied to production, ever. Production already has
   all of it.
2. **Outside `supabase/migrations/`** on purpose, so `supabase db push` can never pick a
   baseline file up and try to run it. This is the whole reason for the separate folder — a
   baseline file in the migrations directory is a live hazard.
3. **Numbered `B01`–`B06`**, not `0001`–`00NN`, so a baseline file can never collide with, be
   confused for, or be sorted among a numbered migration.
4. **Faithful, not corrected.** A baseline reproduces production *as it is*, including the
   over-broad grants and the `using (true)` policies. Fixing something in a baseline file
   would make the file a lie about production and would hide the very drift it exists to
   record. Fixes go in a new numbered migration, never here.
5. **Guarded.** Every file opens with the do-not-run header and a first-statement guard that
   raises if its object already exists, so an accidental run against production stops at
   statement one instead of part-way through.

## Run order for a fresh database

```
1. supabase/baseline/B01 … B06, in order   (B02: main body only)
2. supabase/migrations/0001_initial_schema.sql
3. supabase/baseline/B02 — the DEFERRED section at the foot of the file
4. supabase/migrations/0002 … 00NN  (in order)
5. docs/migrations/2026-08-04-proposal-enhancements.sql   — see note below
```

Baseline first. The migrations assume these objects already exist; 0008 in particular will
fail outright without `leads.permits` and `public.companies`.

B01–B06 run in numeric order because they depend on each other in that order: B04 needs both
`companies` (B02) and `leads.permits` (B03) to compile the view; B05 needs all three. B06 is
storage and depends on nothing here, but see its header — on Supabase the storage schema is
platform-managed, so B06 is a specification of what to reproduce rather than a script to run.

**Why step 3 exists.** The dependency runs both ways, so a single pass cannot work.
`public.companies` is needed by 0008, but two of its own constraints point at tables that
migration 0001 creates:

- `companies_assigned_to_fkey` → `public.profiles (id)`
- `projects_company_id_fkey` → needs `public.projects` to exist

Both are parked in a clearly-marked DEFERRED section at the foot of `B02_companies.sql` and
must be run after 0001. The commented-out statements are there to be run deliberately, in
that slot, and nowhere else.

## File status

| File | Contents | Status |
| --- | --- | --- |
| `B01_leads_schema.sql` | The `leads` schema, its ACL (incl. the pre-0022 `anon` USAGE), sequence and role-config notes | **Written** — from Query A |
| `B02_companies.sql` | `public.companies` + the three `using (true)` policies + pre-0022 grants; `projects.company_id` and the profiles FK as deferred `ALTER`s | **Written** — from Query B / F |
| `B03_leads_tables.sql` | `leads.permits`, `leads.sources`, `leads.weekly_pulls` — columns, constraints, RLS, policies, grants | **Written** — from Query B / F |
| `B04_inside_leads_view.sql` | `public.inside_leads` — the severity-1 finding: owner rights, no `security_invoker`, granted to `anon` | **Written** — from Query C |
| `B05_promote_permit_to_crm.sql` | `promote_permit_to_crm(bigint)` — body verbatim, pre-0022 grants reconstructed | **Written** — from Query D |
| `B06_storage.sql` | The `job-photos` bucket and all six `storage.objects` policies | **Written** — from Query E |

**All six are written. No captures outstanding.** Queries A–G have all been run and both
extraction files are in `supabase/scratchpad/`.

Every file snapshots production **as it stood before migration 0022**. Each carries a `!!`
banner saying so, and every object 0022 later altered is commented at the point of the grant
or policy it changed. Read them as history; read `0022_close_anon_holes.sql` for current state.

### Which files are reconstructed, and why that matters

Queries **A, B, C and F** were captured **before** 0022. Queries **D, E and G** were captured
**after** it. So three files needed the post-0022 output read backwards:

| File | Source | Reconstruction |
| --- | --- | --- |
| B01, B02, B03, B04 | A, B, C, F | None — captured pre-0022, transcribed directly |
| **B05** | D | Query D shows `anon_can_execute = false` and an ACL without `anon` or `PUBLIC`. The pre-0022 grants were rebuilt: `anon` held EXECUTE and the ACL carried a bare `=X/postgres` (PUBLIC). |
| **B06** | E | Query E shows **two** buckets. Before 0022 there was **one** — `company-logos` was created *by* 0022, evidenced by its `created_at` of `2026-09-28T18:39:25Z`. B06 declares `job-photos` only. |
| B01, B03 (sequences) | G | No reconstruction needed: `anon` held nothing on the `leads` sequences before 0022 or after. |

The B05 reconstruction is **corroborated, not assumed**. The original extraction captured
`is_admin()`'s ACL *before* 0022 as
`{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
— the bare `=X/postgres` and the explicit `anon` entry, exactly the shape the addendum says to
rebuild. The two files agree across the 0022 boundary.

## STANDING RULE — every `create table` in a migration

> **Every `create table` in a migration must be immediately followed by**
>
> ```sql
> revoke all on <table> from authenticated, anon;
> ```
>
> **and then the explicit grants that table actually needs.**

Not `revoke all ... from anon, public`. Not a grant on its own. The revoke must name
**`authenticated`**, because `authenticated` is the role Supabase's `ALTER DEFAULT PRIVILEGES`
hands a full table grant to the instant a table is created in `public`.

**"Automatically expose new tables" being OFF does not prevent this.** That setting governs
PostgREST *exposure*. Default role privileges are a Postgres-level grant, applied at
`CREATE TABLE` regardless of any dashboard toggle. The two are separate mechanisms and
conflating them is what caused this every time.

A `grant select, insert, update, delete` written without the revoke first does not grant four
privileges — it re-states four of the seven already present, and **`TRUNCATE`, `REFERENCES`
and `TRIGGER` stay**. `TRUNCATE` is the one that matters: it is a table-level operation, **no
RLS policy applies to it**, so any authenticated user can empty the table in full no matter
how carefully its rows are org-scoped.

**Catching this in a VERIFY block is not sufficient.** It has now been missed four times:

| Table | Migration | Caught by | Repaired in |
| --- | --- | --- | --- |
| `public.profiles` | 0022 | review | 0022 |
| `public.events` | 0024 | post-apply audit | applied by hand, committed in 0026 |
| `public.appointments` | 0027 | 0027 VERIFY check 6b | **0028** |
| `public.labor_catalog` | 0027 | 0027 VERIFY check 6b | **0028** |

VERIFY runs *after* `commit;`. Between the migration committing and a human reading the
output, the grant is live. The revoke belongs in the same statement block as the
`create table`, not in the audit that follows it.

`0028_new_table_grants.sql` carries a VERIFY check (6 / 6b) that sweeps **every** table in
`public` for `TRUNCATE` or `REFERENCES` held by `authenticated` or `anon`. Run it after any
migration that creates a table.

## Production dashboard settings

These are configuration, not schema — no SQL file captures them, so they are recorded here.
A fresh project must be set to match.

**API — exposed schemas**

- `graphql_public`
- `leads`
- `public`
- **19 of 22 tables exposed.** The three `leads` tables show warnings in the dashboard. The
  warnings are expected and are a consequence of the permissive policies recorded in `B03`.
- **"Automatically expose new tables": ON.** Any table added later is exposed through the API
  the moment it is created, without a further decision being made.

  > **Turn this OFF before the tenancy migration runs.** `orgs`, `memberships`,
  > `org_assignments` and `events` would otherwise inherit the permissive grant pattern at
  > creation — exposed through the API, with the default grants, before a single policy is
  > written for them. The tables that define who may see what are the worst possible ones to
  > create under a setting that publishes them automatically. Flip it off first, create the
  > tables, write the policies, then decide table by table what gets exposed.

  > **Flipping it off does NOT deal with the default grants.** Exposure and privilege are two
  > different mechanisms, and turning this toggle off has been mistaken for handling both —
  > four times. See **STANDING RULE — every `create table` in a migration** above.

**Authentication**

| Setting | State |
| --- | --- |
| Allow new users to sign up | **OFF** |
| Manual linking | **OFF** |
| Anonymous sign-ins | **OFF** |
| Confirm email | **OFF** |
| Providers enabled | **Email only** |

Accounts are created by an administrator; there is no self-service signup path.

> **Signup must stay OFF until the `profiles.role` self-write restriction ships.** That toggle
> is currently the only thing preventing privilege escalation to admin. `profiles_update_self`
> is `WITH CHECK (id = auth.uid())` with **no column restriction**, so a user may write any
> column of their own row — including `role`. `is_admin()` reads that same column:
>
> ```sql
> select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
> ```
>
> So anyone who can create an account can set their own `role` to `'admin'` and `is_admin()`
> will agree. Migration 0022 did not touch this — it closed `anon`, and this path needs an
> authenticated session. Turning signup on before the column restriction exists converts a
> latent hole into an open one.

## Applied outside `supabase/migrations/`

**`docs/migrations/2026-08-04-proposal-enhancements.sql` is already applied in production.**
It lives under `docs/` rather than `supabase/migrations/`, so `supabase db push` does not know
about it and a fresh database will not receive it unless it is run deliberately. It is listed
in the run order above for that reason.

## External writer: `sync.py`

A **weekly** job runs outside this repository. It:

1. writes rows into `leads.permits`, and
2. calls `public.auto_link_permits_to_companies()` (the function from migration 0008) to match
   newly-ingested, still-unlinked permits to existing `public.companies` rows by license.

Three consequences worth holding onto:

- **`sync.py` must authenticate with the service role key.** Migration 0022 revoked `anon`
  across both schemas — every table grant, every function, and `USAGE` on schema `leads`. If
  that job is still using the anon key it now fails, and it fails **silently**: it runs weekly,
  unattended, and nothing in this application notices that permits stopped arriving. The
  service role bypasses grants and RLS, which is what an ingest job needs and what the
  grant-backs in 0022 Part 2 preserved for it. Verify the key before the next weekly run.
- `leads.permits` has a writer that is not this application, so its shape is not ours to change
  unilaterally — a column rename here breaks the sync job silently, once a week.
- The linking function is called on a schedule rather than on insert, so a permit can exist
  unlinked for up to a week, and anything reading `crm_company_id` has to tolerate `NULL`.

## Outstanding

**Storage "their own" policies.** The current storage policies named "…their own…" check
**only `bucket_id`**. They do not scope access by user or by organisation, so any
authenticated user reaching the bucket satisfies them. The correct fix is **path-prefix
scoping by org**, which cannot be written until the tenancy model is settled — there is no
column today that says which org a storage object belongs to. Recorded here rather than fixed,
per rule 4; the fix is a numbered migration once tenancy exists.

**`job-photos` is a public bucket.** See `scratchpad/signed-urls-job-photos.md` for the plan
to move to stored paths plus signed URLs. The code change ships first and the
`public = false` flip follows in a later numbered migration.

**Two `SECURITY DEFINER` functions have no caller-authorization check.** `promote_permit_to_crm`
and `set_inventory_tracking` both run with owner rights. Migration 0022 revoked `anon` and
`PUBLIC` execute on them, so they are no longer reachable without an account — but **any
authenticated user can still call either one**, on any permit or any `p_owner_id`. 0022's own
`comment on function` text says as much. Carried into Session 2.

**Two unindexed foreign keys.** `projects.company_id` and `leads.permits.crm_company_id` both
reference `companies(id)` and neither has an index — Postgres creates one for a primary key or
a unique constraint, never for a foreign key. So every `DELETE` on `companies` sequentially
scans `projects` to enforce `NO ACTION`, `inside_leads`' `LEFT JOIN` scans `permits`, and 0008's
linking `UPDATE` scans it again. Two `CREATE INDEX` statements, recorded rather than applied,
because a baseline records.

**Production has drifted from migration 0008.** See the drift note below — this is the first
case the folder was built to catch actually catching one.

**Not captured in either extraction.** Query B's section list promises triggers and returned no
trigger rows for `public.companies` or any `leads` table. Both `companies.updated_at` and
`leads.permits.updated_at` carry `DEFAULT now()`, which fires on INSERT only; whether anything
refreshes them on UPDATE is unanswered. `public.set_updated_at()` does exist. Query D also
covers only 9 of the 15 functions Query A enumerated — the six `apply_*` / `inventory_*`
functions have no captured definition or ACL. 0022's blanket revoke-and-grant-back covered
them regardless, so nothing is unguarded; they are simply undocumented.

## Drift found: `auto_link_permits_to_companies`

**Production's copy of this function does not match `supabase/migrations/0008_auto_link_permits.sql`.**

Both versions do the same two passes and produce the same result. Pass 2 is written
differently in each:

| | Pass 2 |
| --- | --- |
| **0008 (repo)** | `from lateral (select c.id … order by c.id limit 1) m` — a correlated subquery evaluated per permit |
| **Production (Query D)** | `from (select distinct on (lower(btrim(c.name))) c.id as company_id, … ) m` joined on `lower(btrim(p.contractor)) = m.match_name` — a pre-aggregated set |

Both pick the lowest `companies.id` for a given lower-cased, trimmed name, so both are
deterministic and re-run-stable. The production form is the faster shape. 0008's own comment
still describes the LATERAL, which production does not have.

Someone replaced the function in production after 0008 was applied, or edited 0008 afterward.
Either way: **re-running 0008 against production would silently replace the working definition
with a different one.** Not a behaviour change, but not a no-op either, and worth deciding
deliberately rather than discovering during a rebuild. Reconcile the two before the next
`supabase db push`.

## Re-capturing this snapshot

Re-run the extraction queries in `supabase/scratchpad/Kitify_Production_Extraction_Output.md` against
production, then **diff** the fresh output against the files here. A difference means either

- production drifted (someone changed something by hand), or
- a migration landed that this folder has not caught up with.

Either way the difference is the finding. Update the baseline files to match production, and
record *why* it moved.
