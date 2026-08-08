#!/usr/bin/env node
/**
 * Build public/hero/base-photo-occlusion.png — the plate's foreground objects, as a mask.
 *
 *   node scripts/build-occlusion-mask.mjs
 *
 * WHAT IT IS FOR
 * The compositor paints materials onto flat surfaces described by polygons. A polygon knows
 * nothing about the things standing in front of that surface, so flooring runs over the
 * toilet and wall panel runs over the plants. The Three.js plate solved this with a rendered
 * ID pass; this plate is a photograph and has no such thing, so the occluders are recovered
 * here instead. The compositor then restores the plate's own pixels wherever this mask is
 * opaque, in one pass, after all materials are down — which is why the region polygons no
 * longer need notches cut around objects.
 *
 * WHY TWO TECHNIQUES
 * Solid objects — toilet, pots, towel, vase — are traced as polygons, because their outlines
 * are clean and a polygon describes them exactly.
 *
 * The plants are NOT. A fern has no outline: any polygon drawn around it also encloses the
 * wall visible between its leaves, and restoring THAT is what produced the grey blob beside
 * the shower in earlier passes — the same defect whether the polygon lives here or in the
 * region clip. So the foliage is keyed on colour instead: it is the only strongly green thing
 * in its corner of the plate, which makes a per-pixel mask cheap and exact. Leaves come back,
 * the wall between them keeps its material.
 *
 * Coordinates are plate percentages, measured with scripts/hero-grid.mjs at ZOOM 6-16.
 * Re-run this script after editing them; the compositor loads the PNG, not this file.
 */

import puppeteer from "puppeteer";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLATE = join(ROOT, "public/hero/base-photo.png");
const OUT = join(ROOT, "public/hero/base-photo-occlusion.png");

/**
 * Where to look for foliage, and how green a pixel must be to count.
 *
 * The box matters as much as the test: there is other green in the plate — the framed leaf
 * print above the vanity, the trees through the window — and none of it occludes anything.
 * Restricting the key to the shower's bottom-left corner is what keeps this from punching
 * holes in the artwork.
 */
const FOLIAGE_BOX = { x: 11.5, y: 58, w: 20, h: 38 };
/**
 * Green must lead BLUE by this much. Not red — that was the first attempt and it keyed almost
 * nothing (964px of a 20,000px box), because this plate's planting is warm olive and a croton
 * with brown leaves: sampled foliage runs g/r from 0.78 to 1.18, straddling neutral. Against
 * blue it separates cleanly — foliage g/b measures 1.30 to 4.86, the wall behind it 1.06 to
 * 1.10 — so blue is the channel that actually distinguishes leaf from plaster here.
 */
const FOLIAGE_RATIO = 1.20;
const FOLIAGE_MIN = 18;       // ignore near-black pixels, where channel ratios are noise

/** Solid occluders, traced clockwise. Percentages of the plate. */
const OCCLUDERS = {
  // Both pots as one outline; their rims run together at this scale and the foliage key
  // covers everything above them.
  pots: [
    [14.3, 92.8], [22.2, 92.0], [22.4, 90.6], [28.5, 91.0],
    [28.5, 101], [13.9, 101],
  ],
  // Tank, seat and bowl as one silhouette. The left edge steps out at y=75 where the seat
  // starts and back in at y=86 below it; that step is the shape the floor has to stop at.
  toilet: [
    [74.5, 59.4], [83.3, 60.9], [83.5, 77.6], [80.4, 78.9],
    [80.5, 84.2], [80.5, 90.2], [79.7, 97.2], [79.3, 101],
    [69.9, 101], [69.5, 92.0], [68.9, 86.0], [67.3, 80.6],
    [67.5, 77.1], [69.5, 75.1], [74.2, 74.5], [74.4, 70.0],
  ],
  // Hangs over the right end of the counter and the backsplash band. Generous on the RIGHT,
  // where it overlaps nothing paintable and so costs nothing — but tight on the left, because
  // the counter now runs to x=71.0 and every tenth of a percent this reaches past 70.9
  // restores the plate's own wood counter as a stripe beside the selected stone.
  towel: [
    [70.9, 49.0], [75.4, 49.0], [75.4, 66.9], [70.9, 66.9],
  ],
  // Tight to the bottle, and deliberately stopping just ABOVE the counter's top surface at
  // y=55.5 rather than at the vase's true base. The vase does stand on the counter and does
  // occlude a sliver of it, but this outline is a rectangle and the bottle is not: carrying it
  // down to the base restored a 3%-wide block of the plate's original wood counter across the
  // new stone, which reads far worse than the material running under the last half-percent of
  // a glass vase.
  vase: [
    [48.4, 43.0], [51.6, 43.0], [51.7, 55.7], [48.3, 55.7],
  ],
};

/** Alpha-blur passes. Each is a 3x3 box blur; two gives roughly a 1.5px feather. */
const FEATHER_PASSES = 2;

const plate = readFileSync(PLATE);
const W = plate.readUInt32BE(16), H = plate.readUInt32BE(20);
const uri = `data:image/png;base64,${plate.toString("base64")}`;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("about:blank");

const dataUrl = await page.evaluate(async (args) => {
  const { src, W, H, FOLIAGE_BOX, FOLIAGE_RATIO, FOLIAGE_MIN, OCCLUDERS, FEATHER_PASSES } = args;

  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

  // Read the plate.
  const srcCv = document.createElement("canvas");
  srcCv.width = W; srcCv.height = H;
  const sctx = srcCv.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const px = sctx.getImageData(0, 0, W, H).data;

  // Build the mask as pure alpha over black.
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const octx = out.getContext("2d", { willReadFrequently: true });

  // 1. Polygons.
  octx.fillStyle = "#000";
  for (const poly of Object.values(OCCLUDERS)) {
    octx.beginPath();
    poly.forEach(([x, y], i) => {
      const px2 = (x / 100) * W, py2 = (y / 100) * H;
      if (i === 0) octx.moveTo(px2, py2); else octx.lineTo(px2, py2);
    });
    octx.closePath();
    octx.fill();
  }

  // 2. Foliage, keyed on colour inside its box.
  const mask = octx.getImageData(0, 0, W, H);
  const m = mask.data;
  const bx0 = Math.round((FOLIAGE_BOX.x / 100) * W), bx1 = Math.round(((FOLIAGE_BOX.x + FOLIAGE_BOX.w) / 100) * W);
  const by0 = Math.round((FOLIAGE_BOX.y / 100) * H), by1 = Math.round(((FOLIAGE_BOX.y + FOLIAGE_BOX.h) / 100) * H);
  let keyed = 0;
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const i = (y * W + x) * 4;
      const g = px[i + 1], b = px[i + 2];
      if (g < FOLIAGE_MIN) continue;
      if (g > b * FOLIAGE_RATIO) {
        m[i] = 0; m[i + 1] = 0; m[i + 2] = 0; m[i + 3] = 255;
        keyed++;
      }
    }
  }
  octx.putImageData(mask, 0, 0);

  // 3. Feather the alpha so restored objects don't have a cut edge.
  for (let pass = 0; pass < FEATHER_PASSES; pass++) {
    const d = octx.getImageData(0, 0, W, H);
    const a = d.data;
    const copy = new Uint8ClampedArray(a.length);
    copy.set(a);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4;
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          sum += copy[((y + dy) * W + (x + dx)) * 4 + 3];
        }
        a[i + 3] = sum / 9;
        // Keep RGB black everywhere so a partly-transparent edge tints nothing.
        a[i] = 0; a[i + 1] = 0; a[i + 2] = 0;
      }
    }
    octx.putImageData(d, 0, 0);
  }

  // Coverage, for the console line.
  const fin = octx.getImageData(0, 0, W, H).data;
  let opaque = 0;
  for (let i = 3; i < fin.length; i += 4) if (fin[i] > 127) opaque++;

  return { url: out.toDataURL("image/png"), keyed, opaque, total: W * H };
}, { src: uri, W, H, FOLIAGE_BOX, FOLIAGE_RATIO, FOLIAGE_MIN, OCCLUDERS, FEATHER_PASSES });

await browser.close();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(dataUrl.url.split(",")[1], "base64"));

const pct = (n) => ((100 * n) / dataUrl.total).toFixed(2);
console.log(`wrote ${OUT}`);
console.log(`  ${W}x${H}  foliage keyed ${dataUrl.keyed}px  total opaque ${dataUrl.opaque}px (${pct(dataUrl.opaque)}% of plate)`);
