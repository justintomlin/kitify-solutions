// Durasein (Solid Surface) wall-panel lookup — swatch imagery and color data, keyed by SKU.
//
// Same shape as lib/naturepanel-catalog.ts: the data lives in lib/data/*.json so a refreshed
// crawl is a data commit, not a code change, and every lookup returns null/[] rather than
// throwing so callers keep their existing fallback.
//
// Unlike Nature Panel, there is no image template to fill in — Durasein serves each swatch
// as a plain WordPress upload, so the URLs are stored whole and used as-is. Nothing is
// stored locally, and no size parameters are appended (the CDN offers none).
//
// NO PRICING: the catalog carries no prices. Wall-kit pricing stays on the shower module's
// placeholder tier price until a real price book lands.

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
