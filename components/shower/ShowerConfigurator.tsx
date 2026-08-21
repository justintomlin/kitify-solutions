"use client";

/**
 * Kitify — Shower Configurator (reusable module).
 *
 * Flow: base type (shower base | skirted tub) → drain → size → wall material
 * (one per shower) → per-wall color → optional door → optional accessories.
 *
 * Contract mirrors the vanity module: catalog in, ShowerConfig out via onComplete.
 *
 * Real data (ThermaGlass/NuVo): bases, tubs, doors, accessories + dealer (KD) prices.
 * Real data (Nature Panel): the HPL wall palette — 21 catalogued decors with swatch
 * photography, via lib/naturepanel-catalog.ts. Carries no pricing.
 * PLACEHOLDER (flagged): the SPC wall palette (seeded with the 6 real NuVo composite
 * colors as a stand-in) and wall-kit pricing for every tier.
 *
 * Wall panels are SPC and HPL only. Solid surface (Durasein) was offered as a third wall
 * tier and was retired in Aug 2026 — Kitify is not selling solid-surface shower wall
 * systems. It survives here ONLY as LEGACY_WALL_MATERIALS, which no picker renders and
 * only findWallMaterial() resolves, so a quote saved while it was selectable still shows
 * and prices what it saved. Durasein COUNTERTOPS are a separate, live program (see
 * components/vanity/VanityConfigurator.tsx) and are unaffected.
 * Drain options are data-driven per size (L/R/Center aren't offered on every size).
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, RotateCcw, Plus, Minus, DoorOpen, Square } from "lucide-react";
import {
  SHOWER_BASE_SKUS, ALCOVE_TUB_SKUS, SHOWER_BASE_COLORS, COMPOSITE_BASE_COLORS,
  SHOWER_DOORS, DOOR_FAMILIES, DEFAULT_DOOR_FAMILY,
  matchSpcWallKit, spcKitCode, SPC_CEILING_HEIGHTS, DEFAULT_SPC_CEILING,
  NUVO_WALL_COLORS, CORNER_SHELF, SHOWER_NICHE, GRAB_BARS,
  type BaseFamily, type BaseFamilySku, type BaseVariant, type BaseDrain,
  type DoorFamily, type DoorFinish, type DoorGlass, type DoorModel, type SpcCeilingHeight,
} from "@/lib/catalog";
import { getPanelCollections, getPanelImage, getPanelSpecs, getPanel } from "@/lib/naturepanel-catalog";
import {
  computeHplShowerBom,
  type HplShowerBom,
  type HplShowerConfig,
  type HplShowerType,
  type HplWallSpec,
} from "@/lib/hpl-shower-takeoff";
import { getAllDuraseinColors, duraseinSheetTexture } from "@/lib/durasein-catalog";
import { resolveDefault, DEFAULT_FINISH_ID, INCLUDED_QTY, OPT_IN_QTY } from "@/lib/defaults";
import { useLanguage } from "@/components/LanguageContext";
import { HplUpsellPopup } from "@/components/shower/HplUpsellPopup";

// Price-line display text is resolved at render (never stored) so a quote saved in
// one language reads correctly when reopened in another. See lib/i18n.ts.
type Tr = (key: string, vars?: Record<string, string>) => string;
function priceLineText(t: Tr, l: PriceLine): string {
  const params = l.params ? { ...l.params } : undefined;
  if (params && typeof params.finish === "string") params.finish = t("configurator.doorFinish." + params.finish);
  return t(l.key, params);
}

// ------------------------------ Types -------------------------------------
export type Path = "shower" | "tub";
/** Re-exported from the catalog so this module and the SKU data can never drift apart. */
export type Drain = BaseDrain;
// `hex` is the flat colour every palette has had. A catalogued wall panel adds the real
// swatch photo plus its decor metadata; the hex stays as the fallback tint for when the
// CDN image can't load, so nothing downstream has to branch on which kind of swatch it holds.
export type Swatch = {
  id: string; name: string; hex: string;
  imageUrl?: string;      // real product image, for thumbnails (Nature Panel + Durasein)
  style?: string;         // decor style — "Wood Slat", "Shiplap", "Subway", "Large Tile", "Pure"
  collection?: string;    // collection id — "wood" | "tile" | "pure" | "timeless" | …
  /**
   * A flat, edge-to-edge image of the material itself — the only kind that may be tiled
   * across the preview walls. Set only where such an asset genuinely exists, because the
   * two catalogues fail this test in different ways: Nature Panel's Tile and Pure decors
   * publish room photography, and Durasein's swatch masters are angled slab renders complete
   * with shadows. Repeating either across a shower reads as a rendering bug, so they stay
   * thumbnails and the wall falls back to the flat tint.
   */
  textureUrl?: string;
};

/**
 * One selectable base size WITHIN a family.
 *
 * `id` is the dimension key and is NOT unique across the catalog — a 60×36 exists as both a
 * NuVo composite and a K-Series acrylic at different prices — so every lookup here goes
 * through findBaseItem(), which takes the family too. See lib/catalog.ts's BaseFamily note.
 */
export type BaseItem = {
  id: string; family: BaseFamily; label: string; w: number; d: number;
  h?: number;   // finished floor-to-rim height in inches — carried by the tubs (skirt/apron)
  drains: Drain[];
  variants: BaseVariant[];
  colors: Swatch[]; doorWidth: 48 | 60 | 0; price: number; noteKey?: string; placeholder?: boolean;
};
export type Material = { id: string; name: string; tier: "Good" | "Better" | "Best"; colors: Swatch[] };
export type ShowerCatalog = {
  bases: BaseItem[];
  tubs: BaseItem[];
  materials: Material[];
  /** Every door model, both paths. Filtered by opening and path in doorsForItem(). */
  doors: DoorModel[];
  accessories: {
    cornerShelf: { finishes: Swatch[]; price: number };
    niche: { finishes: Swatch[]; price: number };
    grabBar: { finishes: Swatch[]; sizes: { id: string; label: string; price: number }[] };
  };
};

export type WallMode = "all" | "perWall";
export const WALL_INDEX = [0, 1, 2] as const;   // back, left, right
const WALL_KEYS = ["configurator.shower.wallBack", "configurator.shower.wallLeft", "configurator.shower.wallRight"];

export type AccessoryState = {
  cornerShelf: { finish: string; qty: number };
  niche: { finish: string; qty: number };
  grabBar: { finish: string; size: string; qty: number };
};
export type ShowerSelections = {
  path?: Path;
  baseId?: string;
  /**
   * Which product line the base comes from. Optional so a quote saved before families
   * existed still loads — resolveBaseFamily() infers it from the id in that case, which is
   * unambiguous for every size except those sold in more than one family.
   */
  baseFamily?: BaseFamily;
  drain?: Drain;
  baseColorId?: string;
  baseColor?: string; // pan/base color id — see SHOWER_BASE_COLORS; defaults to "white"
  materialId?: string;
  /**
   * Finished ceiling height, which is what picks between the NuVo SPC wall kits (66 / 80 /
   * 96"). Optional — an older quote, or an HPL shower, defaults to 96". HPL ignores it
   * entirely: its takeoff is per-wall against a full-height panel.
   */
  ceilingIn?: SpcCeilingHeight;
  wallColors: (string | undefined)[]; // [back, left, right]
  // How the wall picker behaves. Optional so quotes saved before it existed still load:
  // wallMode() infers it from whether the three wallColors agree, which is exactly what an
  // older quote's array already encodes.
  wallMode?: WallMode;
  /**
   * `glass` is optional because only Rainier offers a choice — the frameless ranges are clear
   * only — and because a quote saved before the axis existed must reopen as clear, which is
   * what it was sold as.
   */
  door: { seriesId: string; finish: string; glass?: DoorGlass } | null;
  accessories: AccessoryState;
  /**
   * HPL upsell offer ids the dealer accepted. Stored in the selections (not derived) because
   * an accepted upsell is a decision that has to survive save-and-reopen. HPL only — an SPC
   * shower never populates this.
   */
  hplUpsells?: string[];
};

// A price line carries a dictionary key + interpolation params rather than a finished
// string, so it renders in the viewer's current language, not the language it was built in.
//
// `sku` is the ordered product code where the line resolves to one. It rides the existing
// quote → proposal → order-snapshot path, so the snapshot now records what to actually buy
// rather than only what it cost. Absent on lines that are not a single SKU (a warned SPC
// fallback, an HPL BOM roll-up that already carries its own codes).
// `estimated` marks a line whose MONEY is still a placeholder, as distinct from one whose fit
// is uncertain (that is SpcKitLine.exact). Only the HPL lines set it today — the Therma-Glass
// sheet prices the NuVo and Kohler ranges but carries no Nature Panel rows at all.
//
// `retailPrice` is the MAP reference for the whole line — what the manufacturer suggests the
// partner's customer pays, against `amount`, which is what the partner pays Kitify. Optional
// because most SKUs have no MAP on file; only the HPL panels carry one today. It rides the
// existing snapshot path, so a saved proposal records both the price sold at and the
// recommendation on the day it was written. It is a GUIDELINE — nothing enforces it.
export type PriceLine = {
  key: string; params?: Record<string, string>; amount: number;
  sku?: string; estimated?: boolean; retailPrice?: number;
};
export type ShowerMedia = { wallImage?: string; baseImage?: string; doorImage?: string; swatchHex?: string };
export type ShowerConfig = {
  selections: ShowerSelections;
  // Self-reported imagery so consumers never need to know where image files live.
  // (Kept for the future AI render pipeline; the hub now draws the live SVG preview.)
  media?: ShowerMedia;
  price: { total: number; lines: PriceLine[] };
  /**
   * The real HPL bill of materials — SKU codes and counts — when the walls are HPL, null
   * otherwise. This is what the proposal, the order snapshot and the Phase 3 inventory
   * shipment extractor read instead of the old label-only wall-panel line.
   *
   * SPC showers keep `hplBom: null` and the legacy flat kit line until an SPC takeoff exists.
   */
  hplBom?: HplShowerBom | null;
  isComplete: boolean;
  label: string;
};

/**
 * Which wall materials a dealer may actually pick.
 *
 * The picker offers two tiers and SPC is the unfinished one — it still shows the NuVo
 * stand-in palette rather than its own, and has no wall-kit pricing — so on a deployed build
 * it is visible but not selectable, and HPL is the only live tier. Set
 * NEXT_PUBLIC_SHOW_ALL_MATERIALS=true in .env.local to unlock SPC and work on it locally;
 * that is the flag's only remaining purpose, and it retires with SPC's own palette.
 *
 * Read from the env rather than sniffing window.location.hostname: the value is inlined at
 * build time, so it is identical on the server and the first client render and cannot cause a
 * hydration mismatch, and a preview deployment behaves like production without anyone having
 * to remember that its hostname is not "localhost".
 */
const SHOW_ALL_MATERIALS = process.env.NEXT_PUBLIC_SHOW_ALL_MATERIALS === "true";

/** The one tier that is finished. Everything else is gated unless the flag is set. */
const LIVE_MATERIAL_ID = "hpl";

export function materialAvailable(materialId: string): boolean {
  return SHOW_ALL_MATERIALS || materialId === LIVE_MATERIAL_ID;
}

// --------------------------- Sample catalog -------------------------------
// Chrome leads the row because it's the portal-wide default finish (see DEFAULT_FINISH_ID)
// — the same one the plumbing trim and the shower door hardware land on, so an untouched
// build reads as one coordinated set rather than three different metals.
/**
 * Accessory finishes — three, matching the three SKUs each accessory actually has.
 *
 * The old four-finish list carried both "chrome" and "polished", which are the same product:
 * the corner shelf ships as COR-SHELF-POLISHED and the niche as NUV-6703P, and Chrome is the
 * portal-wide default name for it. A saved quote holding "polished" simply stops matching a
 * chip — the price is finish-independent, so no money moves.
 */
const SHELF_FINISHES: Swatch[] = [
  { id: "chrome", name: "Chrome", hex: "#c9ccd1" },
  { id: "brushed-nickel", name: "Brushed Nickel", hex: "#b8b6b0" },
  { id: "matte-black", name: "Matte Black", hex: "#2a2c2f" },
];

// The SPC wall palette — the six real NuVo decors, read from the catalog rather than
// restated, so the swatch a dealer taps and the kit SKU that gets ordered cannot disagree.
const SPC_COLORS: Swatch[] = NUVO_WALL_COLORS.map((c) => ({ id: c.id, name: c.name, hex: c.hex }));

// HPL is the one tier with a real catalogue behind it: the 21-panel Nature Panel lineup with
// swatch photography from Grant Westfield's CDNs (lib/naturepanel-catalog.ts). SPC stays on
// the NuVo stand-in above until its palette arrives.
//
// `hex` is a single neutral per catalogue rather than a guessed per-decor colour — the real
// appearance comes from the swatch image, and inventing hex values for products whose colours
// aren't published would put made-up data in front of dealers. It shows only as the wall tint
// if the CDN image fails.
const HPL_PANEL_FALLBACK_HEX = "#dad6cd";
const HPL_PANELS: Swatch[] = getPanelCollections().flatMap((c) =>
  c.panels.map((p) => ({
    id: p.id, name: p.name, hex: HPL_PANEL_FALLBACK_HEX,
    imageUrl: p.imageUrl, style: p.style, collection: p.collection,
    // Only the Wood Decors point at flat swatch crops; the rest are room photography.
    textureUrl: p.isSwatch ? p.imageUrl : undefined,
  })),
);

// LEGACY ONLY — the 64-color Durasein US range as it was wired for WALLS before solid
// surface was retired as a wall tier (Aug 2026). Nothing selects from this palette any more;
// it exists so LEGACY_WALL_MATERIALS can resolve a Durasein SKU saved on an old quote back to
// its real name and texture instead of rendering a blank wall. Durasein COUNTERTOPS do not
// come through here — they resolve by colour-name slug in HeroPreview (getDuraseinColorByNameSlug).
//
// Durasein publishes two different images per color and they are NOT interchangeable: the
// swatch master is an angled render of a slab corner (great thumbnail, unusable as a
// repeating texture) while the full-sheet scan is a flat edge-to-edge capture of the
// material. So the thumbnail comes from one and the wall texture from the other.
//
// 13 of the 64 — the solid Brilliant colors plus the plain whites — have no sheet scan at
// all, so they preview as the flat tint. That tint is one neutral for the whole range
// rather than a guessed per-color hex: Durasein publishes no color values, and inventing
// them would put made-up data in front of dealers. Same rule the HPL palette follows.
const SS_COLOR_FALLBACK_HEX = "#e3ded5";
const SS_COLORS: Swatch[] = getAllDuraseinColors().map((c) => ({
  id: c.id, name: c.name, hex: SS_COLOR_FALLBACK_HEX,
  imageUrl: c.swatchUrl, collection: c.collection,
  textureUrl: c.sheetUrl ? duraseinSheetTexture(c.sheetUrl, 640) : undefined,
}));

// Style label → dictionary key. Keyed off the catalogue's own style strings so a new decor
// style surfaces as a missing key rather than silently rendering English.
const STYLE_KEY: Record<string, string> = {
  "Wood Slat": "configurator.shower.panel.style.woodSlat",
  "Shiplap": "configurator.shower.panel.style.shiplap",
  "Subway": "configurator.shower.panel.style.subway",
  "Large Tile": "configurator.shower.panel.style.largeTile",
  "Pure": "configurator.shower.panel.style.pure",
};
const styleLabel = (t: Tr, style?: string) => (style && STYLE_KEY[style] ? t(STYLE_KEY[style]) : style ?? "");

// Decor collection id → dictionary key. Explicit rather than interpolated because the
// catalogue's family ids are hyphenated ("large-tile") and the dictionary is camelCase, and
// because a new family should surface as a missing key rather than silently render English.
const COLLECTION_KEY: Record<string, string> = {
  "wood": "configurator.shower.panel.collection.wood",
  "pure": "configurator.shower.panel.collection.pure",
  "large-tile": "configurator.shower.panel.collection.largeTile",
  "metro-tile": "configurator.shower.panel.collection.metroTile",
};
const COLLECTION_DESC_KEY: Record<string, string> = {
  "wood": "configurator.shower.panel.collectionDesc.wood",
  "pure": "configurator.shower.panel.collectionDesc.pure",
  "large-tile": "configurator.shower.panel.collectionDesc.largeTile",
  "metro-tile": "configurator.shower.panel.collectionDesc.metroTile",
};

// Base family → dictionary key. Same reasoning as above ("alcove-tub" is hyphenated).
const BASE_FAMILY_KEY: Record<BaseFamily, string> = {
  "composite": "configurator.shower.baseFamily.composite",
  "acrylic": "configurator.shower.baseFamily.acrylic",
  "alcove-tub": "configurator.shower.baseFamily.alcoveTub",
};
const BASE_FAMILY_DESC_KEY: Record<BaseFamily, string> = {
  "composite": "configurator.shower.baseFamilyDesc.composite",
  "acrylic": "configurator.shower.baseFamilyDesc.acrylic",
  "alcove-tub": "configurator.shower.baseFamilyDesc.alcoveTub",
};

// ---------------------- Shower box geometry (preview) ----------------------
// One-point perspective inside a 320×240 viewBox. The front opening is the back wall
// scaled about the view centre (160,120); every wall, the floor and the door derive from
// these two rectangles, so nothing can drift out of alignment.
//
// Width and height use the SAME scale factor. The previous geometry splayed the width by
// 1.78× while the height only grew 1.34×, which is what produced the fisheye look — the
// side walls raced out to the viewBox edges while the opening barely got taller.
const BACK = { x0: 70, x1: 250, y0: 44, y1: 196 };
const FRONT = { x0: 38, x1: 282, y0: 17, y1: 223 };   // 1.356× on both axes

const LEFT_WALL = `${FRONT.x0},${FRONT.y0} ${BACK.x0},${BACK.y0} ${BACK.x0},${BACK.y1} ${FRONT.x0},${FRONT.y1}`;
const RIGHT_WALL = `${BACK.x1},${BACK.y0} ${FRONT.x1},${FRONT.y0} ${FRONT.x1},${FRONT.y1} ${BACK.x1},${BACK.y1}`;
// The floor quad the three walls enclose — shared by the pan and the tub so the panels
// always land flush on whatever is underneath them.
const FLOOR_PLANE = `${BACK.x0},${BACK.y1} ${BACK.x1},${BACK.y1} ${FRONT.x1},${FRONT.y1} ${FRONT.x0},${FRONT.y1}`;
const TUB_SKIRT = `${FRONT.x0},${FRONT.y1} ${FRONT.x1},${FRONT.y1} ${FRONT.x1},${FRONT.y1 + 13} ${FRONT.x0},${FRONT.y1 + 13}`;

/**
 * How the preview draws a door: hardware-heavy slider, minimal frameless, or fixed-panel.
 *
 * Keyed off the FAMILY rather than parsed out of a series name, which is what the old
 * catalog did ("Pacific Frameless Slider" → /slider/). The three real ranges are two
 * frameless and one sliding; nothing maps to "panel" today — the Slider + Panel series it
 * described was invented placeholder data with no row on the price sheet — but the drawing
 * case is kept for the next range that needs it.
 */
export type DoorKind = "slider" | "frameless" | "panel";
const DOOR_KIND: Record<DoorFamily, DoorKind> = {
  pacific: "frameless",
  rainier: "slider",
  tetherow: "frameless",
};
function doorKind(family?: DoorFamily): DoorKind {
  return family ? DOOR_KIND[family] : "frameless";
}
// Door hardware finishes are their own set (chrome / brushed-nickel / matte-black) and
// don't overlap the wall or accessory palettes.
const DOOR_FINISH_HEX: Record<string, string> = {
  "chrome": "#bfc5cc",
  "brushed-nickel": "#a49e93",
  "matte-black": "#2a2c2f",
};

// The white every non-composite base ships in. K-Series acrylic and Cascade tubs have no
// colour axis on the price sheet, so this is the whole palette for those families.
const WHITE_ONLY: Swatch[] = [{ id: "white", name: "White", hex: "#eeeeea" }];

/**
 * A catalog SKU → the shape the picker renders.
 *
 * Two fields are DERIVED rather than looked up in a side table, which is what retired the old
 * BASE_META / TUB_META maps:
 *   • `drains` is the set of drain positions the size's own variants offer, so it can never
 *     claim a position that has no SKU behind it.
 *   • `doorWidth` is the stock opening, which is simply the base width where a stock door
 *     exists. The old table said exactly this for all ten sizes, spelled out by hand.
 * `price` is the cheapest variant — the "from" figure the size button shows before a colour
 * and drain are picked. The quoted line uses the resolved variant, not this.
 */
function toBaseItem(sku: BaseFamilySku, colors: Swatch[]): BaseItem {
  const drains = [...new Set(sku.variants.map((v) => v.drain))];
  const doorWidth: 48 | 60 | 0 = sku.w === 48 ? 48 : sku.w === 60 ? 60 : 0;
  return {
    id: sku.id, family: sku.family, label: sku.label, w: sku.w, d: sku.d, h: sku.h,
    drains: drains.length ? drains : ["center"],
    variants: sku.variants,
    colors,
    doorWidth,
    price: sku.variants.length ? Math.min(...sku.variants.map((v) => v.dealerPrice)) : 0,
    placeholder: sku.variants.length === 0,
    noteKey: sku.noteKey,
  };
}

/**
 * The colours a family actually sells. Composite pans come in four; the K-Series acrylics and
 * the Cascade tubs are white only, and offering them a palette would invite a dealer to pick
 * a colour that has no SKU.
 */
const familyColors = (family: BaseFamily): Swatch[] =>
  family === "composite" ? COMPOSITE_BASE_COLORS : WHITE_ONLY;

export const SAMPLE_SHOWER_CATALOG: ShowerCatalog = {
  bases: SHOWER_BASE_SKUS.map((s) => toBaseItem(s, familyColors(s.family))),
  tubs: ALCOVE_TUB_SKUS.map((s) => toBaseItem(s, familyColors(s.family))),
  // Wall panels are SPC and HPL. Anything a dealer may pick lives here and nowhere else —
  // the picker renders this array, so adding a tier to it is what makes a tier selectable.
  // Neither carries a kitPrice any more: SPC prices from a real NuVo kit SKU and HPL from
  // its own per-SKU takeoff, so a single flat number would only be a third, wrong answer.
  materials: [
    { id: "spc", name: "SPC", tier: "Good", colors: SPC_COLORS },
    { id: "hpl", name: "HPL", tier: "Better", colors: HPL_PANELS },
  ],
  doors: SHOWER_DOORS,
  accessories: {
    cornerShelf: { finishes: SHELF_FINISHES, price: CORNER_SHELF.variants[0].dealerPrice },
    niche: { finishes: SHELF_FINISHES, price: SHOWER_NICHE.variants[0].dealerPrice },
    grabBar: {
      finishes: [{ id: "brushed", name: "Brushed", hex: "#b8b6b0" }, { id: "polished", name: "Polished", hex: "#d9dade" }],
      sizes: GRAB_BARS.map((g) => ({ id: g.id, label: g.label, price: g.variants[0].dealerPrice })),
    },
  },
};

/**
 * Wall materials that are no longer offered but may still appear on a saved quote.
 *
 * READ ONLY. Nothing renders this list — the picker maps SAMPLE_SHOWER_CATALOG.materials, so a
 * tier here is unreachable by selection. It exists so a quote saved while solid surface was a
 * wall tier (retired Aug 2026) still resolves to the Durasein colour it stored: the hero paints
 * the wall the dealer saw, the preview keeps its tint, and the wall-panel price line survives a
 * recompute instead of silently dropping off the total. Deleting this would not throw, it would
 * quietly re-price and re-render old quotes as something the dealer never picked.
 */
const LEGACY_WALL_MATERIALS: Material[] = [
  { id: "ss", name: "Solid Surface", tier: "Best", colors: SS_COLORS },
];

/**
 * A wall material by id — the pickable tiers first, then the retired ones.
 *
 * Every wall resolution in this module goes through here rather than reaching into
 * `catalog.materials` directly, which is what keeps "can be chosen" and "can be read back"
 * two different questions. The picker is the one place that still reads `catalog.materials`
 * straight, because offering a tier is exactly what it must not do for a retired one.
 */
function findWallMaterial(catalog: ShowerCatalog, id?: string): Material | undefined {
  return catalog.materials.find((m) => m.id === id) ?? LEGACY_WALL_MATERIALS.find((m) => m.id === id);
}

// ------------------------------ Engine ------------------------------------
/**
 * Cents, not whole dollars — this module is the one that quotes real per-SKU money, and a
 * panel at $161.89 rendered as "$162" is a quote a dealer cannot reconcile against the price
 * sheet. The rest of the portal keeps whole dollars for roll-ups and dashboards.
 */
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function itemsForPath(catalog: ShowerCatalog, path?: Path): BaseItem[] {
  return path === "tub" ? catalog.tubs : path === "shower" ? catalog.bases : [];
}

/** The families that actually have SKUs for this path, in catalog order. */
export function familiesForPath(catalog: ShowerCatalog, path?: Path): BaseFamily[] {
  return [...new Set(itemsForPath(catalog, path).map((b) => b.family))];
}

/**
 * The family a selection belongs to.
 *
 * A quote saved before families existed carries only a dimension id, and most dimensions are
 * unambiguous — only 48×36, 60×32 and 60×36 exist in more than one family. For those the
 * fallback order below decides, and it prefers ACRYLIC because that is both the cheaper and
 * the broader line (10 of the 14 sizes), so an un-migrated quote lands on the reading a
 * dealer is most likely to have meant. Preserved when explicit, always.
 */
const FAMILY_FALLBACK: BaseFamily[] = ["acrylic", "composite", "alcove-tub"];
export function resolveBaseFamily(catalog: ShowerCatalog, path: Path | undefined, baseId?: string, saved?: BaseFamily): BaseFamily | undefined {
  if (!baseId) return saved;
  const withId = itemsForPath(catalog, path).filter((b) => b.id === baseId);
  if (!withId.length) return saved;
  if (saved && withId.some((b) => b.family === saved)) return saved;
  for (const f of FAMILY_FALLBACK) if (withId.some((b) => b.family === f)) return f;
  return withId[0].family;
}

/**
 * The selected base — the ONE lookup that knows id alone is not an identity.
 *
 * Every `items.find(b => b.id === baseId)` in this module used to be correct because ids were
 * unique. They are not any more: reaching for the first id match would silently price a
 * $558 composite pan as a $403.20 acrylic one.
 */
export function findBaseItem(catalog: ShowerCatalog, s: ShowerSelections): BaseItem | undefined {
  if (!s.baseId) return undefined;
  const family = resolveBaseFamily(catalog, s.path, s.baseId, s.baseFamily);
  const items = itemsForPath(catalog, s.path);
  return items.find((b) => b.id === s.baseId && b.family === family) ?? items.find((b) => b.id === s.baseId);
}

/**
 * The exact SKU a selection resolves to: size + family + colour + drain.
 *
 * Returns null while the dealer is mid-flow (no drain picked yet), which is what keeps an
 * incomplete configuration off the price panel instead of quoting an arbitrary variant.
 */
export function resolveBaseVariant(item: BaseItem | undefined, s: ShowerSelections): BaseVariant | null {
  if (!item?.variants.length) return null;
  const hasColorAxis = item.variants.some((v) => v.colorId);
  const colorId = s.baseColor ?? "white";
  const byDrain = s.drain ? item.variants.filter((v) => v.drain === s.drain) : item.variants;
  const pool = byDrain.length ? byDrain : item.variants;
  if (!hasColorAxis) return pool[0];
  return pool.find((v) => v.colorId === colorId) ?? pool[0];
}
/**
 * The door models that fit this base's stock opening, in the catalog's family order.
 *
 * `forPath` is what separates a 70" shower screen from a 57" tub screen — the old catalog
 * kept two parallel arrays for this, which meant a series had to be listed (and priced) twice.
 */
export function doorsForItem(catalog: ShowerCatalog, path: Path | undefined, item?: BaseItem): DoorModel[] {
  if (!item || item.doorWidth === 0) return [];
  const forPath = path === "tub" ? "tub" : "shower";
  return catalog.doors.filter((d) => d.forPath === forPath && d.fits === item.doorWidth);
}

/** Only the families with a model that fits — Tetherow has no 48", so a 48" opening drops it. */
export function doorFamiliesForItem(catalog: ShowerCatalog, path: Path | undefined, item?: BaseItem): DoorFamily[] {
  const avail = doorsForItem(catalog, path, item);
  return DOOR_FAMILIES.filter((f) => avail.some((d) => d.family === f));
}

/**
 * The door to select when the dealer ticks "add a matching door": Rainier — the value line —
 * in the portal-default chrome with clear glass, at whatever size fits the opening.
 *
 * This used to be `avail[0]` sorted by a hand-assigned `rank`, which existed only because
 * every door cost $1 and "cheapest" was therefore unreadable. With real pricing the default
 * is a product decision rather than a sorting artefact, so it is named outright: see
 * DEFAULT_DOOR_FAMILY in lib/catalog.ts. Returns null when nothing fits, which reads as
 * "no door" — the same state as unticked.
 */
export function defaultDoor(avail: DoorModel[]): { seriesId: string; finish: string; glass: DoorGlass } | null {
  const model = avail.find((d) => d.family === DEFAULT_DOOR_FAMILY) ?? avail[0];
  if (!model) return null;
  const finishes = [...new Set(model.variants.map((v) => v.finish))];
  const finish = resolveDefault(undefined, finishes, (f) => f, (f) => f === DEFAULT_FINISH_ID);
  return finish ? { seriesId: model.id, finish, glass: "clear" } : null;
}

/** The exact door SKU a selection resolves to, or null when the combination isn't offered. */
export function resolveDoorVariant(catalog: ShowerCatalog, s: ShowerSelections) {
  if (!s.door) return null;
  const model = catalog.doors.find((d) => d.id === s.door!.seriesId);
  if (!model) return null;
  const glass: DoorGlass = s.door.glass ?? "clear";
  const variant =
    model.variants.find((v) => v.finish === s.door!.finish && v.glass === glass) ??
    model.variants.find((v) => v.finish === s.door!.finish) ??
    null;
  return variant ? { model, variant } : null;
}

/** The HPL wall material id. Anything else falls through to the legacy flat kit pricing. */
const HPL_MATERIAL_ID = "hpl";
export const isHplShower = (s: ShowerSelections) => s.materialId === HPL_MATERIAL_ID;

/**
 * PLACEHOLDER PRICING — a nominal $1 per unit, for HPL TRIM AND CONSUMABLES ONLY.
 *
 * The panels themselves are now real: Nature Panel's Dealer Pricing Structure prices them at
 * the Dealer 3 tier, which the catalogue carries per decor. What it does not price is the
 * interior corner, base profile and end cap, or the sealant, cleaner, wipes and wax — so
 * those keep the sentinel and keep the banner honest about what is still outstanding.
 */
const HPL_PLACEHOLDER_UNIT_PRICE = 1;

/** Money is cents-accurate now; float noise on a 7 × $161.89 line is not acceptable. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The inventory SKU code for an HPL decor.
 *
 * Nature Panel's own code (`sku_ref`, e.g. MP638) is used where the catalogue has one — 14 of
 * the 21 decors. The seven Wood decors carry no supplier code, so they fall back to their
 * catalogue id. Either way the code is stable and namespaced, which is what the inventory
 * seam matches on.
 *
 * KNOWN COLLISION: sku_ref identifies the DECOR, not the panel. MP638 is "Sage Green", which
 * Nature Panel sells both as a Pure panel and as a Metro one, so all seven Pure decors share
 * a code with a Tile decor and 21 decors mint only 14 codes. That was harmless while every
 * panel cost $1 and is not now — Pure is $138.00 against Tile's $152.79 — which is why
 * hplPanelPricing() below resolves through the shower's own decor selections rather than
 * through this code. Re-minting the codes is a separate pass: they are what the Phase 3
 * inventory seam records and what HPL_REQUIRED_SKU_CODES lists.
 */
export function hplPanelSkuCode(panelId?: string): string | null {
  if (!panelId) return null;
  const p = getPanel(panelId);
  return `HPL-${p?.skuRef ?? panelId}`.toUpperCase();
}

/**
 * Per-panel money for one BOM panel line, resolved from the decors THIS shower selected.
 *
 * The BOM rolls panels up by SKU code, and a code can name two decors at two prices (see the
 * collision note above). Going back to the wall selections makes the common cases exact: any
 * shower whose decors share a price band — which is every single-decor shower and every
 * mixed one that stays inside a family — prices exactly right.
 *
 * The one case that cannot be exact is a shower mixing, say, Sage Green Pure with Sage Green
 * Metro: the BOM has already merged them into one line, so there is one quantity and two
 * possible prices. It takes the HIGHER and flags the line, because quoting the cheaper of two
 * possible products and discovering the difference at fulfilment is the worse failure.
 */
type HplPanelPricing = { dealer: number; retail: number; ambiguous: boolean };
function hplPanelPricing(skuCode: string | null, s: ShowerSelections): HplPanelPricing | null {
  if (!skuCode) return null;
  const decors = [...new Set(s.wallColors.filter((c): c is string => !!c))]
    .map((id) => getPanel(id))
    .filter((p): p is NonNullable<typeof p> => !!p && hplPanelSkuCode(p.id) === skuCode);
  if (!decors.length) return null;
  return {
    dealer: Math.max(...decors.map((p) => p.dealerPrice)),
    retail: Math.max(...decors.map((p) => p.retailPrice)),
    ambiguous: new Set(decors.map((p) => p.dealerPrice)).size > 1,
  };
}

/**
 * Shower selections → the takeoff's wall list.
 *
 * The configurator models three walls (WALL_INDEX: back, left, right) sized from the base:
 * the back wall runs the base's width, the two returns run its depth. It has no way to
 * express a two-wall corner shower today, so that configuration is reachable through the
 * takeoff API and the fixture but not yet through this UI — see the Phase B report.
 */
export function buildHplShowerConfig(catalog: ShowerCatalog, s: ShowerSelections): HplShowerConfig | null {
  if (!isHplShower(s)) return null;
  const item = findBaseItem(catalog, s);
  if (!item) return null;
  const mat = findWallMaterial(catalog, s.materialId);
  const decorName = (i: number) => mat?.colors.find((c) => c.id === s.wallColors[i])?.name;
  const widths = [item.w, item.d, item.d];
  const walls: HplWallSpec[] = WALL_INDEX.map((i) => ({
    id: ["back", "left", "right"][i],
    widthIn: widths[i],
    skuCode: hplPanelSkuCode(s.wallColors[i]),
    skuLabel: decorName(i),
  }));
  const type: HplShowerType = s.path === "tub" ? "tub-surround" : "alcove";
  return { type, walls };
}

/** What the SPC wall selection resolved to, for the caveat the price panel renders. */
export type SpcKitLine = { productCode: string | null; exact: boolean; kitHeightIn: number; kitWidthIn: number };

export type ShowerPrice = {
  total: number;
  lines: PriceLine[];
  hplBom: HplShowerBom | null;
  /** Null unless the walls are SPC. `exact: false` means the kit does not match the enclosure. */
  spcKit: SpcKitLine | null;
  /**
   * True when an HPL TRIM or CONSUMABLE line is still on the $1 sentinel. Narrowed from the
   * old "any HPL line" now that the panels themselves price for real — the banner has to name
   * what is actually outstanding, or a dealer learns to ignore it.
   */
  hasPlaceholderPricing: boolean;
  /**
   * True when a panel line covers two decors at two prices — a shower mixing a Pure decor
   * with the Tile decor that shares its sku_ref. Priced at the higher of the two and called
   * out, rather than silently picking one. See hplPanelPricing().
   */
  hasAmbiguousPanelPricing: boolean;
};

export function computeShowerPrice(catalog: ShowerCatalog, s: ShowerSelections): ShowerPrice {
  const lines: PriceLine[] = [];
  const item = findBaseItem(catalog, s);

  // ---- the pan or tub ----------------------------------------------------
  // Priced from the RESOLVED variant, not the size: a 60×36 is $608.40 as a composite and
  // $464.40 as an acrylic, and colour and drain choose between real SKUs within that.
  // A size with no variants (32×32, 48×30, the deck-mount tubs) never contributes a line.
  const baseVariant = resolveBaseVariant(item, s);
  if (item && baseVariant) {
    lines.push({
      key: s.path === "tub" ? "configurator.priceLine.tub" : "configurator.priceLine.showerBase",
      params: { label: item.label },
      amount: baseVariant.dealerPrice,
      sku: baseVariant.productCode,
    });
  }
  const mat = findWallMaterial(catalog, s.materialId);

  // ---- wall panels -------------------------------------------------------
  // HPL gets a real per-SKU takeoff; SPC gets a real NuVo kit SKU. Solid Surface on a
  // reopened legacy quote gets neither and simply drops off, which is correct — it is not a
  // product Kitify sells and there is no sheet to price it from.
  let hplBom: HplShowerBom | null = null;
  let spcKit: SpcKitLine | null = null;
  let hplTrimPlaceholder = false;
  let hplPanelAmbiguous = false;
  const hplConfig = buildHplShowerConfig(catalog, s);
  if (hplConfig) {
    hplBom = computeHplShowerBom(hplConfig, { acceptedUpsellIds: s.hplUpsells ?? [] });
    for (const l of hplBom.lines) {
      // Panels price for real; trim and consumables keep the sentinel until Nature Panel
      // prices them. `estimated` therefore now means "this figure is not final" rather than
      // "every HPL figure is fake", which is what lets the banner name the actual gap.
      const isPanel = l.kind === "panel";
      const priced = isPanel ? hplPanelPricing(l.skuCode, s) : null;
      const discount = 1 - (l.discountPct ?? 0) / 100;
      if (priced?.ambiguous) hplPanelAmbiguous = true;
      // Only a NON-panel line means trim pricing is outstanding. A panel line can also come
      // through unpriced — a wall with no decor chosen yet has no SKU to price — but that is
      // an unfinished configuration, not a gap in the price book, and blaming the trim for it
      // would send the dealer looking in the wrong place.
      if (!isPanel) hplTrimPlaceholder = true;
      lines.push({
        key: l.labelKey,
        params: { ...(l.labelParams ?? {}), n: String(l.qty) },
        amount: round2(l.qty * (priced ? priced.dealer : HPL_PLACEHOLDER_UNIT_PRICE) * discount),
        // MAP is the manufacturer's retail per panel and does not move because Kitify gave
        // the dealer an upsell discount, so the reference is deliberately undiscounted.
        retailPrice: priced ? round2(l.qty * priced.retail) : undefined,
        sku: l.skuCode ?? undefined,
        estimated: priced ? (priced.ambiguous || undefined) : true,
      });
    }
  } else if (mat?.id === "spc" && item) {
    // Real kit lookup, replacing the old `kitPrice × (base.w / 48)` area guess. NuVo sells
    // four fixed enclosures, so a base matching none of them warns and quotes the closest —
    // never blocks. See matchSpcWallKit().
    const match = matchSpcWallKit(item.w, item.d, s.ceilingIn ?? DEFAULT_SPC_CEILING);
    if (match) {
      const colorId = s.wallColors[0];
      const code = colorId ? spcKitCode(match.kit, colorId) : null;
      spcKit = { productCode: code, exact: match.exact, kitHeightIn: match.kit.heightIn, kitWidthIn: match.kit.widthIn };
      lines.push({
        key: "configurator.priceLine.wallKit",
        params: { material: mat.name, w: String(match.kit.widthIn), h: String(match.kit.heightIn) },
        amount: match.kit.dealerPrice,
        sku: code ?? undefined,
      });
    }
  }

  // ---- door --------------------------------------------------------------
  const door = resolveDoorVariant(catalog, s);
  if (door) {
    lines.push({
      key: "configurator.priceLine.door",
      params: { series: t_doorFamilyName(door.model.family), finish: door.variant.finish, h: String(door.model.heightIn) },
      amount: door.variant.dealerPrice,
      sku: door.variant.productCode,
    });
  }

  // ---- accessories -------------------------------------------------------
  const a = s.accessories;
  if (a.cornerShelf.qty > 0) {
    lines.push({
      key: "configurator.priceLine.cornerShelf", params: { qty: String(a.cornerShelf.qty) },
      amount: a.cornerShelf.qty * catalog.accessories.cornerShelf.price,
      sku: accessoryCode(CORNER_SHELF, a.cornerShelf.finish),
    });
  }
  if (a.niche.qty > 0) {
    lines.push({
      key: "configurator.priceLine.niche", params: { qty: String(a.niche.qty) },
      amount: a.niche.qty * catalog.accessories.niche.price,
      sku: accessoryCode(SHOWER_NICHE, a.niche.finish),
    });
  }
  if (a.grabBar.qty > 0) {
    const sz = catalog.accessories.grabBar.sizes.find((z) => z.id === a.grabBar.size);
    const bar = GRAB_BARS.find((g) => g.id === a.grabBar.size);
    lines.push({
      key: "configurator.priceLine.grabBar",
      params: { size: sz?.label ?? `${a.grabBar.size}"`, qty: String(a.grabBar.qty) },
      // A retired size (the 42" bar) has no SKU and no price. It shows at zero rather than
      // being silently re-priced onto the 48", which would change what the dealer sells.
      amount: a.grabBar.qty * (sz?.price ?? 0),
      sku: bar?.variants.find((v) => v.finishId === a.grabBar.finish)?.productCode,
    });
  }

  const total = round2(lines.reduce((x, l) => x + l.amount, 0));
  return {
    total, lines, hplBom, spcKit,
    hasPlaceholderPricing: hplTrimPlaceholder,
    hasAmbiguousPanelPricing: hplPanelAmbiguous,
  };
}

/** An accessory's product code in the chosen finish, or undefined if it isn't offered in it. */
function accessoryCode(sku: { variants: { finishId: string; productCode: string }[] }, finishId: string): string | undefined {
  return sku.variants.find((v) => v.finishId === finishId)?.productCode;
}

/** Door family names are proper nouns and stay untranslated in both languages. */
const DOOR_FAMILY_NAME: Record<DoorFamily, string> = { pacific: "Pacific", rainier: "Rainier", tetherow: "Tetherow" };
const t_doorFamilyName = (f: DoorFamily) => DOOR_FAMILY_NAME[f];

/**
 * The wall picker's mode. Explicit once the user touches the toggle; otherwise inferred
 * from the selections themselves, so a quote saved before `wallMode` existed reopens in
 * the mode its own wall array implies — three matching walls read as "all", a mix as
 * "perWall" — instead of silently collapsing a mixed set onto one decor.
 */
export function wallMode(s: ShowerSelections): WallMode {
  if (s.wallMode) return s.wallMode;
  const [a, b, c] = s.wallColors;
  return a === b && b === c ? "all" : "perWall";
}

export function isComplete(s: ShowerSelections): boolean {
  return !!(s.path && s.baseId && s.drain && s.materialId && s.wallColors.every((c) => !!c));
}

function buildLabel(catalog: ShowerCatalog, s: ShowerSelections, t: Tr): string {
  const item = findBaseItem(catalog, s);
  const mat = findWallMaterial(catalog, s.materialId);
  if (!item) return t("configurator.label.newShower");
  const kind = t(s.path === "tub" ? "configurator.label.tub" : "configurator.label.shower");
  const drain = s.drain ? t("configurator.label.drain" + s.drain.charAt(0).toUpperCase() + s.drain.slice(1)) : "";
  const walls = mat ? t("configurator.label.walls", { material: mat.name }) : "";
  // The chosen decor is more use to a dealer than the tier name alone. With three matching
  // walls that's one name; with a mix, all three, so a quote can't hide that the side walls
  // differ from the back.
  const named = (i: number) => mat?.colors.find((c) => c.id === s.wallColors[i]);
  const one = named(0);
  // The style qualifier only exists on the Nature Panel decors — an SPC or legacy Durasein
  // colour carries none, so it reads as its name alone rather than trailing empty parentheses.
  const style = one?.style ? styleLabel(t, one.style) : "";
  const decor = wallMode(s) === "all"
    ? (one?.imageUrl ? (style ? `${one.name} (${style})` : one.name) : "")
    : WALL_INDEX.map((i) => named(i)?.name ?? "—").join(" / ");
  return `${item.label} ${kind}${drain ? " · " + drain : ""}${walls ? " · " + walls : ""}${decor ? " · " + decor : ""}`.trim();
}
// Self-reported imagery. This module ships no product image files yet — only colour
// swatches — so image fields stay undefined and swatchHex carries the wall (or base)
// colour for the consumer to render a colour chip. No image paths are invented.
function buildShowerMedia(catalog: ShowerCatalog, s: ShowerSelections): ShowerMedia {
  const material = findWallMaterial(catalog, s.materialId);
  const palette = material?.colors ?? SPC_COLORS;
  const wall = palette.find((c) => c.id === s.wallColors[0]);
  const item = findBaseItem(catalog, s);
  const baseHex = item?.colors.find((c) => c.id === s.baseColorId)?.hex;
  // wallImage is now a real CDN swatch when a catalogued panel is picked — the field was
  // reserved for exactly this and stays undefined for the flat-colour tiers.
  return { wallImage: wall?.imageUrl, baseImage: undefined, doorImage: undefined, swatchHex: wall?.hex ?? baseHex };
}

// ---------------------------- Component -----------------------------------
// Corner shelf and niche are standard fittings, so they arrive on the quote at qty 1 in the
// default Chrome and the dealer steps one to 0 to drop it. The grab bar stays opt-in: it's an
// accessibility/preference call, and pre-selecting one would put a decision on the quote that
// nobody made. See INCLUDED_QTY / OPT_IN_QTY in lib/defaults.
// (The grab bar carries its own two-finish range — no chrome — so it keeps "brushed".)
const initial: ShowerSelections = {
  baseColor: "white",
  wallColors: [undefined, undefined, undefined],
  door: null,
  accessories: {
    cornerShelf: { finish: DEFAULT_FINISH_ID, qty: INCLUDED_QTY },
    niche: { finish: DEFAULT_FINISH_ID, qty: INCLUDED_QTY },
    grabBar: { finish: "brushed", size: "24", qty: OPT_IN_QTY },
  },
};

// Seed selections from shared hub state. If the seeded base id isn't in this
// catalogue, fall back to the default (kind only) and ignore it silently.
function seedShowerSelections(catalog: ShowerCatalog, kind?: Path, baseId?: string, baseColor?: string): ShowerSelections {
  const base: ShowerSelections = { ...initial, wallColors: [...initial.wallColors], baseColor: baseColor ?? initial.baseColor };
  if (!kind) return base;
  base.path = kind;
  if (baseId) {
    // The hub passes a bare dimension id — the room editor has no concept of families — so
    // the family is inferred here (see resolveBaseFamily) rather than guessed at the picker.
    const family = resolveBaseFamily(catalog, kind, baseId);
    const it = itemsForPath(catalog, kind).find((b) => b.id === baseId && b.family === family);
    if (it) {
      base.baseId = it.id;
      base.baseFamily = it.family;
      base.drain = it.drains.length === 1 ? it.drains[0] : undefined;
      // Keep a seeded colour only where this family sells it; otherwise take its own default.
      const seeded = it.colors.some((c) => c.id === base.baseColor) ? base.baseColor : it.colors[0]?.id;
      base.baseColor = seeded;
      base.baseColorId = seeded;
    }
  }
  return base;
}

export function ShowerConfigurator({
  catalog = SAMPLE_SHOWER_CATALOG,
  mode = "dealer",
  onComplete,
  onChange,
  onPreview,
  initialBaseId,
  initialKind,
  initialBaseColor,
  primaryLabel,
}: {
  catalog?: ShowerCatalog;
  mode?: "dealer" | "customer";
  onComplete?: (config: ShowerConfig) => void;
  onChange?: (shared: { kind: Path; baseId: string; baseColor: string } | null) => void;
  /**
   * The whole in-progress config, on every change — distinct from `onChange`, which reports
   * only the bath size the other modules need to stay in step, and from `onComplete`, which
   * fires once the dealer commits.
   *
   * For consumers that show the selection rather than act on it: the hub's hero preview
   * repaints from this while the module is open, so a decor reads on the wall as it is
   * picked rather than at Add-to-quote. The config may be incomplete; `isComplete` says so.
   */
  onPreview?: (config: ShowerConfig) => void;
  initialBaseId?: string;
  initialKind?: Path;
  initialBaseColor?: string;
  primaryLabel?: string;
}) {
  const { t } = useLanguage();
  const [s, setS] = useState<ShowerSelections>(() => seedShowerSelections(catalog, initialKind, initialBaseId, initialBaseColor));
  const [upsellsDismissed, setUpsellsDismissed] = useState(false);
  const price = useMemo(() => computeShowerPrice(catalog, s), [catalog, s]);
  const complete = isComplete(s);
  const set = (patch: Partial<ShowerSelections>) => setS((prev) => ({ ...prev, ...patch }));

  // Report the current bath size to the hub whenever base/kind changes (last-edit-wins).
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  useEffect(() => { if (s.path && s.baseId) onChangeRef.current?.({ kind: s.path, baseId: s.baseId, baseColor: s.baseColor ?? "white" }); }, [s.path, s.baseId, s.baseColor]);

  // Live config for preview consumers. Held in a ref like the callback above so a parent that
  // re-creates the handler each render can't re-fire the effect. `t` is deliberately not a
  // dependency: the label is rebuilt on the next real selection change, and re-emitting the
  // whole config on a language switch would push a draft over a committed quote.
  const onPreviewRef = useRef(onPreview); onPreviewRef.current = onPreview;
  useEffect(() => {
    onPreviewRef.current?.({ selections: s, media: buildShowerMedia(catalog, s), price, hplBom: price.hplBom, isComplete: isComplete(s), label: buildLabel(catalog, s, t) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, price, catalog]);

  // Adopt a bath size chosen elsewhere (e.g. placed in the room) even while
  // already mounted — swapping only the base/kind, keeping wall + door + accessory
  // work. The equality guard makes this a no-op once in sync (prevents loops).
  useEffect(() => {
    if (initialKind == null && initialBaseId == null) return;
    setS((prev) => {
      const kind = initialKind ?? prev.path;
      if (!kind) return prev;
      // The hub knows only the dimension, so the family the dealer already had is preferred
      // and only re-inferred when this size isn't sold in it.
      const family = initialBaseId ? resolveBaseFamily(catalog, kind, initialBaseId, prev.baseFamily) : undefined;
      const it = initialBaseId ? itemsForPath(catalog, kind).find((b) => b.id === initialBaseId && b.family === family) : undefined;
      const nextBaseId = it ? it.id : (prev.path === kind ? prev.baseId : undefined);
      if (prev.path === kind && prev.baseId === nextBaseId && (!it || prev.baseFamily === it.family)) return prev; // already in sync
      const color = it ? (it.colors.some((c) => c.id === prev.baseColor) ? prev.baseColor : it.colors[0]?.id) : prev.baseColor;
      return {
        ...prev,
        path: kind,
        baseId: nextBaseId,
        baseFamily: it ? it.family : prev.baseFamily,
        drain: it ? (it.drains.length === 1 ? it.drains[0] : (prev.drain && it.drains.includes(prev.drain) ? prev.drain : undefined)) : prev.drain,
        baseColor: color,
        baseColorId: color,
        door: null,
      };
    });
  }, [initialKind, initialBaseId, catalog]);

  // Adopt a base color seeded from shared hub state while already mounted (no-op once in sync).
  useEffect(() => {
    if (initialBaseColor == null) return;
    setS((prev) => (prev.baseColor === initialBaseColor ? prev : { ...prev, baseColor: initialBaseColor }));
  }, [initialBaseColor]);

  const items = itemsForPath(catalog, s.path);
  const item = findBaseItem(catalog, s);
  const baseVariant = resolveBaseVariant(item, s);
  // Which family tab is open. Follows the selection, so reopening the step shows the base
  // the dealer actually picked rather than snapping back to the first tab.
  const families = familiesForPath(catalog, s.path);
  const activeFamily: BaseFamily = item?.family ?? s.baseFamily ?? families[0] ?? "acrylic";
  const familyItems = items.filter((b) => b.family === activeFamily);
  // Resolves retired tiers too, so this module answers "what is this material" the same way
  // everywhere — see LEGACY_WALL_MATERIALS. Only a saved config can hold a retired id; the
  // picker below cannot produce one.
  const material = findWallMaterial(catalog, s.materialId);
  const palette = material?.colors ?? SPC_COLORS;
  const availDoors = doorsForItem(catalog, s.path, item);
  const doorFamilies = doorFamiliesForItem(catalog, s.path, item);
  // The hero paints its pan from the four-colour SHOWER_BASE_COLORS list, which is not
  // family-aware; the picker offers the family's own colours. They agree on white, which is
  // what every non-composite base ships in.
  const baseColor = SHOWER_BASE_COLORS.find((c) => c.id === (s.baseColor ?? "white"))?.hex ?? SHOWER_BASE_COLORS[0].hex;
  const wallHex = (i: number) => palette.find((c) => c.id === s.wallColors[i])?.hex ?? "#dad6cd";
  const isHpl = s.materialId === "hpl";
  const isSpc = s.materialId === "spc";
  // The door SKU the current selection resolves to, and which family tab that puts us on.
  const doorSku = resolveDoorVariant(catalog, s);
  const activeDoorFamily: DoorFamily = doorSku?.model.family ?? doorFamilies[0] ?? DEFAULT_DOOR_FAMILY;
  const wMode = wallMode(s);
  // Which wall the per-wall picker is editing. Local UI state — never part of the quote.
  const [activeWall, setActiveWall] = useState(0);
  // Id of a gated tier the dealer just tapped, for the transient "coming soon" note.
  const [comingSoon, setComingSoon] = useState<string | null>(null);
  useEffect(() => {
    if (!comingSoon) return;
    const id = setTimeout(() => setComingSoon(null), 3200);
    return () => clearTimeout(id);
  }, [comingSoon]);
  const activeSelection = wMode === "all" ? s.wallColors[0] : s.wallColors[activeWall];
  // Resolve the door once for the preview: its series decides the schematic, its finish the
  // hardware colour. Undefined whenever no door is on the quote, which is what hides it.
  const doorViz = useMemo(() => {
    if (!s.door) return undefined;
    const model = catalog.doors.find((d) => d.id === s.door!.seriesId);
    return { kind: doorKind(model?.family), finishHex: DOOR_FINISH_HEX[s.door.finish] ?? "#9aa0a6" };
  }, [s.door, catalog]);
  // Wall imagery for the preview: the real material tiles the walls when a decor is picked.
  // Only a flat material image may do so (see Swatch.textureUrl) — a room photo or an angled
  // slab render repeated across a shower reads as a rendering bug, so decors without one
  // fall back to the flat tint.
  const wallImage = (i: number) => {
    const sw = palette.find((c) => c.id === s.wallColors[i]);
    return sw?.textureUrl;
  };
  // The catalogued tier gets the enlarged decor card under the preview; the flat-colour SPC
  // tier has nothing to show there.
  const selectedDecor = isHpl ? palette.find((c) => c.id === s.wallColors[0]) : undefined;

  function choosePath(p: Path) { setS({ ...initial, path: p }); }
  function chooseBase(b: BaseItem) {
    // A single-drain size answers its own question, so it is filled in rather than asked.
    const drain = b.drains.length === 1 ? b.drains[0] : (s.drain && b.drains.includes(s.drain) ? s.drain : undefined);
    // Carry the colour across only where the new family sells it — a Cotton White composite
    // switched to an acrylic has to become white, because that is the only SKU there is.
    const colorId = b.colors.some((c) => c.id === s.baseColor) ? s.baseColor : b.colors[0]?.id;
    set({ baseId: b.id, baseFamily: b.family, drain, baseColor: colorId, baseColorId: colorId, door: null });
  }
  /**
   * Switching family keeps the same footprint where the new family sells it, so a dealer
   * comparing a composite 60×36 against an acrylic one stays on the size they were pricing
   * instead of losing their place. Falls back to clearing the size when it doesn't exist there.
   */
  function chooseFamily(f: BaseFamily) {
    if (f === activeFamily) return;
    const sameSize = items.find((b) => b.family === f && b.id === s.baseId);
    if (sameSize) chooseBase(sameSize);
    else set({ baseFamily: f, baseId: undefined, drain: undefined, door: null });
  }

  /**
   * Switching door family keeps the finish where the new range offers it and drops back to
   * clear glass where it does not — only Rainier sells opaque, so carrying it onto a Pacific
   * would leave the quote on a SKU that cannot be ordered.
   */
  function chooseDoorFamily(f: DoorFamily) {
    const model = availDoors.find((d) => d.family === f);
    if (!model) return;
    chooseDoorModel(model);
  }
  function chooseDoorModel(model: DoorModel) {
    const finishes = [...new Set(model.variants.map((v) => v.finish))];
    const finish = resolveDefault(s.door?.finish as DoorFinish | undefined, finishes, (x) => x, (x) => x === DEFAULT_FINISH_ID) ?? finishes[0];
    const glasses = [...new Set(model.variants.map((v) => v.glass))];
    const glass = resolveDefault(s.door?.glass, glasses, (x) => x, (x) => x === "clear") ?? "clear";
    set({ door: { seriesId: model.id, finish, glass } });
  }
  // Palettes no longer share ids across tiers (HPL is the Nature Panel catalogue, the others
  // are the NuVo stand-in), so carrying a wall selection across a material change would leave
  // an id that resolves to nothing while still counting the build as complete. Clear it.
  function chooseMaterial(id: string) {
    if (id === s.materialId) return;
    // Gated tiers are inert rather than hidden: a dealer should see the range is coming.
    if (!materialAvailable(id)) { setComingSoon(id); return; }
    set({ materialId: id, wallColors: [undefined, undefined, undefined] });
  }
  // With only one tier selectable there is nothing to choose, so pick it. Guarded on the
  // field being EMPTY, never overwriting a value: a quote carrying a retired tier (a dev-build
  // Solid Surface wall) must keep it when reopened, or the dealer's own choice would be
  // silently rewritten and the quote would price something they never picked.
  useEffect(() => {
    if (SHOW_ALL_MATERIALS || s.materialId || !s.path || !s.baseId) return;
    setS((prev) => (prev.materialId ? prev : { ...prev, materialId: LIVE_MATERIAL_ID }));
  }, [s.materialId, s.path, s.baseId]);

  function setWall(i: number, colorId: string) {
    const next = [...s.wallColors]; next[i] = colorId; set({ wallColors: next });
  }
  // Switching back to "all" collapses onto the wall being edited rather than always the back
  // wall, so the decor the user is looking at is the one that survives.
  function setWallMode(m: WallMode) {
    if (m === wMode) return;
    if (m === "all") {
      const keep = s.wallColors[activeWall] ?? s.wallColors.find(Boolean);
      set({ wallMode: "all", wallColors: [keep, keep, keep] });
    } else {
      set({ wallMode: "perWall" });
    }
  }
  // One assignment path for both pickers: all three walls, or just the active one.
  function assignWall(id: string) {
    if (wMode === "all") setAllWalls(id);
    else setWall(activeWall, id);
  }
  function setAllWalls(colorId: string) { set({ wallColors: [colorId, colorId, colorId] }); }
  // Accepting an upsell is a selection, so it lives in `s` and persists with the quote.
  // Dismissal is view-only — it hides the block for this session without recording anything.
  function toggleUpsell(offerId: string) {
    const cur = s.hplUpsells ?? [];
    set({ hplUpsells: cur.includes(offerId) ? cur.filter((x) => x !== offerId) : [...cur, offerId] });
  }
  function startOver() { setS(initial); }
  function addToQuote() { if (complete) onComplete?.({ selections: s, media: buildShowerMedia(catalog, s), price, hplBom: price.hplBom, isComplete: true, label: buildLabel(catalog, s, t) }); }

  const acc = catalog.accessories;
  const stepAcc = (key: keyof AccessoryState, delta: number) =>
    set({ accessories: { ...s.accessories, [key]: { ...s.accessories[key], qty: Math.max(0, s.accessories[key].qty + delta) } } });

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      {/* Preview + price */}
      <div className="lg:sticky lg:top-5 lg:self-start">
        <div className="overflow-hidden rounded-2xl border border-line bg-card">
          <ShowerPreview path={s.path} back={wallHex(0)} left={wallHex(1)} right={wallHex(2)} baseColor={baseColor}
            wallImages={[wallImage(0), wallImage(1), wallImage(2)]}
            door={doorViz} niche={s.accessories.niche.qty > 0} shelf={s.accessories.cornerShelf.qty > 0} bar={s.accessories.grabBar.qty > 0} />
          {/* Selected decor, at a size a dealer can actually judge the pattern from. */}
          {selectedDecor && <SelectedDecorCard swatch={selectedDecor} />}
          <div className="border-t border-line p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{mode === "dealer" ? t("configurator.dealerPrice") : t("configurator.estimate")}</span>
              <span className="font-display text-2xl font-bold">{money(price.total)}</span>
            </div>
            {/* The banner is now CONDITIONAL rather than always-on. Bases, doors, SPC kits
                and accessories all price from the Therma-Glass sheet and are quotable; the
                HPL lines do not, because that sheet carries no Nature Panel rows, so an HPL
                shower still says so. See PriceLine.estimated. */}
            {price.hasPlaceholderPricing && (
              <div className="mb-2 rounded-md bg-amber/10 px-2 py-1 text-[10px] font-medium text-amber">{t("configurator.shower.hplTrimPricingPending")}</div>
            )}
            <div className="space-y-1">
              {price.lines.map((l, i) => (
                <div key={i} className="text-xs text-muted">
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0">
                      {priceLineText(t, l)}
                      {l.sku && <span className="ml-1 font-mono text-[9px] uppercase tracking-wide opacity-70">{l.sku}</span>}
                    </span>
                    <span className="shrink-0">{money(l.amount)}</span>
                  </div>
                  {/* MAP reference. Informational only — the partner sets their own customer
                      price and nothing here warns if they go above or below it. */}
                  {l.retailPrice != null && (
                    <div className="pl-2 text-[10px] opacity-70">{t("configurator.shower.suggestedRetail", { amount: money(l.retailPrice) })}</div>
                  )}
                </div>
              ))}
              {price.lines.length === 0 && <div className="text-xs text-muted">{t("configurator.shower.chooseBaseFirst")}</div>}
            </div>

            {/* Two decors sharing one sku_ref at two prices — quoted at the higher. */}
            {price.hasAmbiguousPanelPricing && (
              <p className="mt-2 rounded-md border border-amber/30 bg-amber/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber">
                {t("configurator.shower.hplPanelPriceAmbiguous")}
              </p>
            )}

            {/* An SPC kit that doesn't match the configured enclosure. Warn, never block —
                NuVo sells four fixed kits and the closest one is still a usable quote; the
                dealer just needs to know the fit and freight will be estimated. */}
            {price.spcKit && !price.spcKit.exact && (
              <p className="mt-2 rounded-md border border-amber/30 bg-amber/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber">
                {t("configurator.shower.spcKitMismatch", {
                  w: String(price.spcKit.kitWidthIn), h: String(price.spcKit.kitHeightIn),
                })}
              </p>
            )}

            {/* An end-cap count the lookup doesn't cover. Warn, never block — the BOM is still
                usable, the dealer just needs to know that one figure is an estimate. */}
            {price.hplBom?.trim.endCapEstimated && (
              <p className="mt-2 rounded-md border border-amber/30 bg-amber/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber">
                {t("configurator.shower.hplBom.endCapEstimated")}
              </p>
            )}

            {/* HPL upsells. Never rendered for SPC — see HplUpsellPopup's header. */}
            {price.hplBom && !upsellsDismissed && (
              <HplUpsellPopup
                bom={price.hplBom}
                accepted={s.hplUpsells ?? []}
                onToggle={toggleUpsell}
                onDismissAll={() => setUpsellsDismissed(true)}
              />
            )}

            <button onClick={addToQuote} disabled={!complete}
              className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
              {complete ? (primaryLabel ?? t("configurator.addToQuote")) : t("configurator.finishToAdd")}
            </button>
            <p className="mt-2 text-[10px] text-muted">{t("configurator.shower.palletNote")}</p>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-5">
        <Step n={1} title={t("configurator.shower.stepBaseType")}>
          <div className="grid grid-cols-2 gap-2">
            {([["shower", "configurator.shower.showerBase"], ["tub", "configurator.shower.skirtedTub"]] as [Path, string][]).map(([p, lk]) => (
              <button key={p} onClick={() => choosePath(p)}
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${s.path === p ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>{t(lk)}</button>
            ))}
          </div>
        </Step>

        {s.path && (
          <Step n={2} title={t("configurator.shower.stepSize")}>
            {/* Family first, then size — the order the price sheet is organised in, and the
                order a dealer decides in. A 60×36 exists in two families at two prices, so
                asking for the size first would be asking an unanswerable question. */}
            {families.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {families.map((f) => (
                  <button key={f} type="button" onClick={() => chooseFamily(f)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${f === activeFamily ? "border-accent bg-accent-soft/50 text-ink" : "border-line text-muted hover:bg-ink/5"}`}>
                    {t(BASE_FAMILY_KEY[f])}
                  </button>
                ))}
              </div>
            )}
            <p className="mb-3 text-xs text-muted">{t(BASE_FAMILY_DESC_KEY[activeFamily])}</p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {familyItems.map((b) => (
                <button key={`${b.family}:${b.id}`} onClick={() => chooseBase(b)}
                  className={`rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition ${s.baseId === b.id && b.family === activeFamily ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                  {b.label}
                  {b.placeholder
                    ? <span className="block font-mono text-[9px] font-normal text-amber">{t("configurator.shower.pricingTBD")}</span>
                    : <span className="block font-mono text-[9px] font-normal text-muted">{money(b.price)}</span>}
                  {b.noteKey && <span className="block font-mono text-[9px] font-normal text-muted">{t("configurator.shower.note." + b.noteKey)}</span>}
                </button>
              ))}
            </div>

            {/* Skirt height — a tub spec the dealer needs for the rough-in but that the size
                label can't carry. Rendered from the catalog value, so it can never drift from
                the SKU data the way a hardcoded caption would. */}
            {item?.h != null && s.path === "tub" && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                {t("configurator.shower.skirtHeight", { h: String(item.h) })}
              </p>
            )}

            {/* Base colour — only where the family HAS a colour axis. The K-Series acrylics
                and the Cascade tubs ship white only, so a palette there would offer SKUs that
                do not exist. */}
            {item && item.colors.length > 1 && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t("configurator.shower.baseColor")}</span>
                  <span className="text-xs">{item.colors.find((c) => c.id === (s.baseColor ?? "white"))?.name ?? "—"}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.colors.map((c) => (
                    <button key={c.id} onClick={() => set({ baseColor: c.id })} title={c.name}
                      className={`h-8 w-8 rounded-full border-2 transition ${(s.baseColor ?? "white") === c.id ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-ink/30"}`}
                      style={{ background: c.hex }} />
                  ))}
                </div>
              </div>
            )}
            {item && item.colors.length === 1 && (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                {t("configurator.shower.whiteOnly")}
              </p>
            )}
            {/* The ordered code, once size + colour + drain resolve to one. */}
            {baseVariant && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{baseVariant.productCode}</p>
            )}
          </Step>
        )}

        {item && (
          <Step n={3} title={t("configurator.shower.stepDrain")}>
            <div className="flex flex-wrap gap-2">
              {item.drains.map((d) => (
                <button key={d} onClick={() => set({ drain: d })}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${s.drain === d ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                  {t("configurator.drain." + d)}
                </button>
              ))}
              <span className="self-center text-xs text-muted">{t("configurator.shower.matchesSku", { label: item.label })}</span>
            </div>
          </Step>
        )}

        {item && (
          <Step n={4} title={t("configurator.shower.stepWallMaterial")} hint={t("configurator.shower.onePerShower")}>
            <div className="grid grid-cols-2 gap-2">
              {catalog.materials.map((m) => {
                const live = materialAvailable(m.id);
                const selected = s.materialId === m.id;
                return (
                  <button key={m.id} type="button" onClick={() => chooseMaterial(m.id)}
                    aria-disabled={!live}
                    title={live ? undefined : t("configurator.shower.comingSoon")}
                    className={`relative min-h-[64px] rounded-xl border px-3 py-3 text-center transition ${
                      selected ? "border-accent bg-accent-soft/50"
                        : live ? "border-line hover:bg-ink/5"
                          : "cursor-not-allowed border-dashed border-line bg-ink/[0.03]"
                    }`}>
                    {/* Gated: the one live tier is named in full and drops its Good/Better/Best
                        line, because a ladder rung with nothing above or below it is noise. */}
                    <div className={`text-sm font-semibold ${live || selected ? "" : "text-muted"}`}>
                      {!SHOW_ALL_MATERIALS && live ? t("configurator.shower.hplName") : m.name}
                    </div>
                    {(SHOW_ALL_MATERIALS || !live) && (
                      <div className="font-mono text-[9px] uppercase tracking-wide text-muted">
                        {live || selected
                          ? t(m.tier === "Good" ? "configurator.shower.tierGood" : m.tier === "Better" ? "configurator.shower.tierBetter" : "configurator.shower.tierBest")
                          : t("configurator.shower.comingSoon")}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Transient acknowledgement rather than a modal: the tap is a dead end, and the
                dealer only needs to know why. */}
            {comingSoon && (
              <p className="mt-2 rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber" role="status">
                {t("configurator.shower.spcComingSoon")}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              {SHOW_ALL_MATERIALS ? t("configurator.shower.materialNote") : t("configurator.shower.materialNoteLive")}
            </p>
          </Step>
        )}

        {material && (
          <Step n={5} title={t(isHpl ? "configurator.shower.stepWallPanel" : "configurator.shower.stepWallColors")}>
            {/* Mode toggle + (when per-wall) the wall being edited. Both are material-agnostic:
                the picker underneath swaps between catalogued panels and flat swatches, but
                the assignment rules are identical. */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {([["all", "configurator.shower.wallModeAll"], ["perWall", "configurator.shower.wallModePer"]] as [WallMode, string][]).map(([m, lk]) => (
                <button key={m} type="button" onClick={() => setWallMode(m)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${wMode === m ? "border-accent bg-accent-soft/50 text-ink" : "border-line text-muted hover:bg-ink/5"}`}>
                  {t(lk)}
                </button>
              ))}
            </div>

            {wMode === "perWall" && (
              <div className="mb-3">
                <div className="flex flex-wrap gap-1.5">
                  {WALL_INDEX.map((i) => {
                    const picked = palette.find((c) => c.id === s.wallColors[i]);
                    return (
                      <button key={i} type="button" onClick={() => setActiveWall(i)}
                        className={`flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition ${activeWall === i ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                        <span className="h-4 w-4 shrink-0 overflow-hidden rounded-full border border-line" style={{ background: picked?.hex ?? "#dad6cd" }}>
                          {picked?.imageUrl && <SwatchImage src={picked.imageUrl} name="" className="h-full w-full" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-mono text-[9px] uppercase tracking-wide text-muted">{t(WALL_KEYS[i])}</span>
                          <span className="block truncate text-[11px] font-medium text-ink">{picked?.name ?? "—"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-muted">{t("configurator.shower.perWallHint", { wall: t(WALL_KEYS[activeWall]) })}</p>
              </div>
            )}

            {isHpl ? (
              <PanelPicker selectedId={activeSelection} onSelect={assignWall} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {palette.map((c) => (
                  <button key={c.id} onClick={() => assignWall(c.id)} title={c.name}
                    className={`h-8 w-8 rounded-full border-2 transition ${activeSelection === c.id ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-ink/30"}`}
                    style={{ background: c.hex }} />
                ))}
              </div>
            )}

            {/* Ceiling height — SPC only. It is what chooses between the 66", 80" and 96"
                NuVo kits, and there is no way to price one without it. HPL does not ask:
                its takeoff is per-wall against a full-height 94½" panel regardless. */}
            {isSpc && (
              <div className="mt-4">
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                  {t("configurator.shower.ceilingHeight")}
                </div>
                <div className="flex flex-wrap gap-2">
                  {SPC_CEILING_HEIGHTS.map((h) => (
                    <button key={h} type="button" onClick={() => set({ ceilingIn: h })}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${(s.ceilingIn ?? DEFAULT_SPC_CEILING) === h ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                      {h}&quot;
                    </button>
                  ))}
                </div>
                {price.spcKit && (
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                    {price.spcKit.productCode ?? t("configurator.shower.pickDecorForSku")}
                  </p>
                )}
              </div>
            )}
          </Step>
        )}

        {item && (
          <Step n={6} title={t("configurator.shower.stepDoor")} hint={t("configurator.shower.optional")}>
            {availDoors.length === 0 ? (
              <p className="text-sm text-muted">{t("configurator.shower.noStockDoor")}</p>
            ) : (
              <>
                <label className="mb-3 flex items-center gap-2 text-sm">
                  {/* Ticking the box lands on Rainier — the value line — in the default
                      Chrome with clear glass. All three are changeable below. */}
                  <input type="checkbox" checked={!!s.door}
                    onChange={(e) => set({ door: e.target.checked ? defaultDoor(availDoors) : null })} />
                  {t("configurator.shower.addMatchingDoor")}
                </label>
                {s.door && (
                  <div className="space-y-3">
                    {/* Family tabs. Only the families with a model that fits are shown —
                        Tetherow has no 48" door, so a 48" opening offers two, not three. */}
                    <div className="flex flex-wrap gap-1.5">
                      {doorFamilies.map((f) => (
                        <button key={f} type="button" onClick={() => chooseDoorFamily(f)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${f === activeDoorFamily ? "border-accent bg-accent-soft/50 text-ink" : "border-line text-muted hover:bg-ink/5"}`}>
                          {DOOR_FAMILY_NAME[f]}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted">{t(`configurator.shower.doorFamilyDesc.${activeDoorFamily}`)}</p>

                    {/* Model — one per height within the family at this opening. */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {availDoors.filter((d) => d.family === activeDoorFamily).map((d) => {
                        const price = d.variants.find((v) => v.finish === s.door!.finish)?.dealerPrice ?? d.variants[0].dealerPrice;
                        return (
                          <button key={d.id} onClick={() => chooseDoorModel(d)}
                            className={`rounded-lg border px-3 py-2 text-left text-sm transition ${s.door?.seriesId === d.id ? "border-accent bg-accent-soft/40" : "border-line hover:bg-ink/5"}`}>
                            <span className="block font-medium">{t("configurator.shower.doorSize", { w: d.widthLabel, h: String(d.heightIn) })}</span>
                            <span className="block font-mono text-[10px] text-muted">{money(price)}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Finish. */}
                    <div className="flex flex-wrap gap-2">
                      {([...new Set((availDoors.find((d) => d.id === s.door!.seriesId)?.variants ?? []).map((v) => v.finish))] as DoorFinish[]).map((f) => (
                        <button key={f} onClick={() => set({ door: { ...s.door!, finish: f } })}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition ${s.door?.finish === f ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                          {t("configurator.doorFinish." + f)}
                        </button>
                      ))}
                    </div>

                    {/* Glass — Rainier only. The frameless ranges are clear-only, so showing
                        an inert toggle on them would offer a choice that does not exist. */}
                    {activeDoorFamily === "rainier" && (
                      <div>
                        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t("configurator.shower.doorGlass")}</div>
                        <div className="flex flex-wrap gap-2">
                          {(["clear", "opaque"] as DoorGlass[]).map((g) => (
                            <button key={g} onClick={() => set({ door: { ...s.door!, glass: g } })}
                              className={`rounded-lg border px-3 py-1.5 text-sm transition ${(s.door?.glass ?? "clear") === g ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                              {t("configurator.doorGlass." + g)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {doorSku && <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{doorSku.variant.productCode}</p>}
                  </div>
                )}
              </>
            )}
          </Step>
        )}

        {item && (
          <Step n={7} title={t("configurator.shower.stepAccessories")} hint={t("configurator.shower.optional")}>
            <div className="space-y-3">
              <AccRow label={t("configurator.shower.accCornerShelf")} price={acc.cornerShelf.price} finishes={acc.cornerShelf.finishes}
                finish={s.accessories.cornerShelf.finish} qty={s.accessories.cornerShelf.qty}
                onFinish={(f) => set({ accessories: { ...s.accessories, cornerShelf: { ...s.accessories.cornerShelf, finish: f } } })}
                onStep={(d) => stepAcc("cornerShelf", d)} />
              <AccRow label={t("configurator.shower.accNiche")} price={acc.niche.price} finishes={acc.niche.finishes}
                finish={s.accessories.niche.finish} qty={s.accessories.niche.qty}
                onFinish={(f) => set({ accessories: { ...s.accessories, niche: { ...s.accessories.niche, finish: f } } })}
                onStep={(d) => stepAcc("niche", d)} />
              <div className="rounded-lg border border-line p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t("configurator.shower.accGrabBar")}</span>
                  <QtyStepper qty={s.accessories.grabBar.qty} onStep={(d) => stepAcc("grabBar", d)} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {acc.grabBar.sizes.map((z) => (
                    <button key={z.id} onClick={() => set({ accessories: { ...s.accessories, grabBar: { ...s.accessories.grabBar, size: z.id } } })}
                      className={`rounded-md border px-2.5 py-1 text-xs transition ${s.accessories.grabBar.size === z.id ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                      {z.label}
                    </button>
                  ))}
                  <span className="ml-1 flex gap-1">
                    {acc.grabBar.finishes.map((f) => (
                      <button key={f.id} onClick={() => set({ accessories: { ...s.accessories, grabBar: { ...s.accessories.grabBar, finish: f.id } } })} title={f.name}
                        className={`h-6 w-6 rounded-full border-2 ${s.accessories.grabBar.finish === f.id ? "border-accent" : "border-line"}`} style={{ background: f.hex }} />
                    ))}
                  </span>
                </div>
              </div>
            </div>
          </Step>
        )}

        {s.path && (
          <button onClick={startOver} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink">
            <RotateCcw className="h-3.5 w-3.5" /> {t("configurator.startOver")}
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------ UI bits -----------------------------------
function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink font-mono text-[10px] text-white">{n}</span>
        <h3 className="font-display text-sm font-semibold">{title}</h3>
        {hint && <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-accent">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function QtyStepper({ qty, onStep }: { qty: number; onStep: (d: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onStep(-1)} className="rounded-md border border-line p-1 hover:bg-ink/5"><Minus className="h-3.5 w-3.5" /></button>
      <span className="w-5 text-center text-sm font-semibold">{qty}</span>
      <button onClick={() => onStep(1)} className="rounded-md border border-line p-1 hover:bg-ink/5"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function AccRow({ label, price, finishes, finish, qty, onFinish, onStep }: {
  label: string; price: number; finishes: Swatch[]; finish: string; qty: number; onFinish: (f: string) => void; onStep: (d: number) => void;
}) {
  return (
    <div className="rounded-lg border border-line p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <QtyStepper qty={qty} onStep={onStep} />
      </div>
      <div className="mt-2 flex gap-1.5">
        {finishes.map((f) => (
          <button key={f.id} onClick={() => onFinish(f.id)} title={f.name}
            className={`h-6 w-6 rounded-full border-2 ${finish === f.id ? "border-accent" : "border-line"}`} style={{ background: f.hex }} />
        ))}
      </div>
    </div>
  );
}

// ----------------------- Nature Panel decor picker -------------------------
// The 21-panel HPL lineup, grouped by collection behind tabs. Two columns on a phone,
// widening from sm up, so the grid stays usable on the smallest screen a dealer carries.
function PanelPicker({ selectedId, onSelect }: { selectedId?: string; onSelect: (panelId: string) => void }) {
  const { t } = useLanguage();
  const collections = getPanelCollections();
  // Open on the collection holding the current pick, so reopening the step doesn't hide it.
  const [openId, setOpenId] = useState(() => getPanel(selectedId)?.collection ?? collections[0]?.id);
  const active = collections.find((c) => c.id === openId) ?? collections[0];
  const specs = getPanelSpecs();

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {collections.map((c) => (
          <button key={c.id} type="button" onClick={() => setOpenId(c.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${c.id === active?.id ? "border-accent bg-accent-soft/50 text-ink" : "border-line text-muted hover:bg-ink/5"}`}>
            {t(COLLECTION_KEY[c.id] ?? c.name)}
          </button>
        ))}
      </div>
      {active && <p className="mb-3 text-xs text-muted">{t(COLLECTION_DESC_KEY[active.id] ?? active.description)}</p>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {active?.panels.map((p) => {
          const chosen = p.id === selectedId;
          return (
            <button key={p.id} type="button" onClick={() => onSelect(p.id)} title={`${p.name} · ${styleLabel(t, p.style)}`}
              className={`overflow-hidden rounded-xl border text-left transition ${chosen ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-ink/30"}`}>
              <SwatchImage src={getPanelImage(p.id, 200, 200)} name={p.name} />
              <div className="p-1.5">
                <div className="truncate text-[11px] font-medium leading-tight text-ink">{p.name}</div>
                <div className="truncate font-mono text-[9px] uppercase tracking-wide text-muted">{styleLabel(t, p.style)}</div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-muted">
        {t("configurator.shower.panel.specNote", { w: "22¾", h: "94½", joint: specs.joint, years: String(specs.warranty_years) })}
      </p>
    </div>
  );
}

// A swatch tile. Falls back to the neutral tint if the CDN can't serve the image, so the
// grid keeps its shape rather than collapsing to broken-image icons. Nature Panel's URLs
// already carry width/height for its CDN, so a plain <img> is the right element — nothing
// here needs the next/image optimizer.
function SwatchImage({ src, name, className = "aspect-square w-full" }: {
  src: string | null; name: string; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  return (
    <div className={`overflow-hidden bg-ink/5 ${className}`}>
      {src && !failed && (
        <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      )}
    </div>
  );
}

// The chosen decor at a size the pattern actually reads at, under the shower preview.
// Nature Panel decors carry a style, shadow line and SKU ref; SPC's flat colours have
// nothing to show here, so the card is HPL-only (see selectedDecor).
function SelectedDecorCard({ swatch }: { swatch: Swatch }) {
  const { t } = useLanguage();
  const panel = getPanel(swatch.id);
  return (
    <div className="flex items-center gap-3 border-t border-line bg-paper/40 p-3">
      <SwatchImage src={getPanelImage(swatch.id, 200, 200)} name={swatch.name}
        className="h-[76px] w-[76px] shrink-0 rounded-lg border border-line" />
      <div className="min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
          {t("configurator.shower.panel.brand")}
        </div>
        <div className="truncate text-sm font-semibold text-ink">{swatch.name}</div>
        {panel && (
          <>
            <div className="truncate text-xs text-muted">{styleLabel(t, swatch.style)}</div>
            {panel.shadowLine && (
              <div className="truncate text-[11px] text-muted">{t("configurator.shower.panel.shadowLine")}: {panel.shadowLine}</div>
            )}
            {panel.skuRef && <div className="font-mono text-[10px] uppercase tracking-wide text-muted">{panel.skuRef}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// --------------------------- Live preview ---------------------------------
// Walls take a flat colour, or — when a catalogued panel is selected — the real swatch
// tiled through an SVG pattern, so the preview shows the actual decor rather than a tint.
// Pattern ids are namespaced with useId(): the hub mounts a second copy of this preview
// alongside the configurator's, and duplicate ids make url(#…) resolve to the wrong element.
function ShowerPreview({ path, back, left, right, baseColor, wallImages, door, niche, shelf, bar }: {
  path?: Path; back: string; left: string; right: string; baseColor: string;
  wallImages?: (string | undefined)[];   // [back, left, right]
  // Absent when no door is on the quote. Carries the resolved series type and hardware
  // colour so the preview never has to reach back into the catalog.
  door?: { kind: DoorKind; finishHex: string };
  niche: boolean; shelf: boolean; bar: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  // One pattern per distinct image, so three walls in the same decor share a single fill.
  const distinct = Array.from(new Set((wallImages ?? []).filter((u): u is string => !!u)));
  const patternId = (url: string) => `shWall-${uid}-${distinct.indexOf(url)}`;
  const fillFor = (i: number, hex: string) => {
    const url = wallImages?.[i];
    return url ? `url(#${patternId(url)})` : hex;
  };

  return (
    <svg viewBox="0 0 320 240" className="block w-full bg-paper/40">
      {distinct.length > 0 && (
        <defs>
          {distinct.map((url) => (
            <pattern key={url} id={patternId(url)} patternUnits="userSpaceOnUse" width="90" height="90">
              <image href={url} width="90" height="90" preserveAspectRatio="xMidYMid slice" />
            </pattern>
          ))}
        </defs>
      )}
      {/* left side wall */}
      <polygon points={LEFT_WALL} fill={fillFor(1, left)} />
      {/* back wall */}
      <rect x={BACK.x0} y={BACK.y0} width={BACK.x1 - BACK.x0} height={BACK.y1 - BACK.y0} fill={fillFor(0, back)} />
      {/* right side wall, with a shading pass so the two sides read as different planes */}
      <polygon points={RIGHT_WALL} fill={fillFor(2, right)} />
      <polygon points={RIGHT_WALL} fill="#000" opacity="0.08" />
      {/* niche on back wall */}
      {niche && <rect x="150" y="80" width="46" height="34" rx="2" fill="#00000022" stroke="#0000002a" />}
      {/* grab bar on back wall */}
      {bar && <rect x="95" y="150" width="70" height="6" rx="3" fill="#9a9ea1" />}
      {/* corner shelf (left-back corner) */}
      {shelf && <polygon points="70,120 92,124 70,136" fill="#c7c9c9" stroke="#00000022" />}
      {/* Base or tub. FLOOR_PLANE is the quad the three walls actually enclose — its side
          edges ARE the side walls' bottom edges — so the panels always land flush on it. */}
      {path === "tub"
        ? <>
            <polygon points={FLOOR_PLANE} fill={baseColor} stroke="#00000022" />
            {/* rim shadow along the back wall, then the skirt face below the front edge */}
            <polygon points={FLOOR_PLANE} fill="#00000010" />
            <polygon points={TUB_SKIRT} fill={baseColor} stroke="#00000022" />
          </>
        : <polygon points={FLOOR_PLANE} fill={baseColor} stroke="#00000022" />}
      {/* Door last, so the glass tints everything behind it. */}
      {door && <ShowerDoorSVG kind={door.kind} finishHex={door.finishHex} path={path} />}
    </svg>
  );
}

/**
 * The door, drawn in the front-opening plane so it spans exactly the gap between the two
 * side walls' front edges. A schematic, not a render: tinted glass, a frame in the chosen
 * hardware finish, and enough of a division/handle to tell the three series types apart.
 */
function ShowerDoorSVG({ kind, finishHex, path }: { kind: DoorKind; finishHex: string; path?: Path }) {
  const x0 = FRONT.x0, x1 = FRONT.x1, w = x1 - x0;
  // A tub door is a half-height screen sitting on the tub rim; a shower door runs most of
  // the wall height but stops short of the top.
  const yTop = path === "tub" ? 120 : 54;
  const yBot = FRONT.y1;
  const mid = x0 + w / 2;
  const frame = kind === "frameless" ? 1.2 : 2;

  return (
    <g>
      {/* glass */}
      <rect x={x0} y={yTop} width={w} height={yBot - yTop} fill="#cdd8dd" opacity="0.2" />
      {/* a soft highlight so the glass reads as a surface rather than a flat wash */}
      <polygon points={`${x0},${yBot} ${x0 + w * 0.34},${yTop} ${x0 + w * 0.52},${yTop} ${x0 + w * 0.18},${yBot}`}
        fill="#ffffff" opacity="0.12" />

      {kind === "slider" && (
        <>
          {/* header track + the overlap where the two panels pass each other */}
          <rect x={x0} y={yTop} width={w} height="5" fill={finishHex} opacity="0.9" />
          <line x1={mid} y1={yTop} x2={mid} y2={yBot} stroke={finishHex} strokeWidth={frame} opacity="0.75" />
          <line x1={mid - 7} y1={yTop} x2={mid - 7} y2={yBot} stroke={finishHex} strokeWidth="1" opacity="0.45" />
          {/* handle on the leading panel */}
          <rect x={mid - 17} y={(yTop + yBot) / 2 - 14} width="4" height="28" rx="2" fill={finishHex} />
        </>
      )}

      {kind === "panel" && (
        <>
          {/* fixed panel on the left, swinging panel on the right */}
          <line x1={x0 + w * 0.42} y1={yTop} x2={x0 + w * 0.42} y2={yBot} stroke={finishHex} strokeWidth={frame} opacity="0.8" />
          <rect x={x0 + w * 0.42} y={yTop} width={w * 0.58} height="4" fill={finishHex} opacity="0.85" />
          <rect x={x0 + w * 0.47} y={(yTop + yBot) / 2 - 15} width="4" height="30" rx="2" fill={finishHex} />
        </>
      )}

      {kind === "frameless" && (
        // Minimal hardware: two clamps and a bar handle, no header rail.
        <>
          <rect x={x1 - 26} y={yTop + 10} width="5" height="12" rx="1.5" fill={finishHex} opacity="0.85" />
          <rect x={x1 - 26} y={yBot - 24} width="5" height="12" rx="1.5" fill={finishHex} opacity="0.85" />
          <rect x={x1 - 24} y={(yTop + yBot) / 2 - 16} width="4" height="32" rx="2" fill={finishHex} />
        </>
      )}

      {/* outer frame — thin for frameless, full for the others */}
      <rect x={x0} y={yTop} width={w} height={yBot - yTop} fill="none" stroke={finishHex}
        strokeWidth={frame} opacity={kind === "frameless" ? 0.55 : 0.85} />
    </g>
  );
}

/**
 * Read-only wrapper: renders the exact same ShowerPreview as the configurator, driven
 * by an emitted config. Same single-source-of-truth rule as RoomPlanSVG — no drawing
 * logic is duplicated, only the small config → preview-props mapping the module already
 * does internally. Inert (pointer-events disabled) so it never intercepts clicks.
 */
export function ShowerPreviewFromConfig({ config, className }: { config: ShowerConfig; className?: string }) {
  const catalog = SAMPLE_SHOWER_CATALOG;
  const s = config.selections;
  const material = findWallMaterial(catalog, s.materialId);
  const palette = material?.colors ?? SPC_COLORS;
  const wallHex = (i: number) => palette.find((c) => c.id === s.wallColors[i])?.hex ?? "#dad6cd";
  // Only a flat material image may tile the walls (see Swatch.textureUrl) — a room photo or
  // an angled slab render repeated across a shower reads as a rendering bug, so decors
  // without one fall back to the flat tint.
  const wallImage = (i: number) => {
    const sw = palette.find((c) => c.id === s.wallColors[i]);
    return sw?.textureUrl;
  };
  const baseColor = SHOWER_BASE_COLORS.find((c) => c.id === (s.baseColor ?? "white"))?.hex ?? SHOWER_BASE_COLORS[0].hex;
  // Same door resolution the configurator does, so a read-only preview shows the identical
  // schematic rather than a generic pane.
  const doorModel = s.door ? catalog.doors.find((d) => d.id === s.door!.seriesId) : undefined;
  const doorViz = s.door ? { kind: doorKind(doorModel?.family), finishHex: DOOR_FINISH_HEX[s.door.finish] ?? "#9aa0a6" } : undefined;
  return (
    <div className={className} style={{ pointerEvents: "none" }}>
      <ShowerPreview path={s.path} back={wallHex(0)} left={wallHex(1)} right={wallHex(2)} baseColor={baseColor}
        wallImages={[wallImage(0), wallImage(1), wallImage(2)]}
        door={doorViz} niche={s.accessories.niche.qty > 0} shelf={s.accessories.cornerShelf.qty > 0} bar={s.accessories.grabBar.qty > 0} />
    </div>
  );
}

/**
 * The wall decor an emitted shower config resolves to, or null for the flat-colour tiers.
 * Lets the hub show the real swatch without knowing how the palettes are wired.
 */
export function showerWallPanel(config: ShowerConfig): { id: string; name: string; style?: string; imageUrl: string } | null {
  const s = config.selections;
  const material = findWallMaterial(SAMPLE_SHOWER_CATALOG, s.materialId);
  const swatch = material?.colors.find((c) => c.id === s.wallColors[0]);
  if (!swatch?.imageUrl) return null;
  return { id: swatch.id, name: swatch.name, style: swatch.style, imageUrl: swatch.imageUrl };
}

/**
 * The wall decor as a TILEABLE texture, for the hero compositor.
 *
 * Deliberately separate from showerWallPanel above, which answers a different question. That
 * one returns the thumbnail — the image that identifies the decor in a chip or a card, and
 * every catalogued decor has one. This one returns only `textureUrl`, the flat edge-to-edge
 * material capture, which is the single kind of image that may be repeated across a surface.
 * Roughly half the range has no such asset — Nature Panel's Tile and Pure decors publish room
 * photography — and tiling a photographed bathroom across a wall of the previewed bathroom is
 * unmistakably a bug. Those return null, and the compositor leaves the alcove as the base scene.
 */
export function showerWallTexture(config: ShowerConfig): ShowerWallTexture | null {
  return showerWallTextureAt(config, 0);
}

/** What the hero needs to tile a wall honestly: the image, and how the product is made. */
export type ShowerWallTexture = {
  textureUrl: string;
  name: string;
  /**
   * Panel width in inches, or null for sheet goods.
   *
   * SPC and HPL ship as panels and a real install shows a joint every panel width — both wall
   * tiers Kitify sells are panelled, so this is a number for every new quote. Null is the
   * sheet-goods case, now reachable only from a legacy quote carrying the retired solid-surface
   * tier: that ships as sheet — 30"x144" — and covers an alcove wall whole, so it must NOT be
   * drawn with joints or it reads as the wrong product.
   */
  panelWidthIn: number | null;
};

// Nominal panel width for the panelled tiers. Defined as a positive list rather than "not
// solid surface", so a future sheet-goods tier gets seamless treatment by omission instead of
// inheriting joints it doesn't have.
const PANEL_WIDTH_IN = 24;
const PANELLED_MATERIALS = new Set(["spc", "hpl"]);

/**
 * The wall texture for ONE wall of the enclosure — 0 back, 1 left, 2 right.
 *
 * `wallColors` has always been a three-slot array; what changed is that the hero now paints
 * the back wall and the left return as separate planes and can therefore honour a per-wall
 * selection. Falls back to slot 0 whenever the enclosure is in shared-material mode or the
 * requested slot is unset, which is what keeps every quote saved before this render the same.
 */
export function showerWallTextureAt(config: ShowerConfig, wall: 0 | 1 | 2): ShowerWallTexture | null {
  const s = config.selections;
  const material = findWallMaterial(SAMPLE_SHOWER_CATALOG, s.materialId);
  if (!material) return null;
  const colorId = wallMode(s) === "perWall" ? s.wallColors[wall] ?? s.wallColors[0] : s.wallColors[0];
  const swatch = material.colors.find((c) => c.id === colorId);
  if (!swatch?.textureUrl) return null;
  return {
    textureUrl: swatch.textureUrl,
    name: swatch.name,
    panelWidthIn: PANELLED_MATERIALS.has(material.id) ? PANEL_WIDTH_IN : null,
  };
}
