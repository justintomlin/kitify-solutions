# To-do (next session): signed URLs for `job-photos`

**Not implemented. This is a plan, not a change.** Nothing in this document has been applied.

Today `job-photos` is a **public** bucket and the application stores fully-qualified public
URLs in the database. Anyone holding one of those URLs can read the object forever, without a
session, and the URL is guessable-adjacent: it embeds the storage path, and the path is
`orders/<id>/…` or `claims/<id>/…`. The fix is to store **paths** and mint **short-lived
signed URLs at display time**.

## The ordering rule — this is the part that matters

> **The code deploys FIRST. The `public = false` flip goes in `0023` afterward.**

Flipping the bucket first breaks every already-stored URL instantly, across every deployed
client, including rows written months ago. Shipping the code first is harmless: signed URLs
work against a public bucket, so there is a window where both mechanisms are valid and
nothing is broken from either side. Only once the new code is live everywhere does the bucket
flip become a no-op for users.

Do not combine the two into one change. Do not put the flip in the same PR.

## Every `getPublicUrl()` call site

There are exactly two in the codebase.

### 1. `lib/storage.ts:88` — **in scope**

```ts
urls.push(supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl);
```

Inside `uploadPhotos()`. This is the one to change. It currently converts a path it already
has into a public URL and throws the path away.

### 2. `app/portal/settings/page.tsx:104` — **OUT of scope, do not touch**

```ts
const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
```

Different bucket (`company-logos`, `app/portal/settings/page.tsx:19`) and a genuinely
different problem. The company logo is rendered on the **public, unauthenticated** proposal
page — `app/proposal/[token]/ProposalView.tsx:500`, a plain `<img src={branding.logo}>`. That
page has no authenticated Supabase session, so it cannot mint a signed URL. Sweeping
`company-logos` into this change breaks customer-facing proposals.

`company-logos` needs its own decision (stay public, or signed-at-render on the server that
already resolves the proposal token). Out of scope here; flagged so it is not done by reflex.

## The change

### Step 1 — `uploadPhotos()` returns paths

`lib/storage.ts`. The function already computes `path` at line 71; it just stops discarding it.

- `UploadResult.urls: string[]` → `paths: string[]` (rename it — leaving the name `urls`
  while it holds paths is exactly the kind of thing that survives to production).
- Drop the `getPublicUrl` call entirely.
- The tag-in-filename convention (`lib/storage.ts:29–40`) is **unaffected**. `completion_photos`
  is a jsonb array of strings and stays a jsonb array of strings; only the meaning of the
  string changes. The tag still rides in the filename and still parses the same way.

### Step 2 — callers store paths

- `components/PhotoUpload.tsx:92` — the only caller of `uploadPhotos()`. Passes results up.
- `components/PhotoUpload.tsx:239` — `photos.map((url, i) => …)` renders the just-uploaded
  previews. These need resolving too (see step 3), or should keep a local `URL.createObjectURL`
  preview for the in-flight case and only resolve on reload.

Columns that hold these strings:

| Column | Read at | Written at |
| --- | --- | --- |
| `orders.completion_photos` (jsonb) | `lib/store.ts:716` | `lib/store.ts:873` |
| `claims.photos` | `lib/store.ts:1166` | `lib/store.ts:1199` |

### Step 3 — batch `createSignedUrls()` at display time

**Batch, not per-image.** `createSignedUrls(paths[], expiresIn)` takes an array and does one
round trip. A per-image `createSignedUrl()` inside a `.map()` is N sequential network calls
and will be visibly slow on a job with a dozen photos.

Resolve once per view, not once per render — the URLs expire, so they belong in state with
the paths as the dependency, not in a `useMemo` that might be recomputed or might not.

Display sites:

- `app/portal/my-jobs/page.tsx:315` — `o.completionPhotos.map((url) => …)`. The natural place
  is one batch call for the whole visible group (`:291` already filters to orders with photos),
  not one per order.
- `app/portal/orders/[id]/page.tsx:431` — the order detail photo block.
- `components/PhotoUpload.tsx:239` — see step 2.

Suggested expiry: long enough to survive reading a page and opening an image in a new tab,
short enough that a leaked URL is not a permanent grant. An hour is a reasonable default.

### Step 4 — handle legacy rows

**Existing rows already contain full public URLs.** They will not become paths on their own,
and there is no reason to rewrite them in place before the bucket flips.

Display code must accept both for the whole transition:

```
if (s.startsWith("http")) → use as-is (legacy row)
else                     → path, resolve via createSignedUrls
```

This is the part most likely to be skipped and most likely to bite: the day the bucket goes
private, every un-migrated legacy row turns into a broken image at once. Either backfill the
columns to paths before the flip, or keep the branch above permanently. Backfilling is
cleaner and is a data migration, not a schema one — the paths are recoverable from the URLs
by stripping the public prefix.

### Step 5 — `0023`, after the code is live

Flip `job-photos` to `public = false`.

Do this only once the deployment in steps 1–4 is out and the legacy rows are resolved. Until
then the bucket stays public and nothing is worse than it is today.

## Related, not part of this

The storage **"their own" policies check only `bucket_id`** — they do not scope by user or
org, so any authenticated user who reaches the bucket satisfies them. Signed URLs do not fix
that; they are a separate control. The real fix is path-prefix scoping by org, which needs the
tenancy model first. Recorded in `supabase/baseline/README.md` under Outstanding.
