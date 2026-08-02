// Delta product-data lookup — images, prices, spec sheets and specs, keyed by model.
//
// The data lives in lib/data/*.json (one file per Delta collection), kept out of code so a
// refreshed scrape is a data commit, not a code change. All four collections behind the
// dealer packages are loaded: Woodhurst, Lahara, Ashlyn and Trinsic. Callers still keep their
// fallbacks — a finish a collection doesn't publish has no entry here by design.
//
// PRICING: price_usd is the retailer's Internet Sell Price. Treat it as an MSRP / retail
// reference ONLY — it is NOT dealer cost. Anything that surfaces it must label it as such.
//
// Images are served from Build.com's CDN via image_url_template; nothing is stored locally.

import woodhurst from "./data/woodhurst-catalog.json";
import lahara from "./data/lahara-catalog.json";
import ashlyn from "./data/ashlyn-catalog.json";
import trinsic from "./data/trinsic-catalog.json";
import lineax from "./data/lineax-catalog.json";

export type DeltaVariant = {
  finish: string;
  model: string;
  /**
   * Other model strings that denote this same physical product.
   *
   * The retailer's model string and our wholesale ordering SKU don't always agree in form:
   * Trinsic accessories are mid-migration from five- to six-digit models (75918 -> 759180),
   * and its single-hole faucet is listed without the -DST suffix the order sheet carries.
   * Aliases let the image/price lookup succeed from either string, so the ORDERING SKUs in
   * lib/plumbing-catalog.ts stay exactly as the supplier spreadsheet has them — those must
   * never be adjusted to make a lookup work.
   */
  model_aliases?: string[];
  variant_id?: number;
  swatch_hex?: string;
  price_usd: number;
  image_slug: string;
};

export type DeltaResources = {
  installation_sheet?: string;
  spec_sheet?: string;
  exploded_parts?: string;
  manufacturer_warranty?: string;
};

export type DeltaFamily = {
  family_id: string;
  brand: string;
  collection: string;
  base_model: string;
  title: string;
  category: string;
  specs: Record<string, unknown>;
  resources?: DeltaResources;
  variants: DeltaVariant[];
};

export type DeltaCatalog = {
  catalog_name?: string;
  image_url_template: string;
  families: DeltaFamily[];
};

// Registered collections. Add the next catalog here and every lookup picks it up.
// The JSON carries extra keys (retail_urls, gallery_images, price_note…) that no caller
// reads yet, so it's cast to the shape this module contracts on rather than inferred.
//
// Collections publish different finish sets — Lineax in Chrome/Stainless/Matte Black/
// Champagne Bronze (plus Brushed Nickel on its two towel bars alone), Woodhurst swapping
// Champagne for Venetian Bronze, Lahara the reverse, Ashlyn five and Trinsic all six — which
// is exactly what the configurator's swatch filter reads back out of here.
const CATALOGS: DeltaCatalog[] = [
  lineax as unknown as DeltaCatalog,
  woodhurst as unknown as DeltaCatalog,
  lahara as unknown as DeltaCatalog,
  ashlyn as unknown as DeltaCatalog,
  trinsic as unknown as DeltaCatalog,
];

const DEFAULT_IMAGE_SIZE = 400;

// SKUs are compared case-insensitively: the plumbing catalog and the scraped data agree on
// case today, but a future scrape shouldn't be able to silently drop a product.
const normalize = (model: string) => model.trim().toUpperCase();

type VariantHit = { catalog: DeltaCatalog; family: DeltaFamily; variant: DeltaVariant };

// Built once at module load. Small enough (tens of families) that eager indexing costs
// nothing and keeps every lookup O(1).
const byModel = new Map<string, VariantHit>();
const byBaseModel = new Map<string, DeltaFamily>();

for (const catalog of CATALOGS) {
  for (const family of catalog.families) {
    byBaseModel.set(normalize(family.base_model), family);
    for (const variant of family.variants) {
      // Primary model first, then its aliases — so a real model can never be shadowed by
      // something else's alias. First registration wins either way, which keeps a duplicated
      // model across collections from silently displacing the canonical one.
      for (const model of [variant.model, ...(variant.model_aliases ?? [])]) {
        const key = normalize(model);
        if (!byModel.has(key)) byModel.set(key, { catalog, family, variant });
      }
    }
  }
}

function findVariant(model: string | null | undefined): VariantHit | null {
  if (!model) return null;
  return byModel.get(normalize(model)) ?? null;
}

function findFamily(baseModel: string | null | undefined): DeltaFamily | null {
  if (!baseModel) return null;
  // Accept a variant model too — a caller holding a finish-specific SKU shouldn't have to
  // know the family's base model to reach its shared spec sheets.
  return byBaseModel.get(normalize(baseModel)) ?? findVariant(baseModel)?.family ?? null;
}

/** CDN image URL for a finish-specific model, or null when the model isn't loaded. */
export function getProductImage(model: string, width = DEFAULT_IMAGE_SIZE, height = DEFAULT_IMAGE_SIZE): string | null {
  const hit = findVariant(model);
  if (!hit) return null;
  return hit.catalog.image_url_template
    .replace("{W}", String(Math.round(width)))
    .replace("{H}", String(Math.round(height)))
    .replace("{IMAGE_SLUG}", hit.variant.image_slug);
}

/**
 * Internet Sell Price for a model in USD — a retail/MSRP reference, NOT dealer cost.
 * null when the model isn't loaded, so callers fall back to their placeholder price.
 */
export function getProductPrice(model: string): number | null {
  return findVariant(model)?.variant.price_usd ?? null;
}

/** Manufacturer PDFs for a family. Accepts a base model or any of its variant models. */
export function getProductResources(baseModel: string): { installationSheet?: string; specSheet?: string; explodedParts?: string } | null {
  const r = findFamily(baseModel)?.resources;
  if (!r) return null;
  return { installationSheet: r.installation_sheet, specSheet: r.spec_sheet, explodedParts: r.exploded_parts };
}

/** Raw spec block for a family. Accepts a base model or any of its variant models. */
export function getProductSpecs(baseModel: string): Record<string, unknown> | null {
  return findFamily(baseModel)?.specs ?? null;
}

/** Manufacturer product title for a model (shared across the family's finishes). */
export function getProductTitle(model: string): string | null {
  return findVariant(model)?.family.title ?? null;
}

/** The finish name the catalog records for a model — e.g. "Brilliance Stainless". */
export function getProductFinish(model: string): string | null {
  return findVariant(model)?.variant.finish ?? null;
}

/** True when a model has catalog data behind it. */
export function hasProduct(model: string | null | undefined): boolean {
  return findVariant(model) != null;
}

/** Every loaded family in a collection, in catalog order — used by the training resources list. */
export function getCollectionFamilies(collection: string): DeltaFamily[] {
  const want = collection.trim().toLowerCase();
  return CATALOGS.flatMap((c) => c.families).filter((f) => f.collection.trim().toLowerCase() === want);
}

/** Collection names with data loaded, in registration order. */
export function getLoadedCollections(): string[] {
  const seen: string[] = [];
  for (const c of CATALOGS) for (const f of c.families) if (!seen.includes(f.collection)) seen.push(f.collection);
  return seen;
}
