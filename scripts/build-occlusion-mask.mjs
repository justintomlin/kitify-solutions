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
 * WHY THREE TECHNIQUES
 * Solid objects — toilet, planter, towel — are traced as polygons, because their outlines are
 * clean and a polygon describes them exactly.
 *
 * The plants are NOT. A fern has no outline: any polygon drawn around it also encloses the
 * wall visible between its leaves, and restoring THAT is what produced the grey blob beside
 * the shower in earlier passes. So the foliage is keyed on colour instead.
 *
 * The DOOR HARDWARE is not a polygon either, for the opposite reason: it is thin. The track
 * rail is 1.4% of plate height thick and falls across 29% of its width; the hangers are a disc
 * on a stem. A bounding box round any of them is mostly wall, and this mask restores the PLATE
 * wherever it is opaque — so a box would punch a rectangle of the original grey wall through
 * whatever material the dealer chose. They are keyed on luminosity instead, inside the same
 * boxes the compositor uses for finish tinting and at the same cutoff, so the pixels the mask
 * restores are exactly the pixels the tint then recolours.
 *
 * Coordinates are plate percentages, measured with scripts/hero-grid.mjs at ZOOM 6-16 and with
 * a sub-cutoff pixel probe. Re-run this script after editing them; the compositor loads the
 * PNG, not this file.
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
 * holes in the artwork. It also has to stop short of x=30.5, because the door's bottom rail
 * lies at y 92-94 beyond that and keys as "green" often enough to matter.
 */
const FOLIAGE_BOX = { x: 9.0, y: 62, w: 21.5, h: 38 };
/**
 * Green must lead BLUE by this much.
 *
 * RE-KEYED FOR THIS PLATE. The previous plate ran at 1.20, and at that value this one keys its
 * own warm wall shadows as well as its leaves: sampled, the foliage's median g/b is 1.18 and a
 * shadowed wall's is 1.16 — they overlap outright at the median, and only the tail separates
 * them. The 95th percentiles do separate cleanly: foliage 3.5 to 6.3, against bare wall 1.09,
 * pan 1.13, floor 1.09 and the framed leaf print 1.48. 1.45 clears every one of those and
 * still keys 4,969 pixels of leaf against 7,173 at 1.20 — and the 2,200 it drops are the wall
 * seen between the fronds, which is exactly what must NOT be restored.
 */
const FOLIAGE_RATIO = 1.45;
const FOLIAGE_MIN = 18;       // ignore near-black pixels, where channel ratios are noise

/**
 * Where to key the door hardware, and how dark a pixel must be to count.
 *
 * READ FROM THE REGION JSON rather than copied, which is the change this pass makes. These
 * used to be nine literals plus a single cutoff of 112 mirroring the compositor's old global,
 * with a comment warning that if either moved both had to move. Both moved: the compositor's
 * cutoff is per part now, measured per surface, and duplicating fourteen of them here would be
 * the same hazard fourteen times over. The symptom of drift is hardware that restores at a
 * different size from the one it tints at, and over a re-toned shower pan that is not a fringe
 * but a band of the plate's own WHITE pan restored across a black base — which is most of what
 * the markup circled as gold streaks.
 *
 * The post is the one part whose mask box differs from its tint box: the tint stops at y=65.5
 * to stay off the plant, and the mask has no such constraint — restoring the post from behind
 * the leaves is correct, and the foliage key puts the leaves back over it in the same pass.
 */
const REGIONS = JSON.parse(readFileSync(join(ROOT, "lib/data/hero-photo-regions.json"), "utf8"));
const DARK_PARTS = REGIONS.fixtureRegions.doorHardware.parts.map((p) => {
  const box = p.box.slice();
  if (/post/.test(p._what)) box[3] = 86.30;
  return { box, cutoff: p.cutoff };
});

/** Solid occluders, traced clockwise. Percentages of the plate. */
const OCCLUDERS = {
  // The planter under the shower plant. Its rim is a clean ellipse and its body a clean taper,
  // so a polygon is exact here where it is hopeless one row higher.
  planter: [
    [12.3, 94.2], [20.8, 94.6], [21.2, 101], [11.9, 101],
  ],
  // The out-of-focus second plant at the far left. Blurred to the point of having no outline
  // at all, and it only ever overlaps the flooring, so this is deliberately a soft rectangle
  // over its base rather than an attempt at a silhouette.
  leftPlanter: [
    [7.5, 92.0], [12.4, 92.5], [12.4, 101], [7.5, 101],
  ],
  // Tank, seat and bowl as one silhouette, traced at ZOOM 7 and checked against a per-row
  // brightness scan: the seat's leftmost bright pixel sits at x=73.3 on row y=78.6. That is
  // the number that matters — it reaches 4% inside the vanity cabinet's right end at x=77.3,
  // and it is what was painting a wedge of cabinet colour across the bowl before this existed.
  //
  // THE PEDESTAL IS NARROWER THAN THE BOWL, and this pass adds the two vertices that say so.
  // Below the bowl's underside the porcelain steps in: the strongest horizontal rise per row
  // from y=89 to y=100 fits x = 83.7336 - 0.08871y with a worst residual of 0.63, i.e. 75.6 at
  // y=91 falling to 74.8 at the frame's edge. The old outline ran straight down at 73.6-74.2,
  // up to 2.1% of plate width WIDE OF THE PORCELAIN, so it restored the plate's own floor and
  // the toilet's contact shadow along with it. Over a dark plank that reads as a bright halo
  // round the foot — the opposite of a shadow, and why the toilet appeared to float. Pulled in,
  // the flooring paints up to the porcelain and multiply carries the plate's shadow through it,
  // which is the same mechanism that already puts a shadow under the vanity's toe kick.
  toilet: [
    [80.9, 60.3], [90.5, 60.2], [90.5, 63.5], [89.3, 81.5],
    [85.5, 84.5], [84.0, 90.0], [87.5, 93.0], [87.4, 101],
    [74.9, 101], [75.6, 91.0], [73.6, 90.0], [73.0, 81.0], [73.2, 78.2],
    [76.0, 76.6], [80.5, 76.4], [80.7, 63.0],
  ],
  // Hangs from the bar beside the toilet, over the wall and over the right end of the counter
  // run. Generous on the RIGHT, where it overlaps nothing paintable and so costs nothing, and
  // tight on the LEFT, because the counter and cabinet run to x=77.3 and every tenth of a
  // percent this reaches past that restores the plate's own surfaces as a stripe beside the
  // selected material.
  towel: [
    [77.8, 42.4], [82.9, 42.4], [82.9, 69.5], [78.3, 69.6],
    [76.5, 66.5], [76.6, 58.0], [77.4, 49.0],
  ],
};

/**
 * Alpha-blur passes. Each is a 3x3 box blur; two gives roughly a 1.5px feather either side.
 *
 * The HARDWARE gets one pass, not two, and is feathered in its own layer. A soft edge is right
 * for a fern and for the traced solids — they are big and their outlines are approximate — but
 * the hardware is thin: the bottom rail is ONE plate pixel, so two box blurs turn its key into
 * a band five pixels wide, and every one of those pixels restores the plate. Measured on the
 * old mask, the rail's key ran 4-5 pixels of high alpha diagonally across the pan; over a black
 * base that put the plate's white pan back in a stripe, and the finish tint then landed on top
 * of it. One pass keeps the restore on the metal.
 */
const FEATHER_PASSES = 2;
const HARDWARE_FEATHER_PASSES = 1;

const plate = readFileSync(PLATE);
const W = plate.readUInt32BE(16), H = plate.readUInt32BE(20);
const uri = `data:image/png;base64,${plate.toString("base64")}`;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("about:blank");

const dataUrl = await page.evaluate(async (args) => {
  const { src, W, H, FOLIAGE_BOX, FOLIAGE_RATIO, FOLIAGE_MIN, OCCLUDERS, FEATHER_PASSES,
          DARK_PARTS, HARDWARE_FEATHER_PASSES } = args;

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
  for (let y = by0; y < Math.min(H, by1); y++) {
    for (let x = bx0; x < Math.min(W, bx1); x++) {
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

  /** One 3x3 box blur over an alpha-only array. */
  const blur = (a) => {
    const copy = new Uint8ClampedArray(a);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          sum += copy[(y + dy) * W + (x + dx)];
        }
        a[y * W + x] = sum / 9;
      }
    }
  };

  // 3. Feather the polygons and the foliage. Big, soft-edged things: two passes.
  let soft = new Uint8ClampedArray(W * H);
  for (let k = 0; k < W * H; k++) soft[k] = m[k * 4 + 3];
  for (let pass = 0; pass < FEATHER_PASSES; pass++) blur(soft);

  // 4. Door hardware, keyed on luminosity inside its boxes at EACH PART'S OWN cutoff, into a
  //    layer of its own so it can be feathered less. Thin metal wants a tight restore: the
  //    bottom rail is one plate pixel and two blurs would spread its key across five.
  const hard = new Uint8ClampedArray(W * H);
  let hardware = 0;
  for (const { box: [bx, by, bw, bh], cutoff } of DARK_PARTS) {
    const x0 = Math.max(0, Math.round((bx / 100) * W)), x1 = Math.min(W, Math.round(((bx + bw) / 100) * W));
    const y0 = Math.max(0, Math.round((by / 100) * H)), y1 = Math.min(H, Math.round(((by + bh) / 100) * H));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        if (lum < cutoff) {
          if (hard[y * W + x] !== 255) hardware++;
          hard[y * W + x] = 255;
        }
      }
    }
  }
  for (let pass = 0; pass < HARDWARE_FEATHER_PASSES; pass++) blur(hard);

  // 5. Combine by MAX. Whichever layer claims a pixel more strongly wins, so hardware crossing
  //    foliage keeps the foliage's own restore rather than cutting a hole in it.
  const d = octx.getImageData(0, 0, W, H);
  const a = d.data;
  for (let k = 0; k < W * H; k++) {
    // RGB stays black everywhere so a partly-transparent edge tints nothing.
    a[k * 4] = 0; a[k * 4 + 1] = 0; a[k * 4 + 2] = 0;
    a[k * 4 + 3] = Math.max(soft[k], hard[k]);
  }
  octx.putImageData(d, 0, 0);

  // Coverage, for the console line.
  const fin = octx.getImageData(0, 0, W, H).data;
  let opaque = 0;
  for (let i = 3; i < fin.length; i += 4) if (fin[i] > 127) opaque++;

  return { url: out.toDataURL("image/png"), keyed, hardware, opaque, total: W * H };
}, { src: uri, W, H, FOLIAGE_BOX, FOLIAGE_RATIO, FOLIAGE_MIN, OCCLUDERS, FEATHER_PASSES,
     DARK_PARTS, HARDWARE_FEATHER_PASSES });

await browser.close();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(dataUrl.url.split(",")[1], "base64"));

const pct = (n) => ((100 * n) / dataUrl.total).toFixed(2);
console.log(`wrote ${OUT}`);
console.log(`  ${W}x${H}  foliage keyed ${dataUrl.keyed}px  hardware keyed ${dataUrl.hardware}px  total opaque ${dataUrl.opaque}px (${pct(dataUrl.opaque)}% of plate)`);
