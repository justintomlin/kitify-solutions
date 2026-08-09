"use client";

// Alignment harness for the photo-plate hero compositor. DEV ONLY — it 404s in production
// (see the guard below), because it is a debug surface with no auth in front of it and no
// place in the product. It is not linked from anywhere.
//
//   npm run dev  →  http://localhost:3000/hero-check
//   node scripts/hero-shot.mjs   (screenshots this page)
//
// Panel 1 is the real HeroCompositor under a deliberately contrasting configuration — dark
// wood on the alcove, a light floor, a real Durasein countertop scan, black fixtures — which
// makes any bleed past a region boundary obvious in a way a beige-on-beige selection never
// would. Panel 2 draws the clip outlines and the anchor footprints over the bare plate, so a
// misplaced corner can be read off directly instead of inferred from the texture. Panel 3 is
// the four shower-base colours side by side, which is the only way to see that black is
// compositing opaquely rather than multiplying to mud.
//
// Kept rather than deleted because the regions in lib/data/hero-photo-regions.json are
// hand-measured and will need re-tuning; without this the only way to check a change is to
// click through the configurator and squint.

import { useEffect, useRef } from "react";
import { notFound } from "next/navigation";
import { HeroCompositor } from "@/components/configurator/HeroCompositor";
import { PHOTO_SCENE, type Polygon, type RegionId } from "@/lib/hero-regions";
import { getShowerComponentImage, getComponentDimensions } from "@/lib/shower-components-catalog";
import { getDuraseinColorByNameSlug } from "@/lib/durasein-catalog";
import { FLOORING_COLORS, SHOWER_BASE_COLORS } from "@/lib/catalog";
import { PLUMBING_FINISHES } from "@/lib/plumbing-catalog";

const W = 1568;                       // 2x the plate, i.e. a retina desktop hero
const H = Math.round(W / PHOTO_SCENE.scene.aspect);

const NP = (hash: string, slug: string) =>
  `https://www.naturepanel.co.uk/media/${hash}/${slug}.jpg?anchor=center&mode=crop&width=600&height=900`;

// Brown Cuneo Oak wood slat — vertical, high contrast, unmistakable when it lands off-region
// or smears diagonally across a plane whose warp is wrong.
const WALL = {
  textureUrl: NP("e4nnemc0", "brown-cuneo-oak-swatch"),
  name: "Brown Cuneo Oak",
  seamIn: 24,
  tileIn: { w: 24, h: 94.5 },
};
/** A light panel, for the maximum-contrast per-wall test against the dark slat. */
const WALL_LIGHT = {
  textureUrl: NP("ioahdfdr", "grained-alpine-white-swatch"),
  name: "Grained Alpine White",
  seamIn: 24,
  tileIn: { w: 24, h: 94.5 },
};
/** A mid-tone third panel, so a three-way split is unambiguous. */
const WALL_MID = {
  textureUrl: NP("u0en1znm", "bleached-cuneo-oak-swatch"),
  name: "Bleached Cuneo Oak",
  seamIn: 24,
  tileIn: { w: 24, h: 94.5 },
};
/** Solid surface: a sheet, so it must render with NO joints. */
const WALL_SHEET = (() => {
  const c = getDuraseinColorByNameSlug("bianca-sabbia");
  return c ? { textureUrl: c.swatchUrl, name: c.name, seamIn: null, tileIn: { w: 30, h: 144 } } : null;
})();
const FLOOR = FLOORING_COLORS.find((c) => c.id === "vmd-01") ?? FLOORING_COLORS[0];
const TOP = getDuraseinColorByNameSlug("barnwood");

const FINISH = "Matte Black";
const PROGRAM = "Woodhurst";

const OUTLINE: Record<string, string> = {
  showerArea: "#00e5ff",
  showerFloor: "#ffd400",
  floor: "#ff2d95",
  vanityArea: "#7cff00",
  vanityTop: "#ff8a00",
};

// What heroFixtures resolves for sizeIn, mirrored here so the anchor boxes in panel 2 are
// drawn at the size the compositor will actually use.
const SIZE_IN: Record<string, number> = { faucet: 8.9, showerTrim: 6.5, tubSpout: 6.5 };

function useFixtures() {
  const head = getComponentDimensions("shower_head", PROGRAM);
  const trim = getComponentDimensions("valve_trim", PROGRAM);
  return [
    {
      anchor: "showerHead" as const,
      url: getShowerComponentImage("shower_head", PROGRAM, FINISH, 400, 400) ?? "",
      sizeIn: head ? Math.max(head.width_in, head.height_in, head.reach_in ?? 0) : 6.5,
    },
    {
      anchor: "showerTrim" as const,
      url: getShowerComponentImage("valve_trim", PROGRAM, FINISH, 400, 400) ?? "",
      sizeIn: trim ? Math.max(trim.width_in, trim.height_in, trim.reach_in ?? 0) : 6.5,
    },
  ].filter((f) => f.url);
}

const FLOOR_DARK = FLOORING_COLORS.find((c) => /char|graph|slate|espress|walnut/i.test(c.name)) ?? FLOORING_COLORS[FLOORING_COLORS.length - 1];
const FLOOR_LIGHT = FLOORING_COLORS.find((c) => /white|oat|linen|ash|light/i.test(c.name)) ?? FLOORING_COLORS[0];

/**
 * The five selections the plate has to survive, config (a) first because it is the one the
 * dealer actually sells: wood slat walls, brushed nickel, a mid cabinet.
 */
const SWEEP: Array<{
  label: string; back: WallMat; left: WallMat;
  floor: (typeof FLOORING_COLORS)[number] | null; cabinet: string;
  base: "white" | "black" | "grey" | "biscuit"; finish: string;
}> = [
  { label: "a · real-world — wood slat, stainless, mid cabinet", back: WALL, left: WALL, floor: FLOOR, cabinet: "#8d8f8a", base: "white", finish: "stainless" },
  { label: "b · dark everything — slat walls, black base, dark floor, matte black", back: WALL, left: WALL, floor: FLOOR_DARK, cabinet: "#2b2f31", base: "black", finish: "matte-black" },
  { label: "c · light everything — solid surface sheet, white base, light floor, chrome", back: WALL_SHEET, left: WALL_SHEET, floor: FLOOR_LIGHT, cabinet: "#e6e3dc", base: "white", finish: "chrome" },
  { label: "d · per-wall contrast — light back, dark return, champagne", back: WALL_LIGHT, left: WALL, floor: FLOOR, cabinet: "#2f5d50", base: "grey", finish: "champagne-bronze" },
  { label: "e · shared-material legacy quote — one selection everywhere", back: WALL_MID, left: WALL_MID, floor: FLOOR, cabinet: "#6b7b6e", base: "biscuit", finish: "polished-nickel" },
];

const H2 = { color: "#fff", font: "12px monospace", margin: "0 0 6px" } as const;

export default function HeroCheckPage() {
  // NODE_ENV is inlined into the client bundle at build time, so this collapses to a static
  // 404 in a production build rather than being a runtime check anyone could get past.
  if (process.env.NODE_ENV === "production") notFound();

  const fixtures = useFixtures();

  return (
    <main style={{ background: "#111", padding: 16, display: "grid", gap: 16 }}>
      <section>
        <h2 style={H2}>
          1 · composite — wood slat alcove, {FLOOR.name} floor, {TOP?.name ?? "tinted"} top,
          {" "}{FINISH} fixtures, black base
        </h2>
        <div id="composite" style={{ width: W, height: H }}>
          <HeroCompositor
            width={W}
            height={H}
            wallMaterialBack={WALL}
            wallMaterialLeft={WALL}
            wallMaterialRight={WALL}
            floorMaterial={{ textureUrl: FLOOR.image, name: FLOOR.name }}
            vanityColor="#2f5d50"
            vanityTopColor="#9a7b57"
            vanityTopMaterial={TOP ? { textureUrl: TOP.swatchUrl, name: TOP.name } : null}
            showerBaseColor="black"
            backsplashIn={4}
            fixtureFinishId="champagne-bronze"
            fixtures={fixtures}
            className="block"
          />
        </div>
      </section>

      {/* The whole plate under five real selections rather than one, because most of what can
          go wrong on this plate only shows under a particular combination — the glass pass
          against a light wall, the black base under a dark floor, the corner split under two
          different panels. Half-width tiles: five full-size renders would exhaust the canvas
          backing store on their own. */}
      <section>
        <h2 style={H2}>1b · config sweep — the five selections the plate has to survive</h2>
        <div style={{ display: "grid", gap: 8 }} id="sweep">
          {SWEEP.map((cfg) => (
            <figure key={cfg.label} style={{ margin: 0 }}>
              <figcaption style={{ color: "#aaa", font: "11px monospace", marginBottom: 3 }}>{cfg.label}</figcaption>
              <div style={{ width: Math.round(W / 2), height: Math.round(H / 2) }}>
                <HeroCompositor
                  width={Math.round(W / 2)}
                  height={Math.round(H / 2)}
                  wallMaterialBack={cfg.back}
                  wallMaterialLeft={cfg.left}
                  wallMaterialRight={cfg.left}
                  floorMaterial={cfg.floor ? { textureUrl: cfg.floor.image, name: cfg.floor.name } : null}
                  vanityColor={cfg.cabinet}
                  vanityTopColor="#9a7b57"
                  vanityTopMaterial={TOP ? { textureUrl: TOP.swatchUrl, name: TOP.name } : null}
                  showerBaseColor={cfg.base}
                  backsplashIn={4}
                  fixtureFinishId={cfg.finish}
                  className="block"
                />
              </div>
            </figure>
          ))}
        </div>
      </section>

      <section>
        <h2 style={H2}>2 · clip outlines + anchor footprints over the bare plate</h2>
        <RegionOutlines />
      </section>

      <section>
        <h2 style={H2}>3 · shower base colours</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} id="bases">
          {SHOWER_BASE_COLORS.map((c) => (
            <figure key={c.id} style={{ margin: 0 }}>
              <figcaption style={{ color: "#aaa", font: "11px monospace", marginBottom: 3 }}>{c.name}</figcaption>
              <HeroCompositor
                width={380}
                height={Math.round(380 / PHOTO_SCENE.scene.aspect)}
                wallMaterialBack={WALL}
            wallMaterialLeft={WALL}
                showerBaseColor={c.id}
                showDisclaimer={false}
                className="block"
              />
            </figure>
          ))}
        </div>
      </section>

      {/*
        Every finish, cropped hard to the vanity faucet. The whole-room view is too small to
        judge whether a recoloured fixture reads as metal — this is the panel that answers it.
        The crop is done by oversizing the canvas inside a small window, so each tile is the
        real compositor output rather than a scaled-down picture of it.
      */}
      {/* The four wall configurations the corner split has to survive. Each tile is a real
          full-room render cropped to the alcove, so what is on screen is the actual pixels. */}
      <section>
        <h2 style={H2}>4 · alcove wall configs — corner split, panel seams, scale</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} id="walls">
          {[
            { label: "a · same panel, all three planes", back: WALL, left: WALL, right: WALL },
            { label: "b · three different (dark left / light back / mid right)", back: WALL_LIGHT, left: WALL, right: WALL_MID },
            { label: "c · shared-material mode (one selection)", back: WALL, left: WALL, right: WALL },
            { label: "d · solid surface sheet — expect NO seams", back: WALL_SHEET, left: WALL_SHEET, right: WALL_SHEET },
          ].map((cfg) => (
            <figure key={cfg.label} style={{ margin: 0 }}>
              <figcaption style={{ color: "#aaa", font: "11px monospace", marginBottom: 3 }}>{cfg.label}</figcaption>
              <AlcoveCrop back={cfg.back} left={cfg.left} right={cfg.right} />
            </figure>
          ))}
        </div>
      </section>

      <section>
        <h2 style={H2}>5 · plumbing finishes — sink faucet (each tile is the real render, cropped)</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} id="finishes">
          {PLUMBING_FINISHES.map((f) => (
            <figure key={f.id} style={{ margin: 0 }}>
              <figcaption style={{ color: "#aaa", font: "11px monospace", marginBottom: 3 }}>{f.name}</figcaption>
              <FixtureCrop finishId={f.id} at={[61.35, 52.5]} />
            </figure>
          ))}
        </div>
        {/* The other tint groups, each over a DARK SLAT WALL rather than over bare plate. That
            is the case that fails first: a light finish on a dark material is where a box that
            catches wall shows up, as a pale rectangle around the fixture. Three finishes per
            row rather than seven — every tile is a full-room render and the backing stores add
            up fast. Matte Black is in every row on purpose. It is the no-op tint, so it is also
            the only case that proves the OCCLUSION MASK is restoring the hardware: without the
            mask, matte-black hardware would stay buried under the wall material. */}
        {[
          { id: "finishesHead", title: "6 · shower head + arm, on the left return", at: [21.15, 20.5] as [number, number] },
          { id: "finishesValve", title: "7 · valve trim", at: [20.5, 52.5] as [number, number] },
          { id: "finishesDoorTop", title: "8 · door hardware — post, track, left hanger", at: [24.0, 15.0] as [number, number] },
          { id: "finishesDoorEdge", title: "9 · door hardware — handle, at the alcove's bright right edge", at: [44.4, 54.5] as [number, number] },
          { id: "finishesRail", title: "10 · door hardware — bottom rail over the pan", at: [37.0, 93.4] as [number, number] },
          { id: "finishesSconce", title: "11 · vanity sconce — bulbs must stay lit", at: [61.5, 9.6] as [number, number] },
        ].map((row) => (
          <div key={row.id}>
            <h2 style={{ ...H2, marginTop: 10 }}>{row.title}</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} id={row.id}>
              {["chrome", "champagne-bronze", "matte-black"].map((id) => (
                <figure key={id} style={{ margin: 0 }}>
                  <figcaption style={{ color: "#aaa", font: "11px monospace", marginBottom: 3 }}>
                    {PLUMBING_FINISHES.find((f) => f.id === id)?.name ?? id}
                  </figcaption>
                  <FixtureCrop finishId={id} at={row.at} big={1400} wall />
                </figure>
              ))}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

type WallMat = { textureUrl: string; name: string; seamIn: number | null; tileIn?: { w: number; h: number } } | null;

/** One wall configuration, rendered full-room and cropped to the alcove. */
function AlcoveCrop({ back, left, right }: { back: WallMat; left: WallMat; right: WallMat }) {
  const BIG = 1400;
  const BIG_H = Math.round(BIG / PHOTO_SCENE.scene.aspect);
  // 400px of a 1400px render is 28.6% of the plate — wide enough to hold the return's outer
  // edge at 17.5, both interior corners at 23.6 and 42.65, and the strip's outer edge at 44.
  const VIEW_W = 400, VIEW_H = 480;
  const at: [number, number] = [30.7, 52];
  return (
    <div style={{ position: "relative", width: VIEW_W, height: VIEW_H, overflow: "hidden", background: "#000" }}>
      <div style={{
        position: "absolute", width: BIG, height: BIG_H,
        left: -Math.round((at[0] / 100) * BIG - VIEW_W / 2),
        top: -Math.round((at[1] / 100) * BIG_H - VIEW_H / 2),
      }}>
        <HeroCompositor
          width={BIG}
          height={BIG_H}
          wallMaterialBack={back}
          wallMaterialLeft={left}
          wallMaterialRight={right}
          showerBaseColor="black"
          showDisclaimer={false}
          className="block"
        />
      </div>
    </div>
  );
}

/**
 * One finish, rendered at full hero scale and cropped to a window around `at`.
 *
 * The compositor always draws the whole room, so "zoom in on the faucet" means rendering big
 * and looking through a small hole at it — which is exactly what a scrolled, overflow-hidden
 * box does. No scaling, so what is on screen is what the pixels actually are.
 */
function FixtureCrop({ finishId, at, big, wall }: {
  finishId: string; at: [number, number]; big?: number; wall?: boolean;
}) {
  // 2.3x the plate. Enough magnification to judge whether a recoloured fixture reads as
  // metal, and low enough that fourteen of these on one page don't exhaust canvas memory —
  // each is a full-room render, and the backing stores add up fast.
  const BIG = big ?? 1800;
  const BIG_H = Math.round(BIG / PHOTO_SCENE.scene.aspect);
  const VIEW_W = 170, VIEW_H = 130;
  return (
    <div style={{ position: "relative", width: VIEW_W, height: VIEW_H, overflow: "hidden", background: "#000" }}>
      {/* The compositor's host div has no intrinsic size — its canvas is h-full/w-full — so
          the CSS box has to be stated here as well as the backing-store size below. */}
      <div style={{
        position: "absolute",
        width: BIG,
        height: BIG_H,
        left: -Math.round((at[0] / 100) * BIG - VIEW_W / 2),
        top: -Math.round((at[1] / 100) * BIG_H - VIEW_H / 2),
      }}>
        <HeroCompositor
          width={BIG}
          height={BIG_H}
          wallMaterialBack={wall ? WALL : null}
          wallMaterialLeft={wall ? WALL : null}
          wallMaterialRight={wall ? WALL : null}
          vanityTopMaterial={TOP ? { textureUrl: TOP.swatchUrl, name: TOP.name } : null}
          vanityTopColor="#9a7b57"
          fixtureFinishId={finishId}
          showDisclaimer={false}
          className="block"
        />
      </div>
    </div>
  );
}

/** The clip polygons and anchor footprints, stroked over the plate — geometry only. */
function RegionOutlines() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      const clips = PHOTO_SCENE.clips ?? {};
      for (const [id, polys] of Object.entries(clips) as [RegionId, Polygon[]][]) {
        const color = OUTLINE[id] ?? "#fff";
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;
        for (const poly of polys) {
          ctx.beginPath();
          poly.forEach((p, i) => {
            const x = p[0] * W, y = p[1] * H;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.globalAlpha = 0.16; ctx.fill();
          ctx.globalAlpha = 1; ctx.stroke();
          for (const p of poly) {
            ctx.beginPath();
            ctx.arc(p[0] * W, p[1] * H, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      // Anchor footprints. The box is the frame the compositor draws; since these catalog
      // shots fill their frame (see scripts/measure-fixtures.mjs) the box is very nearly the
      // product's own outline, which is what makes it usable for checking alignment.
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      for (const [name, a] of Object.entries(PHOTO_SCENE.anchors)) {
        const cx = a.at[0] * W, cy = a.at[1] * H;
        const size = a.unitPerIn * (SIZE_IN[name] ?? 6.5) * 1.5 * H;
        ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
        ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
        ctx.stroke();
      }
    };
    img.src = PHOTO_SCENE.scene.src;
  }, []);

  return <canvas ref={ref} width={W} height={H} style={{ display: "block", width: W, height: H }} />;
}
