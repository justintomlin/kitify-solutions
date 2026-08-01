// Nature Panel (HPL) wall-panel lookup — swatch imagery and panel data, keyed by panel id.
//
// Same shape as lib/delta-catalog.ts: the data lives in lib/data/*.json so a refreshed
// scrape is a data commit, not a code change, and every lookup returns null/[] rather than
// throwing so callers keep their existing fallback.
//
// Two CDNs are in play — Grant Westfield publishes the Wood Decors on naturepanel.co.uk and
// the Tile/Pure Decors on multipanel.co.uk — so each panel names its own source and the URL
// is built from that source's template. Nothing is stored locally.
//
// NO PRICING: the catalog carries no prices. Wall-kit pricing stays on the shower module's
// placeholder tier price until a real price book lands.

import catalog from "./data/naturepanel-catalog.json";

export type PanelSpecs = {
  width_in: number;
  height_in: number;
  thickness_in: number;
  joint: string;
  waterproof: boolean;
  warranty_years: number;
  certifications: string[];
};

/** A panel flattened for UI use: display fields plus a ready-to-render swatch URL. */
export type Panel = {
  id: string;
  name: string;
  style: string;
  collection: string;      // collection id — "wood" | "tile" | "pure"
  shadowLine?: string;
  skuRef?: string;
  imageUrl: string;        // at DEFAULT_SIZE; call getPanelImage() for another size
  /**
   * Whether imageUrl is a true material swatch (a flat crop of the decor) rather than a
   * room/lifestyle photograph.
   *
   * Only the seven Wood Decors currently point at swatch crops. Every Tile and Pure decor
   * references multipanel.co.uk gallery photography — whole bathrooms, complete with
   * vanities and pot plants. Those are fine as product thumbnails but must never be tiled
   * as a wall texture, which is why callers gate on this instead of on the image existing.
   * Flip to true in the JSON once real swatch assets replace them.
   */
  isSwatch: boolean;
};

export type PanelCollection = { id: string; name: string; description: string; panels: Panel[] };

type RawPanel = {
  id: string; name: string; style: string;
  shadow_line?: string; sku_ref?: string;
  image_source: string; image_hash: string; image_slug: string;
  swatch_asset?: boolean;
};
type RawCollection = { id: string; name: string; description: string; panels: RawPanel[] };
type RawCatalog = {
  brand: string; manufacturer: string; material: string;
  panel_specs: PanelSpecs;
  image_sources: Record<string, string>;
  collections: RawCollection[];
};

// The JSON carries snake_case keys this module maps to the Panel shape above, so it's cast
// to the contracted type rather than inferred.
const DATA = catalog as unknown as RawCatalog;

const DEFAULT_SIZE = 300;

export const PANEL_BRAND = DATA.brand;
export const PANEL_MANUFACTURER = DATA.manufacturer;

function buildUrl(raw: RawPanel, width: number, height: number): string | null {
  const template = DATA.image_sources[raw.image_source];
  // An unknown source means the data references a CDN this module can't build a URL for;
  // returning null keeps the caller on its swatch fallback instead of emitting a broken src.
  if (!template) return null;
  return template
    .replace("{HASH}", raw.image_hash)
    .replace("{SLUG}", raw.image_slug)
    .replace("{W}", String(Math.round(width)))
    .replace("{H}", String(Math.round(height)));
}

function toPanel(raw: RawPanel, collectionId: string): Panel | null {
  const imageUrl = buildUrl(raw, DEFAULT_SIZE, DEFAULT_SIZE);
  if (!imageUrl) return null;
  return {
    id: raw.id,
    name: raw.name,
    style: raw.style,
    collection: collectionId,
    shadowLine: raw.shadow_line,
    skuRef: raw.sku_ref,
    imageUrl,
    // Absent means "not verified as a swatch" — the safe answer, since the cost of being
    // wrong is a bathroom photo rendered as a wall texture.
    isSwatch: raw.swatch_asset === true,
  };
}

// Built once at module load — 21 panels, so eager indexing costs nothing and keeps every
// lookup O(1).
const rawById = new Map<string, RawPanel>();
const panelById = new Map<string, Panel>();
const COLLECTIONS: PanelCollection[] = [];

for (const c of DATA.collections) {
  const panels: Panel[] = [];
  for (const raw of c.panels) {
    const panel = toPanel(raw, c.id);
    if (!panel) continue;
    // First registration wins, so a duplicated id can't silently shadow the canonical one.
    if (!panelById.has(panel.id)) {
      panelById.set(panel.id, panel);
      rawById.set(panel.id, raw);
    }
    panels.push(panel);
  }
  COLLECTIONS.push({ id: c.id, name: c.name, description: c.description, panels });
}

/** Swatch URL for a panel at an arbitrary size, or null when the id isn't in the catalog. */
export function getPanelImage(panelId: string, width = DEFAULT_SIZE, height = DEFAULT_SIZE): string | null {
  const raw = rawById.get(panelId);
  return raw ? buildUrl(raw, width, height) : null;
}

/** Every panel in a collection ("wood" | "tile" | "pure"), in catalog order. Empty if unknown. */
export function getPanelsByCollection(collectionId: string): Panel[] {
  return COLLECTIONS.find((c) => c.id === collectionId)?.panels ?? [];
}

/** All 21 panels across every collection, in catalog order. */
export function getAllHplPanels(): Panel[] {
  return COLLECTIONS.flatMap((c) => c.panels);
}

/** One panel by id, or null. */
export function getPanel(panelId: string | null | undefined): Panel | null {
  return panelId ? panelById.get(panelId) ?? null : null;
}

/** Panel construction specs — dimensions, joint, warranty, certifications. */
export function getPanelSpecs(): PanelSpecs {
  return DATA.panel_specs;
}

/** Collections with their metadata, for rendering grouped swatch grids. */
export function getPanelCollections(): PanelCollection[] {
  return COLLECTIONS;
}
