// Shower component images — the isolated valve trim, tub spout and shower head photos the
// hero compositor pins onto the scene, keyed by program and finish.
//
// Same shape as lib/delta-catalog.ts: the data lives in lib/data/*.json so a refreshed
// extract is a data commit, not a code change, and every lookup returns null rather than
// throwing so callers keep their fallback.
//
// WHY THIS EXISTS ALONGSIDE delta-catalog
// That catalog is the ordering source: it answers "what SKU does this package sell, at what
// price". This one answers a different question — "what does that fixture look like on its
// own, and how big is it in inches" — and its records are per COMPONENT, not per orderable
// product. The physical dimensions are the reason it can't just be folded in: the compositor
// scales a photo by its real-world size, and a 6" Ashlyn trim plate has to render smaller
// than a 6.5" Woodhurst one against the same wall.
//
// NO ORDERING ROLE: nothing here is quoted or ordered. The shower head in particular is
// display-only — one universal 52668 stands in for every program, tagged to whichever trim
// kit the dealer actually bought.

import catalog from "./data/shower-components-catalog.json";

export type ComponentType = "valve_trim" | "tub_spout" | "shower_head";

/** Real-world size, for scaling a photo onto the scene. `reach_in` is spouts only. */
export type ComponentDimensions = { height_in: number; width_in: number; reach_in?: number; shape?: string };

type RawVariant = { finish: string; model: string; price_usd: number; image_slug: string; image_note?: string };
type RawComponent = {
  component_type: string;
  collection: string;
  program: string;
  base_model: string;
  title: string;
  physical_dimensions: ComponentDimensions;
  shape_note?: string;
  variants: RawVariant[];
};
type RawCatalog = { image_url_template: string; components: RawComponent[] };

const DATA = catalog as unknown as RawCatalog;

/**
 * Plumbing package id → the program name this catalogue files components under.
 *
 * The two vocabularies were built by different sources: the configurator's packages are the
 * portal's own brand names, while the component extract is filed by the marketing program.
 * Neither matches Delta's collection name (Lineax, Lahara, Trinsic), which is why this can't
 * be derived and has to be stated.
 */
const PROGRAM_BY_PACKAGE: Record<string, string> = {
  foundations: "Foundation",
  terra: "Woodhurst",
  boheme: "Boheme",
  eleva: "Ashlyn",
  lumen: "Lumen",
};

/**
 * Finish id → the finish name as this catalogue spells it, with fallbacks.
 *
 * Several ids have more than one plausible spelling across Delta's own data — "stainless" is
 * "Brilliance Stainless" on the trims but "SpotShield Stainless" on one Lahara spout, and the
 * universal head files polished nickel without the "Brilliance" prefix that the trims use.
 * Each id therefore carries an ordered list and the first one present on the component wins,
 * which beats guessing a single canonical name and silently missing a photo.
 */
const FINISH_NAMES: Record<string, string[]> = {
  "chrome": ["Chrome"],
  "stainless": ["Brilliance Stainless", "SpotShield Stainless", "Stainless"],
  "matte-black": ["Matte Black"],
  "champagne-bronze": ["Champagne Bronze"],
  "venetian-bronze": ["Venetian Bronze"],
  "polished-nickel": ["Brilliance Polished Nickel", "Polished Nickel"],
  "brushed-nickel": ["Brilliance Brushed Nickel", "Brushed Nickel"],
};

/** Program name for a plumbing package id, or null when the package isn't mapped. */
export function programForPackage(packageId: string | null | undefined): string | null {
  return packageId ? PROGRAM_BY_PACKAGE[packageId] ?? null : null;
}

// Built once at module load — 11 components, so eager indexing costs nothing.
const byKey = new Map<string, RawComponent>();
for (const c of DATA.components) {
  // The head is universal: filed under program "ALL" and looked up without one.
  byKey.set(`${c.component_type}|${c.component_type === "shower_head" ? "ALL" : c.program}`, c);
}

function find(componentType: ComponentType, program: string | null): RawComponent | null {
  const key = `${componentType}|${componentType === "shower_head" ? "ALL" : program ?? ""}`;
  return byKey.get(key) ?? null;
}

function variantFor(c: RawComponent, finish: string): RawVariant | null {
  // Accept either a finish id ("champagne-bronze") or an already-resolved name.
  const names = FINISH_NAMES[finish] ?? [finish];
  for (const n of names) {
    const v = c.variants.find((x) => x.finish === n);
    if (v) return v;
  }
  return null;
}

/**
 * Image URL for one component in one program and finish, or null.
 *
 * Null covers four distinct cases, all of which the caller handles identically by falling
 * back to the modelled fixture: an unmapped package, a program with no such component, a
 * finish that program doesn't sell, and — the one worth knowing about — a variant whose
 * image is recorded as unusable.
 *
 * That last case is not hypothetical. Three Foundation tub-spout slugs return HTTP 200 while
 * serving Build.com's "No Image Available" card, so neither a status check nor an <img>
 * onerror handler catches them; they are stored with an empty slug precisely so this returns
 * null instead of pinning a placeholder to a shower wall. See the JSON's verification note.
 */
export function getShowerComponentImage(
  componentType: ComponentType,
  program: string | null | undefined,
  finish: string | null | undefined,
  width = 400,
  height = 400,
): string | null {
  if (!finish) return null;
  const c = find(componentType, program ?? null);
  if (!c) return null;
  const v = variantFor(c, finish);
  if (!v || !v.image_slug) return null;
  return DATA.image_url_template
    .replace("{IMAGE_SLUG}", v.image_slug)
    .replace("{W}", String(Math.round(width)))
    .replace("{H}", String(Math.round(height)));
}

/** Physical size of a component, for scaling it onto the scene. Null when not catalogued. */
export function getComponentDimensions(
  componentType: ComponentType,
  program?: string | null,
): ComponentDimensions | null {
  return find(componentType, program ?? null)?.physical_dimensions ?? null;
}

/** The ordering model string for a component variant, for debugging and future BOM use. */
export function getShowerComponentModel(
  componentType: ComponentType,
  program: string | null | undefined,
  finish: string | null | undefined,
): string | null {
  if (!finish) return null;
  const c = find(componentType, program ?? null);
  return c ? variantFor(c, finish)?.model ?? null : null;
}
