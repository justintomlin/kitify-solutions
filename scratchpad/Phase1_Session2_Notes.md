# Phase 1 — carries into Session 2

State at the end of Session 1 (commit following `3ebdbdf`).

Migration **0022 is applied and verified in production** — all 11 checks PASS. It closed every
path reachable with the anon key and no account. **Everything below is reachable with an
account**, which is precisely what 0022 did not address and what Session 2 has to.

The shape of the remaining work: *authentication* is now enforced; *authorization* is not.

---

## 1. Two `SECURITY DEFINER` functions take no caller authorization

`promote_permit_to_crm(bigint)` and `set_inventory_tracking(uuid, boolean)` run with owner
rights and check nothing about who called them.

0022 revoked `anon` and `PUBLIC` execute on both (Part 2) and granted back only
`authenticated` and `service_role`. So the door is shut to strangers and **wide open to every
signed-in user**: any authenticated account can promote any permit, and can flip inventory
tracking for any `p_owner_id`, not just their own.

0022 says so in its own `comment on function` text, deliberately, so the TODO lives on the
object:

- `promote_permit_to_crm` — *"TODO Phase 1: add a caller-authorization check. Any authenticated user can still promote any permit."*
- `set_inventory_tracking` — *"TODO Phase 1: verify the caller is an admin or owns p_owner_id."*

**Needed:** an `is_admin() or <ownership test>` guard inside each function body. Note the
ordering dependency — see item 3, because `is_admin()` is only trustworthy once `profiles.role`
is no longer self-writable.

## 2. `public.companies` — all three policies are `using (true)`

RLS is enabled on `companies` and then immediately given away:

| Policy | Command | Expression |
| --- | --- | --- |
| `auth read companies` | SELECT | `USING (true)` |
| `auth insert companies` | INSERT | `WITH CHECK (true)` |
| `auth update companies` | UPDATE | `USING (true)` |

**Any authenticated user reads, inserts and updates every company record**, including rows
assigned to someone else. There is no DELETE policy, so DELETE is denied to clients despite
the grant.

The same pattern is on all three `leads` tables — `authenticated read` and `authenticated
update`, both `USING (true)` — so one dealer can read and overwrite another's `claimed_by`,
`follow_up` and `notes` on any permit.

Snapshotted faithfully in `supabase/baseline/B02_companies.sql` and `B03_leads_tables.sql`,
**not fixed there** (charter rule 4 — a baseline records production, it does not correct it).
The fix is a numbered migration, and it is blocked on the tenancy model: there is no column
today that says which org a company belongs to.

## 3. `profiles.role` is self-writable — privilege escalation to admin

The sharpest item on this list, and the reason **Supabase signup must stay OFF**.

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

So a user sets their own `role` to `'admin'`, and `is_admin()` agrees. Every policy that
trusts `is_admin()` — including `profiles_select_self_or_admin` — then trusts them.

Right now the only thing standing in the way is that **nobody can create an account**: signup
is OFF, manual linking is OFF, anonymous sign-ins are OFF, and accounts are made by an
administrator. That is a configuration toggle, not a control. It holds until someone turns
signup on for a perfectly good product reason.

**Needed:** restrict `profiles_update_self` so `role` (and arguably `status`) cannot be
self-written — a column-level grant revoke, or a `WITH CHECK` that pins `role` to its existing
value. **Do this before item 1**, since item 1's guards are built on `is_admin()`.

## 4. Storage "their own" policies check only `bucket_id`

The policies named "…their own…" on `storage.objects` scope by **`bucket_id` and nothing
else**. No user check, no org check. Any authenticated user who reaches the bucket satisfies
them.

The correct fix is **path-prefix scoping by org**, which cannot be written until tenancy
exists — there is no column today that says which org a storage object belongs to. Uploads
already land under `orders/<id>/…` and `claims/<id>/…` (`lib/storage.ts:71`), so the prefix
convention is there to build on; what is missing is the mapping from prefix to org.

Signed URLs do **not** fix this. They are a separate control on a separate problem — see
`scratchpad/signed-urls-job-photos.md`, which is also still to do, with its deploy-order rule:
**code first, `public = false` in 0023 after, backfill complete before 0023.**

## 5. Queries D, E and G are still uncaptured

`supabase/baseline/B04`–`B06` cannot be written until they are run. From the extraction file's
own header:

| Query | Covers | Blocks |
| --- | --- | --- |
| **D** | `promote_permit_to_crm` definition, config, acl | `B05_promote_permit_to_crm.sql` |
| **E** | storage bucket JSON and the six `storage.objects` policies | `B06_storage.sql` |
| **G** | `projects.company_id` and the `leads` sequences | completes `B02_companies.sql` |

Two notes for whoever runs them:

- **Query D also unblocks item 1.** The caller-authorization guard has to be written against
  the real function body, and nobody has seen it yet.
- **B04 may be closer than it looks.** Query C — already captured — has the full `inside_leads`
  view definition and its raw ACL, which is most of what `B04_inside_leads_view.sql` needs.
  Confirm before scheduling another capture.

Also unanswered by the current extraction: **no trigger rows came back** for `public.companies`
or any `leads` table, though Query B's section list promises them. Both
`companies.updated_at` and `leads.permits.updated_at` carry `DEFAULT now()`, which fires on
INSERT only — whether anything refreshes them on UPDATE is unknown. `public.set_updated_at()`
does exist (Query A). Recorded in B02 and B03 as an open question rather than guessed at.

---

## Ordering

1. **`profiles.role` self-write** (item 3) — everything that trusts `is_admin()` depends on it.
2. **Caller-authorization on the two `SECURITY DEFINER` functions** (item 1) — needs Query D.
3. **Tenancy model**, then the policy rewrites (item 2) and storage path-prefix scoping (item 4).

Before tenancy tables are created, turn **"Automatically expose new tables" OFF** — otherwise
`orgs`, `memberships`, `org_assignments` and `events` are published through the API with the
default grants at the moment of creation, before a single policy exists for them. See
`supabase/baseline/README.md`.
