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
 * PLACEHOLDER (flagged): SPC and Solid-Surface wall palettes (seeded with the 6 real
 * NuVo composite colors as a stand-in) and wall-kit pricing for every tier.
 * Drain options are data-driven per size (L/R/Center aren't offered on every size).
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, RotateCcw, Plus, Minus, DoorOpen, Square } from "lucide-react";
import { SHOWER_BASES, TUBS as CATALOG_TUBS, SHOWER_BASE_COLORS, type BaseSku } from "@/lib/catalog";
import { getPanelCollections, getPanelImage, getPanelSpecs, getPanel } from "@/lib/naturepanel-catalog";
import { useLanguage } from "@/components/LanguageContext";

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
export type Drain = "left" | "right" | "center" | "end";
// `hex` is the flat colour every palette has had. A catalogued wall panel adds the real
// swatch photo plus its decor metadata; the hex stays as the fallback tint for when the
// CDN image can't load, so nothing downstream has to branch on which kind of swatch it holds.
export type Swatch = {
  id: string; name: string; hex: string;
  imageUrl?: string;      // real product image (Nature Panel HPL only, today)
  style?: string;         // decor style — "Wood Slat", "Shiplap", "Subway", "Large Tile", "Pure"
  collection?: string;    // collection id — "wood" | "tile" | "pure"
  // True only when imageUrl is a flat material crop. The Tile/Pure decors currently point
  // at room photography, which is usable as a thumbnail but not as a wall texture.
  isSwatch?: boolean;
};

export type BaseItem = {
  id: string; label: string; w: number; d: number; drains: Drain[];
  colors: Swatch[]; doorWidth: 48 | 60 | 0; price: number; noteKey?: string; placeholder?: boolean;
};
export type Material = { id: string; name: string; tier: "Good" | "Better" | "Best"; kitPrice: number; colors: Swatch[] };
export type DoorSeries = { id: string; series: string; w: 48 | 60; finishes: Record<string, number> };
export type ShowerCatalog = {
  bases: BaseItem[];
  tubs: BaseItem[];
  materials: Material[];
  doors: DoorSeries[];
  tubDoors: DoorSeries[];
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
  drain?: Drain;
  baseColorId?: string;
  baseColor?: string; // pan/base color id — see SHOWER_BASE_COLORS; defaults to "white"
  materialId?: string;
  wallColors: (string | undefined)[]; // [back, left, right]
  // How the wall picker behaves. Optional so quotes saved before it existed still load:
  // wallMode() infers it from whether the three wallColors agree, which is exactly what an
  // older quote's array already encodes.
  wallMode?: WallMode;
  door: { seriesId: string; finish: string } | null;
  accessories: AccessoryState;
};

// A price line carries a dictionary key + interpolation params rather than a finished
// string, so it renders in the viewer's current language, not the language it was built in.
export type PriceLine = { key: string; params?: Record<string, string>; amount: number };
export type ShowerMedia = { wallImage?: string; baseImage?: string; doorImage?: string; swatchHex?: string };
export type ShowerConfig = {
  selections: ShowerSelections;
  // Self-reported imagery so consumers never need to know where image files live.
  // (Kept for the future AI render pipeline; the hub now draws the live SVG preview.)
  media?: ShowerMedia;
  price: { total: number; lines: PriceLine[] };
  isComplete: boolean;
  label: string;
};

// --------------------------- Sample catalog -------------------------------
const FINISHES: Swatch[] = [
  { id: "brushed-nickel", name: "Brushed Nickel", hex: "#b8b6b0" },
  { id: "polished", name: "Polished", hex: "#d9dade" },
  { id: "matte-black", name: "Matte Black", hex: "#2a2c2f" },
];

// PLACEHOLDER wall palette — the 6 real NuVo composite colors, used as a stand-in
// for each material tier until the real SPC / HPL / Solid-Surface palettes arrive.
const NUVO_COLORS: Swatch[] = [
  { id: "amber-beige", name: "Amber Beige", hex: "#cdb48f" },
  { id: "carrara-bronze", name: "Carrara Bronze", hex: "#d6cdbe" },
  { id: "driftwood", name: "Driftwood", hex: "#b3a690" },
  { id: "platinum-grey", name: "Platinum Grey", hex: "#b8bab8" },
  { id: "slate-grey", name: "Slate Grey", hex: "#7c8083" },
  { id: "winter-white", name: "Winter White", hex: "#eeeee9" },
];

// HPL is the one tier with a real catalogue behind it: the 21-panel Nature Panel lineup,
// swatch photography served from Grant Westfield's CDNs (see lib/naturepanel-catalog.ts).
// SPC and Solid Surface stay on the NuVo stand-in above until their palettes arrive.
//
// `hex` is a single neutral for every panel rather than a guessed per-decor colour — the
// real appearance comes from the swatch image, and inventing hex values for products whose
// colours aren't published would put made-up data in front of dealers. It shows only as the
// wall tint if the CDN image fails.
const HPL_PANEL_FALLBACK_HEX = "#dad6cd";
const HPL_PANELS: Swatch[] = getPanelCollections().flatMap((c) =>
  c.panels.map((p) => ({
    id: p.id, name: p.name, hex: HPL_PANEL_FALLBACK_HEX,
    imageUrl: p.imageUrl, style: p.style, collection: p.collection, isSwatch: p.isSwatch,
  })),
);

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

// Door series names carry their own type — "Pacific Frameless Slider", "Trillium Slider +
// Panel". Panel is checked first because those names contain "Slider" too.
export type DoorKind = "slider" | "frameless" | "panel";
function doorKind(series?: string): DoorKind {
  if (!series) return "frameless";
  if (/panel/i.test(series)) return "panel";
  if (/slider/i.test(series)) return "slider";
  return "frameless";
}
// Door hardware finishes are their own set (chrome / brushed-nickel / matte-black) and
// don't overlap the wall or accessory palettes.
const DOOR_FINISH_HEX: Record<string, string> = {
  "chrome": "#bfc5cc",
  "brushed-nickel": "#a49e93",
  "matte-black": "#2a2c2f",
};

const BASE_COLORS: Swatch[] = [
  { id: "white", name: "White", hex: "#eeeeea" },
  { id: "cotton-white", name: "Cotton White", hex: "#e7e4da" },
  { id: "grey", name: "Grey", hex: "#9a9b98" },
  { id: "black", name: "Black", hex: "#2b2d30" },
];
const WHITE_ONLY: Swatch[] = [{ id: "white", name: "White", hex: "#eeeeea" }];

// Shower-specific attributes per SKU id — drain options and the matching stock
// door width. Physical size, price and label all come from lib/catalog; only
// these shower-only details live here.
// `noteKey` is a stable i18n key suffix (rendered via t("configurator.shower.note." + noteKey)),
// NOT display text — so editing the label never silently breaks the translation lookup.
type ShowerMeta = { drains: Drain[]; doorWidth: 48 | 60 | 0; noteKey?: string };
const BASE_META: Record<string, ShowerMeta> = {
  "48x36": { drains: ["center"], doorWidth: 48 },
  "60x32": { drains: ["end"], doorWidth: 60, noteKey: "endDrain" },
  "60x36": { drains: ["center"], doorWidth: 60 },
  "72x36": { drains: ["center"], doorWidth: 0 },
  "78x36": { drains: ["center"], doorWidth: 0 },
  // placeholder sizes — sensible defaults until real shower SKUs exist
  "32x32": { drains: ["center"], doorWidth: 0 },
  "36x36": { drains: ["center"], doorWidth: 0 },
  "48x30": { drains: ["center"], doorWidth: 48 },
  "48x32": { drains: ["center"], doorWidth: 48 },
  "60x30": { drains: ["center"], doorWidth: 60 },
};
const TUB_META: Record<string, ShowerMeta> = {
  "60x30": { drains: ["left", "right"], doorWidth: 60 },
  "60x32": { drains: ["left", "right"], doorWidth: 60 },
  "60x36": { drains: ["left", "right"], doorWidth: 60 },
  "72x36": { drains: ["left", "right"], doorWidth: 0 },
};
function toBaseItem(sku: BaseSku, meta: ShowerMeta | undefined, colors: Swatch[]): BaseItem {
  const m = meta ?? { drains: ["center"] as Drain[], doorWidth: 0 as const };
  return { id: sku.id, label: sku.label, w: sku.w, d: sku.d, price: sku.dealerPrice, placeholder: sku.placeholder, drains: m.drains, colors, doorWidth: m.doorWidth, noteKey: m.noteKey };
}

// PLACEHOLDER PRICING — all values nominal ($1). Real pricing to be loaded from
// supplier spreadsheets. Do not ship to dealers with these values.
export const SAMPLE_SHOWER_CATALOG: ShowerCatalog = {
  bases: SHOWER_BASES.map((s) => toBaseItem(s, BASE_META[s.id], BASE_COLORS)),
  tubs: CATALOG_TUBS.map((s) => toBaseItem(s, TUB_META[s.id], WHITE_ONLY)),
  materials: [
    { id: "spc", name: "SPC", tier: "Good", kitPrice: 1, colors: NUVO_COLORS },
    { id: "hpl", name: "HPL", tier: "Better", kitPrice: 1, colors: HPL_PANELS },
    { id: "ss", name: "Solid Surface", tier: "Best", kitPrice: 1, colors: NUVO_COLORS },
  ],
  doors: [
    { id: "pac-48", series: "Pacific Frameless Slider", w: 48, finishes: { "chrome": 1, "brushed-nickel": 1, "matte-black": 1 } },
    { id: "ran-48", series: "Rainier Deluxe Slider", w: 48, finishes: { "chrome": 1, "brushed-nickel": 1, "matte-black": 1 } },
    { id: "sal-48", series: "Salishan Frameless", w: 48, finishes: { "chrome": 1, "brushed-nickel": 1, "matte-black": 1 } },
    { id: "pac-60", series: "Pacific Frameless Slider", w: 60, finishes: { "chrome": 1, "brushed-nickel": 1, "matte-black": 1 } },
    { id: "ran-60", series: "Rainier Deluxe Slider", w: 60, finishes: { "chrome": 1, "brushed-nickel": 1, "matte-black": 1 } },
    { id: "tet-60", series: "Tetherow Frameless", w: 60, finishes: { "chrome": 1, "brushed-nickel": 1, "matte-black": 1 } },
    { id: "tri-60", series: "Trillium Slider + Panel", w: 60, finishes: { "chrome": 1, "brushed-nickel": 1, "matte-black": 1 } },
  ],
  tubDoors: [
    { id: "pac-tub-60", series: "Pacific Frameless Tub Slider", w: 60, finishes: { "chrome": 1, "brushed-nickel": 1, "matte-black": 1 } },
    { id: "ran-tub-60", series: "Rainier Deluxe Tub Slider", w: 60, finishes: { "chrome": 1, "brushed-nickel": 1, "matte-black": 1 } },
    { id: "tet-tub-60", series: "Tetherow Frameless Tub", w: 60, finishes: { "chrome": 1, "brushed-nickel": 1, "matte-black": 1 } },
  ],
  accessories: {
    cornerShelf: { finishes: FINISHES, price: 1 },
    niche: { finishes: FINISHES, price: 1 },
    grabBar: {
      finishes: [{ id: "brushed", name: "Brushed", hex: "#b8b6b0" }, { id: "polished", name: "Polished", hex: "#d9dade" }],
      sizes: [{ id: "24", label: '24"', price: 1 }, { id: "36", label: '36"', price: 1 }, { id: "42", label: '42"', price: 1 }],
    },
  },
};

// ------------------------------ Engine ------------------------------------
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function itemsForPath(catalog: ShowerCatalog, path?: Path): BaseItem[] {
  return path === "tub" ? catalog.tubs : path === "shower" ? catalog.bases : [];
}
export function doorsForItem(catalog: ShowerCatalog, path: Path | undefined, item?: BaseItem): DoorSeries[] {
  if (!item || item.doorWidth === 0) return [];
  const pool = path === "tub" ? catalog.tubDoors : catalog.doors;
  return pool.filter((d) => d.w === item.doorWidth);
}

export function computeShowerPrice(catalog: ShowerCatalog, s: ShowerSelections): { total: number; lines: PriceLine[] } {
  const lines: PriceLine[] = [];
  const item = itemsForPath(catalog, s.path).find((b) => b.id === s.baseId);
  // Placeholder SKUs (dealerPrice 0, pricing TBD) never contribute a price line.
  if (item && !item.placeholder) lines.push({ key: s.path === "tub" ? "configurator.priceLine.tub" : "configurator.priceLine.showerBase", params: { label: item.label }, amount: item.price });
  const mat = catalog.materials.find((m) => m.id === s.materialId);
  if (mat && item) {
    const factor = item.w / 48; // wall area scales with width (placeholder)
    lines.push({ key: "configurator.priceLine.wallPanels", params: { material: mat.name }, amount: Math.round(mat.kitPrice * factor) });
  }
  if (s.door) {
    const series = (s.path === "tub" ? catalog.tubDoors : catalog.doors).find((d) => d.id === s.door!.seriesId);
    const amt = series?.finishes[s.door.finish];
    if (series && amt != null) lines.push({ key: "configurator.priceLine.door", params: { series: series.series, finish: s.door.finish }, amount: amt });
  }
  const a = s.accessories;
  if (a.cornerShelf.qty > 0) lines.push({ key: "configurator.priceLine.cornerShelf", params: { qty: String(a.cornerShelf.qty) }, amount: a.cornerShelf.qty * catalog.accessories.cornerShelf.price });
  if (a.niche.qty > 0) lines.push({ key: "configurator.priceLine.niche", params: { qty: String(a.niche.qty) }, amount: a.niche.qty * catalog.accessories.niche.price });
  if (a.grabBar.qty > 0) {
    const sz = catalog.accessories.grabBar.sizes.find((z) => z.id === a.grabBar.size);
    lines.push({ key: "configurator.priceLine.grabBar", params: { size: sz?.label ?? "", qty: String(a.grabBar.qty) }, amount: a.grabBar.qty * (sz?.price ?? 0) });
  }
  const total = lines.reduce((x, l) => x + l.amount, 0);
  return { total, lines };
}

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
  const item = itemsForPath(catalog, s.path).find((b) => b.id === s.baseId);
  const mat = catalog.materials.find((m) => m.id === s.materialId);
  if (!item) return t("configurator.label.newShower");
  const kind = t(s.path === "tub" ? "configurator.label.tub" : "configurator.label.shower");
  const drain = s.drain ? t("configurator.label.drain" + s.drain.charAt(0).toUpperCase() + s.drain.slice(1)) : "";
  const walls = mat ? t("configurator.label.walls", { material: mat.name }) : "";
  // The chosen decor is more use to a dealer than the tier name alone. With three matching
  // walls that's one name; with a mix, all three, so a quote can't hide that the side walls
  // differ from the back.
  const named = (i: number) => mat?.colors.find((c) => c.id === s.wallColors[i]);
  const one = named(0);
  const decor = wallMode(s) === "all"
    ? (one?.imageUrl ? `${one.name} (${styleLabel(t, one.style)})` : "")
    : WALL_INDEX.map((i) => named(i)?.name ?? "—").join(" / ");
  return `${item.label} ${kind}${drain ? " · " + drain : ""}${walls ? " · " + walls : ""}${decor ? " · " + decor : ""}`.trim();
}
// Self-reported imagery. This module ships no product image files yet — only colour
// swatches — so image fields stay undefined and swatchHex carries the wall (or base)
// colour for the consumer to render a colour chip. No image paths are invented.
function buildShowerMedia(catalog: ShowerCatalog, s: ShowerSelections): ShowerMedia {
  const material = catalog.materials.find((m) => m.id === s.materialId);
  const palette = material?.colors ?? NUVO_COLORS;
  const wall = palette.find((c) => c.id === s.wallColors[0]);
  const item = itemsForPath(catalog, s.path).find((b) => b.id === s.baseId);
  const baseHex = item?.colors.find((c) => c.id === s.baseColorId)?.hex;
  // wallImage is now a real CDN swatch when a catalogued panel is picked — the field was
  // reserved for exactly this and stays undefined for the flat-colour tiers.
  return { wallImage: wall?.imageUrl, baseImage: undefined, doorImage: undefined, swatchHex: wall?.hex ?? baseHex };
}

// ---------------------------- Component -----------------------------------
const initial: ShowerSelections = {
  baseColor: "white",
  wallColors: [undefined, undefined, undefined],
  door: null,
  accessories: {
    cornerShelf: { finish: "brushed-nickel", qty: 0 },
    niche: { finish: "brushed-nickel", qty: 0 },
    grabBar: { finish: "brushed", size: "24", qty: 0 },
  },
};

// Seed selections from shared hub state. If the seeded base id isn't in this
// catalogue, fall back to the default (kind only) and ignore it silently.
function seedShowerSelections(catalog: ShowerCatalog, kind?: Path, baseId?: string, baseColor?: string): ShowerSelections {
  const base: ShowerSelections = { ...initial, wallColors: [...initial.wallColors], baseColor: baseColor ?? initial.baseColor };
  if (!kind) return base;
  base.path = kind;
  if (baseId) {
    const it = itemsForPath(catalog, kind).find((b) => b.id === baseId);
    if (it) {
      base.baseId = it.id;
      base.drain = it.drains.length === 1 ? it.drains[0] : undefined;
      base.baseColorId = it.colors[0]?.id;
    }
  }
  return base;
}

export function ShowerConfigurator({
  catalog = SAMPLE_SHOWER_CATALOG,
  mode = "dealer",
  onComplete,
  onChange,
  initialBaseId,
  initialKind,
  initialBaseColor,
  primaryLabel,
}: {
  catalog?: ShowerCatalog;
  mode?: "dealer" | "customer";
  onComplete?: (config: ShowerConfig) => void;
  onChange?: (shared: { kind: Path; baseId: string; baseColor: string } | null) => void;
  initialBaseId?: string;
  initialKind?: Path;
  initialBaseColor?: string;
  primaryLabel?: string;
}) {
  const { t } = useLanguage();
  const [s, setS] = useState<ShowerSelections>(() => seedShowerSelections(catalog, initialKind, initialBaseId, initialBaseColor));
  const price = useMemo(() => computeShowerPrice(catalog, s), [catalog, s]);
  const complete = isComplete(s);
  const set = (patch: Partial<ShowerSelections>) => setS((prev) => ({ ...prev, ...patch }));

  // Report the current bath size to the hub whenever base/kind changes (last-edit-wins).
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  useEffect(() => { if (s.path && s.baseId) onChangeRef.current?.({ kind: s.path, baseId: s.baseId, baseColor: s.baseColor ?? "white" }); }, [s.path, s.baseId, s.baseColor]);

  // Adopt a bath size chosen elsewhere (e.g. placed in the room) even while
  // already mounted — swapping only the base/kind, keeping wall + door + accessory
  // work. The equality guard makes this a no-op once in sync (prevents loops).
  useEffect(() => {
    if (initialKind == null && initialBaseId == null) return;
    setS((prev) => {
      const kind = initialKind ?? prev.path;
      if (!kind) return prev;
      const it = initialBaseId ? itemsForPath(catalog, kind).find((b) => b.id === initialBaseId) : undefined;
      const nextBaseId = it ? it.id : (prev.path === kind ? prev.baseId : undefined);
      if (prev.path === kind && prev.baseId === nextBaseId) return prev; // already in sync
      return {
        ...prev,
        path: kind,
        baseId: nextBaseId,
        drain: it ? (it.drains.length === 1 ? it.drains[0] : (prev.drain && it.drains.includes(prev.drain) ? prev.drain : undefined)) : prev.drain,
        baseColorId: it ? it.colors[0]?.id : prev.baseColorId,
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
  const item = items.find((b) => b.id === s.baseId);
  const material = catalog.materials.find((m) => m.id === s.materialId);
  const palette = material?.colors ?? NUVO_COLORS;
  const availDoors = doorsForItem(catalog, s.path, item);
  const baseColor = SHOWER_BASE_COLORS.find((c) => c.id === (s.baseColor ?? "white"))?.hex ?? SHOWER_BASE_COLORS[0].hex;
  const wallHex = (i: number) => palette.find((c) => c.id === s.wallColors[i])?.hex ?? "#dad6cd";
  const isHpl = s.materialId === "hpl";
  const wMode = wallMode(s);
  // Which wall the per-wall picker is editing. Local UI state — never part of the quote.
  const [activeWall, setActiveWall] = useState(0);
  const activeSelection = wMode === "all" ? s.wallColors[0] : s.wallColors[activeWall];
  // Resolve the door once for the preview: its series decides the schematic, its finish the
  // hardware colour. Undefined whenever no door is on the quote, which is what hides it.
  const doorViz = useMemo(() => {
    if (!s.door) return undefined;
    const series = (s.path === "tub" ? catalog.tubDoors : catalog.doors).find((d) => d.id === s.door!.seriesId);
    return { kind: doorKind(series?.series), finishHex: DOOR_FINISH_HEX[s.door.finish] ?? "#9aa0a6" };
  }, [s.door, s.path, catalog]);
  // Wall imagery for the preview: the real panel photo tiles the walls when one is picked.
  // Only a true swatch may tile the walls — a room photograph repeated across a shower
  // reads as a rendering bug, so those fall back to the flat tint.
  const wallImage = (i: number) => {
    const sw = palette.find((c) => c.id === s.wallColors[i]);
    return sw?.isSwatch ? sw.imageUrl : undefined;
  };
  const selectedPanel = isHpl ? palette.find((c) => c.id === s.wallColors[0]) : undefined;

  function choosePath(p: Path) { setS({ ...initial, path: p }); }
  function chooseBase(id: string) {
    const it = items.find((b) => b.id === id);
    const drain = it && it.drains.length === 1 ? it.drains[0] : undefined;
    set({ baseId: id, drain, baseColorId: it?.colors[0]?.id, door: null });
  }
  // Palettes no longer share ids across tiers (HPL is the Nature Panel catalogue, the others
  // are the NuVo stand-in), so carrying a wall selection across a material change would leave
  // an id that resolves to nothing while still counting the build as complete. Clear it.
  function chooseMaterial(id: string) {
    if (id === s.materialId) return;
    set({ materialId: id, wallColors: [undefined, undefined, undefined] });
  }
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
  function startOver() { setS(initial); }
  function addToQuote() { if (complete) onComplete?.({ selections: s, media: buildShowerMedia(catalog, s), price, isComplete: true, label: buildLabel(catalog, s, t) }); }

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
          {selectedPanel && <SelectedPanelCard swatch={selectedPanel} />}
          <div className="border-t border-line p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{mode === "dealer" ? t("configurator.dealerPrice") : t("configurator.estimate")}</span>
              <span className="font-display text-2xl font-bold">{money(price.total)}</span>
            </div>
            <div className="mb-2 rounded-md bg-amber/10 px-2 py-1 text-[10px] font-medium text-amber">{t("configurator.placeholderPricing")}</div>
            <div className="space-y-1">
              {price.lines.map((l, i) => (
                <div key={i} className="flex justify-between text-xs text-muted"><span>{priceLineText(t, l)}</span><span>{money(l.amount)}</span></div>
              ))}
              {price.lines.length === 0 && <div className="text-xs text-muted">{t("configurator.shower.chooseBaseFirst")}</div>}
            </div>
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {items.map((b) => (
                <button key={b.id} onClick={() => chooseBase(b.id)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${s.baseId === b.id ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                  {b.label}
                  {b.placeholder
                    ? <span className="block font-mono text-[9px] font-normal text-amber">{t("configurator.shower.pricingTBD")}</span>
                    : b.noteKey ? <span className="block font-mono text-[9px] font-normal text-muted">{t("configurator.shower.note." + b.noteKey)}</span> : null}
                </button>
              ))}
            </div>
            {/* Base color — solid swatches, applies to the shower base and the skirted tub. */}
            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t("configurator.shower.baseColor")}</span>
                <span className="text-xs">{SHOWER_BASE_COLORS.find((c) => c.id === (s.baseColor ?? "white"))?.name}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {SHOWER_BASE_COLORS.map((c) => (
                  <button key={c.id} onClick={() => set({ baseColor: c.id })} title={c.name}
                    className={`h-8 w-8 rounded-full border-2 transition ${(s.baseColor ?? "white") === c.id ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-ink/30"}`}
                    style={{ background: c.hex }} />
                ))}
              </div>
            </div>
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
            <div className="grid grid-cols-3 gap-2">
              {catalog.materials.map((m) => (
                <button key={m.id} onClick={() => chooseMaterial(m.id)}
                  className={`rounded-xl border px-3 py-3 text-center transition ${s.materialId === m.id ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                  <div className="text-sm font-semibold">{m.name}</div>
                  <div className="font-mono text-[9px] uppercase tracking-wide text-muted">{t(m.tier === "Good" ? "configurator.shower.tierGood" : m.tier === "Better" ? "configurator.shower.tierBetter" : "configurator.shower.tierBest")}</div>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">{t("configurator.shower.materialNote")}</p>
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
                          {picked?.imageUrl && <img src={picked.imageUrl} alt="" className="h-full w-full object-cover" />}
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
          </Step>
        )}

        {item && (
          <Step n={6} title={t("configurator.shower.stepDoor")} hint={t("configurator.shower.optional")}>
            {availDoors.length === 0 ? (
              <p className="text-sm text-muted">{t("configurator.shower.noStockDoor")}</p>
            ) : (
              <>
                <label className="mb-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!s.door}
                    onChange={(e) => set({ door: e.target.checked ? { seriesId: availDoors[0].id, finish: "chrome" } : null })} />
                  {t("configurator.shower.addMatchingDoor")}
                </label>
                {s.door && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {availDoors.map((d) => (
                        <button key={d.id} onClick={() => set({ door: { seriesId: d.id, finish: s.door!.finish } })}
                          className={`rounded-lg border px-3 py-2 text-left text-sm transition ${s.door?.seriesId === d.id ? "border-accent bg-accent-soft/40" : "border-line hover:bg-ink/5"}`}>
                          {d.series}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.keys(availDoors.find((d) => d.id === s.door!.seriesId)?.finishes ?? {}).map((f) => (
                        <button key={f} onClick={() => set({ door: { seriesId: s.door!.seriesId, finish: f } })}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition ${s.door?.finish === f ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                          {t("configurator.doorFinish." + f)}
                        </button>
                      ))}
                    </div>
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
            {t(`configurator.shower.panel.collection.${c.id}`)}
          </button>
        ))}
      </div>
      {active && <p className="mb-3 text-xs text-muted">{t(`configurator.shower.panel.collectionDesc.${active.id}`)}</p>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {active?.panels.map((p) => {
          const chosen = p.id === selectedId;
          return (
            <button key={p.id} type="button" onClick={() => onSelect(p.id)} title={`${p.name} · ${styleLabel(t, p.style)}`}
              className={`overflow-hidden rounded-xl border text-left transition ${chosen ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-ink/30"}`}>
              <PanelSwatchImage panelId={p.id} name={p.name} />
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
// grid keeps its shape rather than collapsing to broken-image icons.
function PanelSwatchImage({ panelId, name }: { panelId: string; name: string }) {
  const src = getPanelImage(panelId, 200, 200);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  return (
    <div className="aspect-square w-full overflow-hidden bg-ink/5">
      {src && !failed && (
        <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      )}
    </div>
  );
}

// The chosen decor at a size the pattern actually reads at, under the shower preview.
function SelectedPanelCard({ swatch }: { swatch: Swatch }) {
  const { t } = useLanguage();
  const panel = getPanel(swatch.id);
  const src = getPanelImage(swatch.id, 200, 200);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  return (
    <div className="flex items-center gap-3 border-t border-line bg-paper/40 p-3">
      <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-lg border border-line bg-ink/5">
        {src && !failed && (
          <img src={src} alt={swatch.name} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">{t("configurator.shower.panel.brand")}</div>
        <div className="truncate text-sm font-semibold text-ink">{swatch.name}</div>
        <div className="truncate text-xs text-muted">{styleLabel(t, swatch.style)}</div>
        {panel?.shadowLine && (
          <div className="truncate text-[11px] text-muted">{t("configurator.shower.panel.shadowLine")}: {panel.shadowLine}</div>
        )}
        {panel?.skuRef && <div className="font-mono text-[10px] uppercase tracking-wide text-muted">{panel.skuRef}</div>}
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
  const material = catalog.materials.find((m) => m.id === s.materialId);
  const palette = material?.colors ?? NUVO_COLORS;
  const wallHex = (i: number) => palette.find((c) => c.id === s.wallColors[i])?.hex ?? "#dad6cd";
  // Only a true swatch may tile the walls — a room photograph repeated across a shower
  // reads as a rendering bug, so those fall back to the flat tint.
  const wallImage = (i: number) => {
    const sw = palette.find((c) => c.id === s.wallColors[i]);
    return sw?.isSwatch ? sw.imageUrl : undefined;
  };
  const baseColor = SHOWER_BASE_COLORS.find((c) => c.id === (s.baseColor ?? "white"))?.hex ?? SHOWER_BASE_COLORS[0].hex;
  // Same door resolution the configurator does, so a read-only preview shows the identical
  // schematic rather than a generic pane.
  const doorSeries = s.door ? (s.path === "tub" ? catalog.tubDoors : catalog.doors).find((d) => d.id === s.door!.seriesId) : undefined;
  const doorViz = s.door ? { kind: doorKind(doorSeries?.series), finishHex: DOOR_FINISH_HEX[s.door.finish] ?? "#9aa0a6" } : undefined;
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
  const material = SAMPLE_SHOWER_CATALOG.materials.find((m) => m.id === s.materialId);
  const swatch = material?.colors.find((c) => c.id === s.wallColors[0]);
  if (!swatch?.imageUrl) return null;
  return { id: swatch.id, name: swatch.name, style: swatch.style, imageUrl: swatch.imageUrl };
}
