#!/usr/bin/env node
/**
 * Bring a generated master plate into the scene's coordinate system.
 *
 *   node scripts/intake-plate.mjs [source.png] [outBasename]
 *   node scripts/intake-plate.mjs public/hero/master-shower-1sink-8cc.png scene-shower.photo
 *
 * Writes  public/hero/<basename>-16x9.png   1920x1080, the full frame
 *         public/hero/<basename>.png        1920x918, rows 81..998 — the production band
 *
 * The source is never modified.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DOES NOT JUST RESIZE TO 1920x1080
 *
 * Firefly's nominal "16:9" bucket is 2752x1536, which is 1.79167 — not 1.77778. Squeezing
 * that straight into 1920x1080 scales x by 0.697674 and y by 0.703125: a 0.78% ANISOTROPIC
 * distortion. It is invisible to the eye and fatal to registration, because the error is zero
 * at frame centre and grows with distance from it, so it masquerades as structure drift in
 * whatever the generator produced.
 *
 * Phase 0.2 measured both. Scoring the photo's luminance gradient on 7,062 ID-mask boundary
 * pixels and searching offsets over +/-30px:
 *
 *   literal squeeze to 1920x1080   left dx +7   mid dx -3   right dx -1    <- 8px spread,
 *                                                                            opposite signs
 *   uniform scale + centre crop    left dx +2   mid dx -5   right dx +2    <- edges agree
 *
 * Opposite-signed drift at the two edges is the squeeze's signature, and it appears at the
 * predicted size (0.78% x 640px ~= 5px per side). The uniform path removes it, and also
 * scored better in absolute terms (peak 34.31 vs 31.93) AND needed less correction to reach
 * that peak (19% vs 27% over its own zero-offset score). Three independent measures, one
 * answer, so this script only implements the uniform one.
 *
 * The crop is horizontal because the generator gave us MORE horizontal field than 16:9, not
 * stretched content — the per-third agreement above is what says so. Scaling to fit height
 * and trimming the excess width recovers the framing the structure reference was rendered at.
 *
 * ---------------------------------------------------------------------------
 * WHY LANCZOS IS HAND-ROLLED
 *
 * Canvas drawImage's downscale filter is unspecified and varies by platform and by scale
 * factor. This is the front door of a measurement pipeline, so the kernel is written out:
 * Lanczos-3, separable, taps normalised per destination sample.
 */
import puppeteer from "puppeteer";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2] ?? "public/hero/master-shower-1sink-8cc.png";
const BASE = process.argv[3] ?? "scene-shower.photo";

/** The production band, matching render-base-scene.mjs --v2. */
const FULL_W = 1920, FULL_H = 1080, BAND_H = 918, BAND_Y0 = 81;

const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
if (!existsSync(abs(SRC))) { console.error(`Source not found: ${SRC}`); process.exit(1); }

const head = readFileSync(abs(SRC));
const sw = head.readUInt32BE(16), sh = head.readUInt32BE(20);
console.log(`Source  ${SRC}`);
console.log(`        ${sw}x${sh}  aspect ${(sw / sh).toFixed(6)}  (16:9 = ${(16 / 9).toFixed(6)})`);
const upW = Math.round(sw * (FULL_H / sh));
const cropX = Math.round((upW - FULL_W) / 2);
if (upW < FULL_W) {
  console.error(`Source is TALLER than 16:9 (${upW}px wide at 1080 tall). This script only`);
  console.error(`crops width; a taller-than-16:9 source needs a different decision. Stopping.`);
  process.exit(1);
}
console.log(`Uniform scale to height ${FULL_H} -> ${upW}x${FULL_H}, centre-crop ${cropX}px each side -> ${FULL_W}x${FULL_H}`);
console.log(`Anisotropy avoided: ${(((FULL_H / sh) / (FULL_W / sw) - 1) * 100).toFixed(3)}%`);

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=4096"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => { console.error("[page]", String(e).slice(0, 300)); });
await page.goto("about:blank");

const outs = await page.evaluate(async (b64, opt) => {
  const { FULL_W, FULL_H, BAND_H, BAND_Y0, upW, cropX } = opt;

  const lanczos3 = (x) => {
    if (x === 0) return 1;
    const ax = Math.abs(x);
    if (ax >= 3) return 0;
    const px = Math.PI * x;
    return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
  };
  /** Destination-indexed taps: for each output sample, which inputs and at what weight. */
  const taps = (srcN, dstN) => {
    const scale = dstN / srcN, sup = scale < 1 ? 3 / scale : 3, out = [];
    for (let i = 0; i < dstN; i++) {
      const centre = (i + 0.5) / scale - 0.5;
      const idx = [], w = [];
      let sum = 0;
      for (let j = Math.ceil(centre - sup); j <= Math.floor(centre + sup); j++) {
        const t = lanczos3(scale < 1 ? (j - centre) * scale : j - centre);
        if (t === 0) continue;
        idx.push(Math.min(srcN - 1, Math.max(0, j))); w.push(t); sum += t;
      }
      for (let k = 0; k < w.length; k++) w[k] /= sum;   // normalise, or the image gains/loses level
      out.push({ idx, w });
    }
    return out;
  };
  const resample = (src, sw, sh, dw, dh) => {
    const hx = taps(sw, dw), vy = taps(sh, dh);
    const mid = new Float32Array(dw * sh * 3);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < dw; x++) {
        const { idx, w } = hx[x];
        let r = 0, g = 0, b = 0;
        for (let k = 0; k < idx.length; k++) {
          const s = (y * sw + idx[k]) * 4, t = w[k];
          r += src[s] * t; g += src[s + 1] * t; b += src[s + 2] * t;
        }
        const d = (y * dw + x) * 3; mid[d] = r; mid[d + 1] = g; mid[d + 2] = b;
      }
    const out = new Uint8ClampedArray(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
      const { idx, w } = vy[y];
      for (let x = 0; x < dw; x++) {
        let r = 0, g = 0, b = 0;
        for (let k = 0; k < idx.length; k++) {
          const s = (idx[k] * dw + x) * 3, t = w[k];
          r += mid[s] * t; g += mid[s + 1] * t; b += mid[s + 2] * t;
        }
        const d = (y * dw + x) * 4;
        out[d] = r + 0.5; out[d + 1] = g + 0.5; out[d + 2] = b + 0.5; out[d + 3] = 255;
      }
    }
    return out;
  };

  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g2 = c.getContext("2d", { willReadFrequently: true });
  g2.drawImage(img, 0, 0);
  const src = g2.getImageData(0, 0, c.width, c.height).data;

  // ONE uniform scale, then crop. Never two different scale factors.
  const scaled = resample(src, c.width, c.height, upW, FULL_H);
  const full = new Uint8ClampedArray(FULL_W * FULL_H * 4);
  for (let y = 0; y < FULL_H; y++)
    for (let x = 0; x < FULL_W; x++) {
      const d = (y * FULL_W + x) * 4, s = (y * upW + x + cropX) * 4;
      full[d] = scaled[s]; full[d + 1] = scaled[s + 1]; full[d + 2] = scaled[s + 2]; full[d + 3] = 255;
    }
  const band = new Uint8ClampedArray(FULL_W * BAND_H * 4);
  band.set(full.subarray(BAND_Y0 * FULL_W * 4, (BAND_Y0 + BAND_H) * FULL_W * 4));

  const enc = (px, w, h) => {
    const cc = document.createElement("canvas"); cc.width = w; cc.height = h;
    cc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
    return cc.toDataURL("image/png");
  };
  return { full: enc(full, FULL_W, FULL_H), band: enc(band, FULL_W, BAND_H) };
}, readFileSync(abs(SRC)).toString("base64"), { FULL_W, FULL_H, BAND_H, BAND_Y0, upW, cropX });

await browser.close();

mkdirSync(path.join(ROOT, "public/hero"), { recursive: true });
const write = (p, dataUrl) => {
  const buf = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  writeFileSync(abs(p), buf);
  console.log(`Wrote ${p}  (${(buf.length / 1024).toFixed(0)} KB)`);
};
write(`public/hero/${BASE}-16x9.png`, outs.full);
write(`public/hero/${BASE}.png`, outs.band);
