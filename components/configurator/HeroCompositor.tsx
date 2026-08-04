"use client";

/**
 * HeroCompositor — the configurator hub's live room preview.
 *
 * A layer compositor, not a renderer: it takes one pre-rendered bathroom shell
 * (public/hero/base-modern.png) and paints the dealer's actual product selections into the
 * surfaces of that shell, perspective and all. No 3D at runtime, no AI, no server call — a
 * few hundred canvas operations per selection change.
 *
 * HOW A SURFACE GETS PAINTED
 *  1. lib/hero-regions gives the four screen corners of the surface, projected from the same
 *     camera that rendered the shell, plus its real-world size in inches.
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
  HERO_SCENE, MASK_COLORS, SCENE_REGIONS, SCENE_ANCHORS, tileRepeat,
  type Face, type Point, type Quad, type Region, type RegionId, type AnchorId,
} from "@/lib/hero-regions";

// --------------------------------- types -----------------------------------

export type HeroMaterial = {
  /** A flat, tileable image of the material. Room photography must never be passed here. */
  textureUrl: string;
  name: string;
  /** Real-world size of one tile, in inches. Defaults per region if omitted. */
  tileIn?: { w: number; h: number };
};

export type HeroCompositorProps = {
  /** Shower wall panel / solid surface — painted into the alcove, not the whole room. */
  wallMaterial?: HeroMaterial | null;
  /** Flooring — painted across the floor. */
  floorMaterial?: HeroMaterial | null;
  /** Vanity cabinet colour, as a CSS colour. Tints the cabinet's front face. */
  vanityColor?: string | null;
  /** Countertop colour, as a CSS colour. Tints the vanity's counter slab. */
  vanityTopColor?: string | null;
  /** Trim finish, as a CSS colour. Tints fixture cutouts when their background can be removed. */
  fixtureFinish?: string | null;
  /**
   * Product photos to pin onto the scene, each at a named anchor and sized in real inches.
   *
   * A list rather than a prop per fixture because the set is open: the shower alone carries a
   * valve trim, a rain head and — only for a tub/shower — a spout, and which of them exist
   * depends on the dealer's package and configuration. Callers omit what they haven't got.
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
  className?: string;
};

// ------------------------------ tuning ------------------------------------

/**
 * Tile sizes in inches, used when a material doesn't state its own.
 *
 * Wall: mid-range for the two catalogued ranges — a Nature Panel decor is ~40" wide and a
 * Durasein sheet 30", so 40 x 60 lands a decor at believable scale on a 60" wall without
 * pretending to a precision the swatch crops don't have.
 * Floor: the Durato swatch photography is about five 7" planks across and one plank long.
 */
const DEFAULT_WALL_TILE = { w: 40, h: 60 };
const DEFAULT_FLOOR_TILE = { w: 35, h: 48 };

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
 * Classification normalises each pixel to full brightness before matching. The ID pass is
 * antialiased, so a boundary pixel is some fraction of its region's colour — half-strength
 * magenta is still unambiguously magenta once scaled back up, whereas a raw nearest-colour
 * match would read it as equidistant from magenta and from black and pick arbitrarily.
 * Genuinely dark pixels fall under the floor test and belong to no region, which is how
 * fixtures, glass and the ceiling stay unpainted.
 */
function loadMasks(): Promise<MaskSet> {
  if (maskPromise) return maskPromise;
  maskPromise = loadImage(HERO_SCENE.maskSrc).then((img) => {
    const out: MaskSet = {};
    if (!img) return out;
    const full = makeCanvas(HERO_SCENE.width, HERO_SCENE.height);
    const fctx = full.getContext("2d", { willReadFrequently: true });
    if (!fctx) return out;
    fctx.imageSmoothingEnabled = false;
    fctx.drawImage(img, 0, 0, full.width, full.height);
    let src: ImageData;
    try { src = fctx.getImageData(0, 0, full.width, full.height); } catch { return out; }

    const ids = Object.keys(MASK_COLORS) as RegionId[];
    const rgb = ids.map((id) => hexToRgb(MASK_COLORS[id]));
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

const SURFACE_MAX = 1024;

/** The material tiled across one face at true scale, ready to be warped onto it. */
function buildSurface(img: HTMLImageElement, face: Face, tileIn: { w: number; h: number }): HTMLCanvasElement {
  const rep = tileRepeat(face, tileIn.w, tileIn.h);
  const aspect = face.widthIn / face.heightIn;
  let sw = SURFACE_MAX, sh = Math.round(SURFACE_MAX / aspect);
  if (sh > SURFACE_MAX) { sh = SURFACE_MAX; sw = Math.round(SURFACE_MAX * aspect); }
  const c = makeCanvas(sw, sh);
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const tw = c.width / rep.x, th = c.height / rep.y;
  for (let j = 0; j < Math.ceil(rep.y); j++) {
    for (let i = 0; i < Math.ceil(rep.x); i++) ctx.drawImage(img, i * tw, j * th, tw, th);
  }
  return c;
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

// ------------------------------ compositing --------------------------------

/** Maps the base scene's normalised coordinates onto the canvas, cover-fitted. */
type Fit = { scale: number; ox: number; oy: number };

function coverFit(cw: number, ch: number): Fit {
  const scale = Math.max(cw / HERO_SCENE.width, ch / HERO_SCENE.height);
  return { scale, ox: (cw - HERO_SCENE.width * scale) / 2, oy: (ch - HERO_SCENE.height * scale) / 2 };
}

const toPx = (p: Point, fit: Fit): Point => [fit.ox + p[0] * HERO_SCENE.width * fit.scale, fit.oy + p[1] * HERO_SCENE.height * fit.scale];
const quadPx = (q: Quad, fit: Fit): Quad => [toPx(q[0], fit), toPx(q[1], fit), toPx(q[2], fit), toPx(q[3], fit)];

type Paint =
  | { kind: "texture"; region: Region; img: HTMLImageElement; tileIn: { w: number; h: number } }
  | { kind: "color"; region: Region; color: string; alpha: number };

/** One product photo pinned to the scene. `sizeIn` is the product's longest real dimension. */
export type HeroFixture = { anchor: AnchorId; url: string; sizeIn: number };

type Pin = { cutout: Cutout; anchor: { at: Point; unitPerIn: number }; photoIn: number };

function paintRegion(
  frame: CanvasRenderingContext2D, layer: HTMLCanvasElement, paint: Paint,
  fit: Fit, blend: "multiply" | "soft", mask?: HTMLCanvasElement,
) {
  const lctx = layer.getContext("2d");
  if (!lctx) return;
  lctx.clearRect(0, 0, layer.width, layer.height);
  for (const face of paint.region.faces) {
    const surface = paint.kind === "texture" ? buildSurface(paint.img, face, paint.tileIn) : buildColorSurface(paint.color);
    warpOntoQuad(lctx, surface, quadPx(face.quad, fit), layer.width, layer.height);
  }
  // Cut the warped surface down to the pixels the region actually occupies. The quad is the
  // whole flat surface; the mask is what survived the fixtures standing in front of it. Both
  // are needed — without this the flooring covers the toilet and the tile covers the shower
  // head, because a quad has no idea anything is in the way.
  if (mask) {
    lctx.save();
    lctx.globalCompositeOperation = "destination-in";
    lctx.imageSmoothingEnabled = true;
    lctx.drawImage(mask, fit.ox, fit.oy, HERO_SCENE.width * fit.scale, HERO_SCENE.height * fit.scale);
    lctx.restore();
  }
  frame.save();
  // `soft` exists for materials multiply would crush; see the blend prop.
  frame.globalCompositeOperation = blend === "soft" ? "source-over" : "multiply";
  frame.globalAlpha = paint.kind === "color" ? paint.alpha : blend === "soft" ? 0.7 : 1;
  frame.drawImage(layer, 0, 0);
  frame.restore();
}

function pinCutout(frame: CanvasRenderingContext2D, pin: Pin, fit: Fit) {
  const { cutout, anchor, photoIn } = pin;
  const hPx = anchor.unitPerIn * photoIn * HERO_SCENE.height * fit.scale;
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
  floorMaterial = null,
  vanityColor = null,
  vanityTopColor = null,
  fixtureFinish = null,
  fixtures = [],
  width,
  height,
  blend = "multiply",
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
  const wallUrl = wallMaterial?.textureUrl ?? null;
  const wallTileW = wallMaterial?.tileIn?.w ?? DEFAULT_WALL_TILE.w;
  const wallTileH = wallMaterial?.tileIn?.h ?? DEFAULT_WALL_TILE.h;
  // Fixtures are flattened to a string so an equal list rebuilt by the parent on every render
  // doesn't retrigger a composite; the effect below reads the array itself.
  const fixtureKey = fixtures.map((f) => `${f.anchor}:${f.url}:${f.sizeIn}`).join("|");
  const floorUrl = floorMaterial?.textureUrl ?? null;
  const floorTileW = floorMaterial?.tileIn?.w ?? DEFAULT_FLOOR_TILE.w;
  const floorTileH = floorMaterial?.tileIn?.h ?? DEFAULT_FLOOR_TILE.h;

  const compose = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const seq = ++seqRef.current;
    const { w, h } = size;

    const needed = [HERO_SCENE.src, floorUrl, wallUrl, ...fixtures.map((f) => f.url)].filter(Boolean) as string[];
    const uncached = needed.filter((s) => !imageCache.has(s));
    if (uncached.length) setLoading(true);

    const [base, masks, floorImg, wallImg, fixtureImgs] = await Promise.all([
      loadImage(HERO_SCENE.src),
      loadMasks(),
      floorUrl ? loadImage(floorUrl) : Promise.resolve(null),
      wallUrl ? loadImage(wallUrl) : Promise.resolve(null),
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
    fctx.drawImage(base, fit.ox, fit.oy, HERO_SCENE.width * fit.scale, HERO_SCENE.height * fit.scale);

    // Floor first, then walls, then fixtures — back to front, so a fixture is never buried
    // under a surface drawn after it.
    const layer = makeCanvas(w, h);
    if (floorImg) paintRegion(fctx, layer, { kind: "texture", region: SCENE_REGIONS.floor, img: floorImg, tileIn: { w: floorTileW, h: floorTileH } }, fit, blend, masks.floor);
    if (wallImg) paintRegion(fctx, layer, { kind: "texture", region: SCENE_REGIONS.showerArea, img: wallImg, tileIn: { w: wallTileW, h: wallTileH } }, fit, blend, masks.showerArea);
    // Cabinet and countertop are flat tints rather than textures: the catalogue publishes
    // both as hex swatches, not as material photography.
    if (vanityColor) paintRegion(fctx, layer, { kind: "color", region: SCENE_REGIONS.vanityArea, color: vanityColor, alpha: 0.92 }, fit, blend, masks.vanityArea);
    if (vanityTopColor) paintRegion(fctx, layer, { kind: "color", region: SCENE_REGIONS.vanityTop, color: vanityTopColor, alpha: 0.88 }, fit, blend, masks.vanityTop);

    // Fixtures last, over every painted surface. In caller order, so a caller that pins two
    // overlapping pieces controls which sits on top.
    fixtures.forEach((f, i) => {
      const img = fixtureImgs[i];
      if (!img) return;   // load failed, or the catalogue had no usable photo — modelled fixture stands
      pinCutout(fctx, {
        cutout: buildCutout(img, fixtureFinish),
        anchor: SCENE_ANCHORS[f.anchor],
        photoIn: f.sizeIn * PHOTO_FRAME_RATIO,
      }, fit);
    });

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
    size, blend, wallUrl, wallTileW, wallTileH, floorUrl, floorTileW, floorTileH,
    vanityColor, vanityTopColor, fixtureFinish, fixtureKey,
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
      {failed && (
        <div className="absolute inset-0 grid place-items-center bg-paper/80 p-4 text-center text-xs text-muted">
          {t("configurator.hero.unavailable")}
        </div>
      )}
    </div>
  );
}
