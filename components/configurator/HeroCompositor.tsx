"use client";

/**
 * HeroCompositor — the configurator hub's live room preview.
 *
 * A layer compositor, not a renderer: it takes one pre-made bathroom shell and paints the
 * dealer's actual product selections into the surfaces of that shell, perspective and all.
 * No 3D at runtime, no AI at runtime, no server call — a few hundred canvas operations per
 * selection change.
 *
 * WHICH SHELL — see USE_PHOTO_PLATE below. The compositor works the same either way; the two
 * plates differ only in how they were measured and how they describe occlusion, and
 * lib/hero-regions resolves both to one shape before this file sees them.
 *
 * HOW A SURFACE GETS PAINTED
 *  1. lib/hero-regions gives the four screen corners of the surface, plus its real-world size
 *     in inches.
 *  2. The material's texture is tiled into an offscreen "surface" canvas at true scale — a
 *     40" panel repeats 1.5 times across a 60" wall, and the compositor knows that because
 *     the region carries `widthIn`.
 *  3. That canvas is mapped onto the quad through a homography (`unitSquareToQuad`). Canvas
 *     2D only does affine transforms, so the map is evaluated over a grid and each cell is
 *     drawn as two affine triangles — fine enough that the piecewise seams are invisible,
 *     coarse enough to stay cheap.
 *  4. The result is composited with `multiply`, so the shell's own shading — corner falloff,
 *     the contact shadow at the floor line, the fall-off away from the window — comes
 *     through the material instead of being painted over. Straight replacement is what makes
 *     this kind of preview look like a sticker; the blend is what makes it look like a room.
 *
 * WHY EACH REGION GETS ITS OWN LAYER
 * The triangles in step 3 are drawn very slightly oversized so no background shows through
 * the joins. Overlapping them is harmless under `source-over` but not under `multiply`,
 * which would darken every seam and leave a visible grid across the wall. So the warp is
 * always drawn source-over into a transparent scratch layer, and that layer is composited
 * onto the frame exactly once, with the blend.
 *
 * ON CANVAS TAINTING
 * Textures come from third-party CDNs, so this canvas is usually tainted. That is fine and
 * deliberate: tainting only blocks reading pixels back, never drawing or displaying them, and
 * nothing here calls toDataURL/toBlob on the visible canvas. The one place that does want
 * pixels — knocking the white studio background out of a product photograph — asks for them
 * inside a try/catch and falls back to a `multiply` blend, which hides white just as well
 * without needing to read anything.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageContext";
import {
  PHOTO_SCENE, RENDER_SCENE, tileRepeat,
  type Face, type FixtureId, type Point, type Polygon, type Quad, type Region, type RegionId,
  type AnchorId, type FixturePart, type ModeledHead, type SceneBundle, type SeamShade,
} from "@/lib/hero-regions";

// ------------------------------ which plate --------------------------------

/**
 * `true` paints onto the photographic plate; `false` falls back to the Three.js render.
 *
 * Kept as a switch rather than deleted code because the two are worth A/B-ing while the photo
 * plate's hand-traced regions are still being refined. The render plate is dimensionally
 * exact and machine-registered but reads as CGI; the photo plate reads as a room but is
 * measured by eye and is only 784x336, so it is soft at full width on a desktop. The
 * fallback is what makes it safe to ship the photo plate before that is solved.
 *
 * Nothing else in the file branches on this. Everything downstream reads PLATE.
 */
const USE_PHOTO_PLATE = true;

/**
 * ON since Phase 3, against a mask rebuilt for this plate.
 *
 * public/hero/base-photo-occlusion.png now carries this plate's plant, planter, toilet and
 * towel, plus the sliding door's hardware. The hardware is in there for one case only: MATTE
 * BLACK. Every other finish paints its own patch straight from the plate, so the hardware
 * reappears whether or not the mask restores it — but matte black is a no-op tint, so without
 * the mask the post and track would stay buried under whatever wall material was chosen.
 */
const OCCLUSION_ENABLED = true;

/** ON since Phase 3. Every box in `fixtureRegions` was re-measured against this plate. */
const FIXTURE_TINT_ENABLED = true;

const PLATE: SceneBundle = USE_PHOTO_PLATE ? PHOTO_SCENE : RENDER_SCENE;
const SCENE = PLATE.scene;

/**
 * Opacity of a warped texture over the plate.
 *
 * The photographic plate carries real lighting — a soft gradient down the alcove, the contact
 * shadow under the vanity, the window falloff across the floor. Multiply already lets that
 * through, but at full strength a dark material also swallows it, and the surface goes flat
 * and pasted-on. Backing off a little keeps the plate's own shading legible through the
 * material. The render plate is lit near-white precisely so multiply works at full strength,
 * so it stays at 1.
 */
const TEXTURE_ALPHA = USE_PHOTO_PLATE ? 0.88 : 1;

// --------------------------------- types -----------------------------------

export type HeroMaterial = {
  /** A flat, tileable image of the material. Room photography must never be passed here. */
  textureUrl: string;
  name: string;
  /** Real-world size of one tile, in inches. Defaults per region if omitted. */
  tileIn?: { w: number; h: number };
  /**
   * Panel width in inches, for drawing joints. Null/omitted for sheet goods, which show no
   * joint across a wall this size — a Durasein sheet is 30"x144" and covers the alcove whole.
   */
  seamIn?: number | null;
};

export type HeroCompositorProps = {
  /** Shower wall panel / solid surface — painted into the alcove, not the whole room. */
  wallMaterial?: HeroMaterial | null;
  /**
   * Per-plane overrides for the alcove, when the dealer picked a different panel per wall.
   *
   * The photo plate paints the alcove as TWO planes — a back wall and a left return meeting at
   * a measured corner — because they are viewed at very different angles and a single warped
   * sheet across both is what made the corner disappear. Either falls back to `wallMaterial`,
   * so a quote saved in shared-material mode renders both planes from the one selection.
   */
  wallMaterialBack?: HeroMaterial | null;
  wallMaterialLeft?: HeroMaterial | null;
  wallMaterialRight?: HeroMaterial | null;
  /** Flooring — painted across the floor. */
  floorMaterial?: HeroMaterial | null;
  /** Vanity cabinet colour, as a CSS colour. Tints the cabinet's front face. */
  vanityColor?: string | null;
  /** Countertop colour, as a CSS colour. Tints the vanity's counter slab. */
  vanityTopColor?: string | null;
  /**
   * Countertop material, when the selection maps to a real sheet scan.
   *
   * Takes precedence over `vanityTopColor`: a Durasein top is a veined solid surface and a
   * flat hex reads as painted MDF. Callers pass both, so the tint stands in whenever a colour
   * has no scan behind it, and the counter is never left unfinished.
   */
  vanityTopMaterial?: HeroMaterial | null;
  /**
   * Shower base/pan colour id — "white" | "beige" | "grey" | "black", per SHOWER_BASE_COLORS.
   *
   * An id rather than a hex because the pan is not a straight tint: see BASE_TINTS for why
   * black has to composite differently from the other three.
   */
  showerBaseColor?: string | null;
  /**
   * Backsplash height in inches, or null for no splash.
   *
   * The plate has no splash to photograph, so this one is drawn: a band of the countertop
   * material standing on the counter's back edge. The region in the JSON is authored at 4",
   * and this scales it — a 6" splash is the same band, half again as tall.
   */
  backsplashIn?: number | null;
  /** Trim finish, as a CSS colour. Tints fixture cutouts when their background can be removed. */
  fixtureFinish?: string | null;
  /**
   * Trim finish as a PLUMBING_FINISHES id — "chrome", "champagne-bronze", and so on.
   *
   * How the photo plate does fixtures: the plate's own matte-black fixtures are recoloured to
   * this finish in place, and no product photograph is pinned at all. An id rather than the
   * hex because the recolour needs a fully-lit target colour to spread the fixture's shading
   * across, which is not the same value as the swatch shown in the picker.
   */
  fixtureFinishId?: string | null;
  /**
   * Product photos to pin onto the scene, each at a named anchor and sized in real inches.
   *
   * A list rather than a prop per fixture because the set is open: the shower alone carries a
   * valve trim, a rain head and — only for a tub/shower — a spout, and which of them exist
   * depends on the dealer's package and configuration. Callers omit what they haven't got.
   *
   * IGNORED on the photo plate, which recolours its own fixtures instead — see
   * `fixtureFinishId` and USE_PHOTO_PLATE. Callers still pass it, because the Three.js
   * fallback does pin them and because the list costs nothing to build.
   */
  fixtures?: HeroFixture[];
  /**
   * Force the canvas backing-store size. Left off, the canvas measures its container and
   * tracks it — which is what the hub wants, since the hero is fluid at every breakpoint.
   */
  width?: number;
  height?: number;
  /**
   * `multiply` keeps the shell's shading visible through the material and is the right
   * answer for a light shell like this one. `soft` replaces the surface at 70% opacity — the
   * escape hatch for a very dark material, which multiply can drive close to black.
   */
  blend?: "multiply" | "soft";
  /**
   * Show the "conceptual rendering" disclaimer over the bottom-right corner.
   *
   * On by default: this render travels onto proposals and orders, where a customer reads it
   * as a picture of what they are buying, and the line is what keeps that honest. Off only
   * for renders too small to read it — the list thumbnail is 120x80, where the text would be
   * illegible and would read as a graphical fault rather than a note.
   */
  showDisclaimer?: boolean;
  className?: string;
};

// ------------------------------ tuning ------------------------------------

/**
 * Tile sizes in inches, used when a material doesn't state its own.
 *
 * Wall: one panel. The kits ship 24" wide by 94.5" tall, which is why a 60" back wall comes
 * out as exactly two and a half panels and a 32" return as one and a third — the seam counts
 * fall out of the arithmetic rather than being chosen. Sheet goods override this with their
 * own tileIn; a Durasein sheet is 30" x 144" and shows no joint across an alcove at all.
 * Floor: the Durato swatch photography is about five 7" planks across and one plank long.
 */
const DEFAULT_WALL_TILE = { w: 24, h: 94.5 };
const DEFAULT_FLOOR_TILE = { w: 35, h: 48 };
/**
 * A countertop's default tile is ONE SOLID-SURFACE SHEET, laid down: 144" along the run by
 * 30.75" deep, measured off Durasein's own full-sheet scans (see DURASEIN_SHEET_IN).
 *
 * It used to be 60x30, i.e. "about a countertop's worth", and that was the wrong shape of
 * answer — a tile size is a statement about the MATERIAL, not about the surface it lands on.
 * Sized to the counter, the whole scan got squeezed onto the counter and the grain came out at
 * whatever magnification the arithmetic happened to produce. At the sheet's real size a 61"
 * counter shows 42% of the scan and 22" of depth shows 72% of it, both at true scale.
 */
const DEFAULT_TOP_TILE = { w: 144, h: 30.75 };

/**
 * THE SHOWER BASE IS RE-TONED, NOT TINTED — see baseTints in lib/hero-regions and
 * _shower_base_note in the region JSON for the measurements.
 *
 * This used to be a list of blend passes here: a multiply for beige and grey, and for black a
 * multiply to a mid grey followed by an opaque fill at 62%. Measured against the plate, the
 * share of the pan's own 41-unit working range that survived was 0.98 white, 0.89 beige, 0.73
 * grey and 0.29 BLACK — and the black number is the mud. The opaque second pass could only
 * throw contrast away, and no pair of blend modes can do better, because the thing that is
 * wrong is the premise: a multiply scales a pan's gloss along with its body, and gloss does
 * not care what colour the acrylic is moulded in.
 */

/**
 * Final warm pass over the whole frame.
 *
 * The plate is warm photography; the textures composited into it come off half a dozen CDNs
 * shot under whatever light those vendors use, mostly cool or neutral. Individually each is
 * plausible, together they read as cut-and-paste because nothing shares a white balance. A
 * few percent of warm light over everything at the end pulls them onto one, and `overlay`
 * does it without flattening — it warms the midtones and leaves the white pan and the black
 * fixtures where they are, which a plain `source-over` wash would not.
 *
 * Deliberately weak. Past about 8% this stops reading as light in a room and starts reading
 * as a sepia filter over a photograph.
 */
const WARM_GRADE = { color: "rgba(255, 235, 205, 0.06)", mode: "overlay" as GlobalCompositeOperation };

// ---------------------------- fixture finishes ------------------------------

/**
 * Target metal for each plumbing finish, keyed by PLUMBING_FINISHES id.
 *
 * These are the colour a fully-lit part of the fixture should reach, not an average — the
 * recolour below spreads each fixture's own shading between black and this value, so a flat
 * mid-grey here would come out as a dull grey blob rather than as metal.
 *
 * Matte black is absent: the plate's fixtures are already matte black, and the most accurate
 * thing to do for that selection is nothing at all.
 */
const FINISH_TINTS: Record<string, [number, number, number]> = {
  chrome: [200, 205, 210],              // #c8cdd2 — cool silver
  stainless: [184, 184, 180],           // #b8b8b4 — warm silver
  "champagne-bronze": [201, 168, 106],  // #c9a86a — warm gold
  "venetian-bronze": [90, 68, 54],      // #5a4436 — dark brown, a subtle shift off black
  "polished-nickel": [212, 208, 200],   // #d4d0c8 — bright warm silver
  "brushed-nickel": [196, 181, 160],    // #c4b5a0 — the fifth finish the towel bars carry
};

/**
 * THE CUTOFF AND THE FEATHER ARE PER PART NOW — see FixturePart in lib/hero-regions and the
 * measurements in the region JSON. They used to be two module constants here, 112 and 12, and
 * that is the single thing this pass changes about fixture tinting.
 *
 * Why it could not stay global: the cutoff is the valley between the fixture's dark mode and
 * the mode of whatever it is standing in front of, and on this plate that surface is a shaded
 * wall for the head, a lit countertop for the faucet, a white acrylic pan for the bottom rail
 * and the door's own glazing for one track span. Measured by Otsu, those valleys land between
 * 77 and 109. A single 112 was above all of them, so every group was recolouring some of the
 * surface behind it — invisible under a dark finish, a coloured smear under a bright one, and
 * that is the family of defects the champagne render exposed.
 */

/**
 * How dark the darkest part of a recoloured fixture is allowed to get, as a share of the
 * target colour.
 *
 * Scaling the target by the pixel's own luminosity alone is the obvious mapping and it comes
 * out far too dark: most of the plate's fixture pixels sit near 25/255, so chrome would land
 * around a quarter strength and read as charcoal. Lifting the floor keeps the fixture's
 * shading — a bright chrome fixture still has near-black creases — while letting the lit
 * faces actually reach the metal colour.
 */
const FIXTURE_SHADE_FLOOR = 0.42;

/**
 * Which slice of a group's own tone range is stretched across the metal, as percentiles.
 *
 * Scaling a pixel's shade by lum/CUTOFF is the obvious mapping and it flattens this plate's
 * fixtures, because none of them uses much of that range. MEASURED, sub-cutoff pixels per
 * group: the valve's escutcheon runs p5=19, p50=37, p95=78, so half of it lives inside a
 * fifteen-unit band; the head is 18/32/89 and the faucet 15/35/108. Against a 112 cutoff the
 * escutcheon's middle half therefore lands between 0.56 and 0.64 of the target colour — an
 * eight percent spread, which reads as metal in a bright finish and as a single flat splotch
 * in a dark one. That is the valve blob: Venetian bronze is (90,68,54), so eight percent of it
 * is eight units of brown.
 *
 * Stretching the group's own p5..p95 across the full shade range instead roughly doubles the
 * contrast that survives recolouring, and it is per GROUP rather than per box so an escutcheon
 * and the lever crossing it stay on one scale and read as one fixture. Percentiles rather than
 * min/max because a single specular pixel or one antialiased edge pixel would otherwise set
 * the whole mapping.
 */
const FIXTURE_TONE_LO_PCT = 0.05;
const FIXTURE_TONE_HI_PCT = 0.95;
/** Below this the group has no usable range and the plain lum/cutoff ramp is used instead. */
const FIXTURE_TONE_MIN_SPAN = 12;

/**
 * TODO — faucet type (1cc vs 8cc).
 *
 * The plate's lavatory faucet is an 8" widespread: a centre spout with two separate handles.
 * A dealer who picks a single-hole (1cc) faucet is shown the widespread anyway, which is
 * wrong in shape though right in finish. Doing better means painting out the two side handles
 * — cloning counter and backsplash pixels over them, which is tractable because both sit on
 * flat, evenly-lit ground — and keeping the centre spout, or dropping in a single-hole
 * silhouette lit to match. Until then the disclaimer carries it: fixture styles are
 * representative, materials are real. `plumbing.selections.faucetType` already holds the
 * answer when someone comes back to this.
 */

/** Crossfade between the outgoing and incoming composite. */
const TRANSITION_MS = 300;

/**
 * How much bigger the square photo FRAME is than the product inside it.
 *
 * Callers size a fixture by its real dimensions — a 6.5" trim plate, a 6" rain head — but
 * what gets drawn is the whole catalog shot, and Build.com's c_lpad transform letterboxes the
 * product into a square with studio whitespace all round it. Drawing a 6.5" frame would
 * therefore render a trim plate noticeably under 6.5". This is the observed ratio between the
 * frame and the product's longest side across these shots; it is a property of how the
 * retailer crops, so it lives here rather than being re-tuned per fixture.
 */
const PHOTO_FRAME_RATIO = 1.5;

/** Warp grid resolution. Higher is smoother and slower; the error at 16 is sub-pixel here. */
const GRID = 16;

// ---------------------------- image loading --------------------------------

// Module-level so switching modules, or coming back to the hub, never refetches a texture the
// browser already has decoded.
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function attemptLoad(src: string, crossOrigin: string | null): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Load a texture, preferring a CORS-clean fetch.
 *
 * The anonymous attempt comes first because a clean image leaves the canvas readable, which
 * is what lets the cutout path below knock a white background out. A CDN that doesn't send
 * the header — Build.com's, for one — fails that attempt, and the retry drops the flag: the
 * pixels still draw, the canvas is simply tainted. Both failing resolves to null and the
 * caller skips that surface rather than breaking the frame.
 *
 * The retry carries a throwaway query parameter, and it does not work without it. A failed
 * CORS request still leaves an entry in the HTTP cache, and a second request for the exact
 * same URL is served from it — so the plain retry inherits the first attempt's failure and
 * the image never appears, which is precisely what happened to the fixture overlays before
 * this was added. Varying the URL forces a genuinely new request. The parameter is unused by
 * every CDN in play here, and same-origin sources never reach this path at all.
 */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  const hit = imageCache.get(src);
  if (hit) return hit;
  const retry = src + (src.includes("?") ? "&" : "?") + "heroRetry=1";
  const p = attemptLoad(src, "anonymous").then((img) => img ?? attemptLoad(retry, null));
  imageCache.set(src, p);
  return p;
}

// ------------------------------- masks -------------------------------------

/**
 * Half the scene resolution. The mask is a shape, not a picture: at 600x400 it still lands
 * within a pixel of the right place once scaled back up, costs a quarter of the memory per
 * region, and the smoothing on the way up feathers the edge — which is wanted anyway, since
 * the ID pass has hard aliased boundaries.
 */
const MASK_SCALE = 0.5;

type MaskSet = Partial<Record<RegionId, HTMLCanvasElement>>;
let maskPromise: Promise<MaskSet> | null = null;

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];

/**
 * Decode the region ID map into one alpha mask per region.
 *
 * Runs once per session and is cached; the result is what every later composite clips
 * against. Same-origin, so `getImageData` is always permitted here — unlike the product
 * photographs, this image is ours.
 *
 * Returns empty for the photo plate, which has no ID render to decode — it clips against
 * hand-traced polygons instead, in paintRegion.
 *
 * Classification normalises each pixel to full brightness before matching. The ID pass is
 * antialiased, so a boundary pixel is some fraction of its region's colour — half-strength
 * magenta is still unambiguously magenta once scaled back up, whereas a raw nearest-colour
 * match would read it as equidistant from magenta and from black and pick arbitrarily.
 * Genuinely dark pixels fall under the floor test and belong to no region, which is how
 * fixtures, glass and the ceiling stay unpainted.
 */
function loadMasks(): Promise<MaskSet> {
  if (maskPromise) return maskPromise;
  const { maskSrc, maskColors } = { maskSrc: SCENE.maskSrc, maskColors: PLATE.maskColors };
  if (!maskSrc || !maskColors) { maskPromise = Promise.resolve({}); return maskPromise; }
  maskPromise = loadImage(maskSrc).then((img) => {
    const out: MaskSet = {};
    if (!img) return out;
    const full = makeCanvas(SCENE.width, SCENE.height);
    const fctx = full.getContext("2d", { willReadFrequently: true });
    if (!fctx) return out;
    fctx.imageSmoothingEnabled = false;
    fctx.drawImage(img, 0, 0, full.width, full.height);
    let src: ImageData;
    try { src = fctx.getImageData(0, 0, full.width, full.height); } catch { return out; }

    const ids = Object.keys(maskColors) as RegionId[];
    const rgb = ids.map((id) => hexToRgb(maskColors[id]));
    const mw = Math.round(full.width * MASK_SCALE), mh = Math.round(full.height * MASK_SCALE);
    const buffers = ids.map(() => new ImageData(mw, mh));
    const px = src.data;

    for (let y = 0; y < mh; y++) {
      const sy = Math.min(full.height - 1, Math.round(y / MASK_SCALE));
      for (let x = 0; x < mw; x++) {
        const sx = Math.min(full.width - 1, Math.round(x / MASK_SCALE));
        const i = (sy * full.width + sx) * 4;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
        if (max < 70) continue;                     // black, or an edge blend too dark to trust
        const k = 255 / max;
        const nr = r * k, ng = g * k, nb = b * k;
        let best = -1, bestD = Infinity;
        for (let c = 0; c < rgb.length; c++) {
          const dr = nr - rgb[c][0], dg = ng - rgb[c][1], db = nb - rgb[c][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bestD) { bestD = d; best = c; }
        }
        if (best < 0 || bestD > 9000) continue;     // not close to any region colour
        buffers[best].data[(y * mw + x) * 4 + 3] = 255;
      }
    }
    ids.forEach((id, c) => {
      const cv = makeCanvas(mw, mh);
      cv.getContext("2d")?.putImageData(buffers[c], 0, 0);
      out[id] = cv;
    });
    return out;
  });
  return maskPromise;
}

// ------------------------------ geometry -----------------------------------

type Px = { x: number; y: number };

/**
 * Projective map from the unit square to a quad given as top-left, top-right, bottom-right,
 * bottom-left — i.e. (0,0), (1,0), (1,1), (0,1).
 *
 * The general 4-point homography, specialised to a unit-square source, which is all this
 * needs and avoids inverting a matrix at runtime.
 */
function unitSquareToQuad(q: Quad): (u: number, v: number) => Px {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;
  const det = dx1 * dy2 - dx2 * dy1;
  if ((dx3 === 0 && dy3 === 0) || det === 0) {
    // Parallelogram (or a degenerate quad): the map is affine, no perspective term.
    a = x1 - x0; b = x2 - x1; c = x0;
    d = y1 - y0; e = y2 - y1; f = y0;
    g = 0; h = 0;
  } else {
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

/**
 * Draw a right triangle of `src` under the affine map that takes its three corners to `p0`,
 * `p1`, `p2`.
 *
 * Source corners are always axis-aligned (one corner plus a horizontal and a vertical leg),
 * which is what makes the matrix fall out directly instead of needing a 3x3 solve: the two
 * legs are exactly the transform's basis vectors.
 *
 * The clip is pushed out from the triangle's centroid by a whisker. Adjacent cells then
 * overlap by well under a pixel, which costs nothing under source-over and is the difference
 * between a clean surface and one crosshatched with hairline gaps.
 */
function drawTriangle(
  ctx: CanvasRenderingContext2D, src: CanvasImageSource,
  ox: number, oy: number, legX: number, legY: number,
  p0: Px, p1: Px, p2: Px,
) {
  const a = (p1.x - p0.x) / legX, b = (p1.y - p0.y) / legX;
  const c = (p2.x - p0.x) / legY, d = (p2.y - p0.y) / legY;
  if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return;
  const e = p0.x - a * ox - c * oy;
  const f = p0.y - b * ox - d * oy;

  const cx = (p0.x + p1.x + p2.x) / 3, cy = (p0.y + p1.y + p2.y) / 3;
  const S = 1.008;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx + (p0.x - cx) * S, cy + (p0.y - cy) * S);
  ctx.lineTo(cx + (p1.x - cx) * S, cy + (p1.y - cy) * S);
  ctx.lineTo(cx + (p2.x - cx) * S, cy + (p2.y - cy) * S);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

/**
 * Warp `src` (treated as covering the whole surface) onto a screen-space quad.
 *
 * Cells whose destination falls outside the canvas are skipped. That is not a micro-
 * optimisation: the side walls extend to roughly -235% of the frame, so most of their grid
 * lands off-screen, and drawing it would triple the work for pixels nobody sees.
 */
function warpOntoQuad(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, quad: Quad, cw: number, ch: number) {
  const map = unitSquareToQuad(quad);
  const sw = src.width, sh = src.height;
  const pts: Px[][] = [];
  for (let j = 0; j <= GRID; j++) {
    const row: Px[] = [];
    for (let i = 0; i <= GRID; i++) row.push(map(i / GRID, j / GRID));
    pts.push(row);
  }
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const p00 = pts[j][i], p10 = pts[j][i + 1], p01 = pts[j + 1][i], p11 = pts[j + 1][i + 1];
      const minX = Math.min(p00.x, p10.x, p01.x, p11.x), maxX = Math.max(p00.x, p10.x, p01.x, p11.x);
      const minY = Math.min(p00.y, p10.y, p01.y, p11.y), maxY = Math.max(p00.y, p10.y, p01.y, p11.y);
      if (maxX < 0 || minX > cw || maxY < 0 || minY > ch) continue;
      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) continue;
      const X0 = (i / GRID) * sw, X1 = ((i + 1) / GRID) * sw;
      const Y0 = (j / GRID) * sh, Y1 = ((j + 1) / GRID) * sh;
      drawTriangle(ctx, src, X0, Y0, X1 - X0, Y1 - Y0, p00, p10, p01);
      drawTriangle(ctx, src, X1, Y1, X0 - X1, Y0 - Y1, p11, p01, p10);
    }
  }
}

// ------------------------------ surfaces -----------------------------------

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * Ceiling on a surface canvas, in pixels.
 *
 * RAISED TO 2048 for the floor's sake. Every other surface asks for less than 1024 and is
 * unaffected, but the floor is a plane running from the back of the room to well below the
 * frame, and on a 2352-wide render its u axis measures 2929 screen pixels — so at the 2x
 * supersample it wants 5858 and was being handed 1024, a shortfall of nearly six times. That
 * is the smear along the bottom edge of the frame: the most magnified part of the floor, where
 * a plank is widest on screen, was carrying the fewest texture columns. 2048 does not close the
 * gap — nothing short of tiling the floor would — but it more than halves it, and it costs one
 * transient 8 MB canvas per floor paint rather than anything persistent.
 */
const SURFACE_MAX = 2048;
/** Below this a surface canvas is too coarse to carry a joint line, whatever the quad's size. */
const SURFACE_MIN = 24;
/**
 * How many surface pixels are built per screen pixel the surface will occupy.
 *
 * The surface used to be built at SURFACE_MAX regardless of how big the quad landed, and that
 * turned out to be visible rather than merely wasteful. The alcove's two planes are seen at
 * very different obliquities — the back wall spans 22.3% of the plate and the left return
 * 6.1% — so a fixed 1024-wide surface was minified 1.9x onto one and 3.4x onto the other.
 * Canvas minification is bilinear, which undersamples rather than area-averages, and a slat
 * texture is mostly narrow dark grooves on lighter faces: undersampling drops grooves and
 * lifts the mean. MEASURED on this plate, same material on both planes, render over plate
 * luminance: the back wall came out at 0.74 of the plate at every height while the return ran
 * 0.79 at mid height and 0.83 low down — the return rendering up to 11% lighter than the back
 * wall under one light, which is exactly what the markup called out.
 *
 * Sizing each surface to its own on-screen extent puts every plane at the SAME minification
 * ratio, so whatever bias the filter has, it is the same bias everywhere and the planes read
 * as one product. 2x is the supersample: enough to keep the filter in its well-behaved range
 * (a 2x reduction is the case bilinear handles correctly) without paying for detail that is
 * then thrown away.
 */
const SURFACE_SUPERSAMPLE = 2;

/**
 * How big to build a surface, from how big its quad lands on the canvas.
 *
 * Edge LENGTHS rather than a bounding box: a quad's u axis runs along its top and bottom
 * edges, and for a plane raking away from the camera — the alcove's return, the floor — the
 * bounding box is much larger than the surface actually is.
 */
function surfaceSize(screenQuad: Quad): { w: number; h: number } {
  const len = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [tl, tr, br, bl] = screenQuad;
  const fit = (px: number) =>
    Math.max(SURFACE_MIN, Math.min(SURFACE_MAX, Math.round(px * SURFACE_SUPERSAMPLE)));
  return {
    w: fit((len(tl, tr) + len(bl, br)) / 2),
    h: fit((len(tl, bl) + len(tr, br)) / 2),
  };
}

/**
 * Width of a rendered panel joint, as a fraction of the surface canvas.
 *
 * A real joint between two wall panels is a hairline — an eighth of an inch on a sixty-inch
 * wall. Rendered honestly at this plate's resolution that is a third of a pixel and vanishes,
 * so the line is drawn wide enough to survive: about one plate pixel once the surface is
 * warped down onto the wall. It is a cue, not a measurement.
 */
const SEAM_FRACTION = 0.006;
const SEAM_ALPHA = 0.22;

/**
 * The material tiled across one face at true scale, ready to be warped onto it.
 *
 * `seamIn` draws the panel joints. Panelled goods arrive in fixed widths and a real install
 * shows a line every panel — 24" for these kits, so a 60" back wall carries two and a 32"
 * return carries one. Sheet goods (Durasein solid surface, which comes 30"x144") show no joint
 * across a wall this size at all, and pass null.
 */
function buildSurface(
  img: HTMLImageElement, face: Face, tileIn: { w: number; h: number },
  screenQuad: Quad, seamIn?: number | null,
): HTMLCanvasElement {
  const rep = tileRepeat(face, tileIn.w, tileIn.h);
  // A wall panel is one piece floor-to-top — it is never butt-jointed halfway up. The field
  // renders taller than the 94.5" the panel really is (see _panel_top_derivation), so tiling
  // vertically at true scale would wrap and draw a horizontal joint near the bottom of the
  // wall, which no install has. Panels therefore stretch to the field height; the 24" VERTICAL
  // joints are untouched, and they are the ones a customer actually sees.
  if (seamIn) rep.y = 1;
  const size = surfaceSize(screenQuad);
  const c = makeCanvas(size.w, size.h);
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  // A tile bigger than the face draws bigger than the canvas and is CROPPED by it, which is
  // how a 144" sheet lands on a 61" counter at true grain size. Math.ceil still gives one
  // draw in that case, and the loop covers the surface whenever the tile is smaller.
  const tw = c.width / rep.x, th = c.height / rep.y;
  for (let j = 0; j < Math.ceil(rep.y); j++) {
    for (let i = 0; i < Math.ceil(rep.x); i++) ctx.drawImage(img, i * tw, j * th, tw, th);
  }

  if (seamIn && seamIn > 0 && face.widthIn > seamIn) {
    // Joints are spaced in real inches from u=0, which is why the return's quad is authored
    // corner-first: it makes u=0 the interior corner, so a full panel terminates there and the
    // offcut falls at the outer edge, the way the kit is actually laid out.
    const step = (seamIn / face.widthIn) * c.width;
    const wpx = Math.max(2, Math.round(c.width * SEAM_FRACTION));
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${SEAM_ALPHA})`;
    for (let x = step; x < c.width - 0.5; x += step) {
      ctx.fillRect(Math.round(x - wpx / 2), 0, wpx, c.height);
    }
    ctx.restore();
  }
  return c;
}

/**
 * The backsplash region, restated at a different height.
 *
 * The JSON authors the band at BACKSPLASH_BASE_IN. Scaling means holding the bottom edge —
 * which sits on the counter and must not move — and pushing the top edge away from it. Both
 * the paint quad and the clip outline have to move together or the material would be drawn
 * at one height and clipped at another.
 */
const BACKSPLASH_BASE_IN = 4;

function scaleBacksplash(region: Region, heightIn: number): { region: Region; clip: Polygon[] } {
  const k = heightIn / BACKSPLASH_BASE_IN;
  // Quad corner order is topLeft, topRight, bottomRight, bottomLeft, so the bottom pair is
  // the anchor and the top pair is what moves.
  const lift = (top: Point, bottom: Point): Point => [
    bottom[0] + (top[0] - bottom[0]) * k,
    bottom[1] + (top[1] - bottom[1]) * k,
  ];
  const faces = region.faces.map((f) => {
    const [tl, tr, br, bl] = f.quad;
    return { ...f, heightIn, quad: [lift(tl, bl), lift(tr, br), br, bl] as Quad };
  });
  const clip = faces.map((f) => [f.quad[0], f.quad[1], f.quad[2], f.quad[3]] as Polygon);
  return { region: { ...region, faces }, clip };
}

/** A flat colour, as a surface. Size is arbitrary — the warp maps whatever it is given. */
function buildColorSurface(color: string): HTMLCanvasElement {
  const c = makeCanvas(16, 16);
  const ctx = c.getContext("2d");
  if (ctx) { ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height); }
  return c;
}

// ------------------------------- cutouts -----------------------------------

type Cutout = { src: CanvasImageSource; w: number; h: number; blend: GlobalCompositeOperation };

/**
 * Turn a product photograph into something that can sit on a wall.
 *
 * Catalog shots are opaque JPEGs on white. The background is removed by flood-filling inward
 * from the edges, rather than by thresholding every light pixel: a chrome faucet is full of
 * near-white speculars, and a plain threshold punches holes straight through the middle of
 * the product. Only white that is actually connected to the border is background.
 *
 * `getImageData` throws on a canvas tainted by a cross-origin image. That is the common case
 * for Build.com's CDN, so the catch is the normal path, not an edge case: the photo is
 * returned as-is to be drawn with `multiply`, under which white is invisible anyway. The
 * difference is only that a finish tint can't be applied without the alpha channel.
 */
function buildCutout(img: HTMLImageElement, tint: string | null): Cutout {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!w || !h) return { src: img, w: 1, h: 1, blend: "multiply" };
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { src: img, w, h, blend: "multiply" };
  ctx.drawImage(img, 0, 0);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, c.width, c.height);
  } catch {
    return { src: img, w, h, blend: "multiply" };   // tainted: multiply hides the white instead
  }

  const px = data.data;
  const W = c.width, H = c.height;

  /**
   * The backdrop colour, sampled rather than assumed.
   *
   * A fixed "brighter than 236" test only removes a near-pure-white background. Real catalog
   * shots are lit to an off-white or a faint grey gradient, and every pixel of that backdrop
   * fails the test — so the knockout removes nothing, the photo composites as an opaque
   * rectangle, and a pale box appears around the fixture on the wall. That is exactly what
   * showed up around the shower trim. Reading the actual corner values and matching against
   * them handles any light backdrop, and the tolerance covers the gradient across it.
   */
  const corners = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + W - 1) * 4];
  let bgR = 0, bgG = 0, bgB = 0;
  for (const i of corners) { bgR += px[i]; bgG += px[i + 1]; bgB += px[i + 2]; }
  bgR /= corners.length; bgG /= corners.length; bgB /= corners.length;
  // Only ever knock out a LIGHT backdrop. A photo shot on a dark or coloured ground would
  // make this a chroma key, and keying a product against an arbitrary colour eats the
  // product; multiply handles those safely instead.
  const bgIsLight = bgR > 200 && bgG > 200 && bgB > 200;
  const TOL = 22;
  const isBg = (i: number) =>
    Math.abs(px[i] - bgR) < TOL && Math.abs(px[i + 1] - bgG) < TOL && Math.abs(px[i + 2] - bgB) < TOL;
  if (!bgIsLight) return { src: img, w, h, blend: "multiply" };

  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const k = y * W + x;
    if (seen[k]) return;
    if (!isBg(k * 4)) return;
    seen[k] = 1;
    stack.push(k);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % W, y = (k - x) / W;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  // If the flood barely spread, the backdrop isn't uniform enough to key against and the
  // result would be a product with a ragged patch of background still attached. Multiply
  // hides a light backdrop wholesale, so fall back rather than ship the patch.
  let removed = 0;
  for (let k = 0; k < W * H; k++) if (seen[k]) removed++;
  if (removed < W * H * 0.05) return { src: img, w, h, blend: "multiply" };

  // A hard alpha edge on a photographed object reads as a cut-out sticker; one pass of
  // half-alpha on the pixels bordering the background is enough to soften it.
  for (let k = 0; k < W * H; k++) {
    if (seen[k]) { px[k * 4 + 3] = 0; continue; }
    const x = k % W, y = (k - x) / W;
    const edge = (x > 0 && seen[k - 1]) || (x < W - 1 && seen[k + 1]) || (y > 0 && seen[k - W]) || (y < H - 1 && seen[k + W]);
    if (edge) px[k * 4 + 3] = 128;
  }
  ctx.putImageData(data, 0, 0);

  if (tint) {
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";   // tints the product only, never the hole
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  return { src: c, w, h, blend: "source-over" };
}

// --------------------------- corner shading --------------------------------

/**
 * Darken a corner so two planes read as two planes.
 *
 * Splitting the alcove into separate quads gets the perspective right — slats on the return
 * compress, slats on the back wall don't — but a clean seam between two equally-lit surfaces
 * still reads as one wall with a line on it. The crease needs ambient occlusion.
 *
 * MEASURED, then halved. The plate's own interior corner dips from shoulders near 171 to 151
 * at its darkest column: a 12% drop over about 2% of plate width each side. Multiply already
 * carries all of that through into the composited material, so painting the measured value
 * again would double it. What is applied here is roughly half, which is enough to hold the
 * corner once a dark panel has flattened the plate's gradient and not enough to draw a stripe.
 *
 * Drawn as a linear gradient across the seam's normal rather than along it, so a leaning
 * corner shades correctly — the alcove's crease drifts 0.2% right over the wall's height.
 */
function paintSeam(frame: CanvasRenderingContext2D, seam: SeamShade, fit: Fit) {
  const [ax, ay] = toPx(seam.from, fit);
  const [bx, by] = toPx(seam.to, fit);
  const half = seam.halfWidth * SCENE.width * fit.scale;
  if (half <= 0) return;

  // Unit normal to the seam, which is the direction the shading fades along.
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;

  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const g = frame.createLinearGradient(mx - nx * half, my - ny * half, mx + nx * half, my + ny * half);
  const a = seam.strength;
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.5, `rgba(0,0,0,${a})`);
  g.addColorStop(1, "rgba(0,0,0,0)");

  frame.save();
  frame.globalCompositeOperation = "multiply";
  frame.beginPath();
  // A quad along the seam, one half-width to each side, extended past both ends so the band
  // doesn't stop short of the surfaces it divides.
  const ex = (dx / len) * half, ey = (dy / len) * half;
  frame.moveTo(ax - nx * half - ex, ay - ny * half - ey);
  frame.lineTo(ax + nx * half - ex, ay + ny * half - ey);
  frame.lineTo(bx + nx * half + ex, by + ny * half + ey);
  frame.lineTo(bx - nx * half + ex, by - ny * half + ey);
  frame.closePath();
  frame.fillStyle = g;
  frame.fill();
  frame.restore();
}

/**
 * The panel field's top edge, drawn as a product edge rather than left as a cut.
 *
 * Panels stop 94.5" up and the wall carries on above them, so the top of the field is a real
 * physical edge with a thickness: a shadow where the panel stands off the wall behind it, and
 * a catch of light on the panel's own top arris. Without them the material just stops, which
 * reads as a clipping boundary rather than as the top of a product.
 *
 * Both lines are one plate pixel at the plate's own resolution and scale with the canvas, so
 * they stay hairlines at any hero size.
 */
const PANEL_EDGE_SHADOW = "rgba(0,0,0,0.20)";
const PANEL_EDGE_HIGHLIGHT = "rgba(255,255,255,0.16)";

function paintPanelTopEdge(frame: CanvasRenderingContext2D, quad: Quad, fit: Fit) {
  const [tl, tr] = quad;
  // CLIPPED at the top of the frame, not skipped. The left return's top is a real product edge
  // on this plate — it follows a measured ceiling line — but that line rises steeply as the wall
  // comes toward the camera and this 2.33:1 crop cuts it off at about x=18.9. Dropping the whole
  // segment because one end is off-plate left the return's panels meeting the back wall's edge
  // at the corner and then simply stopping, which is the one place the join has to read.
  if (tl[1] < 0 && tr[1] < 0) return;
  let a: Point = tl, b: Point = tr;
  if (a[1] < 0 || b[1] < 0) {
    const t = -a[1] / (b[1] - a[1]);
    const cut: Point = [a[0] + (b[0] - a[0]) * t, 0];
    if (a[1] < 0) a = cut; else b = cut;
  }
  const [ax, ay] = toPx(a, fit);
  const [bx, by] = toPx(b, fit);
  const px = (SCENE.height * fit.scale) / SCENE.height;   // one plate pixel, in canvas pixels
  const w = Math.max(1, px);

  frame.save();
  frame.lineCap = "butt";
  // Shadow sits just ABOVE the edge, on the wall the panel stands proud of.
  frame.globalCompositeOperation = "multiply";
  frame.strokeStyle = PANEL_EDGE_SHADOW;
  frame.lineWidth = w;
  frame.beginPath();
  frame.moveTo(ax, ay - w * 0.5);
  frame.lineTo(bx, by - w * 0.5);
  frame.stroke();
  // Highlight sits just BELOW it, on the panel's own top edge.
  frame.globalCompositeOperation = "source-over";
  frame.strokeStyle = PANEL_EDGE_HIGHLIGHT;
  frame.beginPath();
  frame.moveTo(ax, ay + w * 0.6);
  frame.lineTo(bx, by + w * 0.6);
  frame.stroke();
  frame.restore();
}

// --------------------------- repairing the plate ----------------------------

/**
 * The plate with its moved fixture painted out, built once and reused everywhere.
 *
 * Every blend this compositor performs is multiplicative or additive over the photograph, so
 * anything dark in the plate survives all of them. A matte-black shower head on a mid-grey
 * wall cannot be covered by a material — it can only be darkened. When the design moves that
 * head to another wall, the only way to make it leave is to edit the source.
 *
 * SAFE TO READ PIXELS: the plate is same-origin. This runs once at load, and everything
 * downstream — the base draw, the occlusion cut-out, the fixture recolour — reads the repaired
 * canvas, so no path can leak the original.
 */
let repairedPlatePromise: Promise<HTMLCanvasElement | null> | null = null;

/** Average of a small window, so one noisy pixel can't set the ambient. */
function sampleAt(px: Uint8ClampedArray, W: number, H: number, x: number, y: number, ch: number): number {
  let sum = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const sx = Math.min(W - 1, Math.max(0, x + dx)), sy = Math.min(H - 1, Math.max(0, y + dy));
      sum += px[(sy * W + sx) * 4 + ch];
    }
  }
  return sum / 9;
}

/**
 * The wall as it would look with nothing in front of it, across one box.
 *
 * A Coons patch over the box's four surrounding edges: interpolate the left and right ring
 * columns, interpolate the top and bottom ring rows, then subtract the bilinear of the four
 * corners so the two interpolations do not double-count. Exact for a bilinear field, and this
 * wall's ambient is close enough to one over a box this size — the ceiling investigation
 * showed it varying smoothly in both directions with no steps at all.
 */
function ambientField(
  px: Uint8ClampedArray, W: number, H: number,
  x0: number, y0: number, bw: number, bh: number, ring: number, ch: number,
) {
  const lx = Math.max(0, x0 - ring), rx = Math.min(W - 1, x0 + bw + ring);
  const ty = Math.max(0, y0 - ring), by = Math.min(H - 1, y0 + bh + ring);
  const LT = sampleAt(px, W, H, lx, ty, ch), RT = sampleAt(px, W, H, rx, ty, ch);
  const LB = sampleAt(px, W, H, lx, by, ch), RB = sampleAt(px, W, H, rx, by, ch);
  return (x: number, y: number) => {
    const u = bw > 0 ? (x - x0) / bw : 0, v = bh > 0 ? (y - y0) / bh : 0;
    const L = sampleAt(px, W, H, lx, y, ch), R = sampleAt(px, W, H, rx, y, ch);
    const T = sampleAt(px, W, H, x, ty, ch), B = sampleAt(px, W, H, x, by, ch);
    const edges = (1 - u) * L + u * R + (1 - v) * T + v * B;
    const corners = (1 - u) * (1 - v) * LT + u * (1 - v) * RT + (1 - u) * v * LB + u * v * RB;
    return edges - corners;
  };
}

function loadRepairedPlate(): Promise<HTMLCanvasElement | null> {
  if (repairedPlatePromise) return repairedPlatePromise;
  repairedPlatePromise = loadImage(SCENE.src).then((img) => {
    if (!img) return null;
    const c = makeCanvas(SCENE.width, SCENE.height);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (!PLATE.plateRepairs.length) return c;

    const W = c.width, H = c.height;
    let data: ImageData;
    try { data = ctx.getImageData(0, 0, W, H); } catch { return c; }
    const out = data.data;

    // Repairs are ORDERED and each one sees the ones before it. That matters here: the head's
    // shadow reaches up to within a whisker of the head, so the ring the shadow samples its
    // ambient from runs straight through where the head was. Reading that from the original
    // plate dragged the ambient down by the head's own blackness and the shadow came out barely
    // lifted. Each op snapshots the buffer as it stands, samples that, and writes forward — so
    // it sees every earlier repair but never its own partial output.
    for (const op of PLATE.plateRepairs) {
      const src = new Uint8ClampedArray(out);
      const x0 = Math.round(op.box[0] * W), y0 = Math.round(op.box[1] * H);
      const bw = Math.round(op.box[2] * W), bh = Math.round(op.box[3] * H);
      const ring = Math.max(2, Math.round(op.ring * W));
      const fields = [0, 1, 2].map((ch) => ambientField(src, W, H, x0, y0, bw, bh, ring, ch));
      const feather = op.kind === "fill" ? Math.max(1, Math.round(op.feather * W)) : 0;

      for (let y = Math.max(0, y0); y < Math.min(H, y0 + bh); y++) {
        for (let x = Math.max(0, x0); x < Math.min(W, x0 + bw); x++) {
          const i = (y * W + x) * 4;
          if (op.kind === "fill") {
            // Ease the patch out at its own border so the join cannot read as a rectangle.
            const edge = Math.min(x - x0, x0 + bw - 1 - x, y - y0, y0 + bh - 1 - y);
            const t = feather > 0 ? Math.min(1, edge / feather) : 1;
            for (let ch = 0; ch < 3; ch++) out[i + ch] = src[i + ch] + (fields[ch](x, y) - src[i + ch]) * t;
          } else {
            // How far below ambient a pixel sits decides how hard to pull it back: a hard core
            // lifts most of the way, a penumbra about half. Measured on luminance, applied per
            // channel, so the wall keeps its colour instead of washing toward grey.
            const lum = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
            const a0 = fields[0](x, y), a1 = fields[1](x, y), a2 = fields[2](x, y);
            const deficit = (0.2126 * a0 + 0.7152 * a1 + 0.0722 * a2) - lum;
            if (deficit <= 0) continue;
            const k = op.minK + (op.maxK - op.minK) * Math.min(1, deficit / op.deficitFull);
            const amb = [a0, a1, a2];
            for (let ch = 0; ch < 3; ch++) out[i + ch] = src[i + ch] + (amb[ch] - src[i + ch]) * k;
          }
        }
      }
    }
    ctx.putImageData(data, 0, 0);
    return c;
  });
  return repairedPlatePromise;
}

/**
 * Draw the shower head, rather than recolour one the plate already has.
 *
 * The plate photographs its head on the back wall; the design puts it on the left return above
 * the valve, so there is nothing there to recolour and it has to be modelled. Kept deliberately
 * plain — a flange, an arm angling down out of the wall, an oval face — and sized from the
 * catalogue's real dimensions through the return's own scale, which makes it smaller than the
 * plate's baked-in head. That is correct: the plate's was oversized.
 */
function drawModeledHead(
  frame: CanvasRenderingContext2D, head: ModeledHead, tint: [number, number, number] | null, fit: Fit,
) {
  const inPx = head.unitPerIn * SCENE.height * fit.scale;
  if (inPx <= 0) return;
  const [cx, cy] = toPx(head.at, fit);
  const arm = head.armIn * inPx, disc = head.headIn * inPx, th = head.thicknessIn * inPx;
  // Matte black is the base silhouette: the plate's other fixtures are matte black, so an
  // untinted head has to match them rather than default to something lighter.
  const [r, g, b] = tint ?? [43, 43, 43];
  const shade = (k: number) =>
    "rgb(" + Math.round(Math.min(255, r * k)) + "," + Math.round(Math.min(255, g * k)) + "," + Math.round(Math.min(255, b * k)) + ")";

  // The arm runs out of the wall and down, the way a wall-mount head hangs.
  const ex = cx + arm * 0.92, ey = cy + arm * 0.38;

  frame.save();

  // Contact shadow on the wall behind the flange, so the assembly sits on the wall.
  frame.globalCompositeOperation = "multiply";
  frame.fillStyle = "rgba(0,0,0,0.30)";
  frame.beginPath();
  frame.ellipse(cx + th * 0.35, cy + th * 0.45, th * 1.25, th * 1.6, 0, 0, Math.PI * 2);
  frame.fill();

  frame.globalCompositeOperation = "source-over";

  const armGrad = frame.createLinearGradient(cx, cy - th, ex, ey + th);
  armGrad.addColorStop(0, shade(1.0));
  armGrad.addColorStop(1, shade(0.55));
  frame.strokeStyle = armGrad;
  frame.lineWidth = th;
  frame.lineCap = "round";
  frame.beginPath();
  frame.moveTo(cx, cy);
  frame.lineTo(ex, ey);
  frame.stroke();

  frame.fillStyle = shade(0.85);
  frame.beginPath();
  frame.ellipse(cx, cy, th * 0.75, th * 1.05, 0, 0, Math.PI * 2);
  frame.fill();

  // The face, seen from the side and angled down. Lit from the top-left like the rest of the room.
  const headGrad = frame.createLinearGradient(ex - disc * 0.3, ey - disc * 0.3, ex + disc * 0.3, ey + disc * 0.35);
  headGrad.addColorStop(0, shade(1.15));
  headGrad.addColorStop(0.55, shade(0.9));
  headGrad.addColorStop(1, shade(0.5));
  frame.fillStyle = headGrad;
  frame.beginPath();
  frame.ellipse(ex + disc * 0.16, ey + disc * 0.10, disc * 0.30, disc * 0.44, -0.42, 0, Math.PI * 2);
  frame.fill();

  frame.restore();
}

// ------------------------------ occlusion ----------------------------------

/**
 * The plate's foreground objects, cut out and ready to lay back over the composite.
 *
 * A region polygon describes a flat surface. It has no idea that two plants, a toilet, a
 * towel and a vase are standing in front of those surfaces, so left alone the flooring runs
 * across the toilet and the wall panel runs across the leaves. Earlier passes notched the
 * polygons around each object, which works for a toilet and fails badly for a fern — any
 * outline drawn around leaves also encloses the wall between them.
 *
 * So instead: build `plate ∩ occlusion mask` once, and draw it over the finished materials.
 * Every occluder comes back at once, at photographic quality, and the polygons go back to
 * describing surfaces. The mask itself is generated — colour-keyed for foliage, hand-traced
 * for solid objects — by scripts/build-occlusion-mask.mjs.
 *
 * Built at plate resolution and cached for the session: it depends on nothing the dealer can
 * select, so it survives every recomposite.
 */
let occluderPromise: Promise<HTMLCanvasElement | null> | null = null;

function loadOccluders(): Promise<HTMLCanvasElement | null> {
  if (occluderPromise) return occluderPromise;
  const src = OCCLUSION_ENABLED ? SCENE.occlusionSrc : null;
  if (!src) { occluderPromise = Promise.resolve(null); return occluderPromise; }
  occluderPromise = Promise.all([loadRepairedPlate(), loadImage(src)]).then(([plate, mask]) => {
    if (!plate || !mask) return null;
    const c = makeCanvas(SCENE.width, SCENE.height);
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(plate, 0, 0, c.width, c.height);
    // destination-in keeps the plate only where the mask has alpha, and carries the mask's
    // feathered edge into the result — which is what stops restored objects having a cut edge.
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0, c.width, c.height);
    return c;
  });
  return occluderPromise;
}

// -------------------------- recolouring the plate ---------------------------

type FixturePatch = { canvas: HTMLCanvasElement; box: readonly [number, number, number, number] };

// Keyed by finish id. The plate and the boxes are module constants, so a patch built once is
// good for the session — which matters, because this is the only getImageData in the render
// path and we would rather not repeat it on every selection change.
const fixturePatchCache = new Map<string, FixturePatch[]>();

/**
 * Recolour the plate's baked-in fixtures to a plumbing finish.
 *
 * The plate photographs its fixtures in matte black. Rather than hide them under product
 * photographs — which have to be sized, positioned and background-knocked-out, and which
 * cannot be knocked out at all when the retailer's CDN refuses a CORS request — this changes
 * what the plate already shows. The fixture keeps its own photographic shading, its own
 * highlights and its own soft edges; only the metal it appears to be made of changes.
 *
 * READING PIXELS IS SAFE HERE, and only here. This samples the PLATE, which is served from
 * our own origin, never the composited frame — that canvas is tainted the moment a CDN
 * texture lands on it, and getImageData on it would throw. Working from the plate also keeps
 * the cost fixed and tiny: three boxes of a few thousand pixels each, once per finish, rather
 * than a full-canvas read per frame.
 *
 * Pixels above the luminosity cutoff become fully transparent, so the patch carries the
 * fixture and nothing else. Whatever material has been painted behind it — a wood slat wall,
 * a tiled alcove — shows through untouched.
 */
function buildFixturePatches(plate: CanvasImageSource, finishId: string): FixturePatch[] {
  const cached = fixturePatchCache.get(finishId);
  if (cached) return cached;

  const out: FixturePatch[] = [];
  const tint = FIXTURE_TINT_ENABLED ? FINISH_TINTS[finishId] : undefined;
  // No entry means matte black, which the plate already is. Cached as empty so an
  // unrecognised id costs one lookup rather than a rebuild every frame.
  if (!tint) { fixturePatchCache.set(finishId, out); return out; }

  const pw = SCENE.width, ph = SCENE.height;

  for (const group of Object.values(PLATE.fixtureParts) as FixturePart[][]) {
    // Read every part of the GROUP first, so the tone mapping below is one scale for the whole
    // fixture. A per-part scale would map an escutcheon and the lever crossing it differently
    // and they would stop looking like one piece of metal. The CUTOFF stays per part, because
    // that is a property of the surface behind each piece rather than of the finish choice.
    const read: Array<{ c: HTMLCanvasElement; data: ImageData; part: FixturePart }> = [];
    for (const part of group) {
      const box = part.box;
      const sx = Math.round(box[0] * pw), sy = Math.round(box[1] * ph);
      const sw = Math.max(1, Math.round(box[2] * pw)), sh = Math.max(1, Math.round(box[3] * ph));
      const c = makeCanvas(sw, sh);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) continue;
      ctx.drawImage(plate, sx, sy, sw, sh, 0, 0, sw, sh);
      try {
        read.push({ c, data: ctx.getImageData(0, 0, sw, sh), part });
      } catch {
        // Only reachable if the plate stops being same-origin. Bail on the whole finish rather
        // than ship half the fixtures recoloured; matte black is a correct-looking fallback.
        fixturePatchCache.set(finishId, []);
        return [];
      }
    }

    // The group's own tone range, from the pixels that are actually fixture.
    const tones: number[] = [];
    for (const { data, part } of read) {
      const p = data.data;
      for (let i = 0; i < p.length; i += 4) {
        const lum = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
        if (lum < part.cutoff) tones.push(lum);
      }
    }
    tones.sort((a, b) => a - b);
    const lo = tones.length ? tones[Math.floor(FIXTURE_TONE_LO_PCT * (tones.length - 1))] : 0;
    const hi = tones.length ? tones[Math.floor(FIXTURE_TONE_HI_PCT * (tones.length - 1))] : 112;
    // A group with no usable spread falls back to the plain ramp rather than having a
    // near-zero denominator turn two adjacent tones into black and white.
    const stretched = hi - lo >= FIXTURE_TONE_MIN_SPAN;

    for (const { c, data, part } of read) {
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        if (lum >= part.cutoff) { px[i + 3] = 0; continue; }
        // Spread the fixture's own tone across the metal, floored so lit faces reach the target
        // colour instead of everything landing near black. This is what keeps a recoloured
        // fixture reading as a photograph of metal rather than as a silhouette filled in.
        const t = stretched
          ? Math.min(1, Math.max(0, (lum - lo) / (hi - lo)))
          : lum / part.cutoff;
        // A part thin enough to have no modelling of its own opts out of the stretch — see
        // FixturePart.shade. Amplifying one pixel's compression noise across the whole shade
        // range is what turned the door's bottom rail into a dashed line.
        const shade = part.shade ?? FIXTURE_SHADE_FLOOR + (1 - FIXTURE_SHADE_FLOOR) * t;
        px[i] = tint[0] * shade;
        px[i + 1] = tint[1] * shade;
        px[i + 2] = tint[2] * shade;
        px[i + 3] = 255 * Math.min(1, (part.cutoff - lum) / part.feather);
      }
      c.getContext("2d")?.putImageData(data, 0, 0);
      out.push({ canvas: c, box: part.box });
    }
  }
  fixturePatchCache.set(finishId, out);
  return out;
}

// --------------------------- the shower base --------------------------------

/**
 * The plate's pan, re-toned to a catalogue base colour, as one patch drawn 1:1.
 *
 * Not a warped surface: there is no texture to map onto the pan, only the photograph of a white
 * acrylic base to re-tone, so this reads the plate's own pixels over the pan's bounding box and
 * writes back `factor * L + spec * max(0, L - knee)` per channel. Keeping the diffuse and the
 * specular terms apart is the whole point — the body of the pan takes the colour, the gloss
 * along the curb and around the drain does not, and that is what stops a black base collapsing
 * into a flat hole. Clipped to the pan's own polygons by the caller.
 *
 * Cached per colour like the fixture patches, and for the same reason: this is a getImageData
 * over a few thousand plate pixels and nothing about it changes when another selection does.
 */
type BasePatch = { canvas: HTMLCanvasElement; box: readonly [number, number, number, number] };
const basePatchCache = new Map<string, BasePatch | null>();

/** Bounding box of a region's clip outlines, in image fractions. */
function clipBounds(polys: Polygon[]): readonly [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polys) for (const [x, y] of poly) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : null;
}

function buildBasePatch(plate: CanvasImageSource, colorId: string): BasePatch | null {
  const hit = basePatchCache.get(colorId);
  if (hit !== undefined) return hit;

  const tint = PLATE.baseTints[colorId];
  const clip = PLATE.clips?.showerFloor;
  // White has no entry — the plate already photographs a white pan — and a plate with no pan
  // polygons has nothing to re-tone.
  if (!tint || !clip?.length) { basePatchCache.set(colorId, null); return null; }
  const bounds = clipBounds(clip);
  if (!bounds) { basePatchCache.set(colorId, null); return null; }

  const pw = SCENE.width, ph = SCENE.height;
  // Clamped to the plate: the curb's own polygon runs below the bottom of the frame.
  const sx = Math.max(0, Math.floor(bounds[0] * pw)), sy = Math.max(0, Math.floor(bounds[1] * ph));
  const sw = Math.min(pw - sx, Math.ceil(bounds[2] * pw) + 1);
  const sh = Math.min(ph - sy, Math.ceil(bounds[3] * ph) + 1);
  if (sw < 1 || sh < 1) { basePatchCache.set(colorId, null); return null; }

  const c = makeCanvas(sw, sh);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) { basePatchCache.set(colorId, null); return null; }
  ctx.drawImage(plate, sx, sy, sw, sh, 0, 0, sw, sh);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, sw, sh);
  } catch {
    // Same-origin plate, so unreachable in practice; a null patch leaves the pan white, which
    // is a correct-looking fallback rather than a broken one.
    basePatchCache.set(colorId, null);
    return null;
  }

  const px = data.data;
  const [fr, fg, fb] = tint.factor;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const gloss = tint.spec * Math.max(0, lum - tint.knee);
    px[i] = Math.min(255, px[i] * fr + gloss);
    px[i + 1] = Math.min(255, px[i + 1] * fg + gloss);
    px[i + 2] = Math.min(255, px[i + 2] * fb + gloss);
  }
  ctx.putImageData(data, 0, 0);
  const patch: BasePatch = { canvas: c, box: [sx / pw, sy / ph, sw / pw, sh / ph] };
  basePatchCache.set(colorId, patch);
  return patch;
}

// ------------------------------ compositing --------------------------------

/** Maps the base scene's normalised coordinates onto the canvas, cover-fitted. */
type Fit = { scale: number; ox: number; oy: number };

function coverFit(cw: number, ch: number): Fit {
  const scale = Math.max(cw / SCENE.width, ch / SCENE.height);
  return { scale, ox: (cw - SCENE.width * scale) / 2, oy: (ch - SCENE.height * scale) / 2 };
}

const toPx = (p: Point, fit: Fit): Point => [fit.ox + p[0] * SCENE.width * fit.scale, fit.oy + p[1] * SCENE.height * fit.scale];
const quadPx = (q: Quad, fit: Fit): Quad => [toPx(q[0], fit), toPx(q[1], fit), toPx(q[2], fit), toPx(q[3], fit)];

type Paint =
  | { kind: "texture"; region: Region; img: HTMLImageElement; tileIn: { w: number; h: number }; seamIn?: number | null }
  /**
   * `mode` overrides the frame blend for this one region. Only the shower base uses it, to
   * lay black down opaquely; everything else leaves it off and multiplies like the rest.
   */
  | { kind: "color"; region: Region; color: string; alpha: number; mode?: GlobalCompositeOperation };

/** One product photo pinned to the scene. `sizeIn` is the product's longest real dimension. */
export type HeroFixture = { anchor: AnchorId; url: string; sizeIn: number };

type Pin = { cutout: Cutout; anchor: { at: Point; unitPerIn: number }; photoIn: number };

/** Trace a region's clip outlines into the current path, in canvas pixels. */
function tracePolygons(ctx: CanvasRenderingContext2D, polys: Polygon[], fit: Fit) {
  ctx.beginPath();
  for (const poly of polys) {
    if (poly.length < 3) continue;
    const [sx, sy] = toPx(poly[0], fit);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < poly.length; i++) {
      const [x, y] = toPx(poly[i], fit);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

function paintRegion(
  frame: CanvasRenderingContext2D, layer: HTMLCanvasElement, paint: Paint,
  fit: Fit, blend: "multiply" | "soft", mask?: HTMLCanvasElement, clip?: Polygon[],
) {
  const lctx = layer.getContext("2d");
  if (!lctx) return;
  lctx.clearRect(0, 0, layer.width, layer.height);

  // Cut the warped surface down to the pixels the region actually occupies. The quad is the
  // whole flat surface; this is what survived the fixtures standing in front of it. Both are
  // needed — without it the flooring covers the toilet and the tile covers the shower head,
  // because a quad has no idea anything is in the way.
  //
  // Two forms, one job. The render plate answers with a MASK decoded from its ID pass, applied
  // after the fact with destination-in. The photo plate answers with hand-traced POLYGONS,
  // which are cheaper as a clip set before the warp — no second full-canvas bitmap per region,
  // and no resample of one. Even-odd so a nested outline reads as a hole.
  lctx.save();
  if (clip?.length) { tracePolygons(lctx, clip, fit); lctx.clip("evenodd"); }
  for (const face of paint.region.faces) {
    const screenQuad = quadPx(face.quad, fit);
    const surface = paint.kind === "texture"
      ? buildSurface(paint.img, face, paint.tileIn, screenQuad, paint.seamIn)
      : buildColorSurface(paint.color);
    warpOntoQuad(lctx, surface, screenQuad, layer.width, layer.height);
  }
  lctx.restore();

  if (mask) {
    lctx.save();
    lctx.globalCompositeOperation = "destination-in";
    lctx.imageSmoothingEnabled = true;
    lctx.drawImage(mask, fit.ox, fit.oy, SCENE.width * fit.scale, SCENE.height * fit.scale);
    lctx.restore();
  }
  frame.save();
  // `soft` exists for materials multiply would crush; see the blend prop. A paint may also
  // name its own mode, which wins over both — that is how the black shower base gets laid
  // down opaquely while every other surface still multiplies.
  frame.globalCompositeOperation =
    (paint.kind === "color" && paint.mode) ? paint.mode : blend === "soft" ? "source-over" : "multiply";
  frame.globalAlpha = paint.kind === "color" ? paint.alpha : blend === "soft" ? 0.7 : TEXTURE_ALPHA;
  frame.drawImage(layer, 0, 0);
  frame.restore();
}

function pinCutout(frame: CanvasRenderingContext2D, pin: Pin, fit: Fit) {
  const { cutout, anchor, photoIn } = pin;
  const hPx = anchor.unitPerIn * photoIn * SCENE.height * fit.scale;
  const wPx = hPx * (cutout.w / cutout.h);
  const [cx, cy] = toPx(anchor.at, fit);
  frame.save();
  frame.globalCompositeOperation = cutout.blend;
  frame.drawImage(cutout.src, cx - wPx / 2, cy - hPx / 2, wPx, hPx);
  frame.restore();
}

// ------------------------------ component ----------------------------------

export function HeroCompositor({
  wallMaterial = null,
  wallMaterialBack = null,
  wallMaterialLeft = null,
  wallMaterialRight = null,
  floorMaterial = null,
  vanityColor = null,
  vanityTopColor = null,
  vanityTopMaterial = null,
  showerBaseColor = null,
  backsplashIn = null,
  fixtureFinish = null,
  fixtureFinishId = null,
  fixtures = [],
  width,
  height,
  blend = "multiply",
  showDisclaimer = true,
  className = "",
}: HeroCompositorProps) {
  const { t } = useLanguage();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The last fully-composited frame, kept so the next one can cross-fade out of it.
  const prevRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const seqRef = useRef(0);           // guards against a slow texture landing after a newer one
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Track the container unless the caller pinned a size. Device pixel ratio is capped at 2:
  // beyond that the warp cost rises with no visible gain on the tablets this runs on.
  useEffect(() => {
    if (width && height) { setSize({ w: width, h: height }); return; }
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      setSize({ w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  // Selections are flattened to primitives so the render effect re-runs on a real change and
  // not on every parent render that rebuilds an equal object literal.
  // Each alcove plane resolves its own material, falling back to the shared one. Flattened to
  // primitives for the same reason as everything else here: so an equal object rebuilt by the
  // parent on every render doesn't retrigger a composite.
  const backMat = wallMaterialBack ?? wallMaterial;
  const leftMat = wallMaterialLeft ?? wallMaterial;
  const wallUrl = backMat?.textureUrl ?? null;
  const wallTileW = backMat?.tileIn?.w ?? DEFAULT_WALL_TILE.w;
  const wallTileH = backMat?.tileIn?.h ?? DEFAULT_WALL_TILE.h;
  const wallSeam = backMat?.seamIn ?? null;
  const wallLeftUrl = leftMat?.textureUrl ?? null;
  const wallLeftTileW = leftMat?.tileIn?.w ?? DEFAULT_WALL_TILE.w;
  const wallLeftTileH = leftMat?.tileIn?.h ?? DEFAULT_WALL_TILE.h;
  const wallLeftSeam = leftMat?.seamIn ?? null;
  const rightMat = wallMaterialRight ?? wallMaterial;
  const wallRightUrl = rightMat?.textureUrl ?? null;
  const wallRightTileW = rightMat?.tileIn?.w ?? DEFAULT_WALL_TILE.w;
  const wallRightTileH = rightMat?.tileIn?.h ?? DEFAULT_WALL_TILE.h;
  const wallRightSeam = rightMat?.seamIn ?? null;
  // Fixtures are flattened to a string so an equal list rebuilt by the parent on every render
  // doesn't retrigger a composite; the effect below reads the array itself.
  const fixtureKey = fixtures.map((f) => `${f.anchor}:${f.url}:${f.sizeIn}`).join("|");
  const floorUrl = floorMaterial?.textureUrl ?? null;
  const floorTileW = floorMaterial?.tileIn?.w ?? DEFAULT_FLOOR_TILE.w;
  const floorTileH = floorMaterial?.tileIn?.h ?? DEFAULT_FLOOR_TILE.h;
  const topUrl = vanityTopMaterial?.textureUrl ?? null;
  const topTileW = vanityTopMaterial?.tileIn?.w ?? DEFAULT_TOP_TILE.w;
  const topTileH = vanityTopMaterial?.tileIn?.h ?? DEFAULT_TOP_TILE.h;

  const compose = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const seq = ++seqRef.current;
    const { w, h } = size;

    const needed = [SCENE.src, floorUrl, wallUrl, wallLeftUrl, wallRightUrl, topUrl, ...fixtures.map((f) => f.url)].filter(Boolean) as string[];
    const uncached = needed.filter((s) => !imageCache.has(s));
    if (uncached.length) setLoading(true);

    const [base, masks, occluders, floorImg, wallImg, wallLeftImg, wallRightImg, topImg, fixtureImgs] = await Promise.all([
      loadRepairedPlate(),
      loadMasks(),
      loadOccluders(),
      floorUrl ? loadImage(floorUrl) : Promise.resolve(null),
      wallUrl ? loadImage(wallUrl) : Promise.resolve(null),
      wallLeftUrl ? loadImage(wallLeftUrl) : Promise.resolve(null),
      wallRightUrl ? loadImage(wallRightUrl) : Promise.resolve(null),
      topUrl ? loadImage(topUrl) : Promise.resolve(null),
      Promise.all(fixtures.map((f) => loadImage(f.url))),
    ]);
    if (seq !== seqRef.current) return;   // a newer selection landed while these were in flight
    setLoading(false);

    // Without the shell there is no scene to composite into; every other failure is skippable.
    if (!base) { setFailed(true); return; }
    setFailed(false);

    const fit = coverFit(w, h);
    const frame = makeCanvas(w, h);
    const fctx = frame.getContext("2d");
    if (!fctx) return;
    fctx.imageSmoothingQuality = "high";
    fctx.drawImage(base, fit.ox, fit.oy, SCENE.width * fit.scale, SCENE.height * fit.scale);

    // Floor first, then walls, then fixtures — back to front, so a fixture is never buried
    // under a surface drawn after it.
    const R = PLATE.regions;
    const clipFor = (id: RegionId) => PLATE.clips?.[id];
    const layer = makeCanvas(w, h);
    if (floorImg) {
      paintRegion(fctx, layer, { kind: "texture", region: R.floor, img: floorImg, tileIn: { w: floorTileW, h: floorTileH } }, fit, blend, masks.floor, clipFor("floor"));
    }
    // The alcove: two planes on the photo plate, one region on the render plate. Branching on
    // whether the split regions carry geometry keeps the fallback working without a flag test.
    if (R.showerWallBack.faces.length || R.showerWallLeft.faces.length) {
      const planes: Array<[Region, HTMLImageElement | null, { w: number; h: number }, number | null, RegionId]> = [
        [R.showerWallBack, wallImg, { w: wallTileW, h: wallTileH }, wallSeam, "showerWallBack"],
        [R.showerWallLeft, wallLeftImg, { w: wallLeftTileW, h: wallLeftTileH }, wallLeftSeam, "showerWallLeft"],
        [R.showerWallRight, wallRightImg, { w: wallRightTileW, h: wallRightTileH }, wallRightSeam, "showerWallRight"],
      ];
      for (const [region, img, tileIn, seamIn, id] of planes) {
        if (img && region.faces.length) {
          paintRegion(fctx, layer, { kind: "texture", region, img, tileIn, seamIn }, fit, blend, undefined, clipFor(id));
        }
      }
      // The creases, once material is down. Skipped when nothing is painted — there is no
      // corner to define between two patches of bare plate.
      const anyWall = !!(wallImg || wallLeftImg || wallRightImg);
      if (anyWall && PLATE.seams.alcoveInterior) paintSeam(fctx, PLATE.seams.alcoveInterior, fit);
      if (anyWall && PLATE.seams.alcoveRight) paintSeam(fctx, PLATE.seams.alcoveRight, fit);
      // One continuous product edge round the alcove. Drawn per plane because each plane's top
      // is a different line, but they share endpoints at both corners so it reads as one.
      for (const [region, img] of planes) {
        if (img && region.faces.length) paintPanelTopEdge(fctx, region.faces[0].quad, fit);
      }
    } else if (wallImg) {
      paintRegion(fctx, layer, { kind: "texture", region: R.showerArea, img: wallImg, tileIn: { w: wallTileW, h: wallTileH }, seamIn: wallSeam }, fit, blend, masks.showerArea, clipFor("showerArea"));
    }
    // The shower base is a catalogue colour, not a material — one moulded acrylic pan in four
    // finishes. White is a no-op: the plate's pan is already white. The patch is the plate's own
    // pan re-toned, so it goes down source-over at 1:1 rather than through the warp; clipping it
    // to the pan's polygons is what keeps it off the curb's surroundings and the room floor.
    const basePatch = showerBaseColor ? buildBasePatch(base, showerBaseColor) : null;
    const panClip = clipFor("showerFloor");
    if (basePatch && panClip?.length) {
      fctx.save();
      tracePolygons(fctx, panClip, fit);
      fctx.clip("evenodd");
      const [bx, by, bw, bh] = basePatch.box;
      fctx.drawImage(
        basePatch.canvas,
        fit.ox + bx * SCENE.width * fit.scale, fit.oy + by * SCENE.height * fit.scale,
        bw * SCENE.width * fit.scale, bh * SCENE.height * fit.scale,
      );
      fctx.restore();
    }
    // Where the curb stands on the room floor. Both sides of that line are now painted — the
    // curb by the pan's colour, the floor by the flooring — so without it they meet as two flat
    // fields and the base looks laid on top of the floor rather than set into it.
    if (basePatch && floorImg && PLATE.seams.curbFloor) paintSeam(fctx, PLATE.seams.curbFloor, fit);
    // The cabinet is a flat tint — the catalogue publishes door colours as hex swatches, not
    // as photography. The countertop prefers a real Durasein sheet scan and falls back to its
    // hex when the colour has no scan behind it.
    if (vanityColor) paintRegion(fctx, layer, { kind: "color", region: R.vanityArea, color: vanityColor, alpha: 0.92 }, fit, blend, masks.vanityArea, clipFor("vanityArea"));
    // THE CABINET'S THREE EDGES, painted after both the cabinet and the floor, which is why
    // they are here rather than beside the floor pass: two of the three divide the cabinet from
    // the flooring and the later pass would bury them. They were measured two passes ago and
    // never drawn — the only call was on a seam key this plate does not define — which is why
    // the cabinet floated and both junctions read open however well the coordinates were fixed.
    if (vanityColor || floorImg) {
      if (PLATE.seams.vanityToe) paintSeam(fctx, PLATE.seams.vanityToe, fit);
    }
    if (vanityColor) {
      if (PLATE.seams.vanityLeft) paintSeam(fctx, PLATE.seams.vanityLeft, fit);
      if (PLATE.seams.vanityRight) paintSeam(fctx, PLATE.seams.vanityRight, fit);
    }
    // The counter is TWO faces of one region — the top surface and its 1.25" front edge — so a
    // single call paints both, each at its own real height. See PHOTO_FACES.vanityTop.
    if (topImg) paintRegion(fctx, layer, { kind: "texture", region: R.vanityTop, img: topImg, tileIn: { w: topTileW, h: topTileH } }, fit, blend, masks.vanityTop, clipFor("vanityTop"));
    else if (vanityTopColor) paintRegion(fctx, layer, { kind: "color", region: R.vanityTop, color: vanityTopColor, alpha: 0.88 }, fit, blend, masks.vanityTop, clipFor("vanityTop"));
    // The splash is the counter's material carried up the wall, so it follows whatever the
    // counter resolved to — real scan or hex — rather than deciding for itself.
    //
    // ONE piece, and it runs the full length of the counter. There used to be a second region
    // for the splash's right RETURN; it was 0.25% of plate width and a face that narrow cannot
    // carry a texture — see _side_splash_dropped. The back splash now covers it and the plate's
    // own dark return column comes through multiply.
    const splashPainted = !!(backsplashIn && R.vanityBacksplash.faces.length && (topImg || vanityTopColor));
    if (splashPainted) {
      const scaled = scaleBacksplash(R.vanityBacksplash, backsplashIn as number);
      if (topImg) paintRegion(fctx, layer, { kind: "texture", region: scaled.region, img: topImg, tileIn: { w: topTileW, h: topTileH } }, fit, blend, undefined, scaled.clip);
      else if (vanityTopColor) paintRegion(fctx, layer, { kind: "color", region: scaled.region, color: vanityTopColor, alpha: 0.88 }, fit, blend, undefined, scaled.clip);
    }
    // The miter, drawn as a joint rather than as a boundary between two regions. Its top follows
    // the splash: the seam is authored at the 4" height and lifted about the counter's back
    // edge, which is the one point on the joint that a height change cannot move.
    //
    // The foot is the back edge's RIGHT end (quad[2]), not its left (quad[3]). The joint stands
    // at x=77.08, which is the right end of the run, and the back edge falls half a percent of
    // plate height across the counter — anchoring the lift at the far end scaled the seam about
    // a point half a percent below where it actually stands, and a 6" selection overran the
    // splash's own top by a plate pixel.
    if (splashPainted && PLATE.seams.splashCorner) {
      const s = PLATE.seams.splashCorner;
      const foot = R.vanityBacksplash.faces[0].quad[2][1];
      const k = (backsplashIn as number) / BACKSPLASH_BASE_IN;
      paintSeam(fctx, { ...s, from: [s.from[0], foot + (s.from[1] - foot) * k] }, fit);
    }

    // Foreground objects back on top of every material, in one pass.
    //
    // BEFORE THE FIXTURES, AND SINCE PHASE 3 THAT ORDERING IS LOAD-BEARING. The mask now
    // contains the sliding door's hardware, which is also a tint group. Restoring first and
    // tinting second means the hardware comes back as plate pixels and is then recoloured;
    // the other way round, the restore would paint plate-black straight over a Chrome tint and
    // every finish would render matte black. The one thing this order costs is that a tint box
    // must not overlap an occluder it does not own — which is why the door post's tint box
    // stops at y=65.5, where the plant's foliage starts climbing over it.
    if (occluders) {
      fctx.drawImage(occluders, fit.ox, fit.oy, SCENE.width * fit.scale, SCENE.height * fit.scale);
    }

    // The glass, put back over the materials.
    //
    // Multiply keeps everything the plate's glazing does DARKLY — the slight tint of the sheet,
    // the shadow of its edges — and throws away everything it does brightly, which is most of
    // what makes glass read as glass. Pick a dark panel and the glazed half of the alcove comes
    // out identical to the unglazed half. So the plate is drawn back over the glazed polygons in
    // `screen`, which can only ADD light: the reflections return, and every pixel where the
    // plate is dark contributes nothing at all.
    //
    // That last property is what makes the placement safe. The source is the PLATE, not white,
    // so over the door's hardware — matte black in the photograph — screen is a no-op no matter
    // what has been painted underneath. It runs AFTER the occlusion restore, so the glass sits
    // over restored surfaces rather than under them, and BEFORE the fixture tint, so a Chrome
    // track (which is a bright colour, not a dark one) is laid down last and cannot be washed
    // out by its own reflection.
    //
    // Screen is also self-limiting, which is why one alpha serves both a dark wall and a light
    // one: the amount added is proportional to (255 - destination), so a near-white Durasein
    // panel takes almost nothing while a dark slat panel takes the full reflection.
    if (PLATE.glass && PLATE.glass.alpha > 0) {
      fctx.save();
      fctx.beginPath();
      // Both sheets go into ONE path. They overlap by the 0.91% of plate width where the sliding
      // panel laps the fixed one, and a clip region is a set — so the lap is screened once, not
      // twice. Filling them separately would put a bright stripe down the overlap, which is the
      // one place the plate is actually a shade DARKER for having two thicknesses of glass.
      for (const poly of PLATE.glass.polygons) {
        poly.forEach((pt, i) => {
          const [px, py] = toPx(pt, fit);
          if (i === 0) fctx.moveTo(px, py); else fctx.lineTo(px, py);
        });
        fctx.closePath();
      }
      fctx.clip();
      fctx.globalCompositeOperation = "screen";
      fctx.globalAlpha = PLATE.glass.alpha;
      fctx.drawImage(base, fit.ox, fit.oy, SCENE.width * fit.scale, SCENE.height * fit.scale);
      fctx.restore();
    }

    // Fixtures last, over every painted surface.
    //
    // Two strategies, one per plate. The photo plate RECOLOURS the fixtures it already has,
    // which is why it ignores `fixtures` entirely: its fixtures are photographed into the
    // image and look better recoloured than covered. The render plate PINS product photos at
    // anchors, in caller order so a caller that pins two overlapping pieces controls which
    // sits on top.
    if (USE_PHOTO_PLATE) {
      for (const patch of buildFixturePatches(base, fixtureFinishId ?? "")) {
        const [x, y, w, h] = patch.box;
        fctx.drawImage(
          patch.canvas,
          fit.ox + x * SCENE.width * fit.scale, fit.oy + y * SCENE.height * fit.scale,
          w * SCENE.width * fit.scale, h * SCENE.height * fit.scale,
        );
      }
      // A drawn head, for a plate that does not photograph one where the design needs it. This
      // plate does — on the left return, at a true 72in above the pan — so PHOTO_SCENE sets
      // modeledHead to null and the head is recoloured like every other fixture instead. The
      // call stays for the Three.js path and for the next plate.
      if (PLATE.modeledHead) {
        drawModeledHead(fctx, PLATE.modeledHead, FINISH_TINTS[fixtureFinishId ?? ""] ?? null, fit);
      }
    } else {
      fixtures.forEach((f, i) => {
        const img = fixtureImgs[i];
        if (!img) return;   // load failed, or the catalogue had no usable photo — modelled fixture stands
        pinCutout(fctx, {
          cutout: buildCutout(img, fixtureFinish),
          anchor: PLATE.anchors[f.anchor],
          photoIn: f.sizeIn * PHOTO_FRAME_RATIO,
        }, fit);
      });
    }

    // Warm grade last, over everything including the fixtures, because its whole job is to
    // put the composited layers and the plate under one light. Applied to the plate's own
    // rectangle rather than the full canvas so a container wider than the scene doesn't get a
    // warm band down its letterboxed edges.
    fctx.save();
    fctx.globalCompositeOperation = WARM_GRADE.mode;
    fctx.fillStyle = WARM_GRADE.color;
    fctx.fillRect(fit.ox, fit.oy, SCENE.width * fit.scale, SCENE.height * fit.scale);
    fctx.restore();

    // ---- present, cross-fading from whatever was on screen ----
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; prevRef.current = null; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const prev = prevRef.current;
    const present = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(frame, 0, 0);
      prevRef.current = frame;
    };
    // First paint has nothing to fade from, and fading in from blank would flash the panel.
    if (!prev || prev.width !== w || prev.height !== h) { present(); return; }

    const start = performance.now();
    const step = () => {
      if (seq !== seqRef.current) return;   // superseded mid-fade; the newer frame takes over
      const p = Math.min(1, (performance.now() - start) / TRANSITION_MS);
      const eased = p * p * (3 - 2 * p);
      ctx.clearRect(0, 0, w, h);
      // The outgoing frame stays fully opaque underneath so the cross-fade never dips through
      // a translucent middle — only the incoming frame's alpha moves.
      ctx.globalAlpha = 1;
      ctx.drawImage(prev, 0, 0);
      ctx.globalAlpha = eased;
      ctx.drawImage(frame, 0, 0);
      ctx.globalAlpha = 1;
      if (p < 1) { rafRef.current = requestAnimationFrame(step); return; }
      rafRef.current = null;
      prevRef.current = frame;
    };
    rafRef.current = requestAnimationFrame(step);
  }, [
    size, blend, wallUrl, wallTileW, wallTileH, wallSeam,
    wallLeftUrl, wallLeftTileW, wallLeftTileH, wallLeftSeam,
    wallRightUrl, wallRightTileW, wallRightTileH, wallRightSeam,
    floorUrl, floorTileW, floorTileH,
    topUrl, topTileW, topTileH, showerBaseColor, backsplashIn,
    vanityColor, vanityTopColor, fixtureFinish, fixtureFinishId, fixtureKey,
  ]);

  useEffect(() => {
    void compose();
    return () => { if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
  }, [compose]);

  const label = useMemo(() => {
    const parts = [wallMaterial?.name, floorMaterial?.name].filter(Boolean);
    return parts.length ? `${t("configurator.hero.alt")} — ${parts.join(" · ")}` : t("configurator.hero.alt");
  }, [wallMaterial?.name, floorMaterial?.name, t]);

  return (
    <div ref={hostRef} className={`relative overflow-hidden ${className}`}>
      <canvas ref={canvasRef} role="img" aria-label={label} className="block h-full w-full" />
      {loading && (
        <div className="absolute right-3 top-3 flex items-center gap-2 rounded-full bg-card/85 px-2.5 py-1 backdrop-blur">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.hero.loading")}</span>
        </div>
      )}
      {/*
        Drawn as HTML over the canvas rather than painted into it, so it stays crisp at any
        device pixel ratio, wraps on a narrow hero, and reads to a screen reader. The scrim is
        a gradient rather than a box because the corner it sits in is the floor, whose tone
        changes with the flooring selection — a fixed panel would sometimes be invisible and
        sometimes look like a sticker.
      */}
      {showDisclaimer && !failed && (
        <p className="pointer-events-none absolute inset-x-0 bottom-0 select-none bg-gradient-to-t from-ink/55 to-transparent px-3 pb-1.5 pt-6 text-right text-[10px] leading-tight text-white/85 sm:text-[11px]">
          {t("configurator.hero.disclaimer")}
        </p>
      )}
      {failed && (
        <div className="absolute inset-0 grid place-items-center bg-paper/80 p-4 text-center text-xs text-muted">
          {t("configurator.hero.unavailable")}
        </div>
      )}
    </div>
  );
}
