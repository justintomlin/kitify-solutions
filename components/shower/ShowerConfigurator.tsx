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
 * PLACEHOLDER (flagged): SPC/HPL/Solid-Surface wall palettes (seeded with the 6 real
 * NuVo composite colors as a stand-in) and wall-kit pricing.
 * Drain options are data-driven per size (L/R/Center aren't offered on every size).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, RotateCcw, Plus, Minus, DoorOpen, Square } from "lucide-react";
import { SHOWER_BASES, TUBS as CATALOG_TUBS, SHOWER_BASE_COLORS, type BaseSku } from "@/lib/catalog";
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
export type Swatch = { id: string; name: string; hex: string };

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
    { id: "hpl", name: "HPL", tier: "Better", kitPrice: 1, colors: NUVO_COLORS },
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
  return `${item.label} ${kind}${drain ? " · " + drain : ""}${walls ? " · " + walls : ""}`.trim();
}
// Self-reported imagery. This module ships no product image files yet — only colour
// swatches — so image fields stay undefined and swatchHex carries the wall (or base)
// colour for the consumer to render a colour chip. No image paths are invented.
function buildShowerMedia(catalog: ShowerCatalog, s: ShowerSelections): ShowerMedia {
  const material = catalog.materials.find((m) => m.id === s.materialId);
  const palette = material?.colors ?? NUVO_COLORS;
  const wallHex = palette.find((c) => c.id === s.wallColors[0])?.hex;
  const item = itemsForPath(catalog, s.path).find((b) => b.id === s.baseId);
  const baseHex = item?.colors.find((c) => c.id === s.baseColorId)?.hex;
  return { wallImage: undefined, baseImage: undefined, doorImage: undefined, swatchHex: wallHex ?? baseHex };
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

  function choosePath(p: Path) { setS({ ...initial, path: p }); }
  function chooseBase(id: string) {
    const it = items.find((b) => b.id === id);
    const drain = it && it.drains.length === 1 ? it.drains[0] : undefined;
    set({ baseId: id, drain, baseColorId: it?.colors[0]?.id, door: null });
  }
  function setWall(i: number, colorId: string) {
    const next = [...s.wallColors]; next[i] = colorId; set({ wallColors: next });
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
            hasDoor={!!s.door} niche={s.accessories.niche.qty > 0} shelf={s.accessories.cornerShelf.qty > 0} bar={s.accessories.grabBar.qty > 0} />
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
                <button key={m.id} onClick={() => set({ materialId: m.id })}
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
          <Step n={5} title={t("configurator.shower.stepWallColors")}>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs text-muted">{t("configurator.shower.quickFill")}</span>
              {palette.map((c) => (
                <button key={c.id} onClick={() => setAllWalls(c.id)} title={t("configurator.shower.allWalls", { name: c.name })}
                  className="h-6 w-6 rounded-full border border-line hover:border-ink/40" style={{ background: c.hex }} />
              ))}
            </div>
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t(["configurator.shower.wallBack", "configurator.shower.wallLeft", "configurator.shower.wallRight"][i])}</span>
                    <span className="text-xs">{palette.find((c) => c.id === s.wallColors[i])?.name ?? "—"}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {palette.map((c) => (
                      <button key={c.id} onClick={() => setWall(i, c.id)} title={c.name}
                        className={`h-8 w-8 rounded-full border-2 transition ${s.wallColors[i] === c.id ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-ink/30"}`}
                        style={{ background: c.hex }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
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

// --------------------------- Live preview ---------------------------------
function ShowerPreview({ path, back, left, right, baseColor, hasDoor, niche, shelf, bar }: {
  path?: Path; back: string; left: string; right: string; baseColor: string; hasDoor: boolean; niche: boolean; shelf: boolean; bar: boolean;
}) {
  return (
    <svg viewBox="0 0 320 240" className="block w-full bg-paper/40">
      {/* left side wall */}
      <polygon points="0,18 70,44 70,196 0,222" fill={left} />
      {/* back wall */}
      <rect x="70" y="44" width="180" height="152" fill={back} />
      {/* right side wall */}
      <polygon points="250,44 320,18 320,222 250,196" fill={right} />
      <polygon points="250,44 320,18 320,222 250,196" fill="#000" opacity="0.08" />
      {/* niche on back wall */}
      {niche && <rect x="150" y="80" width="46" height="34" rx="2" fill="#00000022" stroke="#0000002a" />}
      {/* grab bar on back wall */}
      {bar && <rect x="95" y="150" width="70" height="6" rx="3" fill="#9a9ea1" />}
      {/* corner shelf (left-back corner) */}
      {shelf && <polygon points="70,120 92,124 70,136" fill="#c7c9c9" stroke="#00000022" />}
      {/* base or tub */}
      {path === "tub"
        ? <><rect x="60" y="196" width="200" height="30" rx="8" fill={baseColor} stroke="#00000022" /><rect x="60" y="196" width="200" height="8" fill="#00000010" /></>
        : <polygon points="70,196 250,196 264,224 56,224" fill={baseColor} stroke="#00000022" />}
      {/* door glass */}
      {hasDoor && <><rect x="52" y="120" width="216" height="104" rx="3" fill="#cdd8dd" opacity="0.35" stroke="#8fa0a8" strokeWidth="2" /><line x1="160" y1="120" x2="160" y2="224" stroke="#8fa0a8" strokeWidth="2" opacity="0.6" /></>}
    </svg>
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
  const baseColor = SHOWER_BASE_COLORS.find((c) => c.id === (s.baseColor ?? "white"))?.hex ?? SHOWER_BASE_COLORS[0].hex;
  return (
    <div className={className} style={{ pointerEvents: "none" }}>
      <ShowerPreview path={s.path} back={wallHex(0)} left={wallHex(1)} right={wallHex(2)} baseColor={baseColor}
        hasDoor={!!s.door} niche={s.accessories.niche.qty > 0} shelf={s.accessories.cornerShelf.qty > 0} bar={s.accessories.grabBar.qty > 0} />
    </div>
  );
}
