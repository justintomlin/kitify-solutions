#!/usr/bin/env node
/**
 * Render the hero compositor's base bathroom scene, its region mask, and the geometry that
 * ties both to the compositor.
 *
 *   node scripts/render-base-scene.mjs
 *
 * Writes  public/hero/base-modern.png        1800x860 furnished architectural render
 *         public/hero/base-modern-mask.png   region ID map, same camera, same size
 *         lib/data/hero-scene.json           projected region quads, anchors, mask legend
 *
 * Runs once (or whenever the scene changes); the compositor itself is pure client-side canvas.
 *
 * WHY THERE IS A MASK PASS
 * The compositor paints a material onto a surface by warping it through that surface's four
 * screen corners. A flat quad is the right description of a bare wall and the wrong
 * description of a wall with a vanity in front of it: paint the floor quad and the flooring
 * goes straight over the toilet; paint the alcove and tile covers the glass and the shower
 * head. So a second pass re-renders the same camera with every paintable surface in a flat ID
 * colour and everything else black. The quad still says HOW a texture warps; the mask says
 * WHERE it is allowed to land. Fixtures then occlude correctly for free, because the depth
 * buffer already sorted them out.
 *
 * Glass is deliberately omitted from the mask pass. The tiled wall behind a shower screen is
 * genuinely visible and should be painted; the screen's own tint then multiplies over the
 * result in the beauty render, which is exactly the shading it should contribute.
 *
 * WHY THE SHELL IS LIGHT
 * The compositor blends materials with `multiply`, so a base pixel becomes the shading
 * multiplier: mid-grey walls would drag every texture down to mud. Surfaces are near-white,
 * and the depth comes from soft edge darkening (the AO gradients below), warm/cool light
 * separation, and contact shadows — detail that survives multiply as real shading.
 *
 * Three.js is vendored under scripts/vendor for the same reasons as render-nuvo-3d.mjs: no
 * network dependency, pinned version, reproducible output.
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = path.join(ROOT, "scripts", "vendor");
const OUT_DIR = path.join(ROOT, "public", "hero");
const OUT_PNG = path.join(OUT_DIR, "base-modern.png");
const OUT_MASK = path.join(OUT_DIR, "base-modern-mask.png");
const OUT_JSON = path.join(ROOT, "lib", "data", "hero-scene.json");

/**
 * Output size, and it is wide on purpose.
 *
 * The hero renders into a broad band across the top of the configurator hub, and the
 * compositor cover-fits into it. A 3:2 scene dropped into a band three times wider than it
 * is tall gets scaled to the width and then loses roughly half its height off the top and
 * bottom — which is what was cropping the floor away and making the room look tight. Match
 * the scene's shape to the slot it lands in and almost all of it survives.
 */
const W = 1800, H = 860;

/**
 * The room, in inches: 10' wide x 8' high, with the fourth wall behind the camera.
 *
 * Wide for a specific reason. A shower, a 62" vanity with a mirror, and a toilet cannot all
 * sit in frame in a narrow room shot from the doorway: side walls near the camera fall
 * outside the frame entirely, so anything against them is invisible. Putting the shower and
 * the vanity side by side on one wide back wall keeps both frontal and prominent, which is
 * what the products need.
 *
 * LAYOUT, left to right in frame:
 *   shower alcove (x 0-48, tiled, glass screen)  |  vanity + mirror + bar light (x 58-120)
 * with the toilet against the right wall, and a window above it throwing light across the
 * room from the right.
 */
// Depth grew from 120" purely to make room for the camera to step back. Every fixture is
// exactly where it was — the extra 24" is all behind the lens, where the fourth wall is, and
// never appears in frame. There was no other way to honour "pull the camera back": it stood
// 16" off the fourth wall, so any further and it would have been outside the box looking
// through it.
const ROOM = { w: 120, h: 96, d: 144 };

const SHOWER = { x1: 48, z1: 36, h: 84, curb: 4 };
// Thickness of the divider between the alcove and the vanity run. Only its front edge faces
// the camera, so this number is entirely how wide that architectural corner reads — at 4" it
// was a washed-out sliver. The alcove's inner face does not move; the wall thickens outward
// into the 10" gap before the vanity starts.
const DIVIDER_W = 6;
// Shower head high, valve trim low — the real rough-in heights, and the separation is the
// point: you reach the controls at waist height without standing under the water.
const HEAD = { arm: 79, y: 77.5, z: 15, r: 5.0 };   // 10" rain head
const TRIM = { y: 38, z: 20, r: 4.0 };              // 8" escutcheon, on the left return
const NICHE = { x0: 9, x1: 31, y0: 42, y1: 58, depth: 3.5 };
// counter: slab thickness, shown as a real edge profile rather than a paper-thin line.
// x1 runs all the way to the right wall so the run dies into it, with no sliver of wall and
// floor showing past its end — a free-standing gap at that end read as a mistake. The
// countertop therefore overhangs on the left and front only; it cannot overhang into a wall.
const VANITY = { x0: 58, x1: 120, depth: 21, body: 32, counter: 1.5, overhang: 1 };
// Backsplash. 4" is the standard and the vanity module's own default; the module also offers
// 6", but this render is static and has no access to a dealer's selection, so it renders the
// default. See the note on SPLASH_HEIGHT in components/vanity/VanityConfigurator.
const SPLASH = { h: 4, t: 0.75 };
/**
 * The basin, as a real recess cut through the countertop rather than a shadow painted on it.
 *
 * `shape` is "oval" or "rect" and `count` is 1 or 2, mirroring the vanity module's sink
 * options. Both are fixed here at the module's defaults for the same reason as the
 * backsplash height: a pre-rendered scene cannot know what a dealer picked. Changing either
 * constant and re-running produces the other variant, so the geometry is ready if a second
 * base scene is ever wanted.
 */
const BASIN = { cx: 89, cz: 11, rx: 8, rz: 6, depth: 5, shape: "oval", count: 1 };
// Both re-centred on the vanity run after it grew to meet the right wall; a mirror hung off
// the centre of the cabinet beneath it reads as a mistake even when nothing else moved.
const MIRROR = { x0: 68, x1: 110, y0: 42, y1: 74 };
const BARLIGHT = { y: 79, x0: 80, x1: 98 };
// The toilet sits well forward of the back wall on purpose. Tucked into the corner it was
// squarely behind the vanity's right-hand end from this camera and read as a white lump
// growing out of the cabinet; clear of the vanity it reads as a separate fixture. Pushed out
// again once the vanity run grew to meet the right wall, which put the counter's end directly
// over the tank and merged the two back together.
const TOILET = { z: 50, w: 20, depth: 28 };            // against the right wall
const WINDOW = { z0: 4, z1: 26, y0: 44, y1: 74 };      // right wall, behind the toilet

// Eye level, a little back from the open end and angled down. Moving this invalidates
// nothing, but the JSON and the mask must be regenerated with it.
// Standing in the doorway. Raised to 5'2" and tilted down about 20 degrees, which is what
// brings the floor — and with it the shower pan, the toe kick and the base of the vanity —
// into frame; the previous near-level framing put the wall-to-floor line at 83% of the
// picture and left barely a strip of floor. `fov` is vertical, so against the wide output
// above it opens to roughly a 96 degree horizontal view and takes in the whole room.
const CAM = { pos: [40, 62, 128], target: [66, 29, 8], fov: 54 };

/**
 * Mask colours. Pure, well separated and never near-black, so the decoder can classify a
 * pixel by nearest match and treat everything unclaimed — fixtures, glass, the ceiling — as
 * "not paintable". Kept in sync with RegionId in lib/hero-regions.ts.
 */
const REGION_COLORS = {
  backWall: "#ff0000",
  leftWall: "#00ff00",
  rightWall: "#0000ff",
  floor: "#ffff00",
  showerArea: "#ff00ff",
  vanityArea: "#00ffff",
  vanityTop: "#ff8000",
};

// --------------------------------- server ----------------------------------
const MIME = { ".js": "text/javascript", ".html": "text/html" };

function startServer(page) {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent((req.url || "/").split("?")[0]);
      if (url === "/" || url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" }); res.end(page); return;
      }
      if (!url.startsWith("/vendor/")) { res.writeHead(404); res.end("not found"); return; }
      const resolved = path.resolve(path.join(VENDOR_DIR, url.slice("/vendor/".length)));
      // Never serve outside the vendor root.
      if (!resolved.startsWith(VENDOR_DIR)) { res.writeHead(403); res.end(); return; }
      const buf = await readFile(resolved);
      res.writeHead(200, { "content-type": MIME[path.extname(resolved).toLowerCase()] ?? "application/octet-stream" });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ------------------------------- render page -------------------------------
const PAGE = /* html */ `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}canvas{display:block}</style></head>
<body>
<script src="/vendor/three.min.js"></script>
<script>
const W = ${W}, H = ${H};
const ROOM = ${JSON.stringify(ROOM)};
const SHOWER = ${JSON.stringify(SHOWER)};
const DIVIDER_W = ${DIVIDER_W};
const HEAD = ${JSON.stringify(HEAD)};
const TRIM = ${JSON.stringify(TRIM)};
const SPLASH = ${JSON.stringify(SPLASH)};
const NICHE = ${JSON.stringify(NICHE)};
const VANITY = ${JSON.stringify(VANITY)};
const BASIN = ${JSON.stringify(BASIN)};
const MIRROR = ${JSON.stringify(MIRROR)};
const BARLIGHT = ${JSON.stringify(BARLIGHT)};
const TOILET = ${JSON.stringify(TOILET)};
const WINDOW = ${JSON.stringify(WINDOW)};
const CAM = ${JSON.stringify(CAM)};

/**
 * The countertop slab's actual extent, derived once and used by both the geometry and the
 * region quad below.
 *
 * Derived rather than written twice because the two must agree exactly: the quad is what the
 * compositor fits a homography to, and a countertop quad that disagrees with the countertop
 * by even an inch slides the material off the slab it is meant to be painting. The right end
 * is clamped to the wall, since the slab cannot overhang into it.
 */
const CTOP = {
  x0: VANITY.x0 - VANITY.overhang,
  x1: Math.min(ROOM.w, VANITY.x1 + VANITY.overhang),
  z1: VANITY.depth + VANITY.overhang,
  y: VANITY.body + VANITY.counter,
};
const REGION_COLORS = ${JSON.stringify(REGION_COLORS)};

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f2f1ee");
const camera = new THREE.PerspectiveCamera(CAM.fov, W / H, 1, 4000);
camera.position.set(CAM.pos[0], CAM.pos[1], CAM.pos[2]);
camera.lookAt(CAM.target[0], CAM.target[1], CAM.target[2]);
camera.updateMatrixWorld(true);
camera.updateProjectionMatrix();

// Registry driving the mask pass: every mesh records the region it belongs to (or null for
// "not paintable"), and whether it should vanish when the mask is rendered.
const REGISTRY = [];
function register(mesh, region, opts) {
  REGISTRY.push({ mesh: mesh, region: region || null, hideInMask: !!(opts && opts.hideInMask) });
  return mesh;
}

/**
 * A soft ambient-occlusion map for one surface, as a canvas texture.
 *
 * Real AO would need a raytracer; what the compositor needs is far less. It needs the base
 * scene to carry believable shading in the value range multiply can use — corners a little
 * darker than the middle, a contact shadow where a wall meets the floor. Four eased edge
 * gradients deliver that, cost nothing, and are identical between runs (a sampled AO pass
 * would dither differently every time).
 */
function aoTexture(wIn, hIn, opts) {
  const o = opts || {};
  const edge = o.edge === undefined ? 0.22 : o.edge;
  const band = o.band === undefined ? 0.28 : o.band;
  const floorEdge = o.floorEdge === undefined ? edge : o.floorEdge;
  const S = 512;
  const ar = wIn / hIn;
  const c = document.createElement("canvas");
  c.width = Math.max(64, Math.round(ar >= 1 ? S : S * ar));
  c.height = Math.max(64, Math.round(ar >= 1 ? S / ar : S));
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  const px = Math.max(8, Math.round(Math.min(c.width, c.height) * band));
  // Eased rather than linear: a two-stop ramp leaves a shoulder where it meets the flat
  // middle, which renders as a faint rectangle outlined on the wall.
  const ramp = (grad, a) => {
    for (let i = 0; i <= 8; i++) {
      const s = i / 8;
      grad.addColorStop(s, "rgba(0,0,0," + (a * Math.pow(1 - s, 2.2)).toFixed(4) + ")");
    }
    return grad;
  };
  g.fillStyle = ramp(g.createLinearGradient(0, 0, px, 0), edge);
  g.fillRect(0, 0, px, c.height);
  g.fillStyle = ramp(g.createLinearGradient(c.width, 0, c.width - px, 0), edge);
  g.fillRect(c.width - px, 0, px, c.height);
  g.fillStyle = ramp(g.createLinearGradient(0, 0, 0, px), edge);
  g.fillRect(0, 0, c.width, px);
  g.fillStyle = ramp(g.createLinearGradient(0, c.height, 0, c.height - px), floorEdge);
  g.fillRect(0, c.height - px, c.width, px);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

/**
 * Cabinet-front detail: the reveal lines between drawers and doors, drawn rather than
 * modelled.
 *
 * Modelled reveals need a light grazing the face to read at all, and this rig is
 * deliberately soft. Drawn lines are unconditional, they survive the compositor's multiply
 * (they are darker than their surroundings, which is all multiply preserves), and they stay
 * put when a dealer tints the cabinet a different colour.
 */
function cabinetTexture(wIn, hIn) {
  const S = 1024;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = Math.max(64, Math.round(S * hIn / wIn));
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  const line = (x0, y0, x1, y1) => {
    const grd = g.createLinearGradient(x0, y0 - 3, x0, y0 + 3);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(0.5, "rgba(0,0,0,0.34)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.strokeStyle = "rgba(0,0,0,0.30)";
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  };
  // Two doors flanking a stack of three drawers — the layout of the reference vanities.
  const third = c.width / 3;
  line(third, 6, third, c.height - 6);
  line(third * 2, 6, third * 2, c.height - 6);
  for (let i = 1; i < 3; i++) line(third, (c.height / 3) * i, third * 2, (c.height / 3) * i);
  // Inset the whole face slightly so the cabinet reads as a box, not a painted rectangle.
  g.strokeStyle = "rgba(0,0,0,0.16)";
  g.lineWidth = 6;
  g.strokeRect(3, 3, c.width - 6, c.height - 6);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

/**
 * A horizontal slab surface with openings cut through it — the countertop deck around its
 * basins.
 *
 * The basin used to be shaded onto a solid top with a radial gradient. It read as a decal:
 * no silhouette against the counter behind it, and nothing for the light to catch. Cutting a
 * real opening and dropping a bowl through it costs this one function and makes the sink an
 * object in the room.
 *
 * The deck is built as a ring of quads sweeping around each opening: for every angle, one
 * point on the opening's edge and one where that same ray leaves the slab. The sweep angles
 * include the slab's four corner bearings explicitly, because a uniform sweep clips the
 * corners of the rectangle it is supposed to be filling. With two basins the slab is split
 * into a column per basin first, since one ring cannot enclose two holes.
 *
 * UVs map linearly across the whole slab, so a texture laid on the deck is unaffected by how
 * it happens to be triangulated.
 */
function deckWithHoles(rect, holes, y, color, opts) {
  const SEG = 72;
  const positions = [], uvs = [];
  const spanX = rect.x1 - rect.x0, spanZ = rect.z1 - rect.z0;

  for (let n = 0; n < holes.length; n++) {
    const hole = holes[n];
    // One column of slab per basin, so each ring encloses exactly one opening.
    const cell = {
      x0: rect.x0 + (spanX * n) / holes.length,
      x1: rect.x0 + (spanX * (n + 1)) / holes.length,
      z0: rect.z0, z1: rect.z1,
    };
    const innerAt = (t) => {
      const c = Math.cos(t), s = Math.sin(t);
      if (hole.shape === "rect") {
        const k = Math.min(hole.rx / Math.max(1e-6, Math.abs(c)), hole.rz / Math.max(1e-6, Math.abs(s)));
        return [hole.cx + c * k, hole.cz + s * k];
      }
      return [hole.cx + hole.rx * c, hole.cz + hole.rz * s];
    };
    const outerAt = (t) => {
      const c = Math.cos(t), s = Math.sin(t);
      const kx = c > 0 ? (cell.x1 - hole.cx) / c : c < 0 ? (cell.x0 - hole.cx) / c : Infinity;
      const kz = s > 0 ? (cell.z1 - hole.cz) / s : s < 0 ? (cell.z0 - hole.cz) / s : Infinity;
      const k = Math.min(kx, kz);
      return [hole.cx + c * k, hole.cz + s * k];
    };
    const norm = (a) => (a % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const angles = [];
    for (let i = 0; i < SEG; i++) angles.push((i / SEG) * Math.PI * 2);
    for (const [cx, cz] of [[cell.x0, cell.z0], [cell.x1, cell.z0], [cell.x1, cell.z1], [cell.x0, cell.z1]]) {
      angles.push(norm(Math.atan2(cz - hole.cz, cx - hole.cx)));
    }
    angles.sort((a, b) => a - b);

    const push = (p, q, r) => {
      for (const v of [p, q, r]) {
        positions.push(v[0], y, v[1]);
        uvs.push((v[0] - rect.x0) / spanX, (v[1] - rect.z0) / spanZ);
      }
    };
    for (let i = 0; i < angles.length; i++) {
      const t0 = angles[i], t1 = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
      if (t1 - t0 < 1e-6) continue;
      const i0 = innerAt(t0), i1 = innerAt(t1), o0 = outerAt(t0), o1 = outerAt(t1);
      push(i0, o1, o0);
      push(i0, i1, o1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  // Set flat rather than computed: every triangle is in the same horizontal plane, and
  // computeVertexNormals on a fan around a hole can flip a sliver at the corner bearings.
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  const o = opts || {};
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: color, map: o.map || null, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  scene.add(m);
  return register(m, o.region, {});
}

/** A soft vertical gradient, for the mirror glass. */
function mirrorTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, c.height);
  grd.addColorStop(0, "#f4f7fa");
  grd.addColorStop(0.55, "#e2e8ec");
  grd.addColorStop(1, "#cfd8de");
  g.fillStyle = grd;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

/**
 * One flat surface, from its four world-space corners in texture order (TL, TR, BR, BL as
 * seen looking at the face).
 *
 * Built as an explicit BufferGeometry rather than a positioned PlaneGeometry because these
 * corners are the very numbers the region JSON is projected from — one definition of where a
 * surface is, used for the render and for the compositing geometry, so the two cannot drift.
 */
function panel(corners, color, opts) {
  const o = opts || {};
  const [tl, tr, br, bl] = corners;
  const pos = new Float32Array([
    bl[0], bl[1], bl[2], br[0], br[1], br[2], tr[0], tr[1], tr[2],
    bl[0], bl[1], bl[2], tr[0], tr[1], tr[2], tl[0], tl[1], tl[2],
  ]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const mat = o.basic
    ? new THREE.MeshBasicMaterial({ color: color, map: o.map || null, transparent: !!o.opacity, opacity: o.opacity === undefined ? 1 : o.opacity, side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ color: color, map: o.map || null, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = !o.basic;
  scene.add(mesh);
  return register(mesh, o.region, { hideInMask: o.hideInMask });
}

/**
 * An axis-aligned solid, from min/max corners. Fixtures; never a paintable region.
 *
 * opts.noShadow exempts a solid from casting. Architecture uses it: the divider wall between
 * the shower and the vanity is tall enough to throw a hard diagonal band clean across the
 * alcove, which reads as a smudge on the tile rather than as depth. Fixtures keep casting,
 * because their short contact shadows are exactly what grounds them on the floor.
 */
function box(min, max, color, opts) {
  const o = opts || {};
  const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: color, map: o.map || null }));
  m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  m.castShadow = !o.noShadow; m.receiveShadow = true;
  scene.add(m);
  return register(m, o.region, { hideInMask: o.hideInMask });
}

function mesh(geo, color, pos, rot, opts) {
  const o = opts || {};
  const m = new THREE.Mesh(geo, o.basic
    ? new THREE.MeshBasicMaterial({ color: color })
    : new THREE.MeshLambertMaterial({ color: color }));
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = !o.basic && !o.noShadow; m.receiveShadow = !o.basic;
  scene.add(m);
  return register(m, null, { hideInMask: o.hideInMask });
}

// ---- palette --------------------------------------------------------------
// High-key on purpose: these are the values the compositor multiplies a texture against, so
// a wall at ~0.85 tints a decor believably while a wall at ~0.65 makes every material look
// dirty. The shading lives in the AO falloff and the shadows, not in the overall level.
// Values are separated deliberately. The first furnished version rendered a white cabinet
// against a white counter against a white wall and read as a single flat shape — every
// object was present and none of them were legible. The cabinet is now clearly a grey, the
// floor sits below the walls, and the alcove is a touch cooler than the room.
const WALL = "#f1efe9", ALCOVE_C = "#e9e9e7", FLOOR_C = "#dbd6cd", CEIL = "#f8f7f4";
const CAB = "#c2c4c3", COUNTER = "#fafaf9", PORCELAIN = "#fbfbfa", METAL = "#b6bbc0";

const wallAo = aoTexture(ROOM.w, ROOM.h, { edge: 0.20, floorEdge: 0.30, band: 0.26 });
const sideAo = aoTexture(ROOM.d, ROOM.h, { edge: 0.20, floorEdge: 0.30, band: 0.18 });
const floorAo = aoTexture(ROOM.w, ROOM.d, { edge: 0.22, band: 0.18 });
const alcoveAo = aoTexture(SHOWER.x1, SHOWER.h, { edge: 0.26, floorEdge: 0.30, band: 0.24 });

// ---- shell ----------------------------------------------------------------
// The back wall is split so the mask can distinguish the tiled alcove from plain wall: a
// pixel is either one or the other, never both, which is what keeps the ID map unambiguous.
//
// The cut depths are derived from what the camera can actually see, not guessed: at this
// focal length the floor is visible only to about z=40 and the side walls to z=38, because
// rays toward the frame edges leave the room before reaching the near end. Anything past
// that is off-frame, and pushing a quad corner toward the camera makes its projection blow
// up — the first pass ran the floor to z=96, eight inches from the lens, which put a corner
// at 516% and left the visible floor covered by barely two cells of the warp grid.
const CUT = { side: 88, floor: 80 };

// Back wall, alcove portion (x 0..SHOWER.x1, up to the alcove height).
panel([[0, SHOWER.h, 0], [SHOWER.x1, SHOWER.h, 0], [SHOWER.x1, 0, 0], [0, 0, 0]], ALCOVE_C, { map: alcoveAo, region: "showerArea" });
// Back wall, above the alcove and to its right.
panel([[0, ROOM.h, 0], [SHOWER.x1, ROOM.h, 0], [SHOWER.x1, SHOWER.h, 0], [0, SHOWER.h, 0]], WALL, { region: "backWall" });
panel([[SHOWER.x1, ROOM.h, 0], [ROOM.w, ROOM.h, 0], [ROOM.w, 0, 0], [SHOWER.x1, 0, 0]], WALL, { map: wallAo, region: "backWall" });

// Left wall: the alcove's far return, then plain wall.
panel([[0, SHOWER.h, 0], [0, SHOWER.h, SHOWER.z1], [0, 0, SHOWER.z1], [0, 0, 0]], ALCOVE_C, { map: alcoveAo, region: "showerArea" });
panel([[0, ROOM.h, 0], [0, ROOM.h, SHOWER.z1], [0, SHOWER.h, SHOWER.z1], [0, SHOWER.h, 0]], WALL, { region: "leftWall" });
panel([[0, ROOM.h, SHOWER.z1], [0, ROOM.h, ROOM.d], [0, 0, ROOM.d], [0, 0, SHOWER.z1]], WALL, { map: sideAo, region: "leftWall" });

// Right wall.
panel([[ROOM.w, ROOM.h, ROOM.d], [ROOM.w, ROOM.h, 0], [ROOM.w, 0, 0], [ROOM.w, 0, ROOM.d]], WALL, { map: sideAo, region: "rightWall" });

// Floor: the shower pan is not flooring, so it is a separate unpainted surface.
panel([[0, 0, 0], [SHOWER.x1, 0, 0], [SHOWER.x1, 0, SHOWER.z1], [0, 0, SHOWER.z1]], "#eceae6", {});
panel([[SHOWER.x1, 0, 0], [ROOM.w, 0, 0], [ROOM.w, 0, ROOM.d], [SHOWER.x1, 0, ROOM.d]], FLOOR_C, { map: floorAo, region: "floor" });
panel([[0, 0, SHOWER.z1], [SHOWER.x1, 0, SHOWER.z1], [SHOWER.x1, 0, ROOM.d], [0, 0, ROOM.d]], FLOOR_C, { region: "floor" });

panel([[0, ROOM.h, ROOM.d], [ROOM.w, ROOM.h, ROOM.d], [ROOM.w, ROOM.h, 0], [0, ROOM.h, 0]], CEIL, {});
// Fourth wall, behind the camera. Present so no ray escapes the box.
panel([[ROOM.w, ROOM.h, ROOM.d], [0, ROOM.h, ROOM.d], [0, 0, ROOM.d], [ROOM.w, 0, ROOM.d]], WALL, {});

// ---- shower ---------------------------------------------------------------
(function shower() {
  const X = SHOWER.x1, Z = SHOWER.z1;
  // Divider wall between the shower and the vanity run. Its inner face is tiled and is part
  // of the alcove; its outer face is ordinary wall.
  panel([[X, SHOWER.h, 0], [X, SHOWER.h, Z], [X, 0, Z], [X, 0, 0]], ALCOVE_C, { map: alcoveAo, region: "showerArea" });
  // Body of the divider, inset a hair on both faces so it never lies coplanar with the
  // alcove panel above or the front edge below — coincident faces z-fight and flicker.
  box([X + 0.05, 0, 0], [X + DIVIDER_W, ROOM.h, Z - 0.05], WALL, { noShadow: true });
  // The front edge of the divider: the architectural corner where the enclosure begins, and
  // the only part of this wall the camera sees square-on. It carries its own AO map with
  // hard edge falloff, which is what draws the two corner lines down the full height — the
  // flat-shaded 4" version read as a washed-out sliver with no edges at all.
  panel([[X, ROOM.h, Z], [X + DIVIDER_W, ROOM.h, Z], [X + DIVIDER_W, 0, Z], [X, 0, Z]], "#e8e5df",
    { map: aoTexture(DIVIDER_W, ROOM.h, { edge: 0.34, band: 0.34, floorEdge: 0.34 }) });

  // Niche, as a recess: back face plus four reveals. Reads as depth because the reveals
  // catch the light differently from the wall they sit in.
  //
  // Every face joins showerArea, reveals included. A niche is tiled through in reality, and
  // leaving the reveals out of the region meant they kept their bare light grey while the
  // wall around them took the decor — which composited as a pale rectangle outlined on the
  // tile, indistinguishable from a rendering fault. They are perpendicular to the alcove
  // homography and do smear slightly, but they are 3.5" deep and project to a few pixels, so
  // a few pixels of smear beats a bright hole in the wall.
  const d = NICHE.depth;
  panel([[NICHE.x0, NICHE.y1, d], [NICHE.x1, NICHE.y1, d], [NICHE.x1, NICHE.y0, d], [NICHE.x0, NICHE.y0, d]], "#e2dfda", { region: "showerArea" });
  panel([[NICHE.x0, NICHE.y1, 0], [NICHE.x0, NICHE.y1, d], [NICHE.x0, NICHE.y0, d], [NICHE.x0, NICHE.y0, 0]], "#d5d2cc", { region: "showerArea" });
  panel([[NICHE.x1, NICHE.y1, d], [NICHE.x1, NICHE.y1, 0], [NICHE.x1, NICHE.y0, 0], [NICHE.x1, NICHE.y0, d]], "#d5d2cc", { region: "showerArea" });
  panel([[NICHE.x0, NICHE.y1, 0], [NICHE.x1, NICHE.y1, 0], [NICHE.x1, NICHE.y1, d], [NICHE.x0, NICHE.y1, d]], "#cbc7c1", { region: "showerArea" });
  panel([[NICHE.x0, NICHE.y0, d], [NICHE.x1, NICHE.y0, d], [NICHE.x1, NICHE.y0, 0], [NICHE.x0, NICHE.y0, 0]], "#f4f2ee", { region: "showerArea" });

  // Curb and pan. Non-casting like the rest of the alcove — its shadow fell across the pan
  // and the lower wall as another pale-edged shape with no obvious source.
  box([0, 0, Z - SHOWER.curb], [X, 5, Z], "#eeece8", { noShadow: true });

  // Neither shower fixture casts a shadow. Theirs fell as a second soft head-shaped blob a
  // little away from the real one, which at a glance reads as a duplicate fixture rather
  // than as shading — and the compositor multiplies that ghost into whatever tile the dealer
  // picks, so it survived all the way into the finished preview.
  const noCast = { noShadow: true };

  // Shower head, mounted high on the back wall: the arm leaves the wall at 79" and the head
  // hangs just below it, angled down. A 10" rain head.
  mesh(new THREE.CylinderGeometry(1.0, 1.0, HEAD.z, 16), METAL, [24, HEAD.arm, HEAD.z / 2], [Math.PI / 2, 0, 0], noCast);
  mesh(new THREE.CylinderGeometry(HEAD.r, HEAD.r, 1.5, 32), METAL, [24, HEAD.y, HEAD.z], [0.34, 0, 0], noCast);

  // Valve trim on the LEFT RETURN WALL, not the back wall, at standard rough-in height.
  // That is where the controls actually go: reachable from outside the spray, so nobody has
  // to stand under cold water to start it. The compositor pins the plumbing trim photo here.
  // The vertical gap to the head is the point — controls at waist height, water from above.
  mesh(new THREE.CylinderGeometry(TRIM.r, TRIM.r, 0.9, 28), METAL, [0.6, TRIM.y, TRIM.z], [0, 0, Math.PI / 2], noCast);
  mesh(new THREE.CylinderGeometry(1.0, 1.0, 3.0, 16), METAL, [2.2, TRIM.y, TRIM.z], [0, 0, Math.PI / 2], noCast);

  // Glass screen: a fixed panel and a door, with slim posts. Hidden from the mask pass so the
  // tile behind it stays paintable — see the header note.
  //
  // None of the enclosure hardware casts either. The head rail in particular threw a long
  // diagonal band clean across the tiled wall — the single most conspicuous mark in the
  // alcove, and one the compositor multiplies into every wall material a dealer tries.
  const glass = { basic: true, opacity: 0.17, hideInMask: true };
  const glassHw = { hideInMask: true, noShadow: true };
  panel([[0, SHOWER.h - 6, Z], [X, SHOWER.h - 6, Z], [X, 5, Z], [0, 5, Z]], "#dff0f4", glass);
  mesh(new THREE.CylinderGeometry(0.6, 0.6, SHOWER.h - 11, 12), METAL, [X - 0.6, (SHOWER.h - 1) / 2, Z], null, glassHw);
  mesh(new THREE.CylinderGeometry(0.6, 0.6, SHOWER.h - 11, 12), METAL, [0.6, (SHOWER.h - 1) / 2, Z], null, glassHw);
  mesh(new THREE.BoxGeometry(X, 1.2, 1.2), METAL, [X / 2, SHOWER.h - 6, Z], null, glassHw);
  // Door handle.
  mesh(new THREE.CylinderGeometry(0.5, 0.5, 9, 12), METAL, [X - 8, 44, Z + 1.4], null, glassHw);
})();

// ---- vanity ---------------------------------------------------------------
(function vanity() {
  const { x0, x1, depth, body, counter, overhang } = VANITY;
  const w = x1 - x0;
  const topY = body + counter;

  // Toe kick, set back so the cabinet appears to float a little.
  box([x0 + 2, 0, 2], [x1 - 2, 4, depth - 2], "#b9b9b6");
  // Cabinet body. The front face is a separate panel so it can be its own mask region and
  // carry the reveal lines.
  box([x0, 4, 0], [x1, body, depth - 0.2], CAB);
  panel([[x0, body, depth], [x1, body, depth], [x1, 4, depth], [x0, 4, depth]], CAB,
    { map: cabinetTexture(w, body - 4), region: "vanityArea" });

  // ---- countertop ---------------------------------------------------------
  // Built face by face rather than as a solid box, because the top has to have holes in it
  // and a box's own top face would seal them again.
  // Extent comes from CTOP so the slab and the region quad fitted to it cannot drift apart.
  const cx0 = CTOP.x0, cx1 = CTOP.x1, cz1 = CTOP.z1;
  const flushRight = cx1 >= ROOM.w - 0.001;
  const deckRect = { x0: cx0, x1: cx1, z0: 0, z1: cz1 };
  const holes = Array.from({ length: BASIN.count }, (_, i) => ({
    // Two basins sit at the quarter points; one sits centred.
    cx: BASIN.count === 1 ? BASIN.cx : cx0 + ((i + 0.5) / BASIN.count) * (cx1 - cx0),
    cz: BASIN.cz, rx: BASIN.rx, rz: BASIN.rz, shape: BASIN.shape,
  }));
  deckWithHoles(deckRect, holes, topY, COUNTER, {
    map: aoTexture(w + overhang * 2, cz1, { edge: 0.10, band: 0.14, floorEdge: 0.10 }),
    region: "vanityTop",
  });
  // The slab's exposed edges. A 1.5" profile standing 1" proud of the cabinet face is what
  // makes the counter read as sitting ON the vanity rather than being the top of it.
  panel([[cx0, topY, cz1], [cx1, topY, cz1], [cx1, body, cz1], [cx0, body, cz1]], COUNTER, {});
  panel([[cx0, topY, 0], [cx0, topY, cz1], [cx0, body, cz1], [cx0, body, 0]], COUNTER, {});
  // The right end only exists when the run stops short of the wall; against the wall there is
  // no end to see, and drawing one would z-fight the wall it is buried in.
  if (!flushRight) panel([[cx1, topY, cz1], [cx1, topY, 0], [cx1, body, 0], [cx1, body, cz1]], COUNTER, {});

  // Backsplash: the same slab material turned up the wall. Its front face joins vanityTop as
  // a second face of that region, with its own quad, so a countertop colour carries onto it
  // at the correct orientation instead of being smeared off a horizontal homography.
  box([cx0, topY, 0], [cx1, topY + SPLASH.h, SPLASH.t - 0.05], COUNTER);
  panel([[cx0, topY + SPLASH.h, SPLASH.t], [cx1, topY + SPLASH.h, SPLASH.t], [cx1, topY, SPLASH.t], [cx0, topY, SPLASH.t]],
    COUNTER, { region: "vanityTop" });

  // ---- basin --------------------------------------------------------------
  // Dropped through the deck opening. DoubleSide because what the camera sees is the inside
  // of the bowl, and the hemisphere's own faces point outward.
  for (const h of holes) {
    if (h.shape === "rect") {
      const bx0 = h.cx - h.rx, bx1 = h.cx + h.rx, bz0 = h.cz - h.rz, bz1 = h.cz + h.rz, by = topY - BASIN.depth;
      panel([[bx0, topY, bz0], [bx1, topY, bz0], [bx1, by, bz0], [bx0, by, bz0]], "#f6f6f4", {});
      panel([[bx1, topY, bz1], [bx0, topY, bz1], [bx0, by, bz1], [bx1, by, bz1]], "#f6f6f4", {});
      panel([[bx0, topY, bz1], [bx0, topY, bz0], [bx0, by, bz0], [bx0, by, bz1]], "#f2f2f0", {});
      panel([[bx1, topY, bz0], [bx1, topY, bz1], [bx1, by, bz1], [bx1, by, bz0]], "#f2f2f0", {});
      panel([[bx0, by, bz0], [bx1, by, bz0], [bx1, by, bz1], [bx0, by, bz1]], "#fafaf8", {});
    } else {
      const bowl = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      bowl.scale(h.rx, BASIN.depth, h.rz);
      const m = new THREE.Mesh(bowl, new THREE.MeshLambertMaterial({ color: "#f7f7f5", side: THREE.DoubleSide }));
      m.position.set(h.cx, topY, h.cz);
      m.receiveShadow = true;
      scene.add(m);
      register(m, null, {});
    }
    mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.3, 20), "#c8c8c4", [h.cx, topY - BASIN.depth + 0.2, h.cz], null, { noShadow: true });
  }

  // Faucet: a placeholder the compositor's product photo lands on top of, and which keeps
  // the scene complete when no plumbing package has been chosen. Roughly two thirds of its
  // first size — the original stood 10" over a 14" basin and read as a kitchen fitting.
  const fz = BASIN.cz - BASIN.rz - 2.5;
  mesh(new THREE.CylinderGeometry(0.72, 0.92, 4.6, 18), METAL, [BASIN.cx, topY + 2.3, fz]);
  mesh(new THREE.TorusGeometry(2.1, 0.55, 12, 24, Math.PI / 2), METAL, [BASIN.cx, topY + 4.6, fz], [0, Math.PI / 2, 0]);
  for (const dx of [-4, 4]) mesh(new THREE.CylinderGeometry(0.46, 0.6, 2.2, 14), METAL, [BASIN.cx + dx, topY + 1.1, fz]);

  // Mirror and its frame.
  box([MIRROR.x0 - 1.2, MIRROR.y0 - 1.2, 0], [MIRROR.x1 + 1.2, MIRROR.y1 + 1.2, 0.9], "#b6b3ad");
  panel([[MIRROR.x0, MIRROR.y1, 1.0], [MIRROR.x1, MIRROR.y1, 1.0], [MIRROR.x1, MIRROR.y0, 1.0], [MIRROR.x0, MIRROR.y0, 1.0]],
    "#ffffff", { basic: true, map: mirrorTexture() });

  // Three-bulb bar light above the mirror.
  const bulbs = 3;
  mesh(new THREE.BoxGeometry(BARLIGHT.x1 - BARLIGHT.x0, 1.4, 1.4), METAL, [(BARLIGHT.x0 + BARLIGHT.x1) / 2, BARLIGHT.y, 1.2]);
  for (let i = 0; i < bulbs; i++) {
    const x = BARLIGHT.x0 + ((i + 0.5) / bulbs) * (BARLIGHT.x1 - BARLIGHT.x0);
    mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.2, 10), METAL, [x, BARLIGHT.y + 1.8, 1.2]);
    mesh(new THREE.SphereGeometry(2.4, 20, 16), "#fff6e4", [x, BARLIGHT.y + 4, 1.2], null, { basic: true });
  }

  // The countertop carries nothing but the basin and the faucet.
  //
  // It had a plant and a stack of folded towels, and they were the wrong call: this surface
  // is a paintable region, so every styling object both covers countertop the dealer is
  // trying to evaluate and punches a hole in the vanityTop mask. Props compete with the
  // product on the one surface that must read cleanly.
})();

// ---- toilet ---------------------------------------------------------------
(function toilet() {
  const x = ROOM.w - TOILET.depth / 2 - 1;      // against the right wall
  const z = TOILET.z;
  // Tank against the wall, bowl in front of it.
  box([ROOM.w - 9, 15, z - TOILET.w / 2 + 1], [ROOM.w - 1, 32, z + TOILET.w / 2 - 1], PORCELAIN);
  box([ROOM.w - 9.5, 30.6, z - TOILET.w / 2 + 0.4], [ROOM.w - 0.5, 32.4, z + TOILET.w / 2 - 0.4], "#f4f4f2");
  // Pedestal, bowl and seat. A flattened sphere gives the bowl its rounded underside without
  // needing a lathe profile.
  mesh(new THREE.BoxGeometry(9, 13, 11), PORCELAIN, [ROOM.w - 7, 6.5, z]);
  const bowl = new THREE.SphereGeometry(9.6, 26, 18);
  bowl.scale(0.82, 0.5, 1.0);
  mesh(bowl, PORCELAIN, [ROOM.w - 11, 15.5, z]);
  const seat = new THREE.CylinderGeometry(9.4, 9.4, 1.5, 30);
  seat.scale(0.84, 1, 1.0);
  mesh(seat, "#f7f7f5", [ROOM.w - 11, 16.6, z]);
  // Lid, tipped back against the tank.
  const lid = new THREE.CylinderGeometry(9.0, 9.0, 1.2, 30);
  lid.scale(0.84, 1, 1.0);
  mesh(lid, "#f7f7f5", [ROOM.w - 4.2, 24, z], [0, 0, Math.PI / 2 - 0.24]);

  // No towel on the right wall. That wall runs almost edge-on to the lens, so anything hung
  // on it foreshortens into a vertical stick — a full-size bath towel there read worse than
  // no towel at all. The soft goods live on the counter instead, where they face the camera.
})();

// ---- window ---------------------------------------------------------------
// On the right wall above the toilet, so the light rakes across the room and models the
// vanity front instead of flattening it. Unlit materials keep the opening the brightest
// value in frame however the rig is tuned — it is the source, not a surface receiving light.
(function windowOpening() {
  const x = ROOM.w - 0.6;
  const cy = (WINDOW.y0 + WINDOW.y1) / 2, cz = (WINDOW.z0 + WINDOW.z1) / 2;
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW.z1 - WINDOW.z0 + 7, WINDOW.y1 - WINDOW.y0 + 7),
    new THREE.MeshBasicMaterial({ color: "#c3c6c8" }),
  );
  frame.position.set(x - 0.2, cy, cz); frame.rotation.y = -Math.PI / 2;
  scene.add(frame); register(frame, null, {});
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW.z1 - WINDOW.z0, WINDOW.y1 - WINDOW.y0),
    new THREE.MeshBasicMaterial({ color: "#fdfeff" }),
  );
  pane.position.set(x, cy, cz); pane.rotation.y = -Math.PI / 2;
  scene.add(pane); register(pane, null, {});
})();

// ---- light ----------------------------------------------------------------
// Warm key from the window side, cool fill opposite — the separation that makes a white
// bathroom read as inviting rather than clinical. Total contribution stays under 1.0 on
// every face: overshooting clips to white, and a clipped face carries no shading at all for
// the compositor's multiply pass to pick up.
scene.add(new THREE.AmbientLight(0xfff6ec, 0.46));
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c6, 0.12));

// Steep and only slightly to the right. An oblique key threw long diagonal bands across the
// tile and clean over the cabinet fronts — dramatic, and wrong for a catalogue shot, because
// the compositor multiplies those bands into whatever material the dealer picks. Coming from
// above keeps the shadows short and reading as contact rather than as weather.
const key = new THREE.DirectionalLight(0xfff1de, 0.44);
key.position.set(190, 260, 170);
key.target.position.set(60, 24, 24);
scene.add(key.target);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 800;
key.shadow.camera.left = -240; key.shadow.camera.right = 240;
key.shadow.camera.top = 240; key.shadow.camera.bottom = -240;
key.shadow.bias = -0.0016;
key.shadow.radius = 6;
scene.add(key);

// Cool fill from the open end, so the shadow sides never go dead.
const fill = new THREE.DirectionalLight(0xeaf1ff, 0.26);
fill.position.set(-60, 70, 200);
scene.add(fill);

// ---- regions --------------------------------------------------------------
// Each face carries the real-world size of the surface it covers, which is what lets the
// compositor lay a texture at true scale — a 12" tile reads as 12" on the back wall and on
// the floor — instead of stretching one tile per surface.
//
// The side walls and floor are cut short of the room's full depth. That is not cosmetic: the
// camera stands at z=104, so the near corners of those surfaces would sit BEHIND it, and a
// point behind the camera projects through a negative w to land mirrored thousands of
// percent away. A homography fitted to such a quad is degenerate and folds the texture back
// on itself. Cutting at the last depth the camera can see keeps all four corners in front of
// the lens; the rendered geometry above is still the full room.
const REGIONS = {
  backWall: [{ corners: [[0, ROOM.h, 0], [ROOM.w, ROOM.h, 0], [ROOM.w, 0, 0], [0, 0, 0]], widthIn: ROOM.w, heightIn: ROOM.h }],
  leftWall: [{ corners: [[0, ROOM.h, 0], [0, ROOM.h, CUT.side], [0, 0, CUT.side], [0, 0, 0]], widthIn: CUT.side, heightIn: ROOM.h }],
  rightWall: [{ corners: [[ROOM.w, ROOM.h, CUT.side], [ROOM.w, ROOM.h, 0], [ROOM.w, 0, 0], [ROOM.w, 0, CUT.side]], widthIn: CUT.side, heightIn: ROOM.h }],
  floor: [{ corners: [[0, 0, 0], [ROOM.w, 0, 0], [ROOM.w, 0, CUT.floor], [0, 0, CUT.floor]], widthIn: ROOM.w, heightIn: CUT.floor }],
  // The alcove: back wall plus both returns, so a wall material reads as a wrapped enclosure
  // rather than a poster stuck on the far wall.
  showerArea: [
    { corners: [[0, SHOWER.h, 0], [SHOWER.x1, SHOWER.h, 0], [SHOWER.x1, 0, 0], [0, 0, 0]], widthIn: SHOWER.x1, heightIn: SHOWER.h },
    { corners: [[0, SHOWER.h, 0], [0, SHOWER.h, SHOWER.z1], [0, 0, SHOWER.z1], [0, 0, 0]], widthIn: SHOWER.z1, heightIn: SHOWER.h },
    { corners: [[SHOWER.x1, SHOWER.h, SHOWER.z1], [SHOWER.x1, SHOWER.h, 0], [SHOWER.x1, 0, 0], [SHOWER.x1, 0, SHOWER.z1]], widthIn: SHOWER.z1, heightIn: SHOWER.h },
  ],
  vanityArea: [{ corners: [[VANITY.x0, VANITY.body, VANITY.depth], [VANITY.x1, VANITY.body, VANITY.depth], [VANITY.x1, 4, VANITY.depth], [VANITY.x0, 4, VANITY.depth]], widthIn: VANITY.x1 - VANITY.x0, heightIn: VANITY.body - 4 }],
  // Two faces: the deck, and the backsplash turned up the wall behind it. The backsplash
  // needs its own quad rather than riding on the deck's — they are perpendicular, and a
  // countertop texture mapped through the deck's homography would smear up the splash.
  vanityTop: [
    {
      corners: [
        [CTOP.x0, CTOP.y, 0], [CTOP.x1, CTOP.y, 0],
        [CTOP.x1, CTOP.y, CTOP.z1], [CTOP.x0, CTOP.y, CTOP.z1],
      ],
      widthIn: CTOP.x1 - CTOP.x0, heightIn: CTOP.z1,
    },
    {
      corners: [
        [CTOP.x0, CTOP.y + SPLASH.h, SPLASH.t], [CTOP.x1, CTOP.y + SPLASH.h, SPLASH.t],
        [CTOP.x1, CTOP.y, SPLASH.t], [CTOP.x0, CTOP.y, SPLASH.t],
      ],
      widthIn: CTOP.x1 - CTOP.x0, heightIn: SPLASH.h,
    },
  ],
};

// Where a product cutout is pinned. Drawn upright in screen space rather than warped onto the
// surface plane: these are frontal catalog photographs, and shearing one into a wall's
// perspective looks far more wrong than leaving it square to the viewer. Both sit exactly
// over the placeholder fixture modelled above, so a chosen product replaces it.
const ANCHORS = {
  faucet: [BASIN.cx, VANITY.body + VANITY.counter + 3.4, BASIN.cz - BASIN.rz - 2.5],
  // Follows the valve trim onto the left return wall. Held slightly proud of the wall so the
  // pinned photo sits in front of the modelled placeholder rather than inside it.
  showerTrim: [2.5, TRIM.y, TRIM.z],
  // Over the modelled rain head, out at the end of its arm rather than at the wall.
  showerHead: [24, HEAD.y, HEAD.z],
  // Tub spout: same wall as the valve and below it, which is where it goes when a valve and
  // spout share a wall. Only pinned for a tub/shower configuration — the scene's alcove has a
  // shower pan, so a shower-only quote must not grow a spout.
  tubSpout: [2.5, 26, TRIM.z],
};

function project(p) {
  const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
  return [(v.x + 1) / 2, (1 - v.y) / 2];
}
// Screen height of one inch at a point, so the compositor can size a fixture in real inches
// and have it shrink correctly with distance.
function unitPerIn(p) {
  const a = project(p), b = project([p[0], p[1] + 12, p[2]]);
  return Math.abs(b[1] - a[1]) / 12;
}
const round = (n) => Math.round(n * 100000) / 100000;

/**
 * Re-render the same camera as a region ID map.
 *
 * Every material is swapped for an unlit flat colour — the region's ID, or black for
 * anything not paintable — and glass is hidden so the tile behind it stays claimable.
 * Antialiasing would blend two IDs into a third colour along every edge, so the pass renders
 * flat and the decoder classifies by nearest match with a tolerance.
 */
function renderMask() {
  const saved = [];
  for (const entry of REGISTRY) {
    saved.push({ entry: entry, material: entry.mesh.material, visible: entry.mesh.visible });
    if (entry.hideInMask) { entry.mesh.visible = false; continue; }
    const colour = entry.region ? REGION_COLORS[entry.region] : "#000000";
    entry.mesh.material = new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide });
  }
  const bg = scene.background;
  scene.background = new THREE.Color("#000000");
  const shadows = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  renderer.render(scene, camera);
  const png = renderer.domElement.toDataURL("image/png");
  for (const s of saved) { s.entry.mesh.material.dispose?.(); s.entry.mesh.material = s.material; s.entry.mesh.visible = s.visible; }
  scene.background = bg;
  renderer.shadowMap.enabled = shadows;
  return png;
}

window.renderScene = function () {
  renderer.render(scene, camera);
  const png = renderer.domElement.toDataURL("image/png");
  const mask = renderMask();

  const regions = {};
  for (const key of Object.keys(REGIONS)) {
    regions[key] = REGIONS[key].map((f) => ({
      quad: f.corners.map((c) => project(c).map(round)),
      widthIn: f.widthIn,
      heightIn: f.heightIn,
    }));
  }
  const anchors = {};
  for (const key of Object.keys(ANCHORS)) {
    anchors[key] = { at: project(ANCHORS[key]).map(round), unitPerIn: round(unitPerIn(ANCHORS[key])) };
  }
  return { png: png, mask: mask, regions: regions, anchors: anchors };
};
window.__ready = true;
</script>
</body></html>`;

// --------------------------------- driver ----------------------------------
function resolveChrome() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

const fromDataUrl = (s) => Buffer.from(s.slice("data:image/png;base64,".length), "base64");

async function main() {
  const server = await startServer(PAGE);
  const origin = `http://127.0.0.1:${server.address().port}`;

  // Same fallback as render-nuvo-3d.mjs: Puppeteer's own Chromium download is often blocked
  // by npm ignore-scripts, and any installed Chrome/Edge renders this identically.
  let executablePath;
  try { executablePath = puppeteer.executablePath(); if (!existsSync(executablePath)) executablePath = undefined; } catch { /* not downloaded */ }
  if (!executablePath) {
    executablePath = resolveChrome();
    if (!executablePath) { console.error("No Chrome/Edge found. Set PUPPETEER_EXECUTABLE_PATH."); process.exit(1); }
    console.log(`Using system browser: ${executablePath}`);
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(origin, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction("window.__ready === true", { timeout: 60_000 });

  const glOk = await page.evaluate(`(() => { try { return !!document.createElement("canvas").getContext("webgl"); } catch { return false; } })()`);
  if (!glOk) { console.error("WebGL unavailable in this browser instance."); await browser.close(); server.close(); process.exit(1); }

  const out = await page.evaluate(() => window.renderScene());
  if (!out?.png?.startsWith("data:image/png;base64,")) throw new Error("renderer returned no image");
  if (!out?.mask?.startsWith("data:image/png;base64,")) throw new Error("renderer returned no mask");

  await mkdir(OUT_DIR, { recursive: true });
  const buf = fromDataUrl(out.png), maskBuf = fromDataUrl(out.mask);
  await writeFile(OUT_PNG, buf);
  await writeFile(OUT_MASK, maskBuf);

  const json = {
    _generated: "scripts/render-base-scene.mjs — do not hand-edit; re-run the script instead",
    scene: { id: "modern", image: "/hero/base-modern.png", mask: "/hero/base-modern-mask.png", width: W, height: H },
    room: { widthIn: ROOM.w, heightIn: ROOM.h, depthIn: ROOM.d },
    camera: CAM,
    maskColors: REGION_COLORS,
    regions: out.regions,
    anchors: out.anchors,
  };
  await mkdir(path.dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(json, null, 2) + "\n");

  try { await browser.close(); } catch (e) { console.log(`(browser cleanup warning: ${e.code ?? e.message})`); }
  server.close();

  console.log(`Wrote ${path.relative(ROOT, OUT_PNG)}  (${(buf.length / 1024).toFixed(0)} KB, ${W}x${H})`);
  console.log(`Wrote ${path.relative(ROOT, OUT_MASK)}  (${(maskBuf.length / 1024).toFixed(0)} KB)`);
  console.log(`Wrote ${path.relative(ROOT, OUT_JSON)}  — ${Object.keys(out.regions).length} regions, ${Object.keys(out.anchors).length} anchors`);
  for (const [k, faces] of Object.entries(out.regions)) {
    const xs = faces.flatMap((f) => f.quad.map((p) => p[0]));
    const ys = faces.flatMap((f) => f.quad.map((p) => p[1]));
    const pct = (n) => (n * 100).toFixed(0) + "%";
    console.log(`  ${k.padEnd(11)} x ${pct(Math.min(...xs))}..${pct(Math.max(...xs))}  y ${pct(Math.min(...ys))}..${pct(Math.max(...ys))}`);
  }
  if (buf.length < 8192) console.log("Output is suspiciously small — check for a blank frame.");
  if (pageErrors.length) console.log(`Page errors: ${pageErrors.slice(0, 5).join(" | ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
