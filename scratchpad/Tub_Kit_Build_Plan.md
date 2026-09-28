# Tub Kit — Build Plan

Survey session, 2026-09-28. Read-only: no product code, no migration, no schema change.

---

## The headline, before anything else

**The brief's premise is wrong, and that is good news.** "The tub path does not exist" is not
what the repo says. The tub path is wired end to end today:

| Evidence | Where |
| --- | --- |
| `export type Path = "shower" \| "tub"` | `components/shower/ShowerConfigurator.tsx:60` |
| UI toggle between the two | `ShowerConfigurator.tsx:1266` |
| `catalog.tubs` populated from `ALCOVE_TUB_SKUS` | `ShowerConfigurator.tsx:413` |
| `itemsForPath()` returns tubs for `path === "tub"` | `ShowerConfigurator.tsx:468` |
| Tub doors filtered by `forPath: "tub"` | `ShowerConfigurator.tsx:532`, `lib/catalog.ts:285` |
| Three tub door models with real SKUs | `lib/catalog.ts:324–341` |
| Two tub bases with real SKUs | `lib/catalog.ts:161–170` |
| `HplShowerType = "tub-surround"` in the takeoff | `lib/hpl-shower-takeoff.ts:46` |
| Tub price line key | `ShowerConfigurator.tsx:699` |
| Tub rendered in the 3D preview | `ShowerConfigurator.tsx:1779` |
| Skirt-height spec shown for tubs only | `ShowerConfigurator.tsx:1306` |
| 9 tub i18n keys, EN/ES/RU complete | `lib/i18n.ts` |

So the question this session was called to answer — how far does the tub variant diverge —
has a shorter answer than expected: **it already diverges exactly as far as one enum value,
and someone built that.** What remains is data completeness, one image asset, and
verification. Not architecture.

That is why previous estimates slid. They were estimating a build that is mostly done, which
makes the number impossible to defend and easy to re-open.

---

## TASK 1 — How the shower path actually works

The spine, in order. Entry point at the top, quote line at the bottom.

**1. Entry — `app/portal/configurator/page.tsx`** (1,474 lines)
The hub page. Owns the bathroom strip, the four module cards (Room / Shower / Vanity /
Plumbing), the running estimate and the save panel. Holds selections in
`lib/hub-state.ts`, which already carries `SharedBath = { kind: "shower" | "tub"; baseId; baseColor }`.

**2. Base choice — `ShowerConfigurator.tsx`**
`itemsForPath(catalog, path)` (`:467`) returns `catalog.bases` or `catalog.tubs`.
`familiesForPath` (`:472`) narrows to `"composite" | "acrylic" | "alcove-tub"`.
`findBaseItem` (`:502`) then `resolveBaseVariant` (`:515`) resolve size → colour → drain down
to one orderable SKU. **Pricing comes from the resolved variant, never from the size** — a
60×36 is $608.40 composite and $464.40 acrylic.

**3. Wall quantity — this is where the two materials part company**
`computeShowerPrice` (`:688`) branches on **material, not on path**:

- **HPL (Nature Panel)** → `buildHplShowerConfig` (`:648`) builds three wall specs from the
  base footprint (back = width, returns = depth), then `computeHplShowerBom` in
  `lib/hpl-shower-takeoff.ts` computes panel counts, trims and seals per wall. This is the
  genuinely hard code — a real per-wall takeoff with an upsell path
  (`components/shower/HplUpsellPopup.tsx`).
- **SPC (NuVo)** → no takeoff at all. `SPC_WALL_KITS` (`lib/catalog.ts:382`) is a list of four
  **pre-packaged kits** keyed by enclosure size and ceiling height. `spcKitCode()` (`:404`)
  substitutes the colour code into `codePattern`. A configuration that matches no kit returns
  the closest with `exact: false` and the panel renders a caveat rather than refusing.

**4. Trims and accessories**
HPL trims fall out of the takeoff BOM. SPC kits include their trims in the kit price.
Accessories are independent multi-select: `CORNER_SHELF`, `SHOWER_NICHE`, `GRAB_BARS`,
`SHOWER_CHAIR` (`lib/catalog.ts:478–520`).

**5. SKU list and pricing**
`computeShowerPrice` accumulates `PriceLine[]`, each carrying an i18n `key`, `params`, a
resolved `productCode` and a `dealerPrice`. Freight is layered separately in `lib/freight.ts`,
where **the bathing fixture is the freight driver** — a pan or a tub is the palletised item.

**6. Hero image — `components/configurator/HeroCompositor.tsx`**
Not a picture-picker. One plate is painted. See Task 4.

**7. Quote line**
`components/configurator/SaveQuotePanel.tsx` → `saveQuote` → `lib/store.ts:531`.
`quoteToRow` (`:270`) writes the shower payload into `quotes.shower` as `jsonb`, alongside
`room`, `vanity`, `plumbing`. The column is untyped at the database boundary, so **a tub
payload needs no schema change** — it is the same jsonb slot with `path: "tub"` inside it.

---

## TASK 2 — What the tub logic says

Source: `NuVo_Tub_Kit_Decision_Tree.pdf` and `NuVo_Tub_Kit_Configurator_Logic.xlsx`
(Google Drive, `1l9-rs1G…` and `19Li2iBh…`). Both read cleanly; nothing ambiguous.

### NuVo tub — decision points in order

| # | Decision | Input needed | Determines |
| --- | --- | --- | --- |
| 1 | Tub model | 5 Cascade Alcove models (60×30 L/R, 60×32 L/R, 60×36 R) | Tub SKU. **Every tub proceeds to every wall option** |
| 2 | Wall colour | 4 SPC colours: Winter White, Slate Grey, Platinum Grey, Driftwood Tile | Colour code in the wall SKU |
| 3 | Tile pattern | Vertical \| Horizontal | **Gates step 4** |
| 4 | Wall height | 66" or 80" if vertical; **auto-set 96" if horizontal** | Final wall SKU |
| 5 | Door line | Pacific \| Tetherow \| Rainier — all three, for all tubs | Available finishes and glass |
| 6 | Finish + glass | Chrome \| Brushed Nickel \| Matte Black × Clear/Opaque | Final door SKU |
| 7 | Accessories | 14 SKUs, optional, multi-select | Added to total |

Eight constraint rules, and only two of them constrain anything:
**"Horizontal ⇒ height auto-set to 96""** and **"Rainier offers Opaque; Pacific and Tetherow
are Clear only."** The other six all say some version of *everything is available for
everything*.

### Fibo shower — the same exercise

Source: `Fibo_Shower_Kit_Decision_Tree_v3.pdf` (`1WevMJta…`).

| # | Decision | Determines |
| --- | --- | --- |
| 1 | Base group | K-36" \| K-38" Neo \| CD-36" \| CD-48" \| CD-60" |
| 2 | Specific base | 12 models |
| 3 | Panel colour | 4 colours — **and panel QUANTITY depends on the base** |
| 4 | Door line | **Filtered by base** |
| 5 | Finish + glass | 3 finishes |
| 6 | Accessories | Optional |

Its panel-quantity matrix is the whole difficulty:
K-Series → 2×48" or 4×24" + reduced accessory pack ($168.49);
CD 36"/48" → 3×48" or 6×24" + standard pack ($206.59);
CD 60" → 4×48" or 6×24".
And its door mapping is base-dependent: `K-36"/CD-36" → Presidio`, `K-38" Neo → Madrone`,
`CD-48" → Pacific/Rainier/Salishan`, `CD-60" → Trillium/Pacific/Tetherow/Rainier`.

### Side by side

| Decision | Shower (Fibo) | Tub (NuVo) | Verdict |
| --- | --- | --- | --- |
| Pick a base | 5 groups → 12 models | 5 models, flat | **Shared shape, simpler** |
| Base colour | n/a (white) | n/a (white) | Shared |
| Drain hand | n/a | Left/Right, in the SKU | **Tub-only** |
| Wall colour | 4 | 4 | Shared |
| **Wall quantity** | **Computed from base** | **None — pre-packaged kit** | **Shower-only complexity** |
| Tile pattern | n/a (Fibo has none) | Vertical \| Horizontal | **Tub-only** |
| Wall height | n/a (94" fixed) | 66"/80", or 96" forced | **Tub-only** |
| **Door filtering** | **Base-dependent** | **None — all 3 for all tubs** | **Shower-only complexity** |
| Glass opacity | Rainier + Presidio | Rainier only | Shared rule, smaller set |
| Finishes | 3 | 3 | Shared |
| Accessories | 14 NuVo SKUs | Same 14 NuVo SKUs | **Identical** |

**The tub tree is strictly simpler than the shower tree.** It removes the two hardest
stages — quantity computation and base→door filtering — and adds two trivial ones, pattern
and height, which are already just fields on an existing kit lookup.

---

## TASK 3 — Divergence assessment

| Stage | Class | Why |
| --- | --- | --- |
| Entry / hub | **Same** | `hub-state.ts` already types `kind: "shower" \| "tub"` |
| Path toggle | **Same** | Built, `ShowerConfigurator.tsx:1266` |
| Base list | **Same** | `itemsForPath` returns `catalog.tubs` |
| Base → SKU resolution | **Same** | `resolveBaseVariant` handles drain hand already |
| Base data | **Parameterized** | One tub missing, prices need reconciling — data, not code |
| Wall quantity | **Same** | SPC kits are a lookup; the tub sheet describes the same lookup |
| Wall colour set | **Parameterized** | Repo offers 6 on some kits, tub sheet says 4 |
| Pattern → height rule | **Parameterized** | Implicit in the kit list today; needs an explicit gate |
| Door filtering | **Same** | `forPath` already separates a 70" screen from a 57" tub screen |
| Door data | **Parameterized** | Prices need reconciling |
| Accessories | **Same** | Identical SKU set, already built |
| Pricing / freight | **Same** | Freight already names the tub as the driver |
| Quote line | **Same** | `quotes.shower` is jsonb; no schema change |
| **Hero plate** | **New** | The only genuinely new artefact — see Task 4 |
| Preview geometry | **Same** | `ShowerConfigurator.tsx:1779` already draws a tub |

**Branched: none.** Every conditional the tub needs already exists.

**New: one item.** The hero plate.

### Branch or parallel path?

**A branch. Emphatically, and it is already a branch.**

The reasoning, in order of weight:

1. **The divergence is one enum.** `Path = "shower" | "tub"` threads through `itemsForPath`,
   `familiesForPath`, `doorsForItem` and the price-line key. Four functions. A parallel path
   would duplicate the other ~1,900 lines of `ShowerConfigurator.tsx` to avoid four
   `if`-statements that are already written.

2. **The hard stage is shared and material-keyed, not path-keyed.** Wall pricing branches on
   `isHplShower(s)` — on the *material*. A tub with SPC walls and a shower with SPC walls run
   identical code, because they order literally the same SKUs: `NUV-6036-66{C}`,
   `NUV-6036-80{C}`, `NUV-HPKG-{C}`. The tub sheet and the repo's shower kit list are the same
   four products at the same prices. Splitting the paths would fork one lookup into two
   copies of itself.

3. **The tub is the simpler case.** Parallel paths earn their keep when one side needs
   structure the other cannot express. Here the tub needs *less*: no quantity computation, no
   base→door filtering. A parallel tub path would be the shower path with features deleted,
   which is the definition of a branch worth keeping together.

4. **The two things that are genuinely tub-only are fields, not flows.** Drain hand is already
   a variant discriminator. Pattern and height are already columns on `SPC_WALL_KITS`.

**Where I would change my mind:** if tub walls ever need a per-wall takeoff like HPL's — a
real `lib/spc-tub-takeoff.ts` — the branch would start carrying two genuinely different
quantity engines. `lib/catalog.ts:412` already flags that a per-wall SPC takeoff "has not been
specced" and is the real fix for non-standard enclosures. That is the future fork, and it
would fork on *material*, not on tub-vs-shower. Even then, a branch stays right.

---

## TASK 4 — The image matrix

### How the shower path selects its plate: it doesn't

`HeroCompositor.tsx` is a **layer compositor, not a picture-picker**. There is exactly **one**
plate. `USE_PHOTO_PLATE = true` (`:67`) selects `PHOTO_SCENE` → `public/hero/base-photo.png`,
with `base-photo-occlusion.png` restoring foreground objects. Everything else is painted onto
it at runtime through the ID mask: wall material and colour, floor, countertop, cabinet
colour, and fixture photographs pinned at named anchors (`faucet`, `showerTrim`, `showerHead`,
`tubSpout`).

So the axes that vary — 4+ wall colours × 2 materials × 3 finishes × door lines × countertop
colours — **consume zero additional plates.** That is the entire point of the compositor, and
it is why the shower path ships one image for a configuration space in the thousands.

### What the tub needs

**One plate set, not a matrix.** Specifically one triple, matching what Phase 0 established:

| Asset | Purpose |
| --- | --- |
| `scene-tub.clay-16x9.png` | structure reference the generator works from |
| `scene-tub.id-16x9.png` | flat ID mask, 15 exact legend colours, no anti-aliasing |
| `scene-tub.photo-16x9.png` | the delivered plate, intake via `scripts/intake-plate.mjs` |

**A tub needs its own plate because geometry cannot be painted.** The compositor changes
*surfaces*, not *shapes*. A tub configuration composited onto the shower plate would show a
shower pan and a glass screen, because those are baked into the plate. Everything else —
colour, material, finish — is paint and needs nothing.

**Plate count: 1. Not 3, not 12.** The existing shower plate already serves seven door lines
(Presidio, Madrone, Pacific, Rainier, Salishan, Trillium, Tetherow) with visibly different
geometries. Applying the same tolerance, the three tub door lines — Pacific 66"H, Tetherow
75"H, Rainier 57"H — share one plate. If you later want door-line fidelity that is 3 plates,
but the shower path does not do that today and consistency says start at 1.

**The tub matrix is SMALLER than the shower matrix**, because the tub tree has fewer
geometry-bearing decisions: no base-group variation (5 models, all 60" alcove, all the same
footprint), where the shower has 12 bases across 5 groups at 36"/48"/60".

### ⚠️ The procurement problem, and it has a dependency you may not have priced

**The contractor cannot start the tub plate until someone renders a tub structure reference.**

The Phase 0 pipeline generates a plate *from* `scene-shower.clay-16x9.png` — a structure
reference produced by `scripts/render-base-scene.mjs --v2`. There is no tub equivalent,
because the 3D scene models a shower alcove: `SHOWER = { x1: 48, z1: 36, h: 84, curb: 4 }`, a
pan, and a glass screen.

So the order of operations is:

1. Model a tub in `render-base-scene.mjs` (alcove tub replacing pan + curb, tub door replacing
   the screen) — **this is ours, and it gates the contractor**
2. Render `scene-tub.clay-16x9.png` + `scene-tub.id-16x9.png`
3. Hand the clay to the contractor as the structure reference
4. Contractor generates `master-tub-*.png`
5. `scripts/intake-plate.mjs` → production pair
6. `scripts/registration-check.mjs` → verify

**If the contractor delivers in ~10 days and step 1 has not happened, the tub plate is not in
that delivery.** Step 1 is perhaps a day of scene work — the geometry is simpler than what is
already modelled — but it must happen *first*, and nothing about it is currently scheduled.
**This is the thing to act on tonight.**

### ID tag maps: reuse, do not invent

The 15-colour legend from 0022/Phase 0 covers the tub scene as-is. Two tags change meaning
rather than changing value:

| Legend ID | Shower meaning | Tub meaning |
| --- | --- | --- |
| `#808000` `showerBase` | pan + curb | the tub |
| `#008080` `showerDoor` | screen frame + hardware | tub door frame + hardware |
| `#ff8060` `showerFixtures` | head + valve | head + valve + **tub spout** |

Everything else — walls, floor, vanity, countertop, toilet, rubber base, vanity light — is
unchanged. **No new legend values, no second legend file.** The names read slightly oddly for
a tub, but renaming them would break `lib/hero-regions.ts`'s `RegionId` and every committed
baseline for a cosmetic gain. Leave them, and note the aliasing in the tub scene's header.

`tubSpout` already exists as an anchor (`lib/hero-regions.ts:87`) and is already modelled in
the 3D scene, which is a small sign someone anticipated this.

---

## TASK 5 — What's missing

### You have to supply these — I cannot derive them

| # | Item | Detail |
| --- | --- | --- |
| 1 | **Price reconciliation** | The repo's tub and door dealer prices do **not** match the tub sheet's cost column, and not by a consistent factor. See table below. I cannot tell which is authoritative. |
| 2 | **The fifth tub** | `BGS-2763-6036R` (59¾ × 36 × 21½, right drain, list $1,288 / cost $850) is in the source and **absent from `ALCOVE_TUB_SKUS`**. Repo has 60×30 and 60×32 only. |
| 3 | **Wall colour count** | Source says 4 colours for tub walls. Repo offers 4 on `nuv-6036-66` but **6** on `nuv-6036-80` and both horizontal kits. Is the tub restricted, or is the source sheet stale? |
| 4 | **Tub waste & overflow SKU** | `lib/plumbing-catalog.ts:50` — "SKU PENDING — tub waste & overflow has not been sourced yet. Do not order against this entry." A tub quote is not orderable without it. |
| 5 | **The tub hero plate** | Contractor deliverable, gated on our clay render. See Task 4. |
| 6 | **Freight class for a tub** | `lib/freight.ts` names the tub as the driver but I did not find a tub-specific weight/class band. Confirm it is covered. |

**The price discrepancies, concretely:**

| SKU | Source cost | Repo `dealerPrice` | Δ |
| --- | --- | --- | --- |
| BGS-2763-6030L/R | $765 | 730.20 | repo **lower** |
| BGS-2763-6032L/R | $765 | 730.20 | repo **lower** |
| BGS-2763-6036R | $850 | *absent* | — |
| PAC-6066 (Chrome) | $1,031 | 984 | repo **lower** |
| TET-6060 (Chrome) | $636 | 694.20 | repo **higher** |
| RAN-6057 (Chrome) | $469 | 532.80 | repo **higher** |

No single multiplier explains it — two go down, two go up. These are different price sheets
from different dates, not a tier conversion.

**Worth noting what *does* match:** the wall kits reconcile almost exactly (repo 684 / 697.80 /
891.60 against source 684 / 698 / 890), and the awkward Driftwood code inconsistency —
`DT` on vertical kits, `DW` on horizontal — appears identically in both. So the wall data came
from this sheet and the tub/door data came from somewhere else.

### I can derive these — no input needed

- Pattern → height gating (the rule is explicit in the source)
- Wall SKU assembly (`spcKitCode` already does it)
- Door filtering by path (built)
- Accessory attachment (identical to shower, built)
- Price-line assembly, freight, quote payload (built)
- i18n for anything new — EN/ES/RU, following the existing 9 tub keys

### Contradictions with what is already built

Three, and they are all small — no landmines:

1. **Wall colour count** — 4 in the source, 6 in the repo for two of four kits. Item 3 above.
2. **Tetherow tub door height** — source says the Tetherow tub door opening is
   `56–60"W × 75"H`; the repo has `tet-6060` at `heightIn: 60`. The SKU code says 6060. The
   source's own summary table says the Tetherow tub line is `56-60"W x 75"H` while its SKU
   table repeats 75". **The repo may be wrong, or the SKU name may be misleading.** Confirm
   before it reaches a dealer quote.
3. **Skirt height** — `TUB_SKIRT_HEIGHT_IN = 16` in the repo, with a comment saying "Check it
   against the Cascade tub spec sheet before this reaches a dealer quote." The source says the
   tubs are 21½"H overall. 16" floor-to-rim vs 21½" overall are different measurements and may
   both be right, but nobody has checked.

The absence of larger contradictions is itself the finding: the tub sheet and the repo agree
on structure everywhere that matters.

---

## Proposed session breakdown

Ordered by dependency, not by size. **Session 1 is the one with a clock on it.**

### Session 1 — Tub scene + clay/ID render ⏰
**Blocks the contractor. Do this first.**
Add an alcove-tub variant to `scripts/render-base-scene.mjs`: tub in place of pan + curb, tub
door in place of the screen, `tubSpout` fixture visible. Render `scene-tub.clay-16x9.png` and
`scene-tub.id-16x9.png`. Verify with `audit-scene-v2.mjs` — 15 exact IDs, zero blends.
**Before starting:** ruling on plate count (1, per Task 4) and confirmation the contractor can
take a second structure reference within the current engagement.
**Output:** a clay plate handed to the contractor.

### Session 2 — Data reconciliation
Resolve items 1–3 and 6 from Task 5: tub and door prices, the missing `BGS-2763-6036R`, the
wall colour count, the Tetherow height, the skirt height. Update `lib/catalog.ts`.
**Before starting:** you supply the authoritative price sheet. This session cannot start
without it and should not guess.
**Output:** catalog data matching one named source, with the source named in a comment.

### Session 3 — Pattern/height gate and tub verification
Add the explicit `Horizontal ⇒ 96"` gate. Then walk the tub path end to end in the browser and
record what actually happens at each stage — the first real test of the claim that it works.
**Before starting:** Session 2 complete, or prices will be verified twice.
**Output:** a defect list, which may well be short.

### Session 4 — Tub plate intake
`intake-plate.mjs` on the contractor's delivery, `registration-check.mjs` against the tub ID
mask, fixture conforming if needed (the Phase 0.3 pattern).
**Before starting:** contractor delivery in hand; Session 1 complete.
**Output:** production tub plate, registration verified.

### Session 5 — Compositor plate selection
The one piece of genuinely new wiring: `HeroCompositor` currently has a single `PLATE`
constant. It needs to choose between shower and tub plates on `path`. Small, but it touches
the configurator, so it is deliberately last and deliberately alone.
**Before starting:** Session 4 complete.
**Output:** tub configurations render a tub.

### Not scheduled, flagged
`lib/plumbing-catalog.ts` tub waste & overflow (item 4) — a sourcing task, not a coding one,
and it blocks *ordering* rather than *quoting*. Raise it with whoever owns supplier
relationships now, because it has no engineering dependency and will otherwise surface at the
worst moment.

---

## What I did not do

Per the brief: no product code, no migration, no schema change, no test changes. Nothing in
`app/`, `components/`, `lib/` or `supabase/` was touched. This file is the only output.

**Source files:** none of the six named documents are in the repo. All were read from Google
Drive. Two name mismatches worth knowing: the brief cites
`Fibo_Shower_Kit_Decision_Tree.pdf` and `SPC_Kit_Configurator_Logic_v2.xlsx`; Drive has **v3**
of both. I read v3. Drive also holds a `Fibo_Tub_Kit_Configurator_Logic.xlsx` the brief did not
mention — **not read**, because the repo's tub path is NuVo and reading a second, possibly
conflicting tub source without knowing which is authoritative would have been worse than
leaving it. Say the word if Fibo tubs are also in scope.

`ThermaGlass_Kit_Combinations.xlsx` did not appear in the Drive search and was not read.
