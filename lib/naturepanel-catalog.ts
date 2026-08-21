// Nature Panel (HPL) wall-panel lookup — swatch imagery and panel data, keyed by panel id.
//
// Same shape as lib/delta-catalog.ts: the data lives in lib/data/*.json so a refreshed
// scrape is a data commit, not a code change, and every lookup returns null/[] rather than
// throwing so callers keep their existing fallback.
//
// IMAGERY IS LOCAL. Every decor serves two files under /decor-swatches, generated from Grant
// Westfield's print masters by scripts/build-decor-swatches.mjs: a full-panel texture at the
// true 1:4.138 panel ratio, and a square picker thumbnail. The CDN template fields are kept as
// provenance and are still resolvable via getPanelCdnImage(), but nothing renders from them —
// the CDN assets were mostly room photography (whole bathrooms, pot plants and all), which is
// why only three of them could ever be tiled onto a wall. All 21 masters are flat material
// scans, so all 21 are now tileable.
//
// NO PRICING: the catalog carries no prices. HPL money comes from lib/hpl-shower-takeoff.ts.

// The import attribute is required by Node's ESM loader, which is what runs lib/__tests__ —
// without it the catalog (and everything importing it, including lib/catalog.ts) is untestable
// outside a browser build. Next compiles it through SWC, which accepts the same syntax.
import catalog from "./data/naturepanel-catalog.json" with { type: "json" };

export type PanelSpecs = {
  width_in: number;
  height_in: number;
  thickness_in: number;
  joint: string;
  waterproof: boolean;
  warranty_years: number;
  certifications: string[];
};

/**
 * Decor family. Matches the price sheet's own grouping, which is why the Tile collection is
 * split in two — large-format and metro are separately merchandised products.
 */
export type PanelFamily = "wood" | "pure" | "large-tile" | "metro-tile";

/**
 * How a Wood decor is constructed. These are physically different products, not finishes:
 * shiplap is the 5-slat board and slat-wall the 13-slat panel, and the two Cuneo Oaks are
 * sold in both. Undefined outside the Wood family.
 */
export type PanelFormat = "shiplap" | "slat-wall";

/** A panel flattened for UI use: display fields plus ready-to-render image URLs. */
export type Panel = {
  id: string;
  name: string;
  style: string;
  collection: string;      // collection id, which is also the family
  family: PanelFamily;
  format?: PanelFormat;
  shadowLine?: string;
  skuRef?: string;
  imageUrl: string;        // square thumbnail, for pickers and chips
  /**
   * The full-panel image, at the true 22¾ × 94½ ratio — the only kind that may be repeated
   * across a surface. Every decor now has one (see the module header), so this is never
   * undefined in practice; the optional type is kept so a future decor added without an
   * asset degrades to the flat tint rather than rendering a broken wall.
   */
  textureUrl?: string;
  /** Retained for callers that gate on "may this be tiled"; true for all 21 today. */
  isSwatch: boolean;
  /**
   * The master was CMYK with no embedded ICC profile, so the sRGB conversion is generic and
   * the on-screen colour is approximate. Seven decors. Worth surfacing before a dealer picks
   * a colour from a screen — see `flatChip` for the two worst cases.
   */
  colorUnverified: boolean;
  /** The master has no material texture at all — a flat colour chip. Two decors. */
  flatChip: boolean;
};

export type PanelCollection = { id: string; name: string; description: string; panels: Panel[] };

type RawPanel = {
  id: string; name: string; style: string;
  format?: string;
  shadow_line?: string; sku_ref?: string;
  image?: string; tile_image?: string;
  image_source: string; image_hash: string; image_slug: string;
  swatch_asset?: boolean;
  color_unverified?: boolean;
  flat_chip?: boolean;
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
  // A decor with no local thumbnail can't be rendered, so it is dropped rather than shown as
  // a broken tile. Falls back to the CDN only if the local path is missing from the data.
  const imageUrl = raw.tile_image ?? raw.image ?? buildUrl(raw, DEFAULT_SIZE, DEFAULT_SIZE);
  if (!imageUrl) return null;
  return {
    id: raw.id,
    name: raw.name,
    style: raw.style,
    collection: collectionId,
    family: collectionId as PanelFamily,
    format: raw.format as PanelFormat | undefined,
    shadowLine: raw.shadow_line,
    skuRef: raw.sku_ref,
    imageUrl,
    // Only a flat, edge-to-edge capture may tile a wall. Gated on swatch_asset rather than on
    // the file existing, because the cost of being wrong is a photographed bathroom repeated
    // across the previewed one.
    textureUrl: raw.swatch_asset === true ? raw.image : undefined,
    isSwatch: raw.swatch_asset === true,
    colorUnverified: raw.color_unverified === true,
    flatChip: raw.flat_chip === true,
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

/**
 * Thumbnail URL for a panel, or null when the id isn't in the catalog.
 *
 * The width/height arguments are accepted and IGNORED: the local thumbnails are one fixed
 * 320×320 crop, whereas the CDN this replaced resized on demand. Callers already render
 * inside a sized, object-cover box, so the parameters were never doing anything a caller
 * could observe — they are kept so the CDN path (getPanelCdnImage) stays a drop-in swap.
 */
export function getPanelImage(panelId: string, _width = DEFAULT_SIZE, _height = DEFAULT_SIZE): string | null {
  return panelById.get(panelId)?.imageUrl ?? null;
}

/** The full-panel tileable texture, or null when the decor has no flat capture. */
export function getPanelTexture(panelId: string): string | null {
  return panelById.get(panelId)?.textureUrl ?? null;
}

/** The original CDN URL at an arbitrary size — provenance and fallback only; nothing renders it. */
export function getPanelCdnImage(panelId: string, width = DEFAULT_SIZE, height = DEFAULT_SIZE): string | null {
  const raw = rawById.get(panelId);
  return raw ? buildUrl(raw, width, height) : null;
}

/** Every panel in a collection (a PanelFamily id), in catalog order. Empty if unknown. */
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
