"use client";

/**
 * Kitify — Vanity + Countertop Configurator (reusable module).
 * Images: plain <img> from /public. Each tile falls back to the hex swatch or
 * drawn motif if its file is missing, so partial image sets never break the UI.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { RotateCcw, Droplet } from "lucide-react";
import { VANITY_SIZES } from "@/lib/catalog";
import { useLanguage } from "@/components/LanguageContext";

// Price-line display text is resolved at render (never stored) so a quote saved in
// one language reads correctly when reopened in another. See lib/i18n.ts.
type Tr = (key: string, vars?: Record<string, string>) => string;
const priceLineText = (t: Tr, l: PriceLine): string => t(l.key, l.params);

export type Mount = "floor" | "floating";
// Faucet drilling in the countertop — a physical constraint the plumbing faucet follows.
export type Drilling = "1cc" | "8cc";
// Basin shape shown in the line drawing (sinks are white only — no color choice).
export type SinkShape = "oval" | "rectangle";
export type DoorStyle = { id: string; name: string; motif: "slab" | "shaker" | "slimshaker" | "raised" | "glass"; group: string };
export type Swatch = { id: string; name: string; hex: string };
/**
 * Backsplash: which edges get one, and how tall.
 *
 * `heightIn` is the standard 4" or the taller 6". "None" isn't a height — it's all three
 * edges off — so the picker maps None onto clearing the sides and leaves the last height in
 * place, which is what lets a dealer toggle a splash off and back on without re-choosing it.
 * Optional so a quote saved before heights existed still loads; readers fall back to 4".
 */
export type Backsplash = { back: boolean; left: boolean; right: boolean; heightIn?: SplashHeight };
export type SplashHeight = 4 | 6;
export const SPLASH_HEIGHTS: SplashHeight[] = [4, 6];
export const DEFAULT_SPLASH_HEIGHT: SplashHeight = 4;
/** Any edge on = there is a splash. Single place the "None" state is defined. */
export const hasSplash = (b: Backsplash): boolean => b.back || b.left || b.right;
export const splashHeight = (b: Backsplash): SplashHeight => b.heightIn ?? DEFAULT_SPLASH_HEIGHT;

// Cabinet face layout types
export type FaceSection =
  | { kind: "drawer-over-door"; doors: 1 | 2 }
  | { kind: "drawer-stack"; drawers: number }
  | { kind: "door"; doors: 1 | 2 };

export type FaceLayout = { sections: { section: FaceSection; widthRatio: number }[] };

export type VanityCatalog = {
  sizes: number[];
  doorStyles: DoorStyle[];
  colors: Swatch[];
  topColors: Swatch[];
  pricing: {
    sizeBase: Record<number, number>;
    topBaseBySize: Record<number, number>;
    floatingAdder: number;
    secondSinkAdder: number;
    splashSideAdder: number;
  };
  faceLayoutBySize?: Record<number, FaceLayout>;
};

// --- Image maps: catalog id -> exact file in /public (case + spelling matter) ---
const DOOR_STYLE_IMAGES: Record<string, string> = {
  "slab-100": "/doors/slab-100.jpg",
  "shaker-100": "/doors/shaker-100.jpg",
  "shaker-150": "/doors/shaker-150.jpg",
  "shaker-200": "/doors/shaker-200.jpg",
  "shaker-250": "/doors/shaker-250.jpg",
  "shaker-300": "/doors/shaker-300.jpg",
  "shaker-350": "/doors/shaker-350.jpg",
  "shaker-600": "/doors/shaker-600.jpg",
  "shaker-750": "/doors/shaker-750.jpg",
  "slim-shaker": "/doors/slim-shaker.jpg",
  "classic-100": "/doors/classic-100.jpg",
  "classic-400": "/doors/classic-400.jpg",
  "classic-500": "/doors/classic-500.jpg",
  "classic-550": "/doors/classic-550.jpg",
  "glass-insert": "/doors/glass-placement.jpg",
};

const COLOR_IMAGES: Record<string, string> = {
  "alkoren-calvados": "/finishes/alkoren-calvados.jpg",
  "antique-white": "/finishes/antique-white.jpg",
  "aria": "/finishes/Aria.jpg",
  "baroque": "/finishes/baroque.jpg",
  "marseille": "/finishes/marseille.jpg",
  "majestic-walnut": "/finishes/majestic-walnut.jpg",
  "chocolate-pear": "/finishes/chocolate-pear.jpg",
  "columbia-walnut": "/finishes/columbia-walnut.jpg",
  "covaren-amati": "/finishes/covaren-amati.jpg",
  "diva-2": "/finishes/diva-2.jpg",
  "glacier-white": "/finishes/glacier-white.jpg",
  "high-gloss-white": "/finishes/high-gloss-white.jpg",
  "lausanne-pc": "/finishes/lausanne-pc.jpg",
  "saarinen-driftwood": "/finishes/saarinen-driftwood.jpg",
  "riviera-oak-nizza": "/finishes/riviera-oak-nizza.jpg",
  "oak-dark-grey": "/finishes/oak-dark-grey.jpg",
  "portuna-1": "/finishes/portuna-1.jpg",
  "portuna-2": "/finishes/portuna-2.jpg",
  "swiss-elm-dark": "/finishes/swiss-elm-dark.jpg",
  "celadon-green": "/finishes/celadon-green-super-matte.jpg",
  "matte-steele": "/finishes/matte-steele.jpg",
  "matte-white-pcc": "/finishes/matte-white-pcc.jpg",
  "natural-maple": "/finishes/natural-maple.jpg",
  "perfect-touch-graphite": "/finishes/perfect-touch-graphite.jpg",
  "folkstone-gray": "/finishes/solid-folkstone-gray.jpg",
  "solid-moonlight": "/finishes/solid-moonlight.jpg",
  "solid-opti-gray": "/finishes/solid-opti-gray.jpg",
  "sphera-ash": "/finishes/sphera-super-matte-ash.jpg",
  "sphera-cloud": "/finishes/sphera-super-matte-cloud.jpg",
  "sphera-flagstone": "/finishes/sphera-super-matte-flagstone.jpg",
  "sphera-jet-black": "/finishes/sphera-super-matte-bet-black.jpg",
  "sphera-plomo": "/finishes/sphera-super-matte-plomo.jpg",
  "sphera-woodsmoke": "/finishes/sphera-super-matte-woodsmoke.jpg",
  "sphera-bone": "/finishes/sphera-super-matte-bone.jpg",
  "sphera-birch": "/finishes/sphera-super-matte-birch.jpg",
  "sphera-umber": "/finishes/sphera-super-matte-umber.jpg",
  "umbra": "/finishes/umbra-super-matte.jpg",
  "wenge": "/finishes/wenge.jpg",
  "white-ash": "/finishes/white-ash.jpg",
  "zinc-plate": "/finishes/zinc-plate.jpg",
  "honey-maple": "/finishes/honey-maple.jpg",
  "verismo": "/finishes/verismo.jpg",
  // No file yet (fall back to hex): eggshell-frosty-rooster, charleston-oak
};

// Durasein tops — add files to /public/tops named by id, then list them here.
const TOP_IMAGES: Record<string, string> = {};

export type VanitySelections = {
  mount?: Mount;
  size?: number;
  doorStyleId?: string;
  colorId?: string;
  topColorId?: string;
  sinks: 1 | 2;
  drilling: Drilling;
  sinkShape: SinkShape;
  backsplash: Backsplash;
};

// A price line carries a dictionary key + interpolation params rather than a finished
// string, so it renders in the viewer's current language, not the language it was built in.
export type PriceLine = { key: string; params?: Record<string, string>; amount: number };
export type VanityMedia = { doorImage?: string; finishImage?: string; topImage?: string; swatchHex?: string };
export type VanityConfig = {
  selections: VanitySelections;
  // Self-reported imagery so consumers never need to know where image files live.
  // (Kept for the future AI render pipeline; the hub now draws the live SVG preview.)
  media?: VanityMedia;
  price: { total: number; lines: PriceLine[] };
  isComplete: boolean;
  label: string;
};

export const SAMPLE_VANITY_CATALOG: VanityCatalog = {
  sizes: VANITY_SIZES,
  doorStyles: [
    { id: "slab-100", name: "Slab 100", motif: "slab", group: "Slab" },
    { id: "shaker-100", name: "Shaker 100", motif: "shaker", group: "Shaker" },
    { id: "shaker-150", name: "Shaker 150", motif: "shaker", group: "Shaker" },
    { id: "shaker-200", name: "Shaker 200", motif: "shaker", group: "Shaker" },
    { id: "shaker-250", name: "Shaker 250", motif: "shaker", group: "Shaker" },
    { id: "shaker-300", name: "Shaker 300", motif: "shaker", group: "Shaker" },
    { id: "shaker-350", name: "Shaker 350", motif: "shaker", group: "Shaker" },
    { id: "shaker-600", name: "Shaker 600", motif: "shaker", group: "Shaker" },
    { id: "shaker-750", name: "Shaker 750", motif: "shaker", group: "Shaker" },
    { id: "slim-shaker", name: "Slim Shaker", motif: "slimshaker", group: "Slim Shaker" },
    { id: "classic-100", name: "Classic 100", motif: "raised", group: "Classic" },
    { id: "classic-400", name: "Classic 400", motif: "raised", group: "Classic" },
    { id: "classic-500", name: "Classic 500", motif: "raised", group: "Classic" },
    { id: "classic-550", name: "Classic 550", motif: "raised", group: "Classic" },
    { id: "glass-insert", name: "Glass Insert Door", motif: "glass", group: "Glass" },
  ],
  colors: [
    { id: "alkoren-calvados", name: "Alkoren Calvados", hex: "#b0824a" },
    { id: "antique-white", name: "Antique White", hex: "#ece4d2" },
    { id: "aria", name: "Aria", hex: "#cdc4b4" },
    { id: "baroque", name: "Baroque", hex: "#6d4a30" },
    { id: "marseille", name: "Marseille", hex: "#b58f5c" },
    { id: "majestic-walnut", name: "Majestic Walnut", hex: "#5b3f2a" },
    { id: "chocolate-pear", name: "Chocolate Pear", hex: "#4a3524" },
    { id: "columbia-walnut", name: "Columbia Walnut", hex: "#6a4630" },
    { id: "covaren-amati", name: "Covaren Amati", hex: "#7d5a3a" },
    { id: "diva-2", name: "Diva 2", hex: "#8f8b86" },
    { id: "glacier-white", name: "Glacier White", hex: "#f2f2ef" },
    { id: "high-gloss-white", name: "High Gloss White", hex: "#f7f7f5" },
    { id: "lausanne-pc", name: "Lausanne PC", hex: "#c3a982" },
    { id: "eggshell-frosty-rooster", name: "Eggshell Frosty Rooster", hex: "#eae6da" },
    { id: "saarinen-driftwood", name: "Saarinen Driftwood", hex: "#a99e8c" },
    { id: "riviera-oak-nizza", name: "Riviera Oak Nizza", hex: "#c9b183" },
    { id: "oak-dark-grey", name: "Oak Dark Grey", hex: "#6f6a63" },
    { id: "portuna-1", name: "Portuna 1", hex: "#b89a72" },
    { id: "portuna-2", name: "Portuna 2", hex: "#a68455" },
    { id: "swiss-elm-dark", name: "Swiss Elm Dark", hex: "#5f4a34" },
    { id: "celadon-green", name: "Celadon Green Super Matte", hex: "#aebfa6" },
    { id: "matte-steele", name: "Matte Steele", hex: "#7c8085" },
    { id: "matte-white-pcc", name: "Matte White PCC", hex: "#eef0ee" },
    { id: "natural-maple", name: "Natural Maple", hex: "#d8c4a0" },
    { id: "perfect-touch-graphite", name: "Perfect Touch Graphite", hex: "#3d4044" },
    { id: "folkstone-gray", name: "Solid Folkstone Gray", hex: "#9a958c" },
    { id: "solid-moonlight", name: "Solid Moonlight", hex: "#e2e2df" },
    { id: "solid-opti-gray", name: "Solid Opti Gray", hex: "#b6b5b0" },
    { id: "sphera-ash", name: "Sphera Super Matte Ash", hex: "#c9c6bf" },
    { id: "sphera-cloud", name: "Sphera Super Matte Cloud", hex: "#dcdad4" },
    { id: "sphera-flagstone", name: "Sphera Super Matte Flagstone", hex: "#8f8c85" },
    { id: "sphera-jet-black", name: "Sphera Super Matte Bet Black", hex: "#232427" },
    { id: "sphera-plomo", name: "Sphera Super Matte Plomo", hex: "#6e6f70" },
    { id: "sphera-woodsmoke", name: "Sphera Super Matte Woodsmoke", hex: "#3f4145" },
    { id: "sphera-bone", name: "Sphera Super Matte Bone", hex: "#e6e0d3" },
    { id: "sphera-birch", name: "Sphera Super Matte Birch", hex: "#d8cbb2" },
    { id: "sphera-umber", name: "Sphera Super Matte Umber", hex: "#6b5842" },
    { id: "umbra", name: "Umbra Super Matte", hex: "#4f4b45" },
    { id: "wenge", name: "Wenge", hex: "#3a2c22" },
    { id: "white-ash", name: "White Ash", hex: "#ddd7c9" },
    { id: "zinc-plate", name: "Zinc Plate", hex: "#8e9498" },
    { id: "honey-maple", name: "Honey Maple", hex: "#ca9a5a" },
    { id: "verismo", name: "Verismo", hex: "#9a8b76" },
    { id: "charleston-oak", name: "Charleston Oak", hex: "#b99a6b" },
  ],
  topColors: [
    { id: "arctic-white", name: "Arctic White", hex: "#f4f4f1" },
    { id: "bone", name: "Bone", hex: "#ece6d9" },
    { id: "chez-linen", name: "Chez Linen", hex: "#ddd5c4" },
    { id: "essence", name: "Essence", hex: "#e8e4db" },
    { id: "ever-after", name: "Ever After", hex: "#ece8e0" },
    { id: "euphoria", name: "Euphoria", hex: "#e3e0d9" },
    { id: "bianca-sabbia", name: "Bianca Sabbia", hex: "#e7e2d6" },
    { id: "blossoming", name: "Blossoming", hex: "#e5ddd9" },
    { id: "bella-vista", name: "Bella Vista", hex: "#d8d5cd" },
    { id: "cumberland", name: "Cumberland", hex: "#bdb8ad" },
    { id: "concrete", name: "Concrete", hex: "#b3afa8" },
    { id: "bellingham-grey", name: "Bellingham Grey", hex: "#a9a7a0" },
    { id: "boardwalk", name: "Boardwalk", hex: "#b6a892" },
    { id: "barnwood", name: "Barnwood", hex: "#9a7b57" },
    { id: "coastal", name: "Coastal", hex: "#cdd4d2" },
    { id: "eventide", name: "Eventide", hex: "#6f7681" },
    { id: "bliss-blue", name: "Bliss Blue", hex: "#7d9bb0" },
    { id: "coal", name: "Coal", hex: "#2f3033" },
    { id: "cheerful-yellow", name: "Cheerful Yellow", hex: "#e6cf7a" },
    { id: "energy-orange", name: "Energy Orange", hex: "#d98a4e" },
  ],
  // PLACEHOLDER PRICING — all values nominal ($1). Real pricing to be loaded from
  // supplier spreadsheets. Do not ship to dealers with these values.
  pricing: {
    sizeBase: { 18: 1, 24: 1, 30: 1, 36: 1, 42: 1, 48: 1, 60: 1 },
    topBaseBySize: { 18: 1, 24: 1, 30: 1, 36: 1, 42: 1, 48: 1, 60: 1 },
    floatingAdder: 1,
    secondSinkAdder: 1,
    splashSideAdder: 1,
  },
  faceLayoutBySize: {
    18: { sections: [{ section: { kind: "drawer-over-door", doors: 1 }, widthRatio: 1 }] },
    24: { sections: [{ section: { kind: "drawer-over-door", doors: 1 }, widthRatio: 1 }] },
    30: { sections: [{ section: { kind: "drawer-over-door", doors: 1 }, widthRatio: 1 }] },
    36: { sections: [{ section: { kind: "drawer-over-door", doors: 2 }, widthRatio: 1 }] },
    42: { sections: [{ section: { kind: "drawer-over-door", doors: 2 }, widthRatio: 1 }] },
    48: {
      sections: [
        { section: { kind: "door", doors: 1 }, widthRatio: 0.12 },
        { section: { kind: "drawer-stack", drawers: 3 }, widthRatio: 0.24 },
        { section: { kind: "door", doors: 1 }, widthRatio: 0.14 },
        { section: { kind: "door", doors: 1 }, widthRatio: 0.12 },
        { section: { kind: "drawer-stack", drawers: 3 }, widthRatio: 0.24 },
        { section: { kind: "door", doors: 1 }, widthRatio: 0.14 },
      ],
    },
    60: {
      sections: [
        { section: { kind: "door", doors: 1 }, widthRatio: 0.12 },
        { section: { kind: "drawer-stack", drawers: 3 }, widthRatio: 0.26 },
        { section: { kind: "door", doors: 1 }, widthRatio: 0.12 },
        { section: { kind: "door", doors: 1 }, widthRatio: 0.12 },
        { section: { kind: "drawer-stack", drawers: 3 }, widthRatio: 0.26 },
        { section: { kind: "door", doors: 1 }, widthRatio: 0.12 },
      ],
    },
  },
};

export function sinkOptions(size?: number): (1 | 2)[] {
  return size != null && size >= 48 ? [1, 2] : [1];
}
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function computePrice(catalog: VanityCatalog, s: VanitySelections): { total: number; lines: PriceLine[] } {
  const lines: PriceLine[] = [];
  if (s.size == null) return { total: 0, lines };
  const base = catalog.pricing.sizeBase[s.size] ?? 0;
  lines.push({ key: "configurator.priceLine.cabinet", params: { size: String(s.size) }, amount: base });
  if (s.mount === "floating") lines.push({ key: "configurator.priceLine.floatingMount", amount: catalog.pricing.floatingAdder });
  const top = catalog.pricing.topBaseBySize[s.size] ?? 0;
  lines.push({ key: "configurator.priceLine.countertop", amount: top });
  if (s.sinks === 2) lines.push({ key: "configurator.priceLine.secondSink", amount: catalog.pricing.secondSinkAdder });
  const extraSides = (s.backsplash.left ? 1 : 0) + (s.backsplash.right ? 1 : 0);
  if (extraSides > 0) lines.push({ key: extraSides > 1 ? "configurator.priceLine.backsplashMany" : "configurator.priceLine.backsplashOne", params: { n: String(extraSides) }, amount: extraSides * catalog.pricing.splashSideAdder });
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return { total, lines };
}
export function isComplete(s: VanitySelections): boolean {
  return !!(s.mount && s.size != null && s.doorStyleId && s.colorId && s.topColorId);
}
function buildLabel(catalog: VanityCatalog, s: VanitySelections, t: Tr): string {
  if (s.size == null) return t("configurator.label.newVanity");
  const style = catalog.doorStyles.find((d) => d.id === s.doorStyleId)?.name ?? "";
  const color = catalog.colors.find((c) => c.id === s.colorId)?.name ?? "";
  const mount = s.mount === "floating" ? t("configurator.label.floating") : t("configurator.label.floorMount");
  return `${s.size}" ${mount} ${style}${color ? " · " + color : ""}${s.sinks === 2 ? " · " + t("configurator.label.doubleSink") : ""} · ${s.drilling}`.trim();
}
// Self-reported imagery: pull file paths from the module's own image maps for the
// current selections, and carry the finish's hex as a fallback swatch.
function buildVanityMedia(catalog: VanityCatalog, s: VanitySelections): VanityMedia {
  return {
    doorImage: s.doorStyleId ? DOOR_STYLE_IMAGES[s.doorStyleId] : undefined,
    finishImage: s.colorId ? COLOR_IMAGES[s.colorId] : undefined,
    topImage: s.topColorId ? TOP_IMAGES[s.topColorId] : undefined,
    swatchHex: catalog.colors.find((c) => c.id === s.colorId)?.hex,
  };
}

const initial: VanitySelections = { sinks: 1, drilling: "1cc", sinkShape: "oval", backsplash: { back: true, left: false, right: false, heightIn: DEFAULT_SPLASH_HEIGHT } };

export function VanityConfigurator({
  catalog = SAMPLE_VANITY_CATALOG,
  mode = "dealer",
  onComplete,
  onChange,
  onPreview,
  initialSize,
  initialSinks,
  initialDrilling,
  initialSinkShape,
  primaryLabel,
}: {
  catalog?: VanityCatalog;
  mode?: "dealer" | "customer";
  onComplete?: (config: VanityConfig) => void;
  onChange?: (shared: { size: number; sinks: 1 | 2; drilling: Drilling; sinkShape: SinkShape } | null) => void;
  /**
   * The whole in-progress config, on every change — see the matching prop on
   * ShowerConfigurator. For consumers that display the selection (the hub's hero preview)
   * rather than act on it. May be incomplete; `isComplete` says so.
   */
  onPreview?: (config: VanityConfig) => void;
  initialSize?: number;
  initialSinks?: 1 | 2;
  initialDrilling?: Drilling;
  initialSinkShape?: SinkShape;
  primaryLabel?: string;
}) {
  const [s, setS] = useState<VanitySelections>(() => {
    const base: VanitySelections = { ...initial, drilling: initialDrilling ?? initial.drilling, sinkShape: initialSinkShape ?? initial.sinkShape };
    if (initialSize == null) return base;
    const valid = sinkOptions(initialSize);
    const sinks: 1 | 2 = initialSinks && valid.includes(initialSinks) ? initialSinks : 1;
    // Seed a default floor mount so the seeded size is immediately active/visible.
    return { ...base, mount: "floor", size: initialSize, sinks };
  });
  const { t } = useLanguage();
  const price = useMemo(() => computePrice(catalog, s), [catalog, s]);
  const complete = isComplete(s);
  const set = (patch: Partial<VanitySelections>) => setS((prev) => ({ ...prev, ...patch }));

  // Report the current cabinet size/sinks/drilling/sink-shape to the hub whenever they change (last-edit-wins).
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  useEffect(() => { if (s.size != null) onChangeRef.current?.({ size: s.size, sinks: s.sinks, drilling: s.drilling, sinkShape: s.sinkShape }); }, [s.size, s.sinks, s.drilling, s.sinkShape]);

  // Live config for preview consumers. `t` is intentionally not a dependency — see the same
  // effect in ShowerConfigurator.
  const onPreviewRef = useRef(onPreview); onPreviewRef.current = onPreview;
  useEffect(() => {
    onPreviewRef.current?.({ selections: s, media: buildVanityMedia(catalog, s), price, isComplete: isComplete(s), label: buildLabel(catalog, s, t) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, price, catalog]);

  // Adopt a size chosen elsewhere (e.g. placed in the room) even while already
  // mounted — keeping door-style/finish work. No-op once in sync (prevents loops).
  useEffect(() => {
    if (initialSize == null) return;
    setS((prev) => {
      const valid = sinkOptions(initialSize);
      const sinks: 1 | 2 = initialSinks && valid.includes(initialSinks) ? initialSinks : (valid.includes(prev.sinks) ? prev.sinks : 1);
      if (prev.size === initialSize && prev.sinks === sinks) return prev;
      return { ...prev, size: initialSize, sinks, mount: prev.mount ?? "floor" };
    });
  }, [initialSize, initialSinks]);

  // Adopt a drilling chosen upstream (kept consistent with the shared state) — no-op
  // once in sync so it can't loop against the onChange emission.
  useEffect(() => {
    if (initialDrilling == null) return;
    setS((prev) => (prev.drilling === initialDrilling ? prev : { ...prev, drilling: initialDrilling }));
  }, [initialDrilling]);
  // Adopt a sink shape restored from a saved quote, same round-trip pattern as drilling.
  useEffect(() => {
    if (initialSinkShape == null) return;
    setS((prev) => (prev.sinkShape === initialSinkShape ? prev : { ...prev, sinkShape: initialSinkShape }));
  }, [initialSinkShape]);

  const color = catalog.colors.find((c) => c.id === s.colorId)?.hex ?? "#cfc6b6";
  const topColor = catalog.topColors.find((c) => c.id === s.topColorId)?.hex ?? "#eceae5";
  const colorImage = s.colorId ? COLOR_IMAGES[s.colorId] : undefined;
  const topImage = s.topColorId ? TOP_IMAGES[s.topColorId] : undefined;
  const doorStyle = catalog.doorStyles.find((d) => d.id === s.doorStyleId)?.motif ?? "slab";
  const sinkChoices = sinkOptions(s.size);

  function chooseSize(size: number) {
    const valid = sinkOptions(size);
    set({ size, sinks: valid.includes(s.sinks) ? s.sinks : 1 });
  }
  function startOver() { setS(initial); }
  function addToQuote() { if (complete) onComplete?.({ selections: s, media: buildVanityMedia(catalog, s), price, isComplete: true, label: buildLabel(catalog, s, t) }); }

  const locked = s.mount && s.size != null;

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="lg:sticky lg:top-5 lg:self-start">
        <div className="overflow-hidden rounded-2xl border border-line bg-card">
          <VanityPreview mount={s.mount ?? "floor"} size={s.size ?? 30} color={color} topColor={topColor}
            colorImage={colorImage} topImage={topImage} sinks={s.sinks} sinkShape={s.sinkShape} doorStyle={doorStyle} backsplash={s.backsplash} sizes={catalog.sizes} faceLayoutBySize={catalog.faceLayoutBySize} />
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
              {price.lines.length === 0 && <div className="text-xs text-muted">{t("configurator.vanity.pickMountSize")}</div>}
            </div>
            <button onClick={addToQuote} disabled={!complete}
              className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
              {complete ? (primaryLabel ?? t("configurator.addToQuote")) : t("configurator.finishToAdd")}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {!locked ? (
          <>
            <Step n={1} title={t("configurator.vanity.stepMount")}>
              <div className="grid grid-cols-2 gap-2">
                {(["floor", "floating"] as Mount[]).map((m) => (
                  <button key={m} onClick={() => set({ mount: m })}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${s.mount === m ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                    {m === "floor" ? t("configurator.vanity.floorMount") : t("configurator.vanity.floating")}
                  </button>
                ))}
              </div>
            </Step>
            {s.mount && (
              <Step n={2} title={t("configurator.vanity.stepSize")}>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {catalog.sizes.map((sz) => (
                    <button key={sz} onClick={() => chooseSize(sz)}
                      className="rounded-lg border border-line px-2 py-2.5 text-sm font-semibold hover:border-accent hover:bg-accent-soft/40">
                      {sz}"
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">{t("configurator.vanity.lockNote")}</p>
              </Step>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-xl border border-line bg-paper/60 px-4 py-3">
              <span className="text-sm font-semibold">{s.size}" · {s.mount === "floating" ? t("configurator.vanity.floating") : t("configurator.vanity.floorMount")}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.vanity.locked")}</span>
              <button onClick={startOver} className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink">
                <RotateCcw className="h-3.5 w-3.5" /> {t("configurator.startOver")}
              </button>
            </div>

            <Step n={3} title={t("configurator.vanity.stepDoorStyle")}>
              {catalog.doorStyles.reduce((groups, d) => (groups.includes(d.group) ? groups : [...groups, d.group]), [] as string[]).map((g) => (
                <div key={g} className="mb-3 last:mb-0">
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{g}</div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {catalog.doorStyles.filter((d) => d.group === g).map((d) => (
                      <DoorTile key={d.id} d={d} group={g} color={color} selected={s.doorStyleId === d.id} onSelect={() => set({ doorStyleId: d.id })} />
                    ))}
                  </div>
                </div>
              ))}
              <p className="mt-2 text-xs text-muted">{t("configurator.vanity.doorStyleNote")}</p>
            </Step>

            <Step n={4} title={t("configurator.vanity.stepColor")}>
              <SwatchGrid items={catalog.colors} images={COLOR_IMAGES} selected={s.colorId} onSelect={(id) => set({ colorId: id })} />
              <p className="mt-2 text-xs text-muted">{s.colorId ? catalog.colors.find((c) => c.id === s.colorId)?.name : t("configurator.vanity.colorNote")}</p>
            </Step>

            <Step n={5} title={t("configurator.vanity.stepCountertop")} hint={t("configurator.vanity.handoffSeam")}>
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t("configurator.vanity.sinks")}</div>
                  <div className="flex gap-2">
                    {([1, 2] as (1 | 2)[]).map((n) => {
                      const allowed = sinkChoices.includes(n);
                      return (
                        <button key={n} disabled={!allowed} onClick={() => set({ sinks: n })}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition ${s.sinks === n ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"} disabled:cursor-not-allowed disabled:opacity-40`}>
                          <Droplet className="h-3.5 w-3.5" /> {t(n > 1 ? "configurator.vanity.sinkPlural" : "configurator.vanity.sinkSingular", { n: String(n) })}
                        </button>
                      );
                    })}
                    {!sinkChoices.includes(2) && <span className="self-center text-xs text-muted">{t("configurator.vanity.twoSinksOnly")}</span>}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t("configurator.vanity.drilling")}</div>
                  <div className="flex gap-2">
                    {(["1cc", "8cc"] as Drilling[]).map((d) => (
                      <button key={d} onClick={() => set({ drilling: d })}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition ${s.drilling === d ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                        {t(d === "1cc" ? "configurator.vanity.drill1cc" : "configurator.vanity.drill8cc")}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{t("configurator.vanity.drillingNote")}</p>
                </div>
                <div>
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t("configurator.vanity.sinkShape")}</div>
                  <div className="flex gap-2">
                    {(["oval", "rectangle"] as SinkShape[]).map((sh) => (
                      <button key={sh} onClick={() => set({ sinkShape: sh })}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition ${s.sinkShape === sh ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                        {t(sh === "oval" ? "configurator.vanity.sinkOval" : "configurator.vanity.sinkRect")}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{t("configurator.vanity.sinkShapeNote")}</p>
                </div>
                <div>
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t("configurator.vanity.topColorLabel")}</div>
                  <SwatchGrid items={catalog.topColors} images={TOP_IMAGES} selected={s.topColorId} onSelect={(id) => set({ topColorId: id })} />
                  <p className="mt-1.5 text-xs text-muted">{s.topColorId ? catalog.topColors.find((c) => c.id === s.topColorId)?.name : t("configurator.vanity.duraseinNote")}</p>
                </div>
                <div>
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t("configurator.vanity.backsplashLabel")}</div>
                  {/* Height first: None / 4" / 6". None clears every edge; picking a height
                      brings the standard back splash with it, so the row can't land in a state
                      where a height is set but nothing is splashed. */}
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => set({ backsplash: { ...s.backsplash, back: false, left: false, right: false } })}
                      className={`min-h-11 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${!hasSplash(s.backsplash) ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                      {t("configurator.vanity.bsNone")}
                    </button>
                    {SPLASH_HEIGHTS.map((h) => {
                      const on = hasSplash(s.backsplash) && splashHeight(s.backsplash) === h;
                      return (
                        <button key={h} onClick={() => set({ backsplash: { ...s.backsplash, heightIn: h, back: hasSplash(s.backsplash) ? s.backsplash.back : true } })}
                          className={`min-h-11 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${on ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                          {h}&quot;{h === DEFAULT_SPLASH_HEIGHT ? " · " + t("configurator.vanity.std") : ""}
                        </button>
                      );
                    })}
                  </div>
                  {/* Which edges — only meaningful once there IS a splash. */}
                  {hasSplash(s.backsplash) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {([["back", "configurator.vanity.bsBack"], ["left", "configurator.vanity.bsLeft"], ["right", "configurator.vanity.bsRight"]] as [("back" | "left" | "right"), string][]).map(([k, lk]) => (
                        <button key={k} onClick={() => set({ backsplash: { ...s.backsplash, [k]: !s.backsplash[k] } })}
                          className={`min-h-11 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${s.backsplash[k] ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                          {t(lk)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Step>
          </>
        )}
      </div>
    </div>
  );
}

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

function SwatchButton({ c, src, selected, onSelect }: { c: Swatch; src?: string; selected: boolean; onSelect: () => void }) {
  const [err, setErr] = useState(false);
  const ring = selected ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-ink/30";
  const showImg = src && !err;
  return (
    <button onClick={onSelect} title={c.name}
      className={`h-9 w-9 overflow-hidden rounded-full border-2 transition ${ring}`}
      style={showImg ? undefined : { background: c.hex }}>
      {showImg && <img src={src} alt={c.name} className="h-full w-full object-cover" onError={() => setErr(true)} />}
    </button>
  );
}
function SwatchGrid({ items, images, selected, onSelect }: { items: Swatch[]; images: Record<string, string>; selected?: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((c) => (
        <SwatchButton key={c.id} c={c} src={images[c.id]} selected={selected === c.id} onSelect={() => onSelect(c.id)} />
      ))}
    </div>
  );
}

function DoorTile({ d, group, color, selected, onSelect }: { d: DoorStyle; group: string; color: string; selected: boolean; onSelect: () => void }) {
  const [err, setErr] = useState(false);
  const src = DOOR_STYLE_IMAGES[d.id];
  const short = d.name.startsWith(group + " ") ? d.name.slice(group.length + 1) : d.name;
  const showImg = src && !err;
  return (
    <button onClick={onSelect}
      className={`rounded-lg border p-1.5 text-center transition ${selected ? "border-accent bg-accent-soft/40" : "border-line hover:bg-ink/5"}`}>
      {showImg ? (
        <div className="mx-auto mb-1 h-24 w-[72px] overflow-hidden rounded-xl border border-line bg-paper">
          <img src={src} alt={d.name} className="h-full w-full object-cover" onError={() => setErr(true)} />
        </div>
      ) : (
        <svg viewBox="0 0 40 52" className="mx-auto h-12 w-9"><DoorMotif motif={d.motif} color={color} /></svg>
      )}
      <div className="mt-1 truncate text-[10px]">{short}</div>
    </button>
  );
}

function DoorMotif({ motif, color }: { motif: DoorStyle["motif"]; color: string }) {
  return (
    <>
      <rect x="2" y="2" width="36" height="48" rx="2" fill={color} stroke="#00000022" />
      {motif === "shaker" && <rect x="7" y="7" width="26" height="38" rx="1" fill="none" stroke="#00000033" strokeWidth="2" />}
      {motif === "slimshaker" && <rect x="5" y="5" width="30" height="42" rx="1" fill="none" stroke="#00000028" strokeWidth="1.2" />}
      {motif === "raised" && <>
        <rect x="6" y="6" width="28" height="40" rx="1" fill="none" stroke="#00000033" strokeWidth="2" />
        <rect x="11" y="11" width="18" height="30" rx="1" fill="#ffffff18" stroke="#00000022" />
      </>}
      {motif === "glass" && <>
        <rect x="7" y="7" width="26" height="38" rx="1" fill="#cdd8dd55" stroke="#00000033" strokeWidth="1.5" />
        <line x1="20" y1="7" x2="20" y2="45" stroke="#ffffff66" />
        <line x1="7" y1="26" x2="33" y2="26" stroke="#ffffff66" />
      </>}
    </>
  );
}

function VanityPreview({ mount, size, color, topColor, colorImage, topImage, sinks, sinkShape, doorStyle, backsplash, sizes, faceLayoutBySize }: {
  mount: Mount; size: number; color: string; topColor: string; colorImage?: string; topImage?: string; sinks: 1 | 2; sinkShape: SinkShape; doorStyle: DoorStyle["motif"]; backsplash: Backsplash; sizes: number[]; faceLayoutBySize?: Record<number, FaceLayout>;
}) {
  const minS = sizes[0], maxS = sizes[sizes.length - 1];
  const w = 130 + ((size - minS) / (maxS - minS)) * 150;
  const x = (320 - w) / 2;
  const topY = 96, topH = 12;
  const cabTop = topY + topH;
  const floating = mount === "floating";
  const cabH = 108;
  const cabBottom = cabTop + cabH;
  const floorY = 244;

  // Namespace the pattern ids per instance — the hub can mount a second copy of this
  // preview alongside the configurator's, and duplicate ids make url(#…) resolve to the
  // wrong (often hidden, non-painting) pattern, dropping the finish texture.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const finishPatId = `finishPat-${uid}`, topPatId = `topPat-${uid}`;
  const cabFill = colorImage ? `url(#${finishPatId})` : color;
  const topFill = topImage ? `url(#${topPatId})` : topColor;

  const layout = (faceLayoutBySize && faceLayoutBySize[size]) ?? { sections: [{ section: { kind: "drawer-over-door", doors: 1 }, widthRatio: 1 }] };
  const sections = layout.sections;
  const sectionGap = 6;
  const totalGap = sectionGap * (sections.length + 1);
  const availW = Math.max(0, w - totalGap);

  return (
    <svg viewBox="0 0 320 260" className="block w-full bg-paper/40">
      <defs>
        {colorImage && <pattern id={finishPatId} patternContentUnits="objectBoundingBox" width="1" height="1">
          <image href={colorImage} x="0" y="0" width="1" height="1" preserveAspectRatio="xMidYMid slice" />
        </pattern>}
        {topImage && <pattern id={topPatId} patternContentUnits="objectBoundingBox" width="1" height="1">
          <image href={topImage} x="0" y="0" width="1" height="1" preserveAspectRatio="xMidYMid slice" />
        </pattern>}
      </defs>

      {/* Splash height in view units: the drawing kept 26 for the 4" standard, so a 6" reads
          proportionally taller off the same scale rather than off a second magic number. */}
      {(() => {
        const bsH = 26 * (splashHeight(backsplash) / DEFAULT_SPLASH_HEIGHT);
        return (
          <>
            {backsplash.back && <rect x={x - 4} y={topY - bsH} width={w + 8} height={bsH} fill={topFill} stroke="#00000012" />}
            {backsplash.left && <rect x={x - 4} y={topY - bsH} width={6} height={topH + bsH} fill={topFill} stroke="#00000012" />}
            {backsplash.right && <rect x={x + w - 2} y={topY - bsH} width={6} height={topH + bsH} fill={topFill} stroke="#00000012" />}
          </>
        );
      })()}

      {Array.from({ length: sinks }).map((_, i) => {
        const cx = w >= 210 && sinks === 2 ? x + w * (i === 0 ? 0.3 : 0.7) : x + w / 2;
        return <g key={i}><rect x={cx - 2} y={topY - 20} width={4} height={16} rx={2} fill="#b78a3c" /><rect x={cx - 6} y={topY - 22} width={12} height={4} rx={2} fill="#c79a45" /></g>;
      })}

      <rect x={x - 6} y={topY} width={w + 12} height={topH} rx={2} fill={topFill} stroke="#00000018" />

      {/* Basin(s) on the counter — one per sink, oval or rounded-rectangle per sinkShape.
          White fill only; shape shows in the line drawing (the product photo does not). */}
      {Array.from({ length: sinks }).map((_, i) => {
        const cx = w >= 210 && sinks === 2 ? x + w * (i === 0 ? 0.3 : 0.7) : x + w / 2;
        const cy = topY + topH / 2, rx = Math.min(w * 0.13, 26), ry = 5;
        return sinkShape === "rectangle"
          ? <rect key={`basin${i}`} x={cx - rx} y={cy - ry} width={rx * 2} height={ry * 2} rx={2.5} fill="#fff" stroke="#00000040" strokeWidth={1} pointerEvents="none" />
          : <ellipse key={`basin${i}`} cx={cx} cy={cy} rx={rx} ry={ry} fill="#fff" stroke="#00000040" strokeWidth={1} pointerEvents="none" />;
      })}

      {/* Cabinet body */}
      <rect x={x} y={cabTop} width={w} height={cabH} rx={3} fill={cabFill} stroke="#00000022" />

      {/* Sections */}
      {(() => {
        let acc = 0;
        return sections.map((seg, si) => {
          const secW = seg.widthRatio * availW;
          const sx = x + sectionGap + acc + sectionGap * si;
          acc += secW;
          const innerPad = 6;
          const contentX = sx;
          const contentW = secW;
          const contentY = cabTop + 6;
          const contentH = cabH - 12;

          if (seg.section.kind === "drawer-over-door") {
            const drawerH = Math.max(8, Math.round(contentH * 0.2));
            const drawerY = contentY;
            const doorY = drawerY + drawerH + 4;
            const doorH = contentH - drawerH - 4;
            // drawer
            const drawX = contentX;
            const drawW = contentW;
            // doors
            if (seg.section.doors === 1) {
              return (
                <g key={si}>
                  <rect x={drawX} y={drawerY} width={drawW} height={drawerH} rx={2} fill={cabFill} stroke="#00000018" />
                  {/* drawer pull */}
                  <rect x={drawX + drawW / 2 - 12} y={drawerY + drawerH / 2 - 4} width={24} height={6} rx={3} fill="#00000033" />
                  <rect x={contentX} y={doorY} width={contentW} height={doorH} rx={2} fill={cabFill} stroke="#00000022" />
                  <g transform={`translate(${contentX},${doorY}) scale(${contentW/40},${doorH/52})`}>
                    <DoorMotif motif={doorStyle} color="none" />
                  </g>
                  <circle cx={contentX + contentW - 8} cy={doorY + doorH / 2} r={2} fill="#00000055" />
                </g>
              );
            } else {
              const innerGap = 6;
              const eachW = Math.max(0, (contentW - innerGap) / 2);
              return (
                <g key={si}>
                  <rect x={drawX} y={drawerY} width={drawW} height={drawerH} rx={2} fill={cabFill} stroke="#00000018" />
                  <rect x={drawX + drawW / 2 - 12} y={drawerY + drawerH / 2 - 4} width={24} height={6} rx={3} fill="#00000033" />
                  <rect x={contentX} y={doorY} width={eachW} height={doorH} rx={2} fill={cabFill} stroke="#00000022" />
                  <rect x={contentX + eachW + innerGap} y={doorY} width={eachW} height={doorH} rx={2} fill={cabFill} stroke="#00000022" />
                  <g transform={`translate(${contentX},${doorY}) scale(${eachW/40},${doorH/52})`}>
                    <DoorMotif motif={doorStyle} color="none" />
                  </g>
                  <g transform={`translate(${contentX + eachW + innerGap},${doorY}) scale(${eachW/40},${doorH/52})`}>
                    <DoorMotif motif={doorStyle} color="none" />
                  </g>
                  <circle cx={contentX + eachW - 8} cy={doorY + doorH / 2} r={2} fill="#00000055" />
                  <circle cx={contentX + eachW + innerGap + eachW - 8} cy={doorY + doorH / 2} r={2} fill="#00000055" />
                </g>
              );
            }
          }

          if (seg.section.kind === "drawer-stack") {
            const n = Math.max(1, seg.section.drawers);
            const drawerH = (contentH - (n - 1) * 4) / n;
            const drawers = Array.from({ length: n }).map((_, di) => {
              const y = contentY + di * (drawerH + 4);
              return (
                <g key={di}>
                  <rect x={contentX} y={y} width={contentW} height={drawerH} rx={2} fill={cabFill} stroke="#00000018" />
                  <rect x={contentX + contentW / 2 - 12} y={y + drawerH / 2 - 4} width={24} height={6} rx={3} fill="#00000033" />
                </g>
              );
            });
            return <g key={si}>{drawers}</g>;
          }

          // door only
          if (seg.section.kind === "door") {
            if (seg.section.doors === 1) {
              return (
                <g key={si}>
                  <rect x={contentX} y={contentY} width={contentW} height={contentH} rx={2} fill={cabFill} stroke="#00000022" />
                  <g transform={`translate(${contentX},${contentY}) scale(${contentW/40},${contentH/52})`}>
                    <DoorMotif motif={doorStyle} color="none" />
                  </g>
                  <circle cx={contentX + contentW - 8} cy={contentY + contentH / 2} r={2} fill="#00000055" />
                </g>
              );
            } else {
              const innerGap = 6;
              const eachW = Math.max(0, (contentW - innerGap) / 2);
              return (
                <g key={si}>
                  <rect x={contentX} y={contentY} width={eachW} height={contentH} rx={2} fill={cabFill} stroke="#00000022" />
                  <rect x={contentX + eachW + innerGap} y={contentY} width={eachW} height={contentH} rx={2} fill={cabFill} stroke="#00000022" />
                  <g transform={`translate(${contentX},${contentY}) scale(${eachW/40},${contentH/52})`}>
                    <DoorMotif motif={doorStyle} color="none" />
                  </g>
                  <g transform={`translate(${contentX + eachW + innerGap},${contentY}) scale(${eachW/40},${contentH/52})`}>
                    <DoorMotif motif={doorStyle} color="none" />
                  </g>
                  <circle cx={contentX + eachW - 8} cy={contentY + contentH / 2} r={2} fill="#00000055" />
                  <circle cx={contentX + eachW + innerGap + eachW - 8} cy={contentY + contentH / 2} r={2} fill="#00000055" />
                </g>
              );
            }
          }
          return null;
        });
      })()}

      {floating
        ? <rect x={x + 8} y={cabBottom + 3} width={w - 16} height={5} rx={2} fill="#00000018" />
        : <><rect x={x + 6} y={cabBottom} width={w - 12} height={floorY - cabBottom} fill={cabFill} opacity={0.9} /><line x1={x - 10} y1={floorY} x2={x + w + 10} y2={floorY} stroke="#00000022" strokeWidth={2} /></>}
    </svg>
  );
}

/**
 * Read-only wrapper: renders the exact same VanityPreview as the configurator, driven
 * by an emitted config. Same single-source-of-truth rule as RoomPlanSVG — no drawing
 * logic is duplicated, only the small config → preview-props mapping the module already
 * does internally. Inert (pointer-events disabled) so it never intercepts clicks.
 */
export function VanityPreviewFromConfig({ config, className }: { config: VanityConfig; className?: string }) {
  const catalog = SAMPLE_VANITY_CATALOG;
  const s = config.selections;
  const color = catalog.colors.find((c) => c.id === s.colorId)?.hex ?? "#cfc6b6";
  const topColor = catalog.topColors.find((c) => c.id === s.topColorId)?.hex ?? "#eceae5";
  const colorImage = s.colorId ? COLOR_IMAGES[s.colorId] : undefined;
  const topImage = s.topColorId ? TOP_IMAGES[s.topColorId] : undefined;
  const doorStyle = catalog.doorStyles.find((d) => d.id === s.doorStyleId)?.motif ?? "slab";
  return (
    <div className={className} style={{ pointerEvents: "none" }}>
      <VanityPreview mount={s.mount ?? "floor"} size={s.size ?? 30} color={color} topColor={topColor}
        colorImage={colorImage} topImage={topImage} sinks={s.sinks} sinkShape={s.sinkShape ?? "oval"} doorStyle={doorStyle}
        backsplash={s.backsplash} sizes={catalog.sizes} faceLayoutBySize={catalog.faceLayoutBySize} />
    </div>
  );
}
