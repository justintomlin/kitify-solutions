#!/usr/bin/env node
/**
 * Dev tool: measure the hero plate — or a compositor screenshot — by arithmetic.
 *
 * Decodes an 8-bit truecolour PNG straight in Node (zlib inflate plus PNG's five filters), so a
 * measurement costs microseconds. Earlier passes probed through a headless Chrome, one launch
 * per query; that is fine for six measurements and unusable for the several hundred behind the
 * line fits recorded in lib/data/hero-photo-regions.json. Every number in those notes was
 * produced with this, which is the reason it is checked in: without it they cannot be redone.
 *
 * Everything speaks PLATE PERCENT, the same unit the region JSON is authored in.
 *
 *   node scripts/hero-probe.mjs hrow  <y> <x0> <x1> [step]   horizontal luminance profile
 *   node scripts/hero-probe.mjs vcol  <x> <y0> <y1> [step]   vertical luminance profile
 *   node scripts/hero-probe.mjs hmin  <y> <x0> <x1>          darkest column, parabola-refined
 *   node scripts/hero-probe.mjs hmax  <y> <x0> <x1>          brightest column
 *   node scripts/hero-probe.mjs vmin  <x> <y0> <y1>          darkest row in a column
 *   node scripts/hero-probe.mjs vstep <x> <y0> <y1>          strongest horizontal edge crossing
 *   node scripts/hero-probe.mjs hstep <y> <x0> <x1>          strongest vertical edge crossing
 *   node scripts/hero-probe.mjs box   <x0> <y0> <x1> <y1>    mean/min/max, and mean RGB
 *   node scripts/hero-probe.mjs cols  <x0> <y0> <x1> <y1> [cut]   sub-cutoff pixels per column
 *   node scripts/hero-probe.mjs rows  <x0> <y0> <x1> <y1> [cut]   ... per row
 *
 * SRC=path overrides the plate, which is how a composite gets measured in the same coordinates
 * the regions were authored in — SRC=scripts/.out/hero-composite.png.
 *
 * WARMTH, not just luminance. `box` reports mean RGB as well, because several boundaries on
 * this plate are invisible in brightness and obvious in R-B: the wood counter against its grey
 * wall, the acrylic curb against the flooring. Both were missed by earlier passes for exactly
 * that reason.
 *
 * Importable as a module too — makePlate() and fitLine() are what the ad-hoc survey scripts in
 * scripts/.out use. Not part of the app or the build.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";

export function decodePng(path) {
  const b = readFileSync(path);
  let o = 8, W = 0, H = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.slice(o + 4, o + 8).toString("latin1");
    const data = b.slice(o + 8, o + 8 + len);
    if (type === "IHDR") {
      W = data.readUInt32BE(0); H = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`unsupported PNG: depth ${bitDepth} colour ${colorType}`);
      }
      if (data[12] !== 0) throw new Error("interlaced PNG unsupported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = W * bpp;
  const out = Buffer.alloc(H * stride);
  let p = 0;
  for (let y = 0; y < H; y++) {
    const filter = raw[p++];
    const row = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const bb = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += bb;
      else if (filter === 3) v += (a + bb) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
      }
      cur[i] = v & 255;
    }
  }
  return { W, H, bpp, data: out };
}

export function makePlate(path = "public/hero/base-photo.png") {
  const { W, H, bpp, data } = decodePng(path);
  const at = (px, py) => {
    px = Math.max(0, Math.min(W - 1, Math.round(px)));
    py = Math.max(0, Math.min(H - 1, Math.round(py)));
    const i = (py * W + px) * bpp;
    return [data[i], data[i + 1], data[i + 2], bpp === 4 ? data[i + 3] : 255];
  };
  const lumPx = (px, py) => { const [r, g, bl] = at(px, py); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const X = (p) => (p / 100) * W, Y = (p) => (p / 100) * H;
  const toXp = (px) => (px / W) * 100, toYp = (py) => (py / H) * 100;
  // Averaged along the axis PERPENDICULAR to the feature being searched, which is what makes a
  // one-pixel line survive the plate's compression noise.
  const lumV = (px, py, n = 2) => { let s = 0, k = 0; for (let j = -n; j <= n; j++) { s += lumPx(px, py + j); k++; } return s / k; };
  const lumH = (px, py, n = 2) => { let s = 0, k = 0; for (let j = -n; j <= n; j++) { s += lumPx(px + j, py); k++; } return s / k; };

  return {
    W, H, at, lumPx, X, Y, toXp, toYp, lumV, lumH,
    /** Luminance at a percent coordinate. */
    lum: (xp, yp) => lumPx(X(xp), Y(yp)),
    rgb: (xp, yp) => at(X(xp), Y(yp)),
    /** Darkest column between two percents at a given row, parabola-refined. */
    hmin(yp, x0, x1, n = 3) { return extreme(this, yp, x0, x1, n, true); },
    hmax(yp, x0, x1, n = 3) { return extreme(this, yp, x0, x1, n, false); },
    /** Darkest / brightest row within a column. */
    vmin(xp, y0, y1, n = 3) { return extremeV(this, xp, y0, y1, n, true); },
    vmax(xp, y0, y1, n = 3) { return extremeV(this, xp, y0, y1, n, false); },
    /** Strongest vertical gradient in a column — where a horizontal edge crosses it. */
    vstep(xp, y0, y1, n = 3) {
      const px = X(xp);
      let best = null;
      for (let py = Math.round(Y(y0)); py <= Math.round(Y(y1)); py++) {
        const g = lumH(px, py + 1, n) - lumH(px, py - 1, n);
        if (!best || Math.abs(g) > Math.abs(best.g)) best = { py, g, v: lumH(px, py, n) };
      }
      return best && { at: +toYp(best.py).toFixed(3), grad: +best.g.toFixed(1), value: +best.v.toFixed(1) };
    },
    /** Strongest horizontal gradient in a row — where a vertical edge crosses it. */
    hstep(yp, x0, x1, n = 3) {
      const py = Y(yp);
      let best = null;
      for (let px = Math.round(X(x0)); px <= Math.round(X(x1)); px++) {
        const g = lumV(px + 1, py, n) - lumV(px - 1, py, n);
        if (!best || Math.abs(g) > Math.abs(best.g)) best = { px, g, v: lumV(px, py, n) };
      }
      return best && { at: +toXp(best.px).toFixed(3), grad: +best.g.toFixed(1), value: +best.v.toFixed(1) };
    },
    /** Horizontal luminance profile. */
    hrow(yp, x0, x1, step = 0.25, n = 2) {
      const r = [];
      for (let p = x0; p <= x1 + 1e-9; p += step) r.push([+p.toFixed(2), +lumV(X(p), Y(yp), n).toFixed(1)]);
      return r;
    },
    /** Vertical luminance profile. */
    vcol(xp, y0, y1, step = 0.25, n = 2) {
      const r = [];
      for (let p = y0; p <= y1 + 1e-9; p += step) r.push([+p.toFixed(2), +lumH(X(xp), Y(p), n).toFixed(1)]);
      return r;
    },
    box(x0, y0, x1, y1) {
      let s = 0, k = 0, mn = 1e9, mx = -1e9;
      for (let py = Math.round(Y(y0)); py <= Math.round(Y(y1)); py++) {
        for (let px = Math.round(X(x0)); px <= Math.round(X(x1)); px++) {
          const v = lumPx(px, py); s += v; k++; if (v < mn) mn = v; if (v > mx) mx = v;
        }
      }
      return { mean: +(s / k).toFixed(1), min: +mn.toFixed(1), max: +mx.toFixed(1), n: k };
    },
    /** Mean RGB over a box — for comparing two planes' colour, not just their brightness. */
    boxRgb(x0, y0, x1, y1) {
      let r = 0, g = 0, b = 0, k = 0;
      for (let py = Math.round(Y(y0)); py <= Math.round(Y(y1)); py++) {
        for (let px = Math.round(X(x0)); px <= Math.round(X(x1)); px++) {
          const c = at(px, py); r += c[0]; g += c[1]; b += c[2]; k++;
        }
      }
      return [+(r / k).toFixed(1), +(g / k).toFixed(1), +(b / k).toFixed(1), k];
    },
    /** Count of sub-cutoff pixels per column across a window — the fixture-box finder. */
    darkCols(x0, y0, x1, y1, cutoff = 112) {
      const cols = [];
      for (let px = Math.round(X(x0)); px <= Math.round(X(x1)); px++) {
        let n = 0, mn = 999;
        for (let py = Math.round(Y(y0)); py <= Math.round(Y(y1)); py++) {
          const v = lumPx(px, py); if (v < cutoff) n++; if (v < mn) mn = v;
        }
        cols.push([+toXp(px).toFixed(3), n, +mn.toFixed(0)]);
      }
      return cols;
    },
    darkRows(x0, y0, x1, y1, cutoff = 112) {
      const rows = [];
      for (let py = Math.round(Y(y0)); py <= Math.round(Y(y1)); py++) {
        let n = 0, mn = 999;
        for (let px = Math.round(X(x0)); px <= Math.round(X(x1)); px++) {
          const v = lumPx(px, py); if (v < cutoff) n++; if (v < mn) mn = v;
        }
        rows.push([+toYp(py).toFixed(3), n, +mn.toFixed(0)]);
      }
      return rows;
    },
  };
}

function extreme(P, yp, x0, x1, n, min) {
  const py = P.Y(yp);
  let best = null;
  for (let px = Math.round(P.X(x0)); px <= Math.round(P.X(x1)); px++) {
    const v = P.lumV(px, py, n);
    if (!best || (min ? v < best.v : v > best.v)) best = { px, v };
  }
  const a = P.lumV(best.px - 1, py, n), b = best.v, c = P.lumV(best.px + 1, py, n);
  const den = a - 2 * b + c;
  const sh = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return {
    at: +P.toXp(best.px + (Math.abs(sh) < 1 ? sh : 0)).toFixed(3),
    value: +best.v.toFixed(1),
    shoulders: [+P.lumV(best.px - 8, py, n).toFixed(1), +P.lumV(best.px + 8, py, n).toFixed(1)],
  };
}

function extremeV(P, xp, y0, y1, n, min) {
  const px = P.X(xp);
  let best = null;
  for (let py = Math.round(P.Y(y0)); py <= Math.round(P.Y(y1)); py++) {
    const v = P.lumH(px, py, n);
    if (!best || (min ? v < best.v : v > best.v)) best = { py, v };
  }
  const a = P.lumH(px, best.py - 1, n), b = best.v, c = P.lumH(px, best.py + 1, n);
  const den = a - 2 * b + c;
  const sh = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return {
    at: +P.toYp(best.py + (Math.abs(sh) < 1 ? sh : 0)).toFixed(3),
    value: +best.v.toFixed(1),
    shoulders: [+P.lumH(px, best.py - 8, n).toFixed(1), +P.lumH(px, best.py + 8, n).toFixed(1)],
  };
}

/** Least squares y = a + b x over [[x,y],...]. Returns fit plus the worst residual. */
export function fitLine(pts) {
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
  const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  const res = pts.map((p) => p[1] - (a + b * p[0]));
  return { a: +a.toFixed(4), b: +b.toFixed(5), maxRes: +Math.max(...res.map(Math.abs)).toFixed(3), n,
    at: (x) => a + b * x };
}

// ------------------------------- the CLI ------------------------------------
// Only when run directly, so importing this module from a survey script costs nothing.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const P = makePlate(process.env.SRC ?? "public/hero/base-photo.png");
  const [cmd, ...rest] = process.argv.slice(2);
  const n = rest.map(Number);
  const show = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v));
  switch (cmd) {
    case "hrow": show(P.hrow(n[0], n[1], n[2], n[3] ?? 0.25).map(([x, v]) => `${x}:${v}`).join(" ")); break;
    case "vcol": show(P.vcol(n[0], n[1], n[2], n[3] ?? 0.25).map(([y, v]) => `${y}:${v}`).join(" ")); break;
    case "hmin": show(P.hmin(n[0], n[1], n[2])); break;
    case "hmax": show(P.hmax(n[0], n[1], n[2])); break;
    case "vmin": show(P.vmin(n[0], n[1], n[2])); break;
    case "vmax": show(P.vmax(n[0], n[1], n[2])); break;
    case "vstep": show(P.vstep(n[0], n[1], n[2])); break;
    case "hstep": show(P.hstep(n[0], n[1], n[2])); break;
    case "box": {
      const b = P.box(n[0], n[1], n[2], n[3]), rgb = P.boxRgb(n[0], n[1], n[2], n[3]);
      show({ ...b, rgb: rgb.slice(0, 3), warmth: +(rgb[0] - rgb[2]).toFixed(1) });
      break;
    }
    case "cols": show(P.darkCols(n[0], n[1], n[2], n[3], n[4] ?? 112).map((c) => c.join(":")).join(" ")); break;
    case "rows": show(P.darkRows(n[0], n[1], n[2], n[3], n[4] ?? 112).map((c) => c.join(":")).join(" ")); break;
    default:
      console.log(`plate ${P.W}x${P.H}. Commands: hrow vcol hmin hmax vmin vmax vstep hstep box cols rows`);
  }
}
