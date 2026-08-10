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

import { useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { HeroCompositor } from "@/components/configurator/HeroCompositor";
import { PHOTO_SCENE, type Polygon, type RegionId } from "@/lib/hero-regions";
import { getShowerComponentImage, getComponentDimensions } from "@/lib/shower-components-catalog";
import { getDuraseinColorByNameSlug, duraseinSheetTexture, DURASEIN_SHEET_IN } from "@/lib/durasein-catalog";
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
/**
 * Solid surface: a sheet, so it must render with NO joints.
 *
 * From the full-sheet SCAN, matching what ShowerConfigurator resolves. It used to come from
 * the swatch master, which is a photograph of a slab corner — so this panel was checking the
 * wall against an image the app never puts there. On a wall the sheet stands upright, hence
 * the transposed tile.
 */
const WALL_SHEET = (() => {
  const c = getDuraseinColorByNameSlug("bianca-sabbia");
  return c?.sheetUrl
    ? {
        textureUrl: duraseinSheetTexture(c.sheetUrl),
        name: c.name,
        seamIn: null,
        tileIn: { w: DURASEIN_SHEET_IN.h, h: DURASEIN_SHEET_IN.w },
      }
    : null;
})();
const FLOOR = FLOORING_COLORS.find((c) => c.id === "vmd-01") ?? FLOORING_COLORS[0];

/**
 * A countertop, resolved the way HeroPreview resolves one.
 *
 * Durasein publishes two images per colour and they are NOT interchangeable — the "swatch
 * master" is a studio shot of a slab CORNER, complete with its own edge profile and cast
 * shadow, and the full-sheet scan is a flat edge-to-edge capture. This harness used to pass
 * the swatch, which is what put a giant slab edge across the counter. Mirroring the real
 * resolver here means the harness renders what the app renders.
 */
const topMaterial = (slug: string) => {
  const c = getDuraseinColorByNameSlug(slug);
  if (!c?.sheetUrl) return null;
  return { textureUrl: duraseinSheetTexture(c.sheetUrl), name: c.name, tileIn: DURASEIN_SHEET_IN };
};
type TopMat = ReturnType<typeof topMaterial>;
const TOP = topMaterial("barnwood");
/** The light counter the precision pass checks grain scale against. */
const TOP_LIGHT = topMaterial("bianca-sabbia");

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

// The darkest and lightest planks in the Durato range, PICKED BY MEASUREMENT rather than by
// name. These twelve are named after buildings — Florence, Gherkin, Petronas — so the tone
// regex this used to run ("char|graph|slate|espress|walnut") matched nothing and both ends
// fell through to their defaults, which is how a panel labelled "dark everything" came to be
// rendered on the second-lightest floor in the catalogue. Mean luminance of each swatch:
// Buckingham 33.6 is the darkest by a wide margin and Baymont 180.0 the lightest.
const FLOOR_DARK = FLOORING_COLORS.find((c) => c.id === "vmd-06") ?? FLOORING_COLORS[FLOORING_COLORS.length - 1];
const FLOOR_LIGHT = FLOORING_COLORS.find((c) => c.id === "vmd-03") ?? FLOORING_COLORS[0];

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

/**
 * The finish sweep every fixture zoom runs, brightest first.
 *
 * Order matters for reading the row: the failures that a bright metal exposes (tint landing on
 * something that is not metal) are at the left, and the failures a dark metal exposes (a
 * fixture with no shading left in it) are at the right, with the no-op at the end as the
 * control.
 */
const FINISH_SWEEP = ["chrome", "polished-nickel", "stainless", "champagne-bronze", "venetian-bronze", "matte-black"];

const H2 = { color: "#fff", font: "12px monospace", margin: "0 0 6px" } as const;

/**
 * Which group of panels to mount, from `?panel=`.
 *
 * ONE GROUP AT A TIME, and that is a hard requirement rather than a convenience. Every tile on
 * this page is a real full-room composite with its own canvas backing store — a 2352-wide
 * precision panel is 9.5 MB on its own — and once the fixture sweep went to six finishes across
 * six groups the page had over fifty of them and took the renderer down with it. Mounting one
 * group keeps the total bounded whatever gets added next.
 *
 * The default is `cfg`, so opening the page bare still shows the three whole-room views.
 */
type PanelGroup = "cfg" | "fixtures" | "bases" | "walls" | "outlines" | "sweep" | "plate2";
const PANEL_GROUPS: PanelGroup[] = ["cfg", "fixtures", "bases", "walls", "outlines", "sweep", "plate2"];

function usePanelGroup(): PanelGroup | null {
  const [panel, setPanel] = useState<PanelGroup | null>(null);
  // Read after mount rather than during render: this is a client component with no server
  // search-param plumbing, and reading window during render would mismatch on hydration.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("panel") as PanelGroup | null;
    setPanel(p && PANEL_GROUPS.includes(p) ? p : "cfg");
  }, []);
  return panel;
}

export default function HeroCheckPage() {
  // NODE_ENV is inlined into the client bundle at build time, so this collapses to a static
  // 404 in a production build rather than being a runtime check anyone could get past.
  if (process.env.NODE_ENV === "production") notFound();

  const fixtures = useFixtures();
  const panel = usePanelGroup();
  if (!panel) return <main style={{ background: "#111", minHeight: "100vh" }} />;

  return (
    <main style={{ background: "#111", padding: 16, display: "grid", gap: 16 }}>
      <nav style={{ color: "#888", font: "11px monospace" }}>
        {PANEL_GROUPS.map((g) => (
          <a key={g} href={`?panel=${g}`} style={{ color: g === panel ? "#ff0" : "#6cf", marginRight: 12 }}>{g}</a>
        ))}
      </nav>
      {panel === "cfg" && <>
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
            vanityTopMaterial={TOP}
            showerBaseColor="black"
            backsplashIn={4}
            fixtureFinishId="champagne-bronze"
            fixtures={fixtures}
            className="block"
          />
        </div>
      </section>

      </>}

      {/* The whole plate under five real selections rather than one, because most of what can
          go wrong on this plate only shows under a particular combination — the glass pass
          against a light wall, the black base under a dark floor, the corner split under two
          different panels. Half-width tiles: five full-size renders would exhaust the canvas
          backing store on their own. */}
      {panel === "sweep" && <section>
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
                  vanityTopMaterial={TOP}
                  showerBaseColor={cfg.base}
                  backsplashIn={4}
                  fixtureFinishId={cfg.finish}
                  className="block"
                />
              </div>
            </figure>
          ))}
        </div>
      </section>}

      {/*
        THE PRECISION PASS PANELS. Three configurations at 3x the plate, which is the only
        magnification at which a junction can actually be judged — a 0.2% misalignment is
        two-thirds of a plate pixel and simply is not visible at hero size.

        A is the dealer's own current view and the one the markup was drawn on. B reverses the
        contrast on every junction at once: where A puts something dark against a light plate,
        B puts something light against a dark one, and a boundary that is off by a pixel shows
        up in one of the two whichever way the error points. C is A's floor swapped for the
        darkest plank in the range, which is the only place a gap between the flooring and the
        plate reads as a hole rather than as a tone change.

        All three run the SAME material on both alcove planes, which also makes them the
        acceptance test for the return-versus-back-wall balance.
      */}
      {panel === "cfg" && <>
      <section>
        <h2 style={H2}>1c · precision pass A — THE DEALER&apos;S OWN VIEW: wood slat, green cabinet, Barnwood counter, black base, Champagne</h2>
        {/* Champagne rather than a dark bronze on purpose. A bright finish is the case that
            fails first — anything a tint box catches that is not metal shows up as a coloured
            smear on the wall, where a dark finish paints it dark and hides it. */}
        <div id="cfgA" style={{ width: BIG_W, height: BIG_H }}>
          <PrecisionPanel
            wall={WALL} floor={FLOOR} top={TOP}
            cabinet="#2f5d50" base="black" finish="champagne-bronze"
          />
        </div>
      </section>
      <section>
        <h2 style={H2}>1e · precision pass C — darkest plank (Buckingham), wood slat, Venetian, black base</h2>
        {/* The floor perimeter is only judgeable at the dark extreme: on a mid plank a gap
            between the flooring and the plate reads as a tone change, on Buckingham it reads
            as a hole. */}
        <div id="cfgC" style={{ width: BIG_W, height: BIG_H }}>
          <PrecisionPanel
            wall={WALL} floor={FLOOR_DARK} top={TOP}
            cabinet="#2b2f31" base="black" finish="venetian-bronze"
          />
        </div>
      </section>
      <section>
        <h2 style={H2}>1d · precision pass B — light Durasein counter, light cabinet, light floor, solid surface walls, Chrome, 6&quot; splash</h2>
        {/* 6" rather than 4", so the height selection is exercised somewhere: the back splash
            and its right return are both scaled now, and the miter they share only stays shut
            if they scale together. */}
        <div id="cfgB" style={{ width: BIG_W, height: BIG_H }}>
          <PrecisionPanel
            wall={WALL_SHEET} floor={FLOOR_LIGHT} top={TOP_LIGHT}
            cabinet="#e6e3dc" base="white" finish="chrome" splashIn={6}
          />
        </div>
      </section>

      </>}

      {/*
        THE EDITED-PLATE PASS. Three configurations chosen for what the plate edit and the
        splash rework can each get wrong, rather than for covering the range.

        P1 is the dealer's own eyeball view with the counter swapped to a LIGHT solid surface:
        light is the case where grain bleeding up from the plate would show, because a dark
        counter hides the plate's own pattern under its own. P2 is the opposite extreme — the
        Barnwood scan, which is the strongest pattern the counter range has, over a light floor:
        if any of the plate's old wood survived the edit, a second grain at a different angle is
        what it would look like. P3 exercises the 6" selection, where the drawn splash overruns
        the plate's own and the miter has to scale with it.
      */}
      {panel === "plate2" && <>
      <section>
        <h2 style={H2}>P1 · eyeball config, LIGHT counter — wood slat, dark plank, Venetian, black base, {TOP_LIGHT?.name ?? "light"} top, 4&quot; splash</h2>
        <div id="p1" style={{ width: BIG_W, height: BIG_H }}>
          <PrecisionPanel
            wall={WALL} floor={FLOOR_DARK} top={TOP_LIGHT}
            cabinet="#2f5d50" base="black" finish="venetian-bronze"
          />
        </div>
      </section>
      <section>
        <h2 style={H2}>P2 · grain-is-gone at the other extreme — {TOP?.name ?? "Barnwood"} counter, light floor, 4&quot; splash</h2>
        <div id="p2" style={{ width: BIG_W, height: BIG_H }}>
          <PrecisionPanel
            wall={WALL} floor={FLOOR_LIGHT} top={TOP}
            cabinet="#e6e3dc" base="white" finish="chrome"
          />
        </div>
      </section>
      <section>
        <h2 style={H2}>P3 · 6&quot; splash — light counter, dark plank, so the band above the plate&apos;s own splash is visible</h2>
        <div id="p3" style={{ width: BIG_W, height: BIG_H }}>
          <PrecisionPanel
            wall={WALL} floor={FLOOR_DARK} top={TOP_LIGHT}
            cabinet="#2f5d50" base="black" finish="venetian-bronze" splashIn={6}
          />
        </div>
      </section>
      </>}

      {panel === "outlines" && <section>
        <h2 style={H2}>2 · clip outlines + anchor footprints over the bare plate</h2>
        <RegionOutlines />
      </section>}

      {panel === "bases" && <section>
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
        {/* The pan CROPPED, which is the only view that answers whether a tinted base still has
            a curb, a floor gradient and a drain in it. The whole-room tiles above show that the
            colour landed; they cannot show that it landed on a moulded object rather than on a
            flat cut-out. Champagne hardware in every tile, because the bottom rail crosses the
            pan and its tint is where the gold streaks around the drain came from. */}
        <div>
          <h2 style={{ ...H2, marginTop: 10 }}>3b · the pan itself — curb, floor gradient, drain</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} id="basesZoom">
            {SHOWER_BASE_COLORS.map((c) => (
              <figure key={c.id} style={{ margin: 0 }}>
                <figcaption style={{ color: "#aaa", font: "11px monospace", marginBottom: 3 }}>{c.name}</figcaption>
                <FixtureCrop finishId="champagne-bronze" at={[33, 91]} big={1800} wall base={c.id} view={[330, 190]} />
              </figure>
            ))}
          </div>
        </div>
      </section>}

      {/* The four wall configurations the corner split has to survive. Each tile is a real
          full-room render cropped to the alcove, so what is on screen is the actual pixels. */}
      {panel === "walls" && <section>
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
      </section>}

      {/*
        Every finish, cropped hard to a fixture. The whole-room view is too small to judge
        whether a recoloured fixture reads as metal — this is the panel that answers it. The
        crop is done by oversizing the canvas inside a small window, so each tile is the real
        compositor output rather than a scaled-down picture of it.
      */}
      {panel === "fixtures" && <section>
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
              {/* ALL SIX, not a sample. The two ends of the range fail in opposite directions
                  and a fix that satisfies one can break the other: a bright finish (Chrome,
                  Polished Nickel) turns anything a box catches that is not metal into a pale
                  smear on the wall, a dark one (Venetian) hides that but collapses the
                  fixture's own shading, and Matte Black has to stay a no-op throughout —
                  it is the tint the plate already is, so any visible change in a matte-black
                  tile is a bug by definition. */}
              {FINISH_SWEEP.map((id) => (
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
      </section>}
    </main>
  );
}

type WallMat = { textureUrl: string; name: string; seamIn: number | null; tileIn?: { w: number; h: number } } | null;

/** 3x the plate. Big enough that a two-thirds-of-a-pixel junction error is legible in a crop. */
const BIG_W = 2352;
const BIG_H = Math.round(BIG_W / PHOTO_SCENE.scene.aspect);

/** One whole-room render under a named configuration, at BIG_W. */
function PrecisionPanel({ wall, floor, top, cabinet, base, finish, splashIn = 4 }: {
  wall: WallMat; floor: (typeof FLOORING_COLORS)[number] | null; top: TopMat;
  cabinet: string; base: string; finish: string; splashIn?: number;
}) {
  return (
    <HeroCompositor
      width={BIG_W}
      height={BIG_H}
      wallMaterialBack={wall}
      wallMaterialLeft={wall}
      wallMaterialRight={wall}
      floorMaterial={floor ? { textureUrl: floor.image, name: floor.name } : null}
      vanityColor={cabinet}
      vanityTopColor="#9a7b57"
      vanityTopMaterial={top}
      showerBaseColor={base}
      backsplashIn={splashIn}
      fixtureFinishId={finish}
      showDisclaimer={false}
      className="block"
    />
  );
}

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
function FixtureCrop({ finishId, at, big, wall, base, view, floor }: {
  finishId: string; at: [number, number]; big?: number; wall?: boolean;
  /** Shower base colour id. Omitted leaves the plate's own white pan. */
  base?: string;
  /** Window size, when the default 170x130 is the wrong shape for what is being judged. */
  view?: [number, number];
  floor?: (typeof FLOORING_COLORS)[number] | null;
}) {
  // 2.3x the plate. Enough magnification to judge whether a recoloured fixture reads as
  // metal, and low enough that fourteen of these on one page don't exhaust canvas memory —
  // each is a full-room render, and the backing stores add up fast.
  const BIG = big ?? 1800;
  const BIG_H = Math.round(BIG / PHOTO_SCENE.scene.aspect);
  const [VIEW_W, VIEW_H] = view ?? [170, 130];
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
          floorMaterial={floor ? { textureUrl: floor.image, name: floor.name } : null}
          vanityTopMaterial={TOP}
          vanityTopColor="#9a7b57"
          showerBaseColor={base ?? null}
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
