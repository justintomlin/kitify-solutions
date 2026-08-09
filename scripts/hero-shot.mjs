#!/usr/bin/env node
/**
 * Screenshot the /hero-check alignment harness. Temporary, paired with app/hero-check.
 *
 *   npm run dev            (in another shell)
 *   node scripts/hero-shot.mjs
 *
 * Writes scripts/.out/hero-composite.png and scripts/.out/hero-outlines.png.
 */

import puppeteer from "puppeteer";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", ".out");
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1640, height: 1600, deviceScaleFactor: 1 });

page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 160)); });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));

// networkidle0 is unreliable here: several CDNs reject the browser's CORS request, and the
// retry-with-a-cache-buster means the request log never goes quiet on a predictable schedule.
// Wait for the page's own markup instead, then give the compositors time to load textures and
// finish their 300ms cross-fades.
await page.goto("http://localhost:3000/hero-check", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("#composite canvas", { timeout: 60000 });
await new Promise((r) => setTimeout(r, 6000));

const shots = [
  // The wrapper, not the canvas: the disclaimer is an HTML sibling of the canvas, so shooting
  // the canvas alone would silently omit the thing most worth checking.
  ["#composite", "hero-composite.png"],
  ["section:nth-of-type(2) canvas", "hero-outlines.png"],
  ["#bases", "hero-bases.png"],
  ["#walls", "hero-walls.png"],
  ["#finishes", "hero-finishes.png"],
  ["#finishesHead", "hero-head.png"],
  ["#finishesValve", "hero-valve.png"],
  ["#finishesDoorTop", "hero-doortop.png"],
  ["#finishesDoorEdge", "hero-dooredge.png"],
  ["#finishesRail", "hero-rail.png"],
  ["#finishesSconce", "hero-sconce.png"],

];
for (const [sel, name] of shots) {
  const el = await page.$(sel);
  if (!el) { console.log(`  ! no element for ${sel}`); continue; }
  await el.screenshot({ path: join(OUT, name) });
  console.log(`  wrote ${name}`);
}

await browser.close();
