# Phase 1 — carries into Session 2

State at the end of Session 1. Baseline B01–B06 all written; Queries A–G all captured; no
extraction outstanding.

Migration **0022 is applied and verified in production** — all 11 checks PASS. It closed every
path reachable with the anon key and no account. **Everything below is reachable with an
account**, which is precisely what 0022 did not address.

The shape of the remaining work: *authentication* is now enforced; *authorization* is not.

> **Corrected since the first draft of these notes.** Query D showed that
> `set_inventory_tracking` **already enforces `is_admin()`** as its first statement. It was
> listed here as needing a guard; it does not. Removed as a standalone item — it is repaired
> for free by item 1, because the function it trusts reads a self-writable column.

---

## 1. `profiles.role` is self-writable — privilege escalation to admin

**Do this first.** Everything that trusts `is_admin()` depends on it, and two other items on
this list are only as strong as it is.

```
profiles_update_self   UPDATE   USING (id = auth.uid())   WITH CHECK (id = auth.uid())
```

No column restriction. A user may write **any column of their own row**, `role` included. And
`is_admin()` reads that same column:

```sql
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$function$
```

A user sets their own `role` to `'admin'`; `is_admin()` agrees; every policy and every function
that trusts it agrees too — including `set_inventory_tracking`'s guard.

Right now the only thing in the way is that **nobody can create an account**: signup OFF,
manual linking OFF, anonymous sign-ins OFF. That is a configuration toggle, not a control, and
it holds only until someone turns signup on for a good product reason.

**Needed:** a column-level restriction so `role` (and arguably `status`) cannot be
self-written — either revoke the column grant, or pin `role` to its existing value in
`WITH CHECK`.

## 2. `promote_permit_to_crm` — one edit, two fixes

**No authorization check**, and **a mutable `search_path` on a `SECURITY DEFINER` function**.
Both are in the same function body, and the rewrite that fixes one fixes the other.

```
SET search_path TO 'public', 'leads'
```

Every other definer function in the database — `is_admin`, `next_order_number`,
`next_claim_number`, `auto_link_permits_to_companies`, `set_inventory_tracking` — uses
`search_path = ''` with fully-qualified references. This one is the exception, and a definer
function with a mutable search path is the classic escalation shape.

**Needed, as a single rewrite:**
- add a caller-authorization guard (admin, or ownership of the permit once tenancy exists)
- convert to `search_path = ''` with every reference fully qualified

Body is in `supabase/baseline/B05_promote_permit_to_crm.sql`, verbatim.

Depends on item 1 if the guard is `is_admin()`-based.

## 3. `auto_link_permits_to_companies` — no authorization check

Any authenticated user can trigger a full two-pass relink and stamp `promoted_at` across all
877 permits. **Lower priority** than item 2: it links rather than exposes, and it is
idempotent by design (only `crm_company_id is null` rows are considered).

Created by migration 0008, so it is not baseline material — the fix is a numbered migration
amending it.

> **Note the drift.** Production's copy of this function does not match 0008's source; the two
> Pass-2 implementations differ (LATERAL in the repo, `distinct on` in production) while
> producing identical results. Reconcile before the next `supabase db push` — see
> `supabase/baseline/README.md`. Whoever writes the guard should write it against the
> production body, not 0008's.

## 4. `public.companies` — all three policies are `using (true)`

| Policy | Command | Expression |
| --- | --- | --- |
| `auth read companies` | SELECT | `USING (true)` |
| `auth insert companies` | INSERT | `WITH CHECK (true)` |
| `auth update companies` | UPDATE | `USING (true)` |

**Any authenticated user reads, inserts and updates every company record.** No DELETE policy,
so DELETE is denied to clients despite the grant.

Same pattern on all three `leads` tables — `authenticated read` and `authenticated update`,
both `USING (true)` — so one dealer can read and overwrite another's `claimed_by`, `follow_up`
and `notes` on any permit.

Snapshotted in `B02_companies.sql` and `B03_leads_tables.sql`, **not fixed there** (charter
rule 4). Blocked on tenancy: no column today says which org a company belongs to.

## 5. Storage — policies check only `bucket_id`

All six policies on `storage.objects` scope by `bucket_id` and nothing else. Two are named
"…their own…" and check nothing of the kind: a contractor can delete another contractor's job
photos and another company's logo.

`storage.objects` and `storage.buckets` also **still grant `anon` full DML**. 0022's revokes
were scoped to schemas `public` and `leads` and never named `storage`, so this is unchanged
pre- and post-0022. RLS is what blocks it today; the grants do not.

> **!! CAUTION for whoever cleans up the storage grants !!**
> The policy **"Anyone can view company logos" is `roles=public`, which includes `anon`**, and
> that is load-bearing, not an oversight. The company logo renders on the **unauthenticated**
> proposal page (`app/proposal/[token]/ProposalView.tsx:500`), where the reader has no account
> and no session. A blanket `revoke select on storage.objects from anon` stops that logo
> rendering for every homeowner looking at a proposal. **Scope the cleanup; do not swing.**

The real fix is **path-prefix scoping by org**, which needs tenancy. Uploads already land under
`orders/<id>/…` and `claims/<id>/…` (`lib/storage.ts:71`), so the prefix convention exists to
build on; the mapping from prefix to org does not.

## 6. New for 0023 — `job-photos` bucket hardening

`job-photos` is `public = true` with **`file_size_limit: null` and `allowed_mime_types: null`**.
Any authenticated user can upload any file type at any size and receive a permanent,
unauthenticated public URL on the Supabase domain. Not just images — anything.

Compare `company-logos` as 0022 created it: 2 MB cap, PNG/JPEG/WebP only, SVG deliberately
excluded because an SVG served directly can execute script. `job-photos` has neither guard.

**Fold all three into 0023**, because they edit the same bucket row in one statement:

1. `public = false`
2. a `file_size_limit`
3. an image-only `allowed_mime_types`

Ordering is unchanged and still non-negotiable — **the code deploys first, the backfill
completes, then 0023**. See `scratchpad/signed-urls-job-photos.md`.

Sizing note: Query E counted **3 objects** in `job-photos`, one top-level folder (`orders`).
The backfill from public URLs to paths is very small.

## 7. Two unindexed foreign keys

Neither `projects.company_id` nor `leads.permits.crm_company_id` has an index. Postgres creates
one for a primary key or a unique constraint, never for a foreign key.

- `projects.company_id` — uuid, nullable, no default, FK to `companies(id)` with **no ON DELETE
  action** (so `NO ACTION`). Every `DELETE` on `companies` sequentially scans `projects` to
  enforce it.
- `leads.permits.crm_company_id` — `inside_leads`' `LEFT JOIN` scans on it, and
  `auto_link_permits_to_companies`' first pass updates on it.

Two `CREATE INDEX` statements. Cheap at this table size, and recorded rather than applied
because a baseline records.

---

## Opening order for Session 2

1. **`profiles.role` self-write** (item 1) — unblocks everything built on `is_admin()`.
2. **`promote_permit_to_crm`** (item 2) — guard + `search_path = ''`, one rewrite.
3. **0023**: `job-photos` `public = false` + size limit + MIME allowlist (item 6) — *after* the
   signed-URL code is deployed and the backfill has completed.
4. **`auto_link_permits_to_companies`** guard (item 3), and reconcile the 0008 drift.
5. **The two indexes** (item 7) — small, independent, can land any time.
6. **Tenancy model**, then the `companies` policy rewrite (item 4) and storage path-prefix
   scoping (item 5).

Before the tenancy tables are created, turn **"Automatically expose new tables" OFF** —
otherwise `orgs`, `memberships`, `org_assignments` and `events` are published through the API
with the default grants at the moment they exist, before a single policy is written for them.
See `supabase/baseline/README.md`.

## Still undocumented (not blocking)

Query D covered 9 of the 15 functions Query A enumerated. The six `apply_*` / `inventory_*`
functions have no captured definition or ACL. 0022's blanket revoke-and-grant-back covered
them, so nothing is unguarded — they are simply unrecorded.

No trigger rows came back for `public.companies` or any `leads` table, though Query B's section
list promises them. `companies.updated_at` and `leads.permits.updated_at` both carry
`DEFAULT now()`, which fires on INSERT only; whether anything refreshes them on UPDATE is
unknown. `public.set_updated_at()` does exist.
