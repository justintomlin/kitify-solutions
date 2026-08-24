/**
 * HPL (Nature Panel) shower takeoff — the bill of materials for a shower whose walls are
 * clad in Grant Westfield Nature Panel HPL.
 *
 * HPL ONLY. SPC (NuVo/ThermaGlass) is a different physical product with a different takeoff
 * spec that has not been defined yet. When SPC is specced it gets its own parallel module
 * (lib/spc-shower-takeoff.ts) — deliberately NOT stubbed here, and deliberately no shared
 * abstraction until a second implementation exists to abstract over. Nothing in this file is
 * named as though it covers wall panels in general.
 *
 * ZERO IMPORTS, on purpose. Every function here is pure, deterministic and serialisable, so
 * the reference matrix can be asserted by `node --test` with no React, no DOM, no Supabase and
 * no bundler. That is also why the panel geometry is declared here rather than read from
 * lib/naturepanel-catalog.ts — the test cross-checks these constants against the catalogue
 * JSON so the duplication cannot drift silently.
 *
 * WHY THE PANEL RULE IS PER-WALL. Room walls are taken off with first-fit-decreasing bin
 * packing and cross-wall offcut reuse (wallPanelTakeoff in lib/catalog.ts), which is right for
 * a room: an offcut from one wall genuinely gets used on the next. A shower is not a room.
 * Every wall of a shower terminates in a corner or an exposed edge, panels run full height,
 * and an installer does not carry a 9" strip from the back wall round to a side wall — the
 * joint would land in the wet zone. So the shower rule is: each wall is counted on its own,
 * rounded up, minimum one. No reuse. That is what makes the count agree with what the
 * supplier actually ships, and it is why this module exists instead of calling the room
 * takeoff with different numbers.
 */

// ---------------------------------------------------------------- geometry

/**
 * The one physical HPL panel size. All 21 Nature Panel decors share it — panel_specs sits at
 * the root of lib/data/naturepanel-catalog.json, not per decor, so pattern never affects the
 * count. A 22.75" wall needs one sheet regardless of what is printed on it.
 *
 * Mirrors panel_specs in that JSON; the test fixture asserts the two agree.
 */
export const HPL_PANEL_WIDTH_IN = 22.75;
export const HPL_PANEL_HEIGHT_IN = 94.5;

/** Every HPL trim profile ships in 94.5" lengths. */
export const HPL_TRIM_LENGTH_IN = 94.5;

// ------------------------------------------------------------------ types

/** How a shower is enclosed. Drives the end-cap lookup and nothing else. */
export type HplShowerType = "corner" | "alcove" | "tub-surround";

export type HplWallSpec = {
  /** Stable wall identity. The configurator uses "back" | "left" | "right". */
  id: string;
  widthIn: number;
  /** The decor chosen for this wall — an inventory SKU code, or null while unselected. */
  skuCode: string | null;
  skuLabel?: string;
};

export type HplShowerConfig = {
  type: HplShowerType;
  walls: HplWallSpec[];
};

export type HplWallPanelCount = {
  wallId: string;
  widthIn: number;
  skuCode: string | null;
  skuLabel?: string;
  panels: number;
};

export type HplPanelCountByWall = {
  perWall: HplWallPanelCount[];
  /** Rolled up per decor — this is what actually gets ordered, and what the upsell keys on. */
  bySku: { skuCode: string | null; skuLabel?: string; panels: number }[];
  total: number;
};

export type HplTrimCounts = {
  interiorCorner: number;
  baseProfile: number;
  endCap: number;
  /**
   * True when the end-cap count came from the fallback rather than the lookup — i.e. this is
   * a configuration the reference matrix does not cover. Warn-don't-block: the BOM is still
   * produced, the caller surfaces the caveat.
   */
  endCapEstimated: boolean;
};

export type HplShowerConsumables = { sealant: number; sprayCleaner: number; wipes: number };
export type HplOrderConsumables = { wax: number };

export type HplBomKind =
  | "panel" | "interior-corner" | "base-profile" | "end-cap"
  | "sealant" | "spray-cleaner" | "wipes" | "wax";

export type HplShowerBomLine = {
  kind: HplBomKind;
  /** Inventory SKU code. Null only when a wall has no decor chosen yet. */
  skuCode: string | null;
  /** i18n key + params — resolved at render so a saved quote reads in the viewer's language. */
  labelKey: string;
  labelParams?: Record<string, string>;
  qty: number;
  /** Present on accepted upsell lines so the UI and the ledger can tell them apart. */
  upsell?: true;
  discountPct?: number;
};

export type HplUpsellKind = "panel" | "sealant" | "trim";

export type HplUpsellOffer = {
  /** Stable identity so an accepted offer survives a re-render or a reopened quote. */
  id: string;
  kind: HplUpsellKind;
  bomKind: HplBomKind;
  skuCode: string | null;
  labelKey: string;
  labelParams?: Record<string, string>;
  qty: number;
  /** 25 on the odd-panel offer; the insurance offers are full price. */
  discountPct: number;
};

export type HplUpsellSet = { offers: HplUpsellOffer[] };

export type HplShowerBom = {
  substrate: "hpl";
  panels: HplPanelCountByWall;
  trim: HplTrimCounts;
  consumables: HplShowerConsumables;
  lines: HplShowerBomLine[];
  upsells: HplUpsellSet;
  /** Diagnostics for the UI. Never thrown — this module warns, it does not block. */
  notes: HplTakeoffNote[];
};

export type HplTakeoffNote =
  | { code: "end-cap-estimated"; signature: string }
  | { code: "wall-unselected"; wallId: string }
  | { code: "wall-zero-width"; wallId: string };

// -------------------------------------------------------------- SKU codes
//
// Trim and consumables have no supplier codes in the repo yet, so these are Kitify's own ops
// codes. They are shaped to be created verbatim in public.inventory_skus (by hand or via the
// Phase 3 CSV import); until they exist the BOM still computes and prices, and the inventory
// seam simply records them as unmatched. See the Phase B report.

export const HPL_TRIM_SKU_CODES = {
  interiorCorner: "HPL-TRIM-IC-945",
  baseProfile: "HPL-TRIM-BP-945",
  endCap: "HPL-TRIM-EC-945",
} as const;

export const HPL_CONSUMABLE_SKU_CODES = {
  sealant: "HPL-SEALANT-TUBE",
  sprayCleaner: "HPL-CLEANER-SPRAY",
  wipes: "HPL-CLEANER-WIPES",
  wax: "HPL-WAX-TUBE",
} as const;

/**
 * Installation tools. NOT part of any takeoff, and deliberately absent from every compute
 * function in this file — a tool is bought once per ten or twenty kits, not once per shower,
 * so anything that emitted them per shower would multiply them the way wax would if it were
 * not held at order level (see computeHplOrderConsumables).
 *
 * They live here because this is where an admin reads off the list of SKUs to create, and
 * because HPL_REQUIRED_SKU_CODES is what the inventory seam checks against. They reach a quote
 * only through the tools offer, and only when a dealer ticks one.
 *
 * No supplier pricing exists for either yet — both sit on the $1 sentinel.
 */
export const HPL_TOOL_SKU_CODES = {
  groutTool: "HPL-TOOL-GROUT",
  suctionCup: "HPL-TOOL-SUCTION",
} as const;

/** Every non-decor SKU this takeoff can emit — the list an admin needs to create. */
export const HPL_REQUIRED_SKU_CODES: string[] = [
  ...Object.values(HPL_TRIM_SKU_CODES),
  ...Object.values(HPL_CONSUMABLE_SKU_CODES),
  ...Object.values(HPL_TOOL_SKU_CODES),
];

// ----------------------------------------------------------------- panels

/**
 * Panels per wall: ceil(width / 22.75), minimum 1. No cross-wall offcut reuse (see header).
 *
 * Because there is no reuse, a mixed-decor shower costs exactly what a single-decor shower
 * costs — the per-wall counts are independent, so splitting them by SKU changes which SKUs
 * are ordered but never the total. That property is why mixed patterns needed no special case.
 */
export function computeHplPanelCount(walls: HplWallSpec[]): HplPanelCountByWall {
  const perWall: HplWallPanelCount[] = walls.map((w) => ({
    wallId: w.id,
    widthIn: w.widthIn,
    skuCode: w.skuCode,
    skuLabel: w.skuLabel,
    panels: w.widthIn > 0 ? Math.max(1, Math.ceil(w.widthIn / HPL_PANEL_WIDTH_IN)) : 0,
  }));

  // Roll up per decor, preserving first-seen order so the BOM reads back-wall-first.
  const bySku: { skuCode: string | null; skuLabel?: string; panels: number }[] = [];
  for (const w of perWall) {
    if (w.panels <= 0) continue;
    const hit = bySku.find((x) => x.skuCode === w.skuCode);
    if (hit) hit.panels += w.panels;
    else bySku.push({ skuCode: w.skuCode, skuLabel: w.skuLabel, panels: w.panels });
  }

  return { perWall, bySku, total: perWall.reduce((a, w) => a + w.panels, 0) };
}

// ------------------------------------------------------------------ trim

/**
 * End-cap counts, keyed by wall count and the sorted wall widths.
 *
 * THIS LOOKUP IS THE RULE. The reference numbers are not produced by any clean formula — a
 * 2-wall corner takes 2 while a 3-wall alcove of the same 32" walls takes 4, so end caps do
 * not track exposed vertical edges, panel count, or linear inches in any consistent way. They
 * come from what the supplier ships per configuration. Encoding the table verbatim is
 * therefore more honest than a formula that happens to fit five rows.
 *
 * A future refactor may derive this from wall geometry once more configurations are known;
 * until then, adding a configuration means adding a row here.
 */
const END_CAP_LOOKUP: Record<string, number> = {
  "2:32,32": 2,        // 32×32 corner shower
  "3:32,32,60": 4,     // 32×60 alcove — and the 60×32 tub surround, same wall set
  "3:36,36,60": 4,     // 36×60 alcove
  "3:48,48,60": 6,     // 48×60 alcove
  "3:60,60,60": 6,     // 60×60 alcove
};

/** Stable key: wall count, then widths ascending, so wall ORDER never changes the answer. */
export function hplEndCapSignature(walls: HplWallSpec[]): string {
  const widths = walls.map((w) => Math.round(w.widthIn)).sort((a, b) => a - b);
  return `${walls.length}:${widths.join(",")}`;
}

/**
 * Fallback for configurations the table does not cover. Fits every known 3-wall row
 * (2 × the panel count of a side wall) and the known corner row (one per wall), but it is a
 * pattern observed from six data points, not a supplier rule — which is why anything that
 * lands here is flagged `endCapEstimated` and surfaced to the dealer rather than shipped
 * silently.
 */
function estimateEndCaps(walls: HplWallSpec[]): number {
  if (walls.length <= 2) return walls.length;
  const widths = walls.map((w) => w.widthIn).filter((w) => w > 0);
  if (widths.length === 0) return 0;
  return 2 * Math.max(1, Math.ceil(Math.min(...widths) / HPL_PANEL_WIDTH_IN));
}

export function computeHplTrimCount(config: HplShowerConfig): HplTrimCounts {
  const walls = config.walls.filter((w) => w.widthIn > 0);
  const signature = hplEndCapSignature(walls);
  const known = END_CAP_LOOKUP[signature];

  return {
    // One hidden corner trim per internal junction: 2 walls meet once, 3 walls meet twice.
    interiorCorner: Math.max(0, walls.length - 1),
    // Horizontal track along the bottom of the whole field. Waste is reusable within a
    // shower, so this is a length takeoff — but NOT across showers, so it is computed here
    // per shower rather than rolled up at order level.
    baseProfile: walls.length === 0 ? 0 : Math.max(1, Math.ceil(walls.reduce((a, w) => a + w.widthIn, 0) / HPL_TRIM_LENGTH_IN)),
    endCap: known ?? estimateEndCaps(walls),
    endCapEstimated: known === undefined && walls.length > 0,
  };
}

// ----------------------------------------------------------- consumables

/**
 * Per-shower consumables. Sealant is ceil(panels / 2) ALWAYS — an 8-panel shower needs 4
 * tubes even if the shower next to it on the same order has a spare, because a part-used tube
 * does not travel between jobs. Deliberately no order-level reuse.
 */
export function computeHplConsumablesCount(panelCount: number): HplShowerConsumables {
  const panels = Math.max(0, Math.floor(panelCount));
  if (panels === 0) return { sealant: 0, sprayCleaner: 0, wipes: 0 };
  return { sealant: Math.ceil(panels / 2), sprayCleaner: 1, wipes: 1 };
}

/**
 * Order-level consumables. Wax is the one shared item in the BOM — a tube covers 8–10
 * showers, so it is counted once across the order, not once per shower. It is NOT part of
 * computeHplShowerBom for exactly that reason: emitting it per shower would multiply it.
 */
export function computeHplOrderConsumables(showerCount: number): HplOrderConsumables {
  const n = Math.max(0, Math.floor(showerCount));
  return { wax: n === 0 ? 0 : Math.ceil(n / 8) };
}

// --------------------------------------------------------------- upsells

/**
 * Which upsells to offer. All three are opt-in and never block the order.
 *
 * The panel offer fires PER DECOR whose own count is odd, because panels ship in 2-packs —
 * an order of 3 Marrakech and 4 Pure White breaks a pack on the Marrakech only. Rolling the
 * whole shower up first would hide that.
 */
export function fireHplUpsells(bom: Pick<HplShowerBom, "panels" | "trim" | "consumables">): HplUpsellSet {
  const offers: HplUpsellOffer[] = [];

  for (const s of bom.panels.bySku) {
    if (s.panels > 0 && s.panels % 2 === 1) {
      offers.push({
        id: `panel:${s.skuCode ?? "unselected"}`,
        kind: "panel",
        bomKind: "panel",
        skuCode: s.skuCode,
        labelKey: "configurator.shower.hplUpsell.panel",
        labelParams: { decor: s.skuLabel ?? "", n: String(s.panels) },
        qty: 1,
        discountPct: 25,
      });
    }
  }

  if (bom.consumables.sealant > 0) {
    offers.push({
      id: "sealant",
      kind: "sealant",
      bomKind: "sealant",
      skuCode: HPL_CONSUMABLE_SKU_CODES.sealant,
      labelKey: "configurator.shower.hplUpsell.sealant",
      qty: 1,
      discountPct: 0,
    });
  }

  const trimOffers: [keyof HplTrimCounts, HplBomKind, string, string][] = [
    ["interiorCorner", "interior-corner", HPL_TRIM_SKU_CODES.interiorCorner, "configurator.shower.hplUpsell.interiorCorner"],
    ["baseProfile", "base-profile", HPL_TRIM_SKU_CODES.baseProfile, "configurator.shower.hplUpsell.baseProfile"],
    ["endCap", "end-cap", HPL_TRIM_SKU_CODES.endCap, "configurator.shower.hplUpsell.endCap"],
  ];
  for (const [field, bomKind, skuCode, labelKey] of trimOffers) {
    if ((bom.trim[field] as number) > 0) {
      offers.push({ id: `trim:${bomKind}`, kind: "trim", bomKind, skuCode, labelKey, qty: 1, discountPct: 0 });
    }
  }

  return { offers };
}

// ------------------------------------------------------------ composition

export type HplTakeoffOptions = {
  /** Upsell offer ids the dealer has accepted; each adds a distinguishable BOM line. */
  acceptedUpsellIds?: string[];
};

/** Build the full per-shower BOM. Pure: same config in, same BOM out. */
export function computeHplShowerBom(config: HplShowerConfig, options: HplTakeoffOptions = {}): HplShowerBom {
  const notes: HplTakeoffNote[] = [];
  for (const w of config.walls) {
    if (w.widthIn <= 0) notes.push({ code: "wall-zero-width", wallId: w.id });
    else if (!w.skuCode) notes.push({ code: "wall-unselected", wallId: w.id });
  }

  const panels = computeHplPanelCount(config.walls);
  const trim = computeHplTrimCount(config);
  const consumables = computeHplConsumablesCount(panels.total);
  if (trim.endCapEstimated) {
    notes.push({ code: "end-cap-estimated", signature: hplEndCapSignature(config.walls.filter((w) => w.widthIn > 0)) });
  }

  const lines: HplShowerBomLine[] = [];
  for (const s of panels.bySku) {
    lines.push({
      kind: "panel",
      skuCode: s.skuCode,
      labelKey: "configurator.shower.hplBom.panel",
      labelParams: { decor: s.skuLabel ?? "" },
      qty: s.panels,
    });
  }
  const push = (kind: HplBomKind, skuCode: string, labelKey: string, qty: number) => {
    if (qty > 0) lines.push({ kind, skuCode, labelKey, qty });
  };
  push("interior-corner", HPL_TRIM_SKU_CODES.interiorCorner, "configurator.shower.hplBom.interiorCorner", trim.interiorCorner);
  push("base-profile", HPL_TRIM_SKU_CODES.baseProfile, "configurator.shower.hplBom.baseProfile", trim.baseProfile);
  push("end-cap", HPL_TRIM_SKU_CODES.endCap, "configurator.shower.hplBom.endCap", trim.endCap);
  push("sealant", HPL_CONSUMABLE_SKU_CODES.sealant, "configurator.shower.hplBom.sealant", consumables.sealant);
  push("spray-cleaner", HPL_CONSUMABLE_SKU_CODES.sprayCleaner, "configurator.shower.hplBom.sprayCleaner", consumables.sprayCleaner);
  push("wipes", HPL_CONSUMABLE_SKU_CODES.wipes, "configurator.shower.hplBom.wipes", consumables.wipes);

  const upsells = fireHplUpsells({ panels, trim, consumables });

  // Accepted upsells become their own lines rather than incrementing the base quantity, so a
  // dealer reading the BOM can always see what was ordered as cover and what the job needs.
  const accepted = new Set(options.acceptedUpsellIds ?? []);
  for (const offer of upsells.offers) {
    if (!accepted.has(offer.id)) continue;
    lines.push({
      kind: offer.bomKind,
      skuCode: offer.skuCode,
      labelKey: offer.labelKey,
      labelParams: offer.labelParams,
      qty: offer.qty,
      upsell: true,
      discountPct: offer.discountPct,
    });
  }

  return { substrate: "hpl", panels, trim, consumables, lines, upsells, notes };
}
