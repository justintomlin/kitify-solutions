/**
 * lib/catalog.ts — single source of truth for product sizes and shower-side pricing.
 *
 * The room editor (components/room) and the shower / vanity configurators all
 * read their SKU footprints and sizes from here, so they can never disagree on
 * what products exist or how big they are.
 *
 * PRICING STATUS, by module:
 *   • SHOWER SIDE — REAL. Bases, tubs, doors, SPC wall kits, panels, trim, thresholds and
 *     accessories all carry their product code and dealer (KD) price from the Therma-Glass
 *     Master Price Sheet. These are quotable.
 *   • EVERYTHING ELSE — still nominal $1 placeholders: flooring, wall base, and the vanity
 *     module. Those keep the "Placeholder pricing" banner; the shower module no longer shows it.
 *
 * PLACEHOLDER SKUs: entries marked `placeholder: true` are real physical sizes the room editor
 * can lay out and check clearances for, but which have no orderable SKU on the price sheet — so
 * the shower module gates them out of quotes. That is now a derived fact rather than a hand-set
 * flag: a size is a placeholder exactly when it has no variants.
 *
 * NOT OFFERED, deliberately: free-standing tubs (the ALA/ALD/BEL/BRA/LAG/MER/MON/SON/TOL rows)
 * are not part of the Kitify range, and the Cascade DECK-MOUNT tubs (BG4-*) are out of scope —
 * only the alcove standard (BGS-*) is wired. The two deck sizes survive as footprints only, so
 * a room drawn with one still lays out and a saved quote still resolves its label.
 */

// Extension-qualified so Node's ESM loader can resolve it — lib/__tests__ runs this module
// directly. Same reason as the import attribute in naturepanel-catalog.ts; see tsconfig's
// allowImportingTsExtensions note.
import { getPanelSpecs } from "./naturepanel-catalog.ts";

// ============================================================================
// Shower bases & tubs
// ============================================================================

/**
 * Which product line a base belongs to. This is the axis the old catalog could not express:
 * `id` is a DIMENSION key, and 60×32 exists as a NuVo composite, a K-Series acrylic and a
 * Cascade alcove tub at three different prices. Family is what disambiguates them.
 *
 * `id` deliberately stays the dimension string. It is a cross-module contract — the room
 * editor stores it as `bath.sku`, the hub syncs room↔shower by id equality, and every saved
 * quote holds one — so re-keying to product codes would break all three at once.
 */
export type BaseFamily = "composite" | "acrylic" | "alcove-tub";
export type BaseDrain = "left" | "right" | "center" | "end";

/** A colour that is part of the product code, e.g. the `CW` in NUV-BASE-4836C-CW. */
export type BaseColor = { id: string; code: string; name: string; hex: string };

/** A product offered in a colour. `colorId` is undefined where the line has no colour axis. */
export type ColorVariant = { productCode: string; colorId?: string; dealerPrice: number };

/**
 * One orderable base SKU: a size in a colour with a drain position. Colour and drain are both
 * price-sheet axes rather than free options — K-UT09-6030L and -6030R are different SKUs,
 * and a 72×36 composite is not available in Cotton White at all.
 */
export type BaseVariant = ColorVariant & { drain: BaseDrain };

export type BaseFamilySku = {
  id: string;            // dimension key — unique WITHIN a family, not across families
  family: BaseFamily;
  w: number; d: number; h?: number;
  label: string;
  variants: BaseVariant[];
  /** Stable i18n key suffix for a shower-side note (`configurator.shower.note.<key>`). */
  noteKey?: string;
};

// `h` is the finished height in inches measured floor-to-rim — for a skirted tub that is the
// apron face the installer sees. Optional because a shower base's curb height is a different
// measurement that hasn't been sourced; only the tubs carry it today.
export type BaseSku = { id: string; w: number; d: number; h?: number; label: string; dealerPrice: number; placeholder?: boolean };

/** NuVo composite base colours. The code is the product-code suffix. */
export const COMPOSITE_BASE_COLORS: BaseColor[] = [
  { id: "cotton-white", code: "CW", name: "Cotton White", hex: "#e7e4da" },
  { id: "grey",         code: "GR", name: "Grey",         hex: "#9a9b98" },
  { id: "white",        code: "WH", name: "White",        hex: "#eeeeea" },
  { id: "black",        code: "BL", name: "Black",        hex: "#2b2d30" },
];

const COMPOSITE_COLOR_IDS = COMPOSITE_BASE_COLORS.map((c) => c.id);
const codeOf = (colorId: string) => COMPOSITE_BASE_COLORS.find((c) => c.id === colorId)!.code;

/** Every colour of one NuVo line — `stem` is the product code up to the colour suffix. */
function colorVariants(stem: string, price: number, colorIds = COMPOSITE_COLOR_IDS): ColorVariant[] {
  return colorIds.map((colorId) => ({ productCode: `${stem}-${codeOf(colorId)}`, colorId, dealerPrice: price }));
}
/** The same, for a base — which additionally has a fixed drain position per size. */
function compositeVariants(stem: string, drain: BaseDrain, price: number, colorIds = COMPOSITE_COLOR_IDS): BaseVariant[] {
  return colorVariants(stem, price, colorIds).map((v) => ({ ...v, drain }));
}

/**
 * Shower bases, by family. Prices are dealer (KD) from the Therma-Glass Master Price Sheet.
 *
 * The 60×32 collision is the clearest reason this list is family-keyed: a composite end-drain
 * pan at $543.60, an acrylic L/R pan at $411 and a seated acrylic pan at $896.40 all measure
 * 60 × 32 and all used to be one row called "60x32".
 */
export const SHOWER_BASE_SKUS: BaseFamilySku[] = [
  // ---- NuVo composite (SPC) -----------------------------------------------
  { id: "48x36", family: "composite", w: 48, d: 36, label: '48" × 36"',
    variants: compositeVariants("NUV-BASE-4836C", "center", 558) },
  { id: "60x32", family: "composite", w: 60, d: 32, label: '60" × 32"', noteKey: "endDrain",
    variants: compositeVariants("NUV-BASE-6032E", "end", 543.6) },
  { id: "60x36", family: "composite", w: 60, d: 36, label: '60" × 36"',
    variants: compositeVariants("NUV-BASE-6036C", "center", 608.4) },
  // 72×36 and 78×36 are not offered in Cotton White — three colours, not four.
  { id: "72x36", family: "composite", w: 72, d: 36, label: '72" × 36"',
    variants: compositeVariants("NUV-BASE-7236C", "center", 658.8, ["black", "white", "grey"]) },
  { id: "78x36", family: "composite", w: 78, d: 36, label: '78" × 36"',
    variants: compositeVariants("NUV-BASE-7836C", "center", 684, ["white", "grey", "black"]) },

  // ---- K-Series acrylic ---------------------------------------------------
  // No colour axis: the K-Series ships white only, so variants carry no colorId.
  { id: "36x36", family: "acrylic", w: 36, d: 36, label: '36" × 36"',
    variants: [{ productCode: "K-UT10-3636-3", drain: "center", dealerPrice: 325.2 }] },
  { id: "38x38", family: "acrylic", w: 38, d: 38, label: '38" × 38" neo-angle', noteKey: "neoAngle",
    variants: [{ productCode: "K-UT11-3838N", drain: "center", dealerPrice: 346.8 }] },
  { id: "48x32", family: "acrylic", w: 48, d: 32, label: '48" × 32"',
    variants: [{ productCode: "K-UT09-4832", drain: "center", dealerPrice: 360 }] },
  { id: "48x34", family: "acrylic", w: 48, d: 34, label: '48" × 34"',
    variants: [{ productCode: "K-UT09-4834", drain: "center", dealerPrice: 375.6 }] },
  { id: "48x36", family: "acrylic", w: 48, d: 36, label: '48" × 36"',
    variants: [{ productCode: "K-UT09-4836", drain: "center", dealerPrice: 403.2 }] },
  { id: "60x30", family: "acrylic", w: 60, d: 30, label: '60" × 30"',
    variants: [
      { productCode: "K-UT09-6030L", drain: "left", dealerPrice: 406.8 },
      { productCode: "K-UT09-6030R", drain: "right", dealerPrice: 406.8 },
    ] },
  { id: "60x32", family: "acrylic", w: 60, d: 32, label: '60" × 32"',
    variants: [
      { productCode: "K-UT09-6032L", drain: "left", dealerPrice: 411 },
      { productCode: "K-UT09-6032R", drain: "right", dealerPrice: 411 },
    ] },
  { id: "60x34", family: "acrylic", w: 60, d: 34, label: '60" × 34"',
    variants: [{ productCode: "K-UT09-6034", drain: "center", dealerPrice: 432 }] },
  { id: "60x36", family: "acrylic", w: 60, d: 36, label: '60" × 36"',
    variants: [{ productCode: "K-UT09-6036", drain: "center", dealerPrice: 464.4 }] },
  // A SEPARATE id, not a variant of 60x32: the seated pan is a different product with an
  // integral bench at more than twice the price, and collapsing the two would let a dealer
  // pick "60×32" and get whichever the list happened to order first.
  { id: "60x32-seated", family: "acrylic", w: 60, d: 32, label: '60" × 32" seated', noteKey: "seated",
    variants: [
      { productCode: "K-SB6032L", drain: "left", dealerPrice: 896.4 },
      { productCode: "K-SB6032R", drain: "right", dealerPrice: 896.4 },
    ] },
];

/**
 * HEIGHT TO CONFIRM: the skirt height is the one figure here NOT taken from a supplier sheet.
 * 16" is the top of the range the punch list specified (14–16") and a common alcove apron
 * height. Check it against the Cascade tub spec sheet before this reaches a dealer quote.
 */
export const TUB_SKIRT_HEIGHT_IN = 16;

/** Cascade ALCOVE tubs. Deck-mount (BG4-*) and free-standing are out of scope — see the header. */
export const ALCOVE_TUB_SKUS: BaseFamilySku[] = [
  { id: "60x30", family: "alcove-tub", w: 60, d: 30, h: TUB_SKIRT_HEIGHT_IN, label: '60" × 30"',
    variants: [
      { productCode: "BGS-2763-6030L", drain: "left", dealerPrice: 730.2 },
      { productCode: "BGS-2763-6030R", drain: "right", dealerPrice: 730.2 },
    ] },
  { id: "60x32", family: "alcove-tub", w: 60, d: 32, h: TUB_SKIRT_HEIGHT_IN, label: '60" × 32"',
    variants: [
      { productCode: "BGS-2763-6032L", drain: "left", dealerPrice: 730.2 },
      { productCode: "BGS-2763-6032R", drain: "right", dealerPrice: 730.2 },
    ] },
];

/**
 * Sizes with no orderable SKU on the price sheet, kept as FOOTPRINTS ONLY.
 *
 * The room editor lays these out and checks clearances against them, and a quote saved before
 * the price sheet landed still resolves its label instead of rendering blank. They can never
 * be quoted: no variants means `placeholder: true` below, which is what gates them.
 */
const LEGACY_BASE_SIZES: BaseSku[] = [
  { id: "32x32", w: 32, d: 32, label: '32" × 32"', dealerPrice: 0, placeholder: true },
  { id: "48x30", w: 48, d: 30, label: '48" × 30"', dealerPrice: 0, placeholder: true },
];
const LEGACY_TUB_SIZES: BaseSku[] = [
  { id: "60x36", w: 60, d: 36, h: TUB_SKIRT_HEIGHT_IN, label: '60" × 36" (deck)', dealerPrice: 0, placeholder: true },
  { id: "72x36", w: 72, d: 36, h: TUB_SKIRT_HEIGHT_IN, label: '72" × 36" (deck)', dealerPrice: 0, placeholder: true },
];

/**
 * The flat, dimension-keyed footprint list — DERIVED, never hand-maintained.
 *
 * This is the shape the room editor and every saved quote already speak, so it is preserved
 * exactly: one row per dimension, `dealerPrice` the cheapest way to buy that size in any
 * family. The shower module reads SHOWER_BASE_SKUS instead, because it is the one caller that
 * needs to know a 60×36 composite and a 60×36 acrylic are different products.
 */
function toFootprints(skus: BaseFamilySku[], legacy: BaseSku[]): BaseSku[] {
  const byId = new Map<string, BaseSku>();
  for (const sku of skus) {
    const cheapest = sku.variants.length ? Math.min(...sku.variants.map((v) => v.dealerPrice)) : 0;
    const seen = byId.get(sku.id);
    if (seen) {
      // Same footprint in another family — keep the lower price, keep the first label.
      if (cheapest > 0 && (seen.dealerPrice === 0 || cheapest < seen.dealerPrice)) {
        seen.dealerPrice = cheapest;
        seen.placeholder = false;
      }
      continue;
    }
    byId.set(sku.id, {
      id: sku.id, w: sku.w, d: sku.d, h: sku.h, label: sku.label,
      dealerPrice: cheapest,
      ...(cheapest > 0 ? {} : { placeholder: true as const }),
    });
  }
  for (const l of legacy) if (!byId.has(l.id)) byId.set(l.id, { ...l });
  // Smallest first, so both pickers read in a predictable order.
  return [...byId.values()].sort((a, b) => a.w - b.w || a.d - b.d);
}

export const SHOWER_BASES: BaseSku[] = toFootprints(SHOWER_BASE_SKUS, LEGACY_BASE_SIZES);
export const TUBS: BaseSku[] = toFootprints(ALCOVE_TUB_SKUS, LEGACY_TUB_SIZES);

/**
 * The base/pan colour chips the HERO renders (see HeroCompositor's baseColorId).
 *
 * Kept as its own four-colour list, unchanged, because the hero paints a pan from it and is
 * not family-aware. The shower PICKER no longer uses it — it offers the colours the chosen
 * family actually sells, which is four for composite and white-only for acrylic and tubs.
 */
export type ShowerBaseColor = { id: string; name: string; hex: string };
export const SHOWER_BASE_COLORS: ShowerBaseColor[] = [
  { id: "white", name: "White", hex: "#f4f2ee" },
  { id: "beige", name: "Beige", hex: "#d9cfbe" },
  { id: "black", name: "Black", hex: "#2b2b2b" },
  { id: "grey",  name: "Grey",  hex: "#a8a8a3" },
];

/**
 * NuVo thresholds — the companion curb sold alongside a composite base.
 *
 * Catalogued and priced, but NOT yet offered by any picker: the shower module has no
 * threshold step, so nothing selects one today. Wired now so the SKUs exist when it does.
 */
export type ThresholdSku = { id: string; lengthIn: number; label: string; variants: ColorVariant[] };
export const NUVO_THRESHOLDS: ThresholdSku[] = [
  { id: "thr-60", lengthIn: 60, label: '60" threshold', variants: colorVariants("NUV-THR-60", 108) },
  { id: "thr-80", lengthIn: 80, label: '80" threshold', variants: colorVariants("NUV-THR-80", 144, ["black", "grey", "white"]) },
];

// ============================================================================
// Shower & tub doors
// ============================================================================

/**
 * The three door ranges, in the order the picker shows them.
 *
 * NOTE the ordering is NOT price-descending: Pacific is the most expensive ($984–$1086),
 * Tetherow sits in the middle ($694–$772) and Rainier is the value line ($506–$611). The
 * tab order is the product-marketing order Kitify asked for; `DEFAULT_DOOR_FAMILY` below is
 * what a dealer actually lands on.
 *
 * Two series that used to be in this catalog — Salishan and Trillium — have NO rows on the
 * price sheet and have been dropped. They were invented placeholder data.
 */
export type DoorFamily = "pacific" | "rainier" | "tetherow";
export const DOOR_FAMILIES: DoorFamily[] = ["pacific", "rainier", "tetherow"];

/** Ticking "add a matching door" lands here — the value line, in the portal-default chrome. */
export const DEFAULT_DOOR_FAMILY: DoorFamily = "rainier";

export type DoorFinish = "chrome" | "brushed-nickel" | "matte-black";
export type DoorGlass = "clear" | "opaque";

export type DoorVariant = { productCode: string; finish: DoorFinish; glass: DoorGlass; dealerPrice: number };

export type DoorModel = {
  id: string;
  family: DoorFamily;
  /** The stock opening this fits, matching BaseSku.w. */
  fits: 48 | 60;
  /** What the sheet prints in its dimensions column, e.g. `45-48"W`. */
  widthLabel: string;
  heightIn: number;
  forPath: "shower" | "tub";
  variants: DoorVariant[];
};

// Product-code suffix: finish letter(s) + glass letter. SC = Solid Chrome clear,
// BNO = Brushed Nickel opaque, and so on.
const FINISH_CODE: Record<DoorFinish, string> = { "chrome": "S", "brushed-nickel": "BN", "matte-black": "MB" };
const GLASS_CODE: Record<DoorGlass, string> = { clear: "C", opaque: "O" };

/**
 * Build a model's variants from `[chromePrice, otherPrice]`.
 *
 * Every range on the sheet prices the same way: chrome one figure, brushed nickel and matte
 * black a second, identical figure. Opaque glass carries no separate price — it is the same
 * money as clear in the same finish — so it is generated rather than re-listed.
 */
function doorVariants(stem: string, chrome: number, other: number, glasses: DoorGlass[]): DoorVariant[] {
  const out: DoorVariant[] = [];
  for (const finish of ["chrome", "brushed-nickel", "matte-black"] as DoorFinish[]) {
    for (const glass of glasses) {
      out.push({
        productCode: `${stem}-${FINISH_CODE[finish]}${GLASS_CODE[glass]}`,
        finish, glass,
        dealerPrice: finish === "chrome" ? chrome : other,
      });
    }
  }
  return out;
}

const CLEAR_ONLY: DoorGlass[] = ["clear"];
const CLEAR_AND_OPAQUE: DoorGlass[] = ["clear", "opaque"];

export const SHOWER_DOORS: DoorModel[] = [
  // Pacific — premium frameless sliding. Clear glass only.
  { id: "pac-4880", family: "pacific", fits: 48, widthLabel: '45–48"', heightIn: 80, forPath: "shower",
    variants: doorVariants("PAC-4880", 984, 996, CLEAR_ONLY) },
  { id: "pac-6080", family: "pacific", fits: 60, widthLabel: '56–60"', heightIn: 80, forPath: "shower",
    variants: doorVariants("PAC-6080", 1062, 1086, CLEAR_ONLY) },
  { id: "pac-6066", family: "pacific", fits: 60, widthLabel: '56–60"', heightIn: 66, forPath: "tub",
    variants: doorVariants("PAC-6066", 984, 993, CLEAR_ONLY) },

  // Rainier — value deluxe sliding. The one range offering opaque glass.
  { id: "ran-4870", family: "rainier", fits: 48, widthLabel: '45–48"', heightIn: 70, forPath: "shower",
    variants: doorVariants("RAN-4870", 505.8, 560.4, CLEAR_AND_OPAQUE) },
  { id: "ran-6070", family: "rainier", fits: 60, widthLabel: '56–60"', heightIn: 70, forPath: "shower",
    variants: doorVariants("RAN-6070", 568.8, 610.8, CLEAR_AND_OPAQUE) },
  { id: "ran-6057", family: "rainier", fits: 60, widthLabel: '56–60"', heightIn: 57, forPath: "tub",
    variants: doorVariants("RAN-6057", 532.8, 577.2, CLEAR_AND_OPAQUE) },

  // Tetherow — premium frameless alternate. NO 48" model exists, so a 48" opening shows
  // this family as empty rather than substituting a size that would not fit.
  { id: "tet-6075", family: "tetherow", fits: 60, widthLabel: '56–60"', heightIn: 75, forPath: "shower",
    variants: doorVariants("TET-6075", 728.4, 771.6, CLEAR_ONLY) },
  { id: "tet-6060", family: "tetherow", fits: 60, widthLabel: '56–60"', heightIn: 60, forPath: "tub",
    variants: doorVariants("TET-6060", 694.2, 715.8, CLEAR_ONLY) },
];

// ============================================================================
// NuVo SPC wall systems
// ============================================================================

/** The six NuVo wall decors. Codes vary by line — see the DT/DW note on SPC_WALL_KITS. */
export const NUVO_WALL_COLORS = [
  { id: "amber-beige",    name: "Amber Beige",    hex: "#cdb48f" },
  { id: "carrara-bronze", name: "Carrara Bronze", hex: "#d6cdbe" },
  { id: "driftwood",      name: "Driftwood",      hex: "#b3a690" },
  { id: "platinum-grey",  name: "Platinum Grey",  hex: "#b8bab8" },
  { id: "slate-grey",     name: "Slate Grey",     hex: "#7c8083" },
  { id: "winter-white",   name: "Winter White",   hex: "#eeeee9" },
] as const;

export type NuvoWallColorId = (typeof NUVO_WALL_COLORS)[number]["id"];

/**
 * A complete SPC wall kit for one enclosure size and ceiling height.
 *
 * `codePattern` carries `{C}` where the colour code goes, because the three lines do not
 * agree on placement OR on the code itself: the vertical kits suffix it (`NUV-6036-80AB`)
 * while the horizontal sets infix it (`NUV-HPKG-AB-80`), and Driftwood is `DT` on the
 * vertical lines but `DW` on the horizontal ones. That inconsistency is in the source sheet,
 * so it is encoded per kit rather than normalised away — a normalised code would not order.
 */
export type SpcWallKit = {
  id: string;
  widthIn: number; depthIn: number; heightIn: number;
  codePattern: string;
  colors: { id: NuvoWallColorId; code: string }[];
  dealerPrice: number;
};

const VERTICAL_CODES = { "amber-beige": "AB", "carrara-bronze": "CB", "driftwood": "DT", "platinum-grey": "PG", "slate-grey": "SG", "winter-white": "WW" } as const;
const HORIZONTAL_CODES = { ...VERTICAL_CODES, driftwood: "DW" } as const;
const colorsFrom = (codes: Record<string, string>, ids: NuvoWallColorId[]) => ids.map((id) => ({ id, code: codes[id] }));

const ALL_WALL_COLOR_IDS = NUVO_WALL_COLORS.map((c) => c.id) as NuvoWallColorId[];

export const SPC_WALL_KITS: SpcWallKit[] = [
  // Vertical Shower Walls — fixed 60×36 enclosures.
  { id: "nuv-6036-66", widthIn: 60, depthIn: 36, heightIn: 66, codePattern: "NUV-6036-66{C}",
    colors: colorsFrom(VERTICAL_CODES, ["driftwood", "platinum-grey", "slate-grey", "winter-white"]),
    dealerPrice: 684 },
  { id: "nuv-6036-80", widthIn: 60, depthIn: 36, heightIn: 80, codePattern: "NUV-6036-80{C}",
    colors: colorsFrom(VERTICAL_CODES, ALL_WALL_COLOR_IDS), dealerPrice: 697.8 },
  // Horizontal Complete Sets — full-height pre-packaged kits.
  { id: "nuv-hpkg-60", widthIn: 60, depthIn: 36, heightIn: 96, codePattern: "NUV-HPKG-{C}",
    colors: colorsFrom(HORIZONTAL_CODES, ALL_WALL_COLOR_IDS), dealerPrice: 891.6 },
  { id: "nuv-hpkg-80", widthIn: 80, depthIn: 36, heightIn: 96, codePattern: "NUV-HPKG-{C}-80",
    colors: colorsFrom(HORIZONTAL_CODES, ALL_WALL_COLOR_IDS), dealerPrice: 998.4 },
];

/** The ceiling heights a dealer may pick. Each maps to at least one kit above. */
export const SPC_CEILING_HEIGHTS = [66, 80, 96] as const;
export type SpcCeilingHeight = (typeof SPC_CEILING_HEIGHTS)[number];
export const DEFAULT_SPC_CEILING: SpcCeilingHeight = 96;

/** The ordered product code for one kit in one colour, or null if it isn't offered in it. */
export function spcKitCode(kit: SpcWallKit, colorId: string): string | null {
  const c = kit.colors.find((x) => x.id === colorId);
  return c ? kit.codePattern.replace("{C}", c.code) : null;
}

export type SpcKitMatch = {
  kit: SpcWallKit;
  /** True when the kit's enclosure matches the configured one exactly. */
  exact: boolean;
};

/**
 * The SPC kit for a given enclosure, or null when nothing is close.
 *
 * WARN, DON'T BLOCK: NuVo sells four fixed enclosure kits and a dealer can configure a base
 * that matches none of them (a 48×48, say). Rather than refusing the quote, the closest kit by
 * ceiling height and then footprint is returned with `exact: false`, and the caller surfaces
 * that as a caveat on the price line. A real per-wall SPC takeoff — the equivalent of
 * lib/hpl-shower-takeoff.ts — is the actual fix and has not been specced.
 */
export function matchSpcWallKit(widthIn: number, depthIn: number, ceilingIn: number): SpcKitMatch | null {
  const exact = SPC_WALL_KITS.find((k) => k.widthIn === widthIn && k.depthIn === depthIn && k.heightIn === ceilingIn);
  if (exact) return { kit: exact, exact: true };
  if (!SPC_WALL_KITS.length) return null;
  // Ceiling dominates: a kit that does not reach the ceiling is unusable, whereas a footprint
  // mismatch is a trim-and-fit problem the installer can absorb.
  const scored = [...SPC_WALL_KITS].sort((a, b) => {
    const ha = Math.abs(a.heightIn - ceilingIn), hb = Math.abs(b.heightIn - ceilingIn);
    if (ha !== hb) return ha - hb;
    return Math.abs(a.widthIn - widthIn) - Math.abs(b.widthIn - widthIn);
  });
  return { kit: scored[0], exact: false };
}

/**
 * NuVo panels sold loose rather than as a kit, and the trim that finishes them.
 *
 * Catalogued and priced, but NOT offered by any picker: the shower module quotes SPC as a
 * complete kit, and cutting a bespoke panel schedule needs the SPC takeoff that does not
 * exist yet. Wired so the SKUs and prices are in place when it does.
 */
export type NuvoPanelKit = { id: string; label: string; panelCount: number; panelSize: string; codePattern: string; dealerPrice: number };
export const NUVO_PANEL_KITS: NuvoPanelKit[] = [
  { id: "nuv-2080", label: 'Vertical 20" × 80"', panelCount: 4, panelSize: '20" × 80"', codePattern: "NUV-2080-{C}4", dealerPrice: 348.9 },
  { id: "nuv-2440", label: 'Horizontal 40" × 24"', panelCount: 4, panelSize: '40" × 24"', codePattern: "NUV-2440-{C}", dealerPrice: 230.4 },
  { id: "nuv-2462", label: 'Horizontal 62" × 24"', panelCount: 4, panelSize: '62" × 24"', codePattern: "NUV-2462-{C}", dealerPrice: 354 },
  { id: "nuv-2480", label: 'Horizontal 80" × 24"', panelCount: 4, panelSize: '80" × 24"', codePattern: "NUV-2480-{C}", dealerPrice: 460.8 },
  { id: "nuv-2462-2", label: 'Overheight 62" × 24"', panelCount: 2, panelSize: '62" × 24"', codePattern: "NUV-2462-{C}-2", dealerPrice: 225 },
];

/**
 * NuVo trim, three profiles in two lengths, six colours each — 36 SKUs plus install tape.
 *
 * COLOUR CODES ARE VERBATIM. The 120" rows on the price sheet do not use the same colour
 * codes as the 96" rows (`W` for Winter White, `D` for Driftwood on some rows), and
 * `NUV-INSTALL TAPE` really does contain a space. Normalising any of it would produce a code
 * that does not order, so the sheet's inconsistency is preserved and flagged instead.
 */
export type NuvoTrimSku = { id: string; profile: "F" | "L" | "U"; lengthIn: 96 | 120; codes: string[]; dealerPrice: number };
export const NUVO_TRIM: NuvoTrimSku[] = [
  { id: "trim-f-96",  profile: "F", lengthIn: 96,  dealerPrice: 9,    codes: ["NUV-TRIMF-AB", "NUV-TRIMF-CB", "NUV-TRIMF-DW", "NUV-TRIMF-PG", "NUV-TRIMF-SG", "NUV-TRIMF-WW"] },
  { id: "trim-l-96",  profile: "L", lengthIn: 96,  dealerPrice: 5.4,  codes: ["NUV-TRIML-AB", "NUV-TRIML-CB", "NUV-TRIML-DW", "NUV-TRIML-PG", "NUV-TRIML-SG", "NUV-TRIML-WW"] },
  { id: "trim-u-96",  profile: "U", lengthIn: 96,  dealerPrice: 7.2,  codes: ["NUV-TRIMU-AB", "NUV-TRIMU-CB", "NUV-TRIMU-DW", "NUV-TRIMU-PG", "NUV-TRIMU-SG", "NUV-TRIMU-WW"] },
  { id: "trim-f-120", profile: "F", lengthIn: 120, dealerPrice: 10.8, codes: ["NUV-TRIMF-AB-120", "NUV-TRIMF-CB-120", "NUV-TRIMF-DW-120", "NUV-TRIMF-PG-120", "NUV-TRIMF-SG-120", "NUV-TRIMF-W-120"] },
  { id: "trim-l-120", profile: "L", lengthIn: 120, dealerPrice: 9,    codes: ["NUV-TRIML-AB-120", "NUV-TRIML-CB-120", "NUV-TRIML-D-120", "NUV-TRIML-PG-120", "NUV-TRIML-SG-120", "NUV-TRIML-W-120"] },
  { id: "trim-u-120", profile: "U", lengthIn: 120, dealerPrice: 9,    codes: ["NUV-TRIMU-AB-120", "NUV-TRIMU-CB-120", "NUV-TRIMU-D-120", "NUV-TRIMU-PG-120", "NUV-TRIMU-SG-120", "NUV-TRIMU-WW-120"] },
];
export const NUVO_INSTALL_TAPE = { productCode: "NUV-INSTALL TAPE", dealerPrice: 4.2 };

// ============================================================================
// Shower accessories
// ============================================================================

export type AccessoryVariant = { productCode: string; finishId: string; dealerPrice: number };
export type AccessorySku = { id: string; variants: AccessoryVariant[] };

export const CORNER_SHELF: AccessorySku = { id: "corner-shelf", variants: [
  { productCode: "COR-SHELF-BRUSHED",  finishId: "brushed-nickel", dealerPrice: 33 },
  { productCode: "COR-SHELF-POLISHED", finishId: "chrome",         dealerPrice: 33 },
  { productCode: "COR-SHELF-MB",       finishId: "matte-black",    dealerPrice: 33 },
] };

export const SHOWER_NICHE: AccessorySku = { id: "niche", variants: [
  { productCode: "NUV-6703B",  finishId: "brushed-nickel", dealerPrice: 156 },
  { productCode: "NUV-6703P",  finishId: "chrome",         dealerPrice: 156 },
  { productCode: "NUV-6703MB", finishId: "matte-black",    dealerPrice: 156 },
] };

/**
 * Grab bars — two finishes × three lengths.
 *
 * SIZE CHANGE: the old placeholder catalog offered 24 / 36 / 42". The price sheet sells
 * 24 / 36 / 48" — there is no 42" bar. A quote saved with "42" resolves through
 * LEGACY_GRAB_BAR_SIZES below rather than silently pricing at zero.
 */
export type GrabBarSku = { id: string; lengthIn: number; label: string; variants: AccessoryVariant[] };
const grabBar = (lengthIn: number, price: number): GrabBarSku => ({
  id: String(lengthIn), lengthIn, label: `${lengthIn}"`,
  variants: [
    { productCode: `NUV-6704-${lengthIn}B`, finishId: "brushed", dealerPrice: price },
    { productCode: `NUV-6704-${lengthIn}P`, finishId: "polished", dealerPrice: price },
  ],
});
export const GRAB_BARS: GrabBarSku[] = [grabBar(24, 87), grabBar(36, 98.4), grabBar(48, 108)];

/**
 * Retired grab-bar sizes, resolvable but not offered.
 *
 * A saved quote holding "42" keeps its label and prices at 0 with no invented figure, which
 * surfaces as a visibly wrong line rather than a plausible wrong one. Mapping it to the 48"
 * SKU would silently change what the dealer sells; guessing a price would be worse.
 */
export const LEGACY_GRAB_BAR_SIZES: GrabBarSku[] = [
  { id: "42", lengthIn: 42, label: '42" (retired)', variants: [] },
];

export const SHOWER_CHAIR: AccessorySku = { id: "shower-chair", variants: [
  { productCode: "NUV-6705B", finishId: "black", dealerPrice: 163.2 },
  { productCode: "NUV-6705W", finishId: "white", dealerPrice: 163.2 },
] };

// Vanity cabinet sizes (inches wide) and depth — CS Factory CAD.
export const VANITY_SIZES: number[] = [18, 24, 30, 36, 42, 48, 60];
export const VANITY_DEPTH = 21;

// Durato V-EVO MAX — 6mm SPC rigid core, 20mil wear layer, click-lock.
// PLACEHOLDER PRICING — all values nominal ($1). Real pricing to be loaded from
// supplier spreadsheets. Do not ship to dealers with these values.
export const FLOORING_SF_PRICE = 1;
export const FLOORING_LINE = {
  id: "durato-vevo-max",
  brand: "Durato",
  name: "V-EVO MAX",
  plankSize: '7" × 48"',
  sfPerCarton: 14.1825,
  planksPerCarton: 6,
  sfPerPallet: 850.95,
  sfPrice: FLOORING_SF_PRICE,
};

export type FlooringColor = { id: string; name: string; image: string };
// Image paths point at the exact files in public/durato_vevo_max/. Filenames contain
// spaces (encoded as %20) and two are .jpeg rather than .jpg.
export const FLOORING_COLORS: FlooringColor[] = [
  { id: "vmd-01", name: "Florence", image: "/durato_vevo_max/VMD-01%20Florence.jpg" },
  { id: "vmd-02", name: "Woolworth", image: "/durato_vevo_max/VMD-02%20Woolworth.jpg" },
  { id: "vmd-03", name: "Baymont", image: "/durato_vevo_max/VMD-03%20Baymont.jpeg" },
  { id: "vmd-04", name: "Wentworth", image: "/durato_vevo_max/VMD-04%20Wentworth.jpg" },
  { id: "vmd-05", name: "Blenheim", image: "/durato_vevo_max/VMD-05%20Blenheim.jpeg" },
  { id: "vmd-06", name: "Buckingham", image: "/durato_vevo_max/VMD-06%20Buckingham.jpg" },
  { id: "vmd-07", name: "Dresden", image: "/durato_vevo_max/VMD-07%20Dresden.jpg" },
  { id: "vmd-08", name: "Sistine", image: "/durato_vevo_max/VMD-08%20Sistine.jpg" },
  { id: "vmd-09", name: "Gherkin", image: "/durato_vevo_max/VMD-09%20Gherkin.jpg" },
  { id: "vmd-10", name: "Savoye", image: "/durato_vevo_max/VMD-10%20Savoye.jpg" },
  { id: "vmd-11", name: "Petronas", image: "/durato_vevo_max/VMD-11%20Petronas.jpg" },
  { id: "vmd-12", name: "Cayan", image: "/durato_vevo_max/VMD-12%20Cayan.jpg" },
];

// Carton-based flooring takeoff. Cartons are whole units — partial cartons can't be
// ordered, so coverage rounds up and overage is the resulting waste. Pure & testable.
export function flooringTakeoff(floorSF: number, wastePct: number) {
  const { sfPerCarton, sfPrice } = FLOORING_LINE;
  const withWasteSF = floorSF * (1 + wastePct / 100);
  const cartons = Math.ceil(withWasteSF / sfPerCarton);
  const coverageSF = cartons * sfPerCarton;
  const overageSF = coverageSF - floorSF;
  const cost = coverageSF * sfPrice;
  return { withWasteSF, cartons, coverageSF, overageSF, cost };
}

// PLACEHOLDER PRICING — nominal ($1 per stick). Real pricing to be loaded from
// supplier spreadsheets. Do not ship to dealers with these values.
export const WALL_BASE_STICK_PRICE = 1;
export const WALL_BASE_STICK_LF = 8;
export const WALL_BASE_HEIGHTS = [4, 6] as const;   // inches
export type WallBaseColor = { id: string; name: string; hex: string };
export const WALL_BASE_COLORS: WallBaseColor[] = [
  { id: "white",     name: "White",     hex: "#f4f2ee" },
  { id: "beige",     name: "Beige",     hex: "#d9cfbe" },
  { id: "black",     name: "Black",     hex: "#2b2b2b" },
  { id: "dove-grey", name: "Dove Grey", hex: "#a8a8a3" },
];

// Stick-based wall base takeoff. Wall base sells in whole 8-ft sticks — partial sticks
// can't be ordered, so coverage rounds up and overage is the resulting waste. Mirrors
// flooringTakeoff so the two read consistently. Pure & testable.
export function wallBaseTakeoff(baseboardLF: number, wastePct = 10) {
  const withWasteLF = baseboardLF * (1 + wastePct / 100);
  const sticks = Math.ceil(withWasteLF / WALL_BASE_STICK_LF);
  const coverageLF = sticks * WALL_BASE_STICK_LF;
  const overageLF = coverageLF - baseboardLF;
  const cost = sticks * WALL_BASE_STICK_PRICE;
  return { withWasteLF, sticks, coverageLF, overageLF, cost };
}

/**
 * Wall panel stock, installed vertically — the real Nature Panel HPL size, read from the
 * catalogue rather than restated.
 *
 * This was hardcoded to { widthIn: 24, heightIn: 110 }, which matched no product: Nature
 * Panel is 22.75" × 94.5" (lib/data/naturepanel-catalog.json panel_specs). Two consequences
 * of the correction, both intended:
 *   • Room panel counts rise slightly — 24" was over-crediting each sheet by 1.25".
 *   • panelHeightExceeded now actually fires. At 110" it never could (no residential ceiling
 *     is that tall), so the warning was effectively dead. At 94.5" a standard 96" ceiling
 *     genuinely does exceed a full-height panel, and the dealer should be told.
 *
 * SUBSTRATE NOTE: this describes HPL. When SPC room walls are supported it will need to
 * become substrate-aware — SPC is a different physical size. Not this phase.
 *
 * The SHOWER takeoff does not use this constant. It lives in lib/hpl-shower-takeoff.ts with
 * its own per-wall rule, because a shower is not a room — see that file's header.
 */
const HPL_SPECS = getPanelSpecs();
export const WALL_PANEL = { widthIn: HPL_SPECS.width_in, heightIn: HPL_SPECS.height_in };

export type WallPanelTakeoff = { fullPanels: number; binsUsed: number; totalPanels: number };

/**
 * Wall-panel takeoff with offcut reuse. `netLengths` are the net running lengths
 * (inches) of every wall to be panelled. Each wall yields floor(net / width) full
 * panels; the leftover remainder is an offcut. Remainders are packed into additional
 * full-width panels using first-fit-decreasing bin packing (offcuts are full height,
 * so only width matters). Openings are NOT deducted by this function — pass the net
 * length including any door/window, since a cutout is waste, not a saved panel.
 *
 * Pure and deterministic — safe to unit test in isolation.
 */
export function wallPanelTakeoff(netLengths: number[], widthIn: number = WALL_PANEL.widthIn): WallPanelTakeoff {
  let fullPanels = 0;
  const remainders: number[] = [];
  for (const len of netLengths) {
    if (!(len > 0)) continue;
    const full = Math.floor(len / widthIn);
    fullPanels += full;
    const rem = len - full * widthIn;
    if (rem > 1e-6) remainders.push(rem);
  }
  remainders.sort((a, b) => b - a); // first-fit DECREASING
  const capacityLeft: number[] = []; // remaining width in each opened offcut panel
  for (const r of remainders) {
    let placed = false;
    for (let i = 0; i < capacityLeft.length; i++) {
      if (capacityLeft[i] + 1e-6 >= r) { capacityLeft[i] -= r; placed = true; break; }
    }
    if (!placed) capacityLeft.push(widthIn - r); // open a new panel
  }
  return { fullPanels, binsUsed: capacityLeft.length, totalPanels: fullPanels + capacityLeft.length };
}
