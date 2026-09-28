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
1. supabase/baseline/B01, B02 (main body), B03
2. supabase/migrations/0001_initial_schema.sql
3. supabase/baseline/B02 — the DEFERRED section at the foot of the file
4. supabase/migrations/0002 … 00NN  (in order)
5. docs/migrations/2026-08-04-proposal-enhancements.sql   — see note below
```

Baseline first. The migrations assume these objects already exist; 0008 in particular will
fail outright without `leads.permits` and `public.companies`.

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
| `B04_inside_leads_view.sql` | The `public.inside_leads` view | **Outstanding** — needs **Query D** |
| `B05_promote_permit_to_crm.sql` | `promote_permit_to_crm(bigint)` | **Outstanding** — needs **Query E** |
| `B06_storage.sql` | Storage buckets and the six `storage.objects` policies | **Outstanding** — needs **Query G** |

All three written files snapshot production **as it stood before migration 0022**. Each one
carries a `!!` banner saying so, and every object 0022 later altered is commented at the point
of the grant or policy it changed. Read them as history; read `0022_close_anon_holes.sql` for
current state.

**Note on B04.** Query C — already captured — contains the full `inside_leads` view definition
and its raw ACL, which is most of what B04 needs. Query D is listed above because it covers
the function definitions; B04 may be closer to writable than the table suggests. Confirm
before scheduling the capture.

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

**Not captured in the extraction.** Query B's section list promises triggers and returned no
trigger rows for `public.companies` or any `leads` table. Both `companies.updated_at` and
`leads.permits.updated_at` carry `DEFAULT now()`, which fires on INSERT only; whether anything
refreshes them on UPDATE is unanswered. `public.set_updated_at()` does exist. Sequence-level
ACLs in schema `leads` are also uncaptured, as is everything Query G would cover for
`projects.company_id` — nullability, default, backing index, and the FK's ON DELETE action.

## Re-capturing this snapshot

Re-run the extraction queries in `supabase/scratchpad/Kitify_Production_Extraction_Output.md` against
production, then **diff** the fresh output against the files here. A difference means either

- production drifted (someone changed something by hand), or
- a migration landed that this folder has not caught up with.

Either way the difference is the finding. Update the baseline files to match production, and
record *why* it moved.
