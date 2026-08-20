// Durasein (Solid Surface) lookup — swatch imagery, sheet scans and color data, keyed by SKU.
//
// WHAT THIS FEEDS: the VANITY COUNTERTOP program. Durasein was also the shower's third wall
// tier until Aug 2026, when solid surface was retired as a wall product; the shower module
// keeps a read-only legacy palette (LEGACY_WALL_MATERIALS) so old quotes still resolve, but
// nothing selects a Durasein WALL any more. Countertops are unaffected and live.
//
// Two access patterns, and they are not interchangeable:
//   · by SKU ("DM1001")            — getDuraseinColor / getAllDuraseinColors /
//                                    getDuraseinCollections / getDuraseinColorsByCollection /
//                                    getDuraseinSwatchUrl
//   · by colour-name slug ("bone") — getDuraseinColorByNameSlug
// The countertop path uses the slug lookup (the vanity's own swatch ids are name slugs), plus
// DURASEIN_SHEET_IN and duraseinSheetTexture. The SKU accessors were the wall picker's and
// currently have no callers — kept, not deleted: this is the read API of a catalogue that
// still ships, and a countertop picker browsing the range by collection is the obvious next
// consumer. Same for DURASEIN_BRAND / DURASEIN_MATERIAL / DURASEIN_PRODUCT_URL.
//
// Same shape as lib/naturepanel-catalog.ts: the data lives in lib/data/*.json so a refreshed
// crawl is a data commit, not a code change, and every lookup returns null/[] rather than
// throwing so callers keep their existing fallback.
//
// Unlike Nature Panel, there is no image template to fill in — Durasein serves each swatch
// as a plain WordPress upload, so the URLs are stored whole and used as-is. Nothing is
// stored locally, and no size parameters are appended (the CDN offers none).
//
// NO PRICING: the catalog carries no prices.

import catalog from "./data/durasein-catalog.json";

/** One catalogued color, flattened for UI use. */
export type DuraseinColor = {
  id: string;                  // Durasein SKU — "DM1001"
  name: string;                // published color name — "Arctic White"
  patternCode: string;         // pattern/texture code ("pm4874", "ts050"); "" for solid colors
  collection: string;          // collection id — "timeless" | "brilliant" | …
  swatchUrl: string;           // hi-res swatch master; the primary configurator image
  swatchDownload: string;      // Durasein's DOWNLOAD SWATCH asset; "" when the page offers none
  sheetUrl: string;            // full-sheet scan; "" when the page offers none
  pageUrl: string;             // durasein.com product page
  applicationPhotos: string[]; // installed / lifestyle photography, in page order
};

/**
 * Real-world size of one full-sheet scan, in inches. MEASURED, not assumed.
 *
 * Three of these scans were pulled and their pixel dimensions compared against the nominal
 * sheet: 7021 x 1500 px against 144 x 30.75in gives 48.76 px/in across and 48.78 px/in down —
 * agreeing to 0.05%, which is what pins the sheet's proportions rather than leaving them a
 * guess. (Glacier Tundra's scan is 7201 x 1500 and comes out 2.5% wider; the difference is
 * within the crop variation between shoots and does not move the tile size enough to matter.)
 *
 * This is the number that makes a solid-surface texture render at TRUE SCALE: the compositor
 * turns a tile's real size into a repeat count, so a sheet declared 144in wide across a 61in
 * countertop shows 42% of the scan rather than the whole thing squeezed on.
 */
export const DURASEIN_SHEET_IN = { w: 144, h: 30.75 };

/**
 * A sheet scan, sized down through Next's image optimizer.
 *
 * Addressed by URL rather than through <Image> because the consumers are an SVG
 * <pattern><image href> and a canvas texture, neither of which next/image can render. The
 * scans are 1–2 MB apiece — far more than a texture drawn a few hundred pixels wide needs —
 * and Durasein serves them as plain WordPress uploads with no CDN sizing parameters of their
 * own, which is why the host is allowlisted in next.config.mjs. `w` must be one of Next's
 * configured widths (its default deviceSizes/imageSizes lists).
 *
 * SAME ORIGIN once optimized, which matters beyond bandwidth: the hero compositor reads pixels
 * back off some of its canvases, and a direct durasein.com fetch would taint them.
 */
export function duraseinSheetTexture(sheetUrl: string, w = 1920): string {
  return `/_next/image?url=${encodeURIComponent(sheetUrl)}&w=${w}&q=75`;
}

/**
 * SWATCH IMAGES ARE NOT TEXTURES, and this is the one place that is worth saying out loud
 * because two different callers have now got it wrong.
 *
 * Durasein's `swatchUrl` is a studio photograph of a slab CORNER — the sheet seen at an angle,
 * with its own 12mm edge profile crossing the frame, a background and a cast shadow. It is the
 * right image for a picker tile and completely wrong as a repeating surface: tiled onto a
 * countertop it draws that edge profile across the middle of the counter and magnifies the
 * grain by whatever the ratio between the shot's field of view and the counter happens to be.
 * `sheetUrl` is the flat edge-to-edge scan and is the only one that may be tiled.
 */

export type DuraseinCollection = { id: string; name: string; colors: DuraseinColor[] };

type RawColor = Omit<DuraseinColor, "collection">;
type RawCollection = { id: string; name: string; colors: RawColor[] };
type RawCatalog = { brand: string; material: string; productUrl: string; collections: RawCollection[] };

const DATA = catalog as RawCatalog;

export const DURASEIN_BRAND = DATA.brand;
export const DURASEIN_MATERIAL = DATA.material;
export const DURASEIN_PRODUCT_URL = DATA.productUrl;

// Built once at module load — 64 colors, so eager indexing costs nothing and keeps every
// lookup O(1).
const colorById = new Map<string, DuraseinColor>();
const COLLECTIONS: DuraseinCollection[] = DATA.collections.map((c) => {
  const colors: DuraseinColor[] = [];
  for (const raw of c.colors) {
    // A color with no usable swatch has nothing to show in the picker; the generator already
    // drops those, and this guard keeps a hand-edited JSON from putting a blank tile on screen.
    if (!raw.swatchUrl) continue;
    const color: DuraseinColor = { ...raw, collection: c.id };
    // First registration wins, so a duplicated SKU can't silently shadow the canonical one.
    if (!colorById.has(color.id)) colorById.set(color.id, color);
    colors.push(color);
  }
  return { id: c.id, name: c.name, colors };
});

/**
 * Swatch URL for a SKU, or null when the id isn't in the catalog. These are direct
 * WordPress uploads — there is no size parameter to pass, so callers size with CSS.
 */
export function getDuraseinSwatchUrl(colorId: string | null | undefined): string | null {
  return colorId ? colorById.get(colorId)?.swatchUrl ?? null : null;
}

/** Collections with their metadata, for rendering grouped swatch grids. */
export function getDuraseinCollections(): DuraseinCollection[] {
  return COLLECTIONS;
}

/** Every color in a collection ("timeless" | "brilliant" | …), in catalog order. Empty if unknown. */
export function getDuraseinColorsByCollection(collectionId: string): DuraseinColor[] {
  return COLLECTIONS.find((c) => c.id === collectionId)?.colors ?? [];
}

/** All 64 colors across every collection, in catalog order. */
export function getAllDuraseinColors(): DuraseinColor[] {
  return COLLECTIONS.flatMap((c) => c.colors);
}

/** One color by SKU, or null. */
export function getDuraseinColor(colorId: string | null | undefined): DuraseinColor | null {
  return colorId ? colorById.get(colorId) ?? null : null;
}

// ---------------------------- lookup by name --------------------------------

/**
 * The catalog is keyed by SKU ("DM1001"), but the vanity configurator's countertop swatches
 * are keyed by a slug of the marketing name ("arctic-white"). They are the same 16 materials
 * — the vanity list was authored from Durasein's colour names — so this bridges the two
 * without duplicating the swatch URLs into the vanity module or renaming either set of ids.
 *
 * Built eagerly alongside colorById; 64 entries. First registration wins, matching the SKU
 * index, so a duplicated name cannot shadow the canonical colour.
 */
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const colorByNameSlug = new Map<string, DuraseinColor>();
for (const c of COLLECTIONS.flatMap((c) => c.colors)) {
  const slug = slugify(c.name);
  if (!colorByNameSlug.has(slug)) colorByNameSlug.set(slug, c);
}

/**
 * One color by a slug of its name ("arctic-white"), or null.
 *
 * Returns null rather than guessing when a slug has no match: the caller's fallback is a flat
 * hex tint, which is a correct-if-plainer answer, whereas a near-miss would paint the wrong
 * stone onto a customer's countertop.
 */
export function getDuraseinColorByNameSlug(slug: string | null | undefined): DuraseinColor | null {
  return slug ? colorByNameSlug.get(slug) ?? null : null;
}
