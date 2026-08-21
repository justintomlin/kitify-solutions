/**
 * Nature Panel decor swatches: print masters -> web derivatives.
 *
 * The 21 masters in `public/Decor Swatches/` are 378 MB of print-resolution scans — two over
 * GitHub's 100 MB hard limit, six in TIFF (which no browser renders) and seven in CMYK. They
 * are gitignored and stay local as the source of truth; this writes what the browser can use.
 *
 * Output is keyed by the catalogue's own panel id, so lib/naturepanel-catalog.ts resolves a
 * path directly instead of carrying a second lookup table:
 *   <id>.jpg       512 wide, full panel aspect  — tileable wall texture (hero + preview)
 *   <id>-tile.jpg  320 x 320 centre crop        — picker thumbnail
 *
 * `sharp` is not a direct dependency — it ships with Next for image optimisation, which is why
 * this is a script rather than something the app imports.
 *
 * Run from the repo root:  node scripts/build-decor-swatches.mjs
 */
import { statSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "public", "Decor Swatches");
const OUT = path.join(ROOT, "public", "decor-swatches");

/**
 * Catalogue panel id -> master filename.
 *
 * The masters were named by decor and the catalogue keys by id, and the two genuinely
 * disagree: `grained-` prefixes the catalogue keeps but no longer displays, `-naturepanel`
 * where the catalogue says `-slat`, and one master with a stray space in its name. Mapping
 * explicitly beats deriving it — a rename upstream should fail loudly here, not silently
 * mis-assign a decor.
 */
const MAP = {
  // Wood — 5 colours, the two Cuneo Oaks in both formats
  "grained-alpine-white": "alpine-white-shiplap.jpg",
  "grained-angora-grey": "angora-grey-shiplap.jpg",
  "grained-stone-green": "stone-green-shiplap.jpg",
  "bleached-cuneo-oak-shiplap": "bleached-cuneo-oak-shiplap.jpg",
  "bleached-cuneo-oak-slat": "bleached-cuneo-oak-naturepanel.jpg",
  "brown-cuneo-oak-shiplap": "brown-cuneo-oak-shiplap.jpg",
  "brown-cuneo-oak-slat": "brown-cuneo-oak-naturepanel.jpg",
  // Pure
  "cremona-marble-pure": "cremona-marble-pure.jpg",
  "crystal-marble-pure": "crystal-marble-pure.tif",
  "sage-green-pure": "sage-green-pure.tif",
  "valmasino-marble-pure": "valmasino-marble -pure.tif", // stray space in the master
  "white-grey-pure": "white-grey-pure.tif",
  "white-gypsum-pure": "white-gypsum-pure.tif",
  "white-terrazzo-pure": "white-terrazzo-pure.tif",
  // Large Tile
  "cremona-marble-large": "large-tile-cremona-marble.jpg",
  "crystal-marble-large": "large-tile-crystal-marble.jpg",
  "valmasino-marble-large": "large-tile-valmasino-marble.jpg",
  "white-gypsum-large": "large-tile-white-gypsum.jpg",
  "white-terrazzo-large": "large-tile-white-terrazzo.jpg",
  // Metro Tile
  "sage-green-subway": "metro-tile-sage-green.jpg",
  "white-grey-subway": "metro-tile-white-grey.jpg",
};

if (!existsSync(SRC)) {
  console.error(`No masters at ${SRC}.`);
  console.error("They are gitignored (~378 MB) — restore them from the asset drive to rebuild.");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

let srcTotal = 0;
let outTotal = 0;
const flat = [];

for (const [id, file] of Object.entries(MAP)) {
  const src = path.join(SRC, file);
  if (!existsSync(src)) throw new Error(`missing master for ${id}: ${file}`);
  srcTotal += statSync(src).size;

  // limitInputPixels off: the masters run to 6850 x 28346, well past sharp's default guard.
  // toColorspace("srgb") is what makes the CMYK masters renderable at all.
  const load = () => sharp(src, { limitInputPixels: false }).toColorspace("srgb");
  const encode = (p) => p.jpeg({ quality: 80, progressive: true, mozjpeg: true });

  const texPath = path.join(OUT, `${id}.jpg`);
  await encode(load().resize({ width: 512, withoutEnlargement: true })).toFile(texPath);

  const tilePath = path.join(OUT, `${id}-tile.jpg`);
  await encode(load().resize({ width: 320, height: 320, fit: "cover", position: "centre" })).toFile(tilePath);

  const texBytes = statSync(texPath).size;
  const tileBytes = statSync(tilePath).size;
  outTotal += texBytes + tileBytes;

  const { width, height } = await sharp(texPath).metadata();
  const stats = await sharp(texPath).stats();
  // A master with no channel variation is a flat colour chip, not a material scan — worth
  // saying out loud, because it looks like a successful conversion in every other respect.
  const isFlat = Math.max(...stats.channels.map((c) => c.stdev)) < 1;
  if (isFlat) flat.push(id);

  console.log(
    `${id.padEnd(30)} ${String(Math.round(texBytes / 1024)).padStart(4)}KB ${`${width}x${height}`.padStart(10)}` +
      `  tile ${String(Math.round(tileBytes / 1024)).padStart(3)}KB${isFlat ? "   FLAT (no texture)" : ""}`,
  );
}

const MB = (n) => (n / 1024 / 1024).toFixed(1) + "MB";
console.log(
  `\n${Object.keys(MAP).length} decors   ${MB(srcTotal)} -> ${MB(outTotal)}   (${(srcTotal / outTotal).toFixed(0)}x smaller)`,
);
if (flat.length) console.log("flat colour chips (flagged in the catalogue):", flat.join(", "));
