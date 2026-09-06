#!/usr/bin/env node
/**
 * Audit the v2 scene render — the contract that render-base-scene.mjs --v2 has to hold.
 *
 *   node scripts/render-base-scene.mjs --v2
 *   node scripts/audit-scene-v2.mjs
 *
 * WHY THIS EXISTS AS A SCRIPT AND NOT A ONE-OFF CHECK
 * The v1 ID pass was wrong for its entire life and nothing caught it: it shared the beauty
 * renderer, so MSAA blended IDs along every silhouette (1.79% of the committed mask, 62
 * distinct colours where there should have been 8) and the sRGB output transform rewrote any
 * channel that was not 0x00 or 0xff — which meant vanityTop (#ff8000) appeared in that mask
 * ZERO times, as #ffbc00 instead. Both failures are invisible to the eye and fatal to a
 * decoder. This asserts what the eye cannot check.
 *
 * Exits non-zero on any failure, so it can gate a later phase.
 */
import puppeteer from "puppeteer";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.join(ROOT, p);

/** Must match ID_COLORS in render-base-scene.mjs, plus unclaimed black. */
const LEGEND = {
  "#ff0000": "backWall", "#00ff00": "leftWall", "#0000ff": "rightWall",
  "#ffff00": "floor", "#ff00ff": "showerArea", "#00ffff": "vanityArea",
  "#ff8000": "vanityTop", "#8000ff": "rubberBase", "#808000": "showerBase",
  "#008080": "showerDoor", "#964b00": "toilet", "#ff8060": "showerFixtures",
  "#00ff80": "faucet", "#c000c0": "vanityLight", "#000000": "(unclaimed black)",
};

const FULL_W = 1920, FULL_H = 1080, BAND_H = 918, BAND_Y0 = 81;
const ID_FULL = "public/hero/scene-shower.id-16x9.png";
const ID_BAND = "public/hero/scene-shower.id.png";
const CLAY_FULL = "public/hero/scene-shower.clay-16x9.png";
const CLAY_BAND = "public/hero/scene-shower.clay.png";

let fail = 0;
const bad = (msg) => { console.log(`  FAIL  ${msg}`); fail++; };
const ok = (msg) => console.log(`  ok    ${msg}`);

for (const f of [ID_FULL, ID_BAND, CLAY_FULL, CLAY_BAND, "lib/data/hero-scene-v2.json"]) {
  if (!existsSync(rel(f))) { console.log(`Missing ${f} — run: node scripts/render-base-scene.mjs --v2`); process.exit(1); }
}

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("about:blank");

const b64 = (f) => readFileSync(rel(f)).toString("base64");
const histogram = (f) =>
  page.evaluate(async (data) => {
    const img = new Image();
    img.src = "data:image/png;base64," + data;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const counts = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const hex = "#" + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
      counts.set(hex, (counts.get(hex) || 0) + 1);
    }
    return { w: c.width, h: c.height, counts: [...counts.entries()].sort((a, b) => b[1] - a[1]) };
  }, b64(f));

// ---- 1. both ID renders are exact legend values, nothing else ---------------
for (const [file, label, w, h] of [[ID_FULL, "ID full frame", FULL_W, FULL_H], [ID_BAND, "ID band crop", FULL_W, BAND_H]]) {
  console.log(`\n${label} — ${file}`);
  const r = await histogram(file);
  r.w === w && r.h === h ? ok(`${r.w}x${r.h}`) : bad(`${r.w}x${r.h}, expected ${w}x${h}`);

  const blends = r.counts.filter(([hex]) => !LEGEND[hex]);
  const blendPx = blends.reduce((t, [, n]) => t + n, 0);
  blendPx === 0
    ? ok(`zero non-legend pixels (${r.counts.length} distinct colours, all legend)`)
    : bad(`${blendPx} non-legend px across ${blends.length} colours: ${blends.slice(0, 8).map(([x, n]) => `${x}x${n}`).join(" ")}`);

  const missing = Object.keys(LEGEND).filter((hex) => !r.counts.some(([h]) => h === hex));
  missing.length === 0
    ? ok(`all ${Object.keys(LEGEND).length} IDs present`)
    : bad(`absent IDs: ${missing.map((m) => `${m} ${LEGEND[m]}`).join(", ")}`);

  for (const [hex, name] of Object.entries(LEGEND)) {
    const n = r.counts.find(([h]) => h === hex)?.[1] ?? 0;
    console.log(`        ${hex}  ${name.padEnd(18)} ${String(n).padStart(9)} px`);
  }
}

// ---- 2. clay is registered with ID, and the band is an exact slice ----------
console.log("\nRegistration");
for (const [file, w, h] of [[CLAY_FULL, FULL_W, FULL_H], [CLAY_BAND, FULL_W, BAND_H]]) {
  const r = await histogram(file);
  r.w === w && r.h === h ? ok(`${path.basename(file)} ${r.w}x${r.h}`) : bad(`${path.basename(file)} ${r.w}x${r.h}, expected ${w}x${h}`);
}
const diff = await page.evaluate(async (full, band, y0, h) => {
  const load = async (d) => { const i = new Image(); i.src = "data:image/png;base64," + d; await i.decode(); return i; };
  const cut = (img, sy, sh) => {
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = sh;
    const g = c.getContext("2d", { willReadFrequently: true, alpha: false });
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, sy, img.naturalWidth, sh, 0, 0, img.naturalWidth, sh);
    return g.getImageData(0, 0, img.naturalWidth, sh).data;
  };
  const A = cut(await load(full), y0, h), B = cut(await load(band), 0, h);
  let n = 0;
  for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) n++;
  return n;
}, b64(ID_FULL), b64(ID_BAND), BAND_Y0, BAND_H);
diff === 0 ? ok(`ID band is a byte-exact slice of rows ${BAND_Y0}..${BAND_Y0 + BAND_H - 1}`) : bad(`${diff} px differ between the band and its slice of the full frame`);

// ---- 3. the band reproduces the v1 composition -----------------------------
// Compared in FULL-FRAME pixels so the 918-vs-917.33 band rounding drops out and only the
// camera derivation is under test.
console.log("\nComposition vs v1");
const v1 = JSON.parse(readFileSync(rel("lib/data/hero-scene.json"), "utf8"));
const v2 = JSON.parse(readFileSync(rel("lib/data/hero-scene-v2.json"), "utf8"));
const EXACT_BAND = v1.scene.height * (FULL_W / v1.scene.width);
let worstX = 0, worstY = 0, corners = 0;
for (const key of Object.keys(v1.regions)) {
  const a = v1.regions[key], b = v2.regions[key];
  if (!b) { bad(`v2 has no ${key} region`); continue; }
  for (let f = 0; f < a.length; f++) {
    for (let c = 0; c < a[f].quad.length; c++) {
      worstX = Math.max(worstX, Math.abs(a[f].quad[c][0] - b[f].quad[c][0]) * FULL_W);
      const fromV1 = FULL_H / 2 + (a[f].quad[c][1] - 0.5) * EXACT_BAND;
      const fromV2 = b[f].quad[c][1] * BAND_H + BAND_Y0;
      worstY = Math.max(worstY, Math.abs(fromV1 - fromV2));
      corners++;
    }
  }
}
const sameCam = JSON.stringify(v1.camera.pos) === JSON.stringify(v2.camera.pos)
  && JSON.stringify(v1.camera.target) === JSON.stringify(v2.camera.target);
sameCam ? ok("camera position and target identical to v1") : bad("camera moved");
worstX < 0.05 ? ok(`horizontal agreement over ${corners} corners: ${worstX.toFixed(4)}px`) : bad(`horizontal drift ${worstX.toFixed(3)}px — hFov is not preserved`);
worstY < 0.05 ? ok(`vertical agreement over ${corners} corners: ${worstY.toFixed(4)}px`) : bad(`vertical drift ${worstY.toFixed(3)}px — vFov derivation is wrong`);

// ---- 4. v1 outputs are untouched -------------------------------------------
console.log("\nv1 left alone");
const v1Png = await histogram("public/hero/base-modern.png");
v1Png.w === v1.scene.width && v1Png.h === v1.scene.height
  ? ok(`base-modern.png still ${v1Png.w}x${v1Png.h}`)
  : bad(`base-modern.png is ${v1Png.w}x${v1Png.h} — v1 was regenerated`);

await browser.close();
console.log(fail ? `\nFAIL — ${fail} check(s)` : "\nPASS — all checks green");
process.exit(fail ? 1 : 0);
