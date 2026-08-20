"use client";

/**
 * HeroPreview — the hero bathroom compositor, driven by a set of saved configurator configs.
 *
 * HeroCompositor takes resolved inputs (a texture URL, a hex, a product photo). This turns
 * the four module configs into those inputs, so every surface that holds a quote — the
 * configurator hub, a public proposal, a project's quote list, an order — renders the same
 * picture from the same rule, rather than each one re-deriving it slightly differently.
 *
 * WHY NOTHING IS STORED
 * The obvious approach is to snapshot the rendered canvas into the quote. It cannot work
 * here: the compositor draws textures from third-party CDNs, which taints the canvas, and a
 * tainted canvas throws SecurityError from toDataURL. Every real quote would hit the failure
 * path, not the happy one.
 *
 * Deriving from the configs instead turns out to be better than storing either the image or
 * the resolved inputs:
 *   - quotes, proposals and orders already carry the configs, so there is nothing to migrate
 *     and every quote saved before this existed gets a hero straight away;
 *   - the snapshot doesn't grow by a couple of hundred KB per quote;
 *   - improving the base scene improves every proposal ever sent, retroactively.
 * The cost is that a proposal depends on the catalogue URLs still resolving — if a CDN drops
 * an image the compositor skips that surface and shows the base scene underneath, which is a
 * softer failure than a broken <img> and is handled already.
 */

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/LanguageContext";
import { HeroCompositor } from "@/components/configurator/HeroCompositor";
import { showerWallTextureAt, type ShowerConfig } from "@/components/shower/ShowerConfigurator";
import { SAMPLE_VANITY_CATALOG, type VanityConfig } from "@/components/vanity/VanityConfigurator";
import { plumbingCatalogItems, type PlumbingConfig } from "@/components/plumbing/PlumbingConfigurator";
import { type RoomConfig } from "@/components/room/RoomConfigurator";
import { PLUMBING_FINISHES } from "@/lib/plumbing-catalog";
import { FLOORING_COLORS } from "@/lib/catalog";
import { getDuraseinColorByNameSlug, duraseinSheetTexture, DURASEIN_SHEET_IN } from "@/lib/durasein-catalog";
import { getShowerComponentImage, getComponentDimensions, programForPackage } from "@/lib/shower-components-catalog";
import type { HeroFixture } from "@/components/configurator/HeroCompositor";

/** The four module configs, however a caller happens to hold them. */
export type HeroSource = {
  room?: RoomConfig | null;
  shower?: ShowerConfig | null;
  vanity?: VanityConfig | null;
  plumbing?: PlumbingConfig | null;
};

type HeroWall = {
  textureUrl: string; name: string;
  seamIn: number | null;
  tileIn: { w: number; h: number };
};

/** Panel height for the wall kits. Every wall tier Kitify sells is panelled and lands here. */
const PANEL_TILE_H_IN = 94.5;
/**
 * A sheet standing upright on a wall — 30" x 144".
 *
 * LEGACY. Solid surface was retired as a wall tier in Aug 2026, so nothing selectable resolves
 * to sheet goods on a wall any more; this is reached only by a quote saved while it was
 * selectable (see LEGACY_WALL_MATERIALS in ShowerConfigurator), which is exactly the case that
 * would otherwise render an old quote's alcove with joints the product never had. Not to be
 * confused with DURASEIN_SHEET_IN, the live COUNTERTOP tile, which is the same sheet laid down.
 */
const SHEET_TILE_IN = { w: 30, h: 144 };

type HeroInputs = {
  wallMaterial: HeroWall | null;
  wallMaterialBack: HeroWall | null;
  wallMaterialLeft: HeroWall | null;
  wallMaterialRight: HeroWall | null;
  floorMaterial: { textureUrl: string; name: string } | null;
  vanityColor: string | null;
  vanityTopColor: string | null;
  vanityTopMaterial: { textureUrl: string; name: string; tileIn: { w: number; h: number } } | null;
  showerBaseColor: string | null;
  backsplashIn: number | null;
  fixtureFinish: string | null;
  fixtureFinishId: string | null;
  fixtures: HeroFixture[];
};

/**
 * Resolve the configs into compositor inputs. Anything unselected — or selected but without
 * usable imagery — comes back null, and the compositor leaves that surface as base scene.
 */
export function heroInputsFrom(src: HeroSource): HeroInputs {
  const { room, shower, vanity, plumbing } = src;

  // Null for roughly half the wall range: only a flat material capture may be tiled onto a
  // wall, and the room photography behind the Tile/Pure decors would read as a rendering
  // bug. See showerWallTexture.
  //
  // Resolved per plane: the hero paints the alcove as three surfaces — back wall, left return
  // and the narrow right return at the alcove's edge — so all three slots of wallColors are
  // now live. `showerWallTextureAt` reads wallMode itself, so a shared-material quote resolves
  // all three to the same swatch and renders exactly as it did before.
  const wallMaterial = shower ? showerWallTextureAt(shower, 0) : null;
  const wallMaterialBack = wallMaterial;
  const wallMaterialLeft = shower ? showerWallTextureAt(shower, 1) : null;
  const wallMaterialRight = shower ? showerWallTextureAt(shower, 2) : null;
  const wallSeamIn = (m: { panelWidthIn: number | null } | null) => m?.panelWidthIn ?? null;

  const floorId = room?.selections?.flooring?.colorId;
  const floor = floorId ? FLOORING_COLORS.find((c) => c.id === floorId) : undefined;
  const floorMaterial = floor ? { textureUrl: floor.image, name: floor.name } : null;

  const vanityColor = vanity?.selections.colorId
    ? SAMPLE_VANITY_CATALOG.colors.find((c) => c.id === vanity.selections.colorId)?.hex ?? null
    : null;
  const topColorId = vanity?.selections.topColorId;
  const vanityTopColor = topColorId
    ? SAMPLE_VANITY_CATALOG.topColors.find((c) => c.id === topColorId)?.hex ?? null
    : null;
  // The vanity's countertop swatches ARE Durasein colours — the list was authored from their
  // range — but the two modules key them differently, so the bridge is by name slug. When a
  // scan comes back the compositor paints the real stone; when it doesn't, vanityTopColor
  // above still carries the hex and the counter is tinted instead of left bare.
  //
  // THE FULL-SHEET SCAN, NOT THE SWATCH MASTER. This used to pass `swatchUrl`, which is a
  // studio photograph of a slab corner rather than a flat capture — see the note in
  // lib/durasein-catalog. Tiled onto the counter it drew the slab's own edge profile across
  // the middle of the top and magnified the grain several times over, which is what made the
  // countertop read as a butcher block. `sheetUrl` is the flat scan and it carries a known
  // real-world size, so the grain now renders at true scale. Colours with no sheet scan (the
  // solid Brilliant range and the plain whites) fall through to the hex tint, which is the
  // same rule the shower module already follows.
  const topScan = topColorId ? getDuraseinColorByNameSlug(topColorId) : null;
  const vanityTopMaterial = topScan?.sheetUrl
    ? {
        textureUrl: duraseinSheetTexture(topScan.sheetUrl),
        name: topScan.name,
        tileIn: DURASEIN_SHEET_IN,
      }
    : null;

  // The pan colour is passed as an id, not a hex: the compositor tints three of the four by
  // multiply and has to lay black down opaquely, so it needs to know which one this is.
  const showerBaseColor = shower?.selections.baseColor ?? null;

  // Only the BACK splash is drawn. The vanity also offers left and right returns, but both sit
  // on planes this plate's camera cannot see — the vanity is boxed into a nook, and its ends
  // are hard against the walls.
  const splash = vanity?.selections.backsplash;
  const backsplashIn = splash?.back ? splash.heightIn ?? 4 : null;

  // The tile IS the panel for panelled goods, which is what makes the seam count real rather
  // than decorative: tiling at 24"x94.5" and drawing a joint at every tile boundary are the
  // same statement made twice. Sheet goods tile at sheet size and draw nothing — a legacy-only
  // branch on walls now (see SHEET_TILE_IN), kept because dropping it would put joints on an
  // old quote's solid-surface alcove rather than leave it blank.
  const toWall = (m: { textureUrl: string; name: string; panelWidthIn: number | null } | null): HeroWall | null => {
    if (!m) return null;
    const seamIn = wallSeamIn(m);
    return {
      textureUrl: m.textureUrl,
      name: m.name,
      seamIn,
      tileIn: seamIn ? { w: seamIn, h: PANEL_TILE_H_IN } : SHEET_TILE_IN,
    };
  };

  return {
    wallMaterial: toWall(wallMaterial),
    wallMaterialBack: toWall(wallMaterialBack),
    wallMaterialLeft: toWall(wallMaterialLeft),
    wallMaterialRight: toWall(wallMaterialRight),
    floorMaterial,
    vanityColor,
    vanityTopColor,
    vanityTopMaterial,
    showerBaseColor,
    backsplashIn,
    fixtureFinish: plumbing
      ? PLUMBING_FINISHES.find((f) => f.id === plumbing.selections.finishId)?.hex ?? null
      : null,
    // The id, not the hex: the photo plate recolours the fixtures baked into the plate and
    // needs a fully-lit target metal to spread their shading across, which is a different
    // value from the flat swatch in the picker.
    fixtureFinishId: plumbing?.selections.finishId ?? null,
    fixtures: heroFixtures(shower, plumbing),
  };
}

/**
 * The product photos to pin into the scene.
 *
 * The lavatory faucet comes from the ordering catalogue, because the faucet the dealer sees
 * is literally the SKU on the quote. The three shower pieces come from the component
 * catalogue instead, and that distinction is the point of this function: the ordering
 * catalogue only has photographs of whole TRIM KITS, and several of those are shot as a
 * plate-plus-head assembly. Pinning one of those at the valve position put a second shower
 * head on the wall next to the modelled one. The component catalogue carries the pieces
 * isolated and per program, so a Woodhurst lever, an Ashlyn plate and Trinsic's round plate
 * now each render as themselves rather than as one stand-in.
 *
 * Anything with no usable photo is simply absent from the list, and the modelled fixture in
 * the base scene shows through — the same graceful path as a failed load.
 */
function heroFixtures(shower?: ShowerConfig | null, plumbing?: PlumbingConfig | null): HeroFixture[] {
  const out: HeroFixture[] = [];
  if (!plumbing) return out;
  const { packageId, finishId } = plumbing.selections;
  const program = programForPackage(packageId);

  // Lavatory faucet — unchanged, straight off the ordering catalogue.
  const faucet = plumbingCatalogItems(plumbing, 400)
    .find((i) => i.key === "faucet1cc" || i.key === "faucet8cc");
  if (faucet?.image) out.push({ anchor: "faucet", url: faucet.image, sizeIn: 8.9 });

  const push = (anchor: HeroFixture["anchor"], type: "valve_trim" | "tub_spout" | "shower_head") => {
    const url = getShowerComponentImage(type, program, finishId, 400, 400);
    if (!url) return;
    const d = getComponentDimensions(type, program);
    // Longest real dimension: the photo is square and letterboxed, so that side is what the
    // frame is scaled against. A spout is sized by its reach, not its 3" body height.
    const sizeIn = d ? Math.max(d.width_in, d.height_in, d.reach_in ?? 0) : 6.5;
    out.push({ anchor, url, sizeIn });
  };

  // The head is universal — one 52668 for every program, matched on finish alone.
  push("showerHead", "shower_head");
  push("showerTrim", "valve_trim");
  // Only a tub/shower configuration gets a spout. A shower-only quote must not grow one, and
  // the scene's alcove has a pan rather than a tub, so this is also the honest limit of what
  // the base scene can depict.
  if (shower?.selections.path === "tub") push("tubSpout", "tub_spout");

  return out;
}

/**
 * Whether a quote has anything the hero would actually show.
 *
 * A quote with no material, colour or fixture selected renders as the bare base scene — a
 * generic grey bathroom that is not this customer's bathroom. On a proposal that reads as a
 * stock photo, so callers skip the hero entirely rather than present one.
 */
export function hasHeroContent(src: HeroSource): boolean {
  const i = heroInputsFrom(src);
  return !!(i.wallMaterial || i.floorMaterial || i.vanityColor || i.vanityTopColor || i.fixtures.length);
}

export function HeroPreview({
  room, shower, vanity, plumbing,
  caption,
  className = "aspect-[1800/860] max-h-[600px] min-h-[200px]",
}: HeroSource & { caption?: string; className?: string }) {
  const inputs = useMemo(
    () => heroInputsFrom({ room, shower, vanity, plumbing }),
    [room, shower, vanity, plumbing],
  );
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <HeroCompositor {...inputs} className={`${className} bg-paper`} />
      {caption && (
        <div className="border-t border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {caption}
        </div>
      )}
    </div>
  );
}

/**
 * A small, non-interactive hero for a list row, with a click target that opens the full one.
 *
 * The thumbnail is far squarer than the scene, so the compositor's cover-fit crops the sides
 * rather than letterboxing — which keeps the shower and the vanity, the two things that
 * identify a quote at a glance, and drops the empty wall at either end.
 */
export function HeroThumb({ src, label, onOpen }: { src: HeroSource; label: string; onOpen: () => void }) {
  const inputs = useMemo(() => heroInputsFrom(src), [src]);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={label}
      aria-label={label}
      className="block h-[80px] w-[120px] shrink-0 overflow-hidden rounded-lg border border-line bg-paper transition hover:border-accent"
    >
      {/* No disclaimer at 120x80 — it would be unreadable. The full-size hero this opens carries it. */}
      <HeroCompositor {...inputs} showDisclaimer={false} className="h-full w-full" />
    </button>
  );
}

/** Full-size hero over a dimmed backdrop. Escape and a backdrop click both close it. */
export function HeroModal({ src, title, closeLabel, onClose }: {
  src: HeroSource; title: string; closeLabel: string; onClose: () => void;
}) {
  const { t } = useLanguage();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div aria-hidden onClick={onClose}
        className={`absolute inset-0 bg-ink/50 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`} />
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`relative w-full max-w-[1100px] transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white">{title}</span>
          <button type="button" onClick={onClose}
            className="min-h-11 rounded-lg bg-white/90 px-4 text-sm font-medium text-ink transition hover:bg-white">
            {closeLabel}
          </button>
        </div>
        <HeroPreview {...src} caption={t("configurator.hero.preview")} className="aspect-[1800/860]" />
      </div>
    </div>
  );
}
