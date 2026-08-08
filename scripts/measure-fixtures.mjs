#!/usr/bin/env node
/**
 * Dev tool: measure where the PRODUCT actually sits inside a catalog photo.
 *
 *   node scripts/measure-fixtures.mjs
 *
 * The compositor sizes a pinned fixture from PHOTO_FRAME_RATIO — a single constant standing
 * in for "how much of Build.com's square c_lpad frame is whitespace". That is fine for
 * sizing in aggregate and useless for alignment: to put a faucet's BASE on a countertop you
 * need to know where the base is inside its own frame, which varies per shot. This fetches
 * each photo server-side (the CDN answers curl and Node happily; it is only the browser's
 * CORS request it refuses) and reports the product's bounding box as fractions of the frame.
 *
 * Those numbers are what the anchors in lib/data/hero-photo-regions.json are solved against.
 * Not part of the app or the build.
 */

import puppeteer from "puppeteer";

// Slugs read straight out of the catalogue JSON rather than through the TS helpers, which
// Node cannot import. Woodhurst / Chrome throughout, matching the /hero-check harness.
const CDN = "https://s3.img-b.com/image/private/t_base,c_lpad,f_auto,dpr_auto,w_400,h_400/product/delta/";
const TARGETS = [
  ["showerHead", CDN + "delta-52668-7908442.jpg"],
  ["valveTrim", CDN + "delta-t14032-7866937.jpg"],
  ["faucet", CDN + "delta-3532lf-mpu-7866937.jpg"],
];

async function fetchDataUri(url) {
  // Accept: */* keeps the CDN on JPEG rather than serving WebP, which decodes the same but
  // makes the byte count harder to sanity-check by eye.
  const res = await fetch(url, { headers: { Accept: "*/*" } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${res.headers.get("content-type") ?? "image/jpeg"};base64,${buf.toString("base64")}`;
}

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("about:blank");

for (const [name, url] of TARGETS) {
  if (!url) { console.log(`${name.padEnd(11)} no catalogue image`); continue; }
  const uri = await fetchDataUri(url);
  if (!uri) { console.log(`${name.padEnd(11)} fetch failed`); continue; }

  // A data: URI is same-origin, so getImageData is permitted here even though the same
  // bytes over https would taint the canvas in the app.
  const box = await page.evaluate((src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, W, H).data;
      // Background sampled from the corners, same rule buildCutout uses.
      const corners = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + W - 1) * 4];
      let bR = 0, bG = 0, bB = 0;
      for (const i of corners) { bR += px[i]; bG += px[i + 1]; bB += px[i + 2]; }
      bR /= 4; bG /= 4; bB /= 4;
      const TOL = 22;
      let minX = W, minY = H, maxX = -1, maxY = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const bg = Math.abs(px[i] - bR) < TOL && Math.abs(px[i + 1] - bG) < TOL && Math.abs(px[i + 2] - bB) < TOL;
          if (bg) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      resolve({ W, H, minX, minY, maxX, maxY });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  }), uri);

  if (!box || box.maxX < 0) { console.log(`${name.padEnd(11)} no content found`); continue; }
  const { W, H, minX, minY, maxX, maxY } = box;
  const w = (maxX - minX + 1) / W;      // product width, as a fraction of the frame
  const h = (maxY - minY + 1) / H;      // product height, same
  // Where the product's centre and its bottom sit inside the frame, measured from the frame
  // centre. bottomFromCentre is the one that matters for standing a faucet on a counter.
  const cx = ((minX + maxX) / 2 / W) - 0.5;
  const cy = ((minY + maxY) / 2 / H) - 0.5;
  const bottomFromCentre = ((maxY + 1) / H) - 0.5;
  console.log(
    `${name.padEnd(11)} frame ${W}x${H}  product ${(w * 100).toFixed(1)}% x ${(h * 100).toFixed(1)}% of frame` +
    `  offsetFromCentre ${(cx * 100).toFixed(1)}%, ${(cy * 100).toFixed(1)}%` +
    `  bottomFromCentre ${(bottomFromCentre * 100).toFixed(1)}%` +
    `  impliedFrameRatio ${(1 / Math.max(w, h)).toFixed(2)}`,
  );
}

await browser.close();
