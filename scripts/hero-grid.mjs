#!/usr/bin/env node
/**
 * Dev tool: overlay a labelled percentage grid on the hero base plate.
 *
 *   node scripts/hero-grid.mjs                       # whole plate
 *   node scripts/hero-grid.mjs 0 0 50 100            # crop x%,y%,w%,h% — zoom a region
 *
 * Writes scripts/.out/hero-grid.png. Used to hand-map the polygon regions in
 * lib/data/hero-photo-regions.json against the AI-generated plate, which (unlike the Three.js
 * render) has no camera to project from. Not part of the app or the build.
 */

import puppeteer from "puppeteer";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", ".out");
mkdirSync(OUT, { recursive: true });

// SRC lets the same grid be thrown over a compositor screenshot, not just the bare plate —
// which is how a misaligned polygon gets read off in the same coordinates it was authored in.
const plate = readFileSync(process.env.SRC ? join(ROOT, process.env.SRC) : join(ROOT, "public/hero/base-photo.png"));
const W = plate.readUInt32BE(16), H = plate.readUInt32BE(20);
const dataUri = `data:image/png;base64,${plate.toString("base64")}`;

// Crop window in percent of the plate (defaults to the whole thing).
const [cx = 0, cy = 0, cw = 100, ch = 100] = process.argv.slice(2).map(Number);
const ZOOM = Number(process.env.ZOOM ?? 2.4);

// Displayed size of the cropped window.
const dispW = Math.round((cw / 100) * W * ZOOM);
const dispH = Math.round((ch / 100) * H * ZOOM);

// Grid step in percent — finer when zoomed into a small window.
const step = cw <= 30 ? 1 : cw <= 60 ? 2 : 5;

const lines = [];
for (let p = 0; p <= 100; p += step) {
  if (p < cx || p > cx + cw) continue;
  const left = ((p - cx) / cw) * dispW;
  const major = p % 10 === 0;
  lines.push(`<div class="v ${major ? "maj" : ""}" style="left:${left}px"></div>`);
  lines.push(`<div class="lx ${major ? "maj" : ""}" style="left:${left + 2}px">${p}</div>`);
}
for (let p = 0; p <= 100; p += step) {
  if (p < cy || p > cy + ch) continue;
  const top = ((p - cy) / ch) * dispH;
  const major = p % 10 === 0;
  lines.push(`<div class="h ${major ? "maj" : ""}" style="top:${top}px"></div>`);
  lines.push(`<div class="ly ${major ? "maj" : ""}" style="top:${top + 2}px">${p}</div>`);
}

const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#111;font:10px/1 ui-monospace,monospace}
  #wrap{position:relative;width:${dispW}px;height:${dispH}px;overflow:hidden}
  img{position:absolute;width:${Math.round(W * ZOOM)}px;height:${Math.round(H * ZOOM)}px;
      left:${-((cx / 100) * W * ZOOM)}px;top:${-((cy / 100) * H * ZOOM)}px;image-rendering:auto}
  .v,.h{position:absolute;background:rgba(255,0,255,.35)}
  .v{top:0;height:100%;width:1px} .h{left:0;width:100%;height:1px}
  .v.maj,.h.maj{background:rgba(0,255,255,.85)}
  .lx,.ly{position:absolute;color:#ff0;text-shadow:0 0 3px #000,0 0 3px #000}
  .lx{top:1px} .ly{left:1px}
  .lx.maj,.ly.maj{color:#0ff;font-weight:700;font-size:12px}
</style><div id="wrap"><img src="${dataUri}">${lines.join("")}</div>`;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: dispW, height: dispH, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle0" });
const out = join(OUT, `hero-grid${process.env.TAG ? `-${process.env.TAG}` : ""}.png`);
await page.screenshot({ path: out });
await browser.close();

console.log(`plate ${W}x${H} · window x${cx}–${cx + cw}% y${cy}–${cy + ch}% · grid ${step}% · ${out}`);
