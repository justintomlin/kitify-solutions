#!/usr/bin/env node
/**
 * Batch-render the NuVo 3D assets (Wavefront OBJ) to catalog-style PNG product shots.
 *
 *   node scripts/render-nuvo-3d.mjs [--force] [--only <substring>] [--bg <transparent|#hex>]
 *
 * Reads  assets/nuvo-3d/<Category>/<Model>.obj (+ .mtl)
 * Writes public/nuvo/<category-kebab>/<Model>.png   600×600, transparent by default
 *
 * Re-runnable: a model whose PNG already exists is skipped unless --force.
 *
 * On the background: the range includes Chrome (Kd 1,1,1) and White finishes, so an opaque
 * white backdrop renders roughly a quarter of the catalogue as a near-invisible white-on-
 * white shape. Alpha moves that decision to the UI, which can sit them on a tinted tile.
 * Pass `--bg #ffffff` for flat white if a consumer needs it.
 *
 * HOW IT WORKS
 * A tiny static server exposes the asset folder and a render page to headless Chrome
 * (driven by Puppeteer). The page uses Three.js + OBJLoader/MTLLoader to load each model,
 * frame it, and hand back a data URL that this process writes to disk.
 *
 * TWO THINGS THE RAW ASSETS NEED FIXING FIRST, both handled by the server, not by editing
 * the source files:
 *
 *  1. Every MTL points its textures at the artist's own machine —
 *     `map_Kd C:/Users/therm/Documents/Graphic Design/Blender/.../Brushed Nickel.png`.
 *     Those paths resolve to nothing here. The matching image does sit next to the OBJ, so
 *     MTLs are rewritten in flight to reference the bare filename.
 *  2. Model and texture filenames contain spaces, so every path segment is URL-encoded on
 *     the way out and decoded on the way in.
 *
 * Three.js is vendored under scripts/vendor rather than pulled from a CDN: the render must
 * not depend on network access, and pinning the version keeps output reproducible.
 * OBJLoader/MTLLoader ship as UMD only up to r147, which is why that version is pinned.
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_DIR = path.join(ROOT, "assets", "nuvo-3d");
const VENDOR_DIR = path.join(ROOT, "scripts", "vendor");
const OUT_DIR = path.join(ROOT, "public", "nuvo");

const SIZE = 600;
const PER_MODEL_TIMEOUT_MS = 180_000;   // the largest OBJ here is ~8 MB

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
// "transparent" (default) or any CSS hex, e.g. --bg #ffffff
const BG = args.includes("--bg") ? args[args.indexOf("--bg") + 1] : "transparent";

// "NuVo Bases" -> "nuvo-bases", "K Series Bases" -> "k-series-bases"
const kebab = (s) => s.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

// ------------------------------- asset scan --------------------------------
async function findModels() {
  const out = [];
  const categories = (await readdir(ASSET_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
  for (const cat of categories) {
    const files = await readdir(path.join(ASSET_DIR, cat.name));
    for (const f of files.filter((f) => f.toLowerCase().endsWith(".obj")).sort()) {
      const base = f.replace(/\.obj$/i, "");
      const mtl = files.find((m) => m.toLowerCase() === `${base.toLowerCase()}.mtl`);
      out.push({
        category: cat.name,
        categorySlug: kebab(cat.name),
        name: base,
        objUrl: `/assets/${encodePath(cat.name)}/${encodeURIComponent(f)}`,
        mtlUrl: mtl ? `/assets/${encodePath(cat.name)}/${encodeURIComponent(mtl)}` : null,
        resourceUrl: `/assets/${encodePath(cat.name)}/`,
        outFile: path.join(OUT_DIR, kebab(cat.name), `${base}.png`),
      });
    }
  }
  return out;
}

// ------------------------------ static server ------------------------------
const MIME = { ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".obj": "text/plain", ".mtl": "text/plain", ".html": "text/html" };

// Point every texture at the file sitting beside the OBJ. Paths may contain spaces, so the
// value is everything after the keyword, reduced to its last path segment.
function rewriteMtl(text) {
  return text.replace(/^(\s*map_\w+\s+)(.+)$/gim, (_, key, value) => {
    const file = value.trim().split(/[\\/]/).pop();
    return key + encodeURIComponent(file);
  });
}

function startServer(page) {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent((req.url || "/").split("?")[0]);
      if (url === "/" || url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" }); res.end(page); return;
      }
      let file = null;
      if (url.startsWith("/vendor/")) file = path.join(VENDOR_DIR, url.slice("/vendor/".length));
      else if (url.startsWith("/assets/")) file = path.join(ASSET_DIR, url.slice("/assets/".length));
      if (!file) { res.writeHead(404); res.end("not found"); return; }
      // Never serve outside the two roots we intend to expose.
      const resolved = path.resolve(file);
      if (!resolved.startsWith(VENDOR_DIR) && !resolved.startsWith(ASSET_DIR)) { res.writeHead(403); res.end(); return; }
      const ext = path.extname(resolved).toLowerCase();
      if (ext === ".mtl") {
        const text = await readFile(resolved, "utf8");
        res.writeHead(200, { "content-type": "text/plain" }); res.end(rewriteMtl(text)); return;
      }
      const buf = await readFile(resolved);
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" }); res.end(buf);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ------------------------------- render page -------------------------------
const PAGE = /* html */ `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0}canvas{display:block}</style></head>
<body>
<script src="/vendor/three.min.js"></script>
<script src="/vendor/OBJLoader.js"></script>
<script src="/vendor/MTLLoader.js"></script>
<script>
const SIZE = ${SIZE};
const BG = "__BG__";   // "transparent" or a hex colour, substituted by the driver
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Transparent by default. These products come in Chrome (Kd 1,1,1) and White finishes, which
// on an opaque white backdrop are invisible — the shape is genuinely the same colour as the
// background. Alpha hands that decision to whatever surface the configurator puts them on.
if (BG === "transparent") { scene.background = null; renderer.setClearColor(0x000000, 0); }
else { scene.background = new THREE.Color(BG); }
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
// Key light, upper-left-front.
const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(-5, 10, 7);
scene.add(key);
// Weak opposite fill. Without it the black/bronze finishes read as a silhouette — the
// unlit side goes to pure ambient and loses all form.
const fill = new THREE.DirectionalLight(0xffffff, 0.25);
fill.position.set(6, 4, -5);
scene.add(fill);

// MTLLoader.preload() only *starts* the texture fetches. Rendering straight after it draws
// untextured geometry — and since a material with no Kd defaults to white, an untextured
// model on a white background comes out as a blank frame. Wait for the pixels to arrive.
async function awaitTextures(creator, timeoutMs = 30000) {
  if (!creator) return { total: 0, loaded: 0 };
  const texes = [];
  for (const name of Object.keys(creator.materials)) {
    const m = creator.materials[name];
    for (const k of ["map", "specularMap", "bumpMap", "normalMap", "alphaMap", "emissiveMap"]) {
      if (m[k] && !texes.includes(m[k])) texes.push(m[k]);
    }
  }
  if (texes.length === 0) return { total: 0, loaded: 0 };
  const ready = (t) => !!(t.image && (t.image.width || t.image.videoWidth));
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs && !texes.every(ready)) {
    await new Promise((r) => setTimeout(r, 40));
  }
  for (const t of texes) if (ready(t)) t.needsUpdate = true;
  return { total: texes.length, loaded: texes.filter(ready).length };
}

// A studio environment, as a 6-face gradient cube: bright above, mid at the horizon, dark
// below. Every MTL here is "illum 3" (reflection on) authored against Blender's Principled
// BSDF, but MTLLoader flattens them to MeshPhongMaterial and drops the reflection model
// entirely. Untextured metals therefore collapse to their raw Kd — chrome to pure white
// (invisible on a white background) and black to a featureless silhouette. Reflecting this
// environment is what gives them their form back; it is the lighting the material asked
// for, not invented colour.
function makeStudioEnv() {
  const S = 128;
  const faces = [];
  // CubeTexture face order: +X, -X, +Y, -Y, +Z, -Z
  const stops = [
    [["#ffffff", 0], ["#d8d8d8", 0.55], ["#8f8f8f", 1]],
    [["#ffffff", 0], ["#d8d8d8", 0.55], ["#8f8f8f", 1]],
    [["#ffffff", 0], ["#ffffff", 1]],
    [["#6a6a6a", 0], ["#4a4a4a", 1]],
    [["#ffffff", 0], ["#d8d8d8", 0.55], ["#8f8f8f", 1]],
    [["#ffffff", 0], ["#d8d8d8", 0.55], ["#8f8f8f", 1]],
  ];
  for (const face of stops) {
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, S);
    for (const [colour, at] of face) grad.addColorStop(at, colour);
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    faces.push(c);
  }
  const tex = new THREE.CubeTexture(faces);
  tex.needsUpdate = true;
  return tex;
}
const STUDIO_ENV = makeStudioEnv();

// Only the untextured glossy materials need it. Anything carrying a diffuse map already
// renders with its real surface and is left exactly as authored.
function applyEnvironment(root) {
  let touched = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || m.map || !("shininess" in m)) continue;
      if (m.shininess < 100) continue;              // matte plastics stay matte
      m.envMap = STUDIO_ENV;
      m.combine = THREE.MixOperation;
      m.reflectivity = Math.min(0.55, Math.max(0.2, m.shininess / 900));
      m.needsUpdate = true;
      touched++;
    }
  });
  return touched;
}

let current = null;
function disposeCurrent() {
  if (!current) return;
  scene.remove(current);
  current.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of ["map", "specularMap", "normalMap", "bumpMap", "alphaMap"]) if (m[k]) m[k].dispose();
      m.dispose();
    }
  });
  current = null;
}

window.renderModel = async function (objUrl, mtlUrl, resourceUrl) {
  disposeCurrent();

  let materials = null;
  if (mtlUrl) {
    materials = await new Promise((resolve) => {
      const ml = new THREE.MTLLoader();
      ml.setResourcePath(resourceUrl);
      // Blender exports single-sided faces that read as holes from a catalog angle.
      ml.setMaterialOptions({ side: THREE.DoubleSide });
      ml.load(mtlUrl, (m) => { m.preload(); resolve(m); }, undefined, () => resolve(null));
    });
  }
  const tex = await awaitTextures(materials);

  const obj = await new Promise((resolve, reject) => {
    const ol = new THREE.OBJLoader();
    if (materials) ol.setMaterials(materials);
    ol.load(objUrl, resolve, undefined, (e) => reject(new Error("OBJ load failed: " + (e && e.message ? e.message : objUrl))));
  });

  // A model with no usable material still has to be visible.
  let meshes = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (!o.material) o.material = new THREE.MeshPhongMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
  });
  if (meshes === 0) throw new Error("no meshes in OBJ");
  const reflective = applyEnvironment(obj);

  // Centre at the origin, then normalise scale so framing is identical for a 24" bar and a
  // 60" base — the camera distance below is derived from the model, not hard-coded.
  //
  // The scale goes on a PARENT, not on obj itself. A node's transform is T·R·S, so position
  // is applied after scale and never shrinks with it: scaling obj directly would leave it
  // displaced by the full unscaled centre offset. Models authored near the origin survived
  // that; a shower door authored 12 units up the Y axis flew clean out of frame and rendered
  // as a blank white square.
  const box = new THREE.Box3().setFromObject(obj);
  if (!isFinite(box.min.x) || box.isEmpty()) throw new Error("degenerate bounding box");
  const centre = box.getCenter(new THREE.Vector3());
  obj.position.sub(centre);

  const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
  if (!(sphere.radius > 0) || !isFinite(sphere.radius)) throw new Error("degenerate bounding sphere");

  const holder = new THREE.Group();
  holder.add(obj);
  holder.scale.setScalar(1 / sphere.radius);

  scene.add(holder);
  current = holder;

  // Three-quarter view from above-front-right, the standard product-catalog angle.
  const fov = camera.fov * Math.PI / 180;
  const dist = (1 / Math.sin(fov / 2)) * 1.06;   // unit sphere + a small margin
  const dir = new THREE.Vector3(0.78, 0.52, 1).normalize();
  camera.position.copy(dir.multiplyScalar(dist));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  return { png: renderer.domElement.toDataURL("image/png"), meshes, textures: tex, reflective };
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

async function main() {
  if (!existsSync(ASSET_DIR)) {
    console.error(`No asset directory at ${ASSET_DIR}`);
    process.exit(1);
  }

  let models = await findModels();
  if (ONLY) models = models.filter((m) => `${m.category}/${m.name}`.toLowerCase().includes(ONLY.toLowerCase()));
  const total = models.length;
  console.log(`Found ${total} OBJ file(s) across ${new Set(models.map((m) => m.category)).size} categories.`);

  for (const slug of new Set(models.map((m) => m.categorySlug))) {
    await mkdir(path.join(OUT_DIR, slug), { recursive: true });
  }

  const pending = FORCE ? models : models.filter((m) => !existsSync(m.outFile));
  const skipped = total - pending.length;
  if (skipped) console.log(`Skipping ${skipped} already rendered (use --force to redo).`);
  if (pending.length === 0) { console.log("Nothing to do."); return; }

  const server = await startServer(PAGE.replace("__BG__", BG));
  console.log(`Background: ${BG}`);
  const origin = `http://127.0.0.1:${server.address().port}`;

  // Puppeteer's own Chromium download is often blocked (npm ignore-scripts); fall back to
  // whatever Chrome/Edge is installed, which renders identically for our purposes.
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
    // SwiftShader keeps WebGL working on a headless box with no real GPU.
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: SIZE, height: SIZE });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(origin, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction("window.__ready === true", { timeout: 60_000 });

  const glOk = await page.evaluate(`(() => { try { return !!document.createElement("canvas").getContext("webgl"); } catch { return false; } })()`);
  if (!glOk) { console.error("WebGL unavailable in this browser instance."); await browser.close(); server.close(); process.exit(1); }

  let done = 0, failed = 0;
  const failures = [], blanks = [], missingTex = [];
  for (const m of pending) {
    const label = `${m.name}.png`;
    try {
      const out = await page.evaluate(
        (o, t, r) => window.renderModel(o, t, r),
        origin + m.objUrl, m.mtlUrl ? origin + m.mtlUrl : null, origin + m.resourceUrl,
      );
      if (!out?.png?.startsWith("data:image/png;base64,")) throw new Error("renderer returned no image");
      const buf = Buffer.from(out.png.slice("data:image/png;base64,".length), "base64");
      await writeFile(m.outFile, buf);
      done++;
      const tex = out.textures;
      // A blank frame is a silent failure, so surface anything that hints at one: a PNG
      // this small on a 600×600 canvas is essentially an empty white field.
      const thin = buf.length < 4096 ? "  <-- NEARLY BLANK, CHECK" : "";
      const texNote = tex.total ? `${tex.loaded}/${tex.total} tex` : "no tex";
      if (tex.total && tex.loaded < tex.total) missingTex.push(`${m.category}/${m.name} (${tex.loaded}/${tex.total})`);
      if (thin) blanks.push(`${m.category}/${m.name}`);
      console.log(`Rendered: ${label} (${done + failed}/${pending.length}) ${(buf.length / 1024).toFixed(0)} KB, ${texNote} -> ${m.categorySlug}/${thin}`);
    } catch (err) {
      failed++;
      const why = (err && err.message ? err.message : String(err)).split("\n")[0];
      failures.push({ model: `${m.category}/${m.name}`, why });
      console.log(`FAILED:   ${label} (${done + failed}/${pending.length}) — ${why}`);
    }
  }

  // Windows regularly refuses to unlink Chrome's temp profile while handles are still
  // settling. That happens after every render is already on disk, so it must not take the
  // run down — or worse, swallow the summary below.
  try { await browser.close(); } catch (e) { console.log(`(browser cleanup warning: ${e.code ?? e.message})`); }
  server.close();

  console.log(`\nRendered ${done}/${pending.length}. Failed ${failed}.`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  ${f.model} — ${f.why}`);
  }
  if (missingTex.length) {
    console.log(`Textures that did not finish loading (${missingTex.length}):`);
    for (const s of missingTex) console.log(`  ${s}`);
  }
  if (blanks.length) {
    console.log(`Suspiciously small output — likely blank (${blanks.length}):`);
    for (const s of blanks) console.log(`  ${s}`);
  }
  if (pageErrors.length) console.log(`Page errors: ${pageErrors.slice(0, 5).join(" | ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
