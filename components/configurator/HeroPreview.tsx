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
import { showerWallTexture, type ShowerConfig } from "@/components/shower/ShowerConfigurator";
import { SAMPLE_VANITY_CATALOG, type VanityConfig } from "@/components/vanity/VanityConfigurator";
import { plumbingCatalogItems, type PlumbingConfig } from "@/components/plumbing/PlumbingConfigurator";
import { type RoomConfig } from "@/components/room/RoomConfigurator";
import { PLUMBING_FINISHES } from "@/lib/plumbing-catalog";
import { FLOORING_COLORS } from "@/lib/catalog";
import { getShowerComponentImage, getComponentDimensions, programForPackage } from "@/lib/shower-components-catalog";
import type { HeroFixture } from "@/components/configurator/HeroCompositor";

/** The four module configs, however a caller happens to hold them. */
export type HeroSource = {
  room?: RoomConfig | null;
  shower?: ShowerConfig | null;
  vanity?: VanityConfig | null;
  plumbing?: PlumbingConfig | null;
};

type HeroInputs = {
  wallMaterial: { textureUrl: string; name: string } | null;
  floorMaterial: { textureUrl: string; name: string } | null;
  vanityColor: string | null;
  vanityTopColor: string | null;
  fixtureFinish: string | null;
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
  const wallMaterial = shower ? showerWallTexture(shower) : null;

  const floorId = room?.selections?.flooring?.colorId;
  const floor = floorId ? FLOORING_COLORS.find((c) => c.id === floorId) : undefined;
  const floorMaterial = floor ? { textureUrl: floor.image, name: floor.name } : null;

  const vanityColor = vanity?.selections.colorId
    ? SAMPLE_VANITY_CATALOG.colors.find((c) => c.id === vanity.selections.colorId)?.hex ?? null
    : null;
  const vanityTopColor = vanity?.selections.topColorId
    ? SAMPLE_VANITY_CATALOG.topColors.find((c) => c.id === vanity.selections.topColorId)?.hex ?? null
    : null;

  return {
    wallMaterial,
    floorMaterial,
    vanityColor,
    vanityTopColor,
    fixtureFinish: plumbing
      ? PLUMBING_FINISHES.find((f) => f.id === plumbing.selections.finishId)?.hex ?? null
      : null,
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
      <HeroCompositor {...inputs} className="h-full w-full" />
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
