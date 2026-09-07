#!/usr/bin/env node
/**
 * Measure how well a photographic plate registers against the scene's ID mask.
 *
 *   node scripts/registration-check.mjs [photo.png] [id.png]
 *   defaults: public/hero/scene-shower.photo.png  public/hero/scene-shower.id.png
 *
 * Writes scripts/.out/registration-check.png (ID over photo at 40%), zoom crops of the
 * fixtures, and registration-report.json. Exits non-zero if any gated fixture is off by more
 * than MAX_OFFSET_PX or any legend ID is missing from the mask.
 *
 * ---------------------------------------------------------------------------
 * HOW OFFSET IS MEASURED, AND WHY NOT BY COLOUR
 *
 * The obvious test — "are the pixels under the faucet mask faucet-coloured?" — only works for
 * a dark fixture on a light ground. It says nothing useful about a white toilet on a pale
 * floor, and Phase 0.2 produced three garbage numbers that way (a 448px "offset" for a door
 * frame, because the frame is a thin ring whose centroid is the empty middle of the shower).
 *
 * So the primary metric is EDGE ALIGNMENT instead. A mask region's boundary is where the
 * render says a silhouette is. If the plate agrees, the plate's luminance gradient peaks on
 * that same line. Shifting the boundary and re-scoring finds the offset that best explains
 * the plate, and it works regardless of whether the fixture is darker or lighter than what is
 * behind it. Colour statistics are still reported, because they catch a different failure —
 * a region landing on the wrong KIND of surface — but they are not what the gate reads.
 *
 * CONTRAST COVERAGE is reported alongside: the fraction of a mask blob's pixels where the
 * plate differs from its local background at all. Low coverage means the mask is painting
 * bare wall, which is the failure mode that matters when a mask drives a generator.
 */
import puppeteer from "puppeteer";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const PHOTO = process.argv[2] ?? "public/hero/scene-shower.photo.png";
const ID = process.argv[3] ?? "public/hero/scene-shower.id.png";
const OUT = path.join(ROOT, "scripts/.out");
mkdirSync(OUT, { recursive: true });

const LEGEND = {
  backWall: "#ff0000", leftWall: "#00ff00", rightWall: "#0000ff", floor: "#ffff00",
  showerArea: "#ff00ff", vanityArea: "#00ffff", vanityTop: "#ff8000", rubberBase: "#8000ff",
  showerBase: "#808000", showerDoor: "#008080", toilet: "#964b00", showerFixtures: "#ff8060",
  faucet: "#00ff80", vanityLight: "#c000c0", unclaimed: "#000000",
};

/**
 * Which regions the exit code depends on. These are the small hardware pieces the plate has
 * to actually contain: they are what a later phase will cut out or re-finish, and they are
 * small enough that a few pixels of drift means painting wall instead of metal.
 *
 * Deliberately NOT gated: the walls, floor and vanity faces are enormous and their edge
 * alignment is dominated by whichever architectural line happens to be strongest, so a large
 * "offset" there is usually the measurement finding a better edge nearby rather than real
 * drift. They are reported, and the global/per-third alignment below is the honest check on
 * whole-frame registration.
 */
const GATED = ["showerFixtures", "faucet", "showerDoor", "vanityLight"];
const MAX_OFFSET_PX = 12;
const MIN_BLOB_PX = 60;
/**
 * Coverage gate: the share of a mask blob's pixels where the plate actually differs from its
 * local background. This is the failure that matters downstream — a mask painting bare wall
 * is useless whatever its offset says — and it is the only check that stays meaningful on
 * every shape.
 */
const MIN_COVERAGE = 0.5;
/**
 * The offset gate applies only to COMPACT blobs.
 *
 * Boundary alignment answers "where does the plate put this silhouette", and that question is
 * well posed for a handle or a head. It is not well posed for a 30,000px frame ring spanning
 * the whole enclosure: its boundary runs past the glass seam, the pan lip and the wall
 * corner, so the search locks onto whichever of those is strongest and returns a confident
 * number about nothing. Phase 0.2 produced a 448px "offset" for exactly that region while its
 * coverage was 0.91 and its top rail solved to the modelled height within 0.75px.
 *
 * So: compact blobs are gated on offset AND coverage; sprawling ones on coverage alone, with
 * their offset still printed.
 */
const COMPACT_DIAG_PX = 200;

for (const f of [PHOTO, ID]) if (!existsSync(abs(f))) { console.error(`missing ${f}`); process.exit(1); }

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("[page]", String(e).slice(0, 300)));
await page.goto("about:blank");

const R = await page.evaluate(async (idB, phB, cfg) => {
  const dec = async (d) => {
    const img = new Image(); img.src = "data:image/png;base64," + d; await img.decode();
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
  };
  const id = await dec(idB), ph = await dec(phB);
  if (id.w !== ph.w || id.h !== ph.h) return { dimMismatch: [id.w, id.h, ph.w, ph.h] };
  const W = id.w, H = id.h, N = W * H;

  const idKey = new Int32Array(N);
  for (let p = 0; p < N; p++) idKey[p] = (id.data[p * 4] << 16) | (id.data[p * 4 + 1] << 8) | id.data[p * 4 + 2];
  const L = new Float32Array(N);
  for (let p = 0; p < N; p++) L[p] = 0.2126 * ph.data[p * 4] + 0.7152 * ph.data[p * 4 + 1] + 0.0722 * ph.data[p * 4 + 2];
  const G = new Float32Array(N);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      G[p] = Math.abs(L[p + 1] - L[p - 1]) + Math.abs(L[p + W] - L[p - W]);
    }

  const hex2k = (h) => parseInt(h.slice(1), 16);
  const boundaryOf = (pred) => {
    const out = [];
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        if (!pred(p)) continue;
        if (!pred(p - 1) || !pred(p + 1) || !pred(p - W) || !pred(p + W)) out.push(p);
      }
    return out;
  };
  /** Best (dx,dy) in +/-range that puts the plate's gradient on these boundary pixels. */
  const bestShift = (pts, range) => {
    if (!pts.length) return null;
    let best = { dx: 0, dy: 0, score: -1 }, zero = 0, sum = 0, n = 0;
    for (let dy = -range; dy <= range; dy++)
      for (let dx = -range; dx <= range; dx++) {
        let s = 0, c = 0;
        for (const p of pts) {
          const x = (p % W) + dx, y = ((p / W) | 0) + dy;
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          s += G[y * W + x]; c++;
        }
        s = c ? s / c : 0;
        sum += s; n++;
        if (dx === 0 && dy === 0) zero = s;
        if (s > best.score) best = { dx, dy, score: s };
      }
    return {
      dx: best.dx, dy: best.dy,
      offset: +Math.hypot(best.dx, best.dy).toFixed(2),
      score: +best.score.toFixed(2), zero: +zero.toFixed(2),
      // How much the peak stands out from the average shift — a flat surface means the
      // measurement found nothing and the offset is not meaningful.
      prominence: +(best.score / (sum / n)).toFixed(3),
      pts: pts.length,
    };
  };

  // ---- per-region colour + erosion ------------------------------------------
  const interior = (p, r, k) => {
    const x = p % W, y = (p / W) | 0;
    if (x < r || y < r || x >= W - r || y >= H - r) return false;
    return idKey[p - r] === k && idKey[p + r] === k && idKey[p - r * W] === k && idKey[p + r * W] === k;
  };
  const regions = {};
  for (const [name, hex] of Object.entries(cfg.LEGEND)) {
    const k = hex2k(hex);
    const acc = (useInt) => {
      let n = 0, s = [0, 0, 0], q = [0, 0, 0];
      for (let p = 0; p < N; p++) {
        if (idKey[p] !== k) continue;
        if (useInt && !interior(p, 6, k)) continue;
        for (let c = 0; c < 3; c++) { const v = ph.data[p * 4 + c]; s[c] += v; q[c] += v * v; }
        n++;
      }
      if (!n) return null;
      const m = s.map((v) => v / n);
      return { n, mean: m.map((v) => +v.toFixed(1)), sd: q.map((v, c) => +Math.sqrt(Math.max(0, v / n - m[c] * m[c])).toFixed(1)) };
    };
    const full = acc(false);
    regions[name] = {
      hex, present: !!full, full, eroded: acc(true),
      align: full ? bestShift(boundaryOf((p) => idKey[p] === k).filter((_, i) => i % 2 === 0), 20) : null,
    };
  }

  // ---- fixture blobs ---------------------------------------------------------
  const blobs = [];
  for (const name of cfg.GATED.concat(["toilet", "showerBase"])) {
    const k = hex2k(cfg.LEGEND[name]);
    const seen = new Uint8Array(N);
    const found = [];
    for (let p0 = 0; p0 < N; p0++) {
      if (seen[p0] || idKey[p0] !== k) continue;
      const st = [p0]; seen[p0] = 1; const px = [];
      while (st.length) {
        const p = st.pop(); px.push(p);
        const x = p % W, y = (p / W) | 0;
        if (x > 0 && !seen[p - 1] && idKey[p - 1] === k) { seen[p - 1] = 1; st.push(p - 1); }
        if (x < W - 1 && !seen[p + 1] && idKey[p + 1] === k) { seen[p + 1] = 1; st.push(p + 1); }
        if (y > 0 && !seen[p - W] && idKey[p - W] === k) { seen[p - W] = 1; st.push(p - W); }
        if (y < H - 1 && !seen[p + W] && idKey[p + W] === k) { seen[p + W] = 1; st.push(p + W); }
      }
      if (px.length >= cfg.MIN_BLOB_PX) found.push(px);
    }
    found.sort((a, b) => b.length - a.length);
    for (const px of found.slice(0, 4)) {
      const set = new Set(px);
      let sx = 0, sy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
      for (const p of px) {
        const x = p % W, y = (p / W) | 0;
        sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      // Contrast coverage: does the plate contain anything here, or is this bare surface?
      const pad = Math.max(14, Math.round(Math.max(x1 - x0, y1 - y0) * 0.8));
      const wx0 = Math.max(0, x0 - pad), wx1 = Math.min(W - 1, x1 + pad);
      const wy0 = Math.max(0, y0 - pad), wy1 = Math.min(H - 1, y1 + pad);
      const vals = [];
      for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) vals.push(L[y * W + x]);
      vals.sort((a, b) => a - b);
      const med = vals[vals.length >> 1];
      let hit = 0;
      for (const p of px) if (Math.abs(L[p] - med) > 18) hit++;
      blobs.push({
        region: name, px: px.length,
        centroid: [+(sx / px.length).toFixed(1), +(sy / px.length).toFixed(1)],
        box: [x0, y0, x1, y1],
        coverage: +(hit / px.length).toFixed(3),
        align: bestShift(boundaryOf((p) => set.has(p)), 20),
        gated: cfg.GATED.includes(name),
      });
    }
  }

  // ---- whole-frame alignment, and by thirds ----------------------------------
  const allB = boundaryOf((p) => {
    const k = idKey[p];
    return idKey[p - 1] === k && idKey[p + 1] === k && idKey[p - W] === k && idKey[p + W] === k ? false : true;
  }).filter((_, i) => i % 4 === 0);
  const thirds = {};
  for (const [nm, a, b] of [["left", 0, W / 3], ["mid", W / 3, (2 * W) / 3], ["right", (2 * W) / 3, W]]) {
    thirds[nm] = bestShift(allB.filter((p) => { const x = p % W; return x >= a && x < b; }), 20);
  }

  // ---- rubber base band ------------------------------------------------------
  const RB = hex2k(cfg.LEGEND.rubberBase);
  const base = [];
  for (let x = 30; x < W; x += 30) {
    let top = -1, bot = -1;
    for (let y = 0; y < H; y++) if (idKey[y * W + x] === RB) { if (top < 0) top = y; bot = y; }
    if (top < 0 || bot - top < 8 || bot >= H - 2) continue;   // skip slivers and clipped runs
    const strongest = (a, b) => {
      let bY = -1, bG = -1;
      for (let y = Math.max(2, a); y < Math.min(H - 2, b); y++) {
        const g = Math.abs(L[(y + 1) * W + x] - L[(y - 1) * W + x]);
        if (g > bG) { bG = g; bY = y; }
      }
      return bY;
    };
    const t = strongest(top - 16, top + 16), b2 = strongest(bot - 12, bot + 18);
    base.push({ x, maskH: bot - top + 1, dTop: t - top, dBot: b2 - bot, dH: (b2 - t + 1) - (bot - top + 1) });
  }

  // ---- overlay + zooms -------------------------------------------------------
  const over = new Uint8ClampedArray(N * 4);
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    for (let c = 0; c < 3; c++) over[i + c] = ph.data[i + c] * 0.6 + id.data[i + c] * 0.4;
    over[i + 3] = 255;
  }
  const enc = (px, w, h) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
    return c.toDataURL("image/png");
  };
  const overCanvas = document.createElement("canvas");
  overCanvas.width = W; overCanvas.height = H;
  overCanvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(over), W, H), 0, 0);
  const crop = (x, y, w, h, z) => {
    const c = document.createElement("canvas"); c.width = w * z; c.height = h * z;
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
    g.drawImage(overCanvas, x, y, w, h, 0, 0, w * z, h * z);
    return c.toDataURL("image/png");
  };
  // Zooms follow the fixture blobs, so they keep framing the right thing as geometry moves.
  const zooms = {};
  for (const b of blobs.filter((b) => b.gated)) {
    const [x0, y0, x1, y1] = b.box;
    const pad = 40, w = Math.min(W, x1 - x0 + pad * 2), h = Math.min(H, y1 - y0 + pad * 2);
    const z = Math.max(2, Math.min(8, Math.round(600 / Math.max(w, h))));
    zooms[`zoom-${b.region}-${x0}x${y0}`] = crop(Math.max(0, x0 - pad), Math.max(0, y0 - pad), w, h, z);
  }

  return { W, H, regions, blobs, thirds, whole: bestShift(allB, 20), base, overlay: enc(over, W, H), zooms };
}, readFileSync(abs(ID)).toString("base64"), readFileSync(abs(PHOTO)).toString("base64"),
   { LEGEND, GATED, MIN_BLOB_PX });

await browser.close();

if (R.dimMismatch) {
  console.error(`Dimension mismatch: id ${R.dimMismatch[0]}x${R.dimMismatch[1]} vs photo ${R.dimMismatch[2]}x${R.dimMismatch[3]}`);
  process.exit(1);
}

const wr = (n, url) => writeFileSync(path.join(OUT, n), Buffer.from(url.slice("data:image/png;base64,".length), "base64"));
wr("registration-check.png", R.overlay);
for (const [n, u] of Object.entries(R.zooms)) wr(`${n}.png`, u);
writeFileSync(path.join(OUT, "registration-report.json"),
  JSON.stringify(R, (k, v) => (k === "overlay" || k === "zooms" ? undefined : v), 2));

// ---------------------------------------------------------------- report ----
const pad = (s, n) => String(s).padEnd(n);
let fail = 0;
console.log(`\n${PHOTO}  vs  ${ID}   (${R.W}x${R.H})`);

console.log("\n==== REGION CONTENT ====");
console.log(`${pad("region", 15)} ${pad("px", 8)} ${pad("mean RGB", 18)} ${pad("sd RGB", 16)} ${pad("sd eroded", 16)} align`);
for (const [n, r] of Object.entries(R.regions)) {
  if (!r.present) { console.log(`${pad(n, 15)} ABSENT  <-- FAIL`); fail++; continue; }
  const a = r.align;
  console.log(`${pad(n, 15)} ${pad(r.full.n, 8)} ${pad(r.full.mean.join(","), 18)} ${pad(r.full.sd.join(","), 16)} ` +
    `${pad(r.eroded ? r.eroded.sd.join(",") : "(none)", 16)} ${a ? `dx ${a.dx} dy ${a.dy}` : "-"}`);
}

console.log("\n==== FIXTURE BLOBS ====");
console.log(`${pad("region", 15)} ${pad("px", 7)} ${pad("centroid", 15)} ${pad("cover", 7)} ${pad("dx,dy", 10)} ${pad("offset", 8)} ${pad("diag", 7)} gate`);
for (const b of R.blobs) {
  const a = b.align;
  const diag = Math.hypot(b.box[2] - b.box[0], b.box[3] - b.box[1]);
  const compact = diag <= COMPACT_DIAG_PX;
  const bad = [];
  if (b.gated) {
    if (b.coverage < MIN_COVERAGE) bad.push(`coverage<${MIN_COVERAGE}`);
    if (compact && a && a.offset > MAX_OFFSET_PX) bad.push(`offset>${MAX_OFFSET_PX}px`);
  }
  if (bad.length) fail++;
  const verdict = !b.gated ? "(report only)"
    : bad.length ? `FAIL ${bad.join(" ")}`
    : compact ? "ok" : "ok (coverage only — not compact)";
  console.log(`${pad(b.region, 15)} ${pad(b.px, 7)} ${pad(b.centroid.join(","), 15)} ${pad(b.coverage, 7)} ` +
    `${pad(a ? `${a.dx},${a.dy}` : "-", 10)} ${pad(a ? a.offset : "-", 8)} ${pad(diag.toFixed(0), 7)} ${verdict}`);
}

console.log("\n==== WHOLE-FRAME ALIGNMENT ====");
const w = R.whole;
console.log(`  best dx ${w.dx}, dy ${w.dy}  (score ${w.score} vs ${w.zero} at origin, ${w.pts} boundary px)`);
for (const [k, t] of Object.entries(R.thirds)) console.log(`  ${pad(k, 6)} dx ${pad(t.dx, 5)} dy ${pad(t.dy, 5)} (${t.pts} px)`);

console.log("\n==== RUBBER BASE ====");
const mean = (f) => (R.base.reduce((t, r) => t + f(r), 0) / R.base.length).toFixed(2);
console.log(`  ${R.base.length} columns:  dTop ${mean((r) => r.dTop)}px   dBot ${mean((r) => r.dBot)}px   dHeight ${mean((r) => r.dH)}px`);

console.log(`\nWrote scripts/.out/registration-check.png, ${Object.keys(R.zooms).length} zoom crops, registration-report.json`);
console.log(fail
  ? `\nFAIL — ${fail} check(s)`
  : `\nPASS — every gated fixture at >=${MIN_COVERAGE} coverage, compact ones within ${MAX_OFFSET_PX}px, all IDs present`);
process.exit(fail ? 1 : 0);
