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
1. supabase/baseline/B01 … B06      (in order)
2. supabase/migrations/0001 … 00NN  (in order)
3. docs/migrations/2026-08-04-proposal-enhancements.sql   — see note below
```

Baseline first. The migrations assume these objects already exist; 0008 in particular will
fail outright without `leads.permits` and `public.companies`.

## File status

| File | Contents | Status |
| --- | --- | --- |
| `B01_leads_schema.sql` | The `leads` schema itself, its grants and its search path | **Not yet written** — needs Query A output |
| `B02_companies.sql` | `public.companies`, plus `projects.company_id` as a documented `ALTER` | **Not yet written** — needs Query B output |
| `B03_leads_tables.sql` | The three `leads.*` tables, their grants and their policies | **Not yet written** — needs Query F output |
| `B04_inside_leads_view.sql` | The inside-leads view | **Outstanding** — needs Query D output |
| `B05_promote_permit_to_crm.sql` | `promote_permit_to_crm()` | **Outstanding** — needs Query E output |
| `B06_storage.sql` | Storage buckets and their policies | **Outstanding** — needs Query G output |

B01–B03 are specified and ready to write; the extraction output they transcribe was not
available in the working tree when this README was written. B04–B06 are blocked on queries
that have not been run yet.

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
  the moment it is created, without a further decision being made. Worth knowing before
  adding a table that is not meant to be public.

**Authentication**

| Setting | State |
| --- | --- |
| Allow new users to sign up | **OFF** |
| Manual linking | **OFF** |
| Anonymous sign-ins | **OFF** |
| Confirm email | **OFF** |
| Providers enabled | **Email only** |

Accounts are created by an administrator; there is no self-service signup path.

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

Two consequences worth holding onto:

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

## Re-capturing this snapshot

Re-run the extraction queries in `scratchpad/Kitify_Production_Extraction_Output.md` against
production, then **diff** the fresh output against the files here. A difference means either

- production drifted (someone changed something by hand), or
- a migration landed that this folder has not caught up with.

Either way the difference is the finding. Update the baseline files to match production, and
record *why* it moved.
