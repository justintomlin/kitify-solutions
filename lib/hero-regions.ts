// Region geometry for the hero compositor's base bathroom scene.
//
// The numbers come from lib/data/hero-scene.json, which scripts/render-base-scene.mjs writes
// at the same time it renders public/hero/base-modern.png. Both are produced by one pass of
// one camera, so the polygons cannot drift out of register with the picture — re-run the
// script and the geometry follows the render. Nothing here is hand-measured, and the JSON
// should never be hand-edited.
//
// COORDINATES are fractions of the image, x rightward and y downward, with (0,0) at the top
// left and (1,1) at the bottom right. They are deliberately NOT clamped: a side wall runs
// well past the frame in both directions, and clamping its corners would bend the surface it
// describes. Consumers clip to the canvas instead.

import scene from "./data/hero-scene.json";

export type Point = readonly [number, number];
export type Quad = readonly [Point, Point, Point, Point];

/**
 * One flat surface of a region, as it appears in the scene.
 *
 * `quad` is the surface's four screen corners in texture order — top-left, top-right,
 * bottom-right, bottom-left as seen by someone facing the surface. That order is what lets a
 * consumer fit a homography straight from the quad without any further orientation data:
 * corner i of the quad is corner i of the texture.
 *
 * `widthIn`/`heightIn` are the real-world extent of that same rectangle, which is what turns
 * a texture's physical tile size into a repeat count. Without them a 12" mosaic and a 48"
 * panel would both be stretched to exactly one tile per wall.
 */
export type Face = { quad: Quad; widthIn: number; heightIn: number };

export type RegionId = "backWall" | "leftWall" | "rightWall" | "floor" | "showerArea" | "vanityArea" | "vanityTop";

export type Region = {
  id: RegionId;
  /** The surfaces to paint, in draw order. More than one where a region wraps a corner. */
  faces: Face[];
  /**
   * Outline of the whole region — the convex hull of every face corner.
   *
   * For hit-testing, debug overlays and captions. Compositing uses `faces`: the hull of a
   * wrapped region (the alcove) bridges the corner between its faces, so filling it would
   * paint across geometry the region doesn't actually cover.
   */
  points: Point[];
  /**
   * Real-world size of the region unrolled flat — the summed width of its faces by their
   * greatest height. For a single-face region this is just that face; for the alcove it is
   * the developed length of the enclosure (34" + 60" + 34" of wall, 80" tall).
   */
  perspective: { faces: number; widthIn: number; heightIn: number };
};

/** A point where a product cutout is pinned, rather than a surface to be painted. */
export type Anchor = {
  /** Where the fixture sits, in image fractions. */
  at: Point;
  /**
   * Screen height of one inch at that depth, as a fraction of image height.
   *
   * Lets a caller size a fixture in real inches and have it shrink correctly with distance —
   * the vanity faucet is roughly twice the on-screen scale of the shower trim behind it,
   * because it is roughly half as far away.
   */
  unitPerIn: number;
};

export type AnchorId = "faucet" | "showerTrim" | "showerHead" | "tubSpout";

type RawFace = { quad: number[][]; widthIn: number; heightIn: number };
type RawScene = {
  scene: { id: string; image: string; mask: string; width: number; height: number };
  room: { widthIn: number; heightIn: number; depthIn: number };
  maskColors: Record<string, string>;
  regions: Record<string, RawFace[]>;
  anchors: Record<string, { at: number[]; unitPerIn: number }>;
};

const DATA = scene as unknown as RawScene;

/** The base scene image these regions are registered against. */
export const HERO_SCENE = {
  id: DATA.scene.id,
  src: DATA.scene.image,
  /**
   * The region ID map: the same camera re-rendered with each paintable surface in a flat
   * colour and everything else black.
   *
   * A region's quad says how a texture warps onto a surface; this says where it is allowed
   * to land. The two are not interchangeable, because the scene has fixtures standing in
   * front of its surfaces — the floor quad covers ground the toilet is standing on, and the
   * alcove quad covers wall the shower head hangs over. Painting a quad without consulting
   * the mask puts flooring across the toilet.
   */
  maskSrc: DATA.scene.mask,
  width: DATA.scene.width,
  height: DATA.scene.height,
  /** Needed to letterbox/cover-fit the scene into a container of a different shape. */
  aspect: DATA.scene.width / DATA.scene.height,
};

/** Flat colour each region is painted in within the mask, as "#rrggbb". */
export const MASK_COLORS = DATA.maskColors as Record<RegionId, string>;

/** Interior dimensions of the modelled room, in inches. */
export const HERO_ROOM = DATA.room;

// Andrew's monotone chain. Small enough to keep here rather than pull a dependency for, and
// it runs once at module load over ~12 points per region.
function convexHull(pts: Point[]): Point[] {
  if (pts.length < 3) return pts.slice();
  const sorted = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (input: Point[]) => {
    const out: Point[] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half(sorted.slice().reverse())];
}

function toFace(raw: RawFace): Face {
  const q = raw.quad.map((p) => [p[0], p[1]] as Point);
  return { quad: [q[0], q[1], q[2], q[3]], widthIn: raw.widthIn, heightIn: raw.heightIn };
}

function toRegion(id: RegionId, raw: RawFace[]): Region {
  const faces = raw.map(toFace);
  const corners = faces.flatMap((f) => f.quad as unknown as Point[]);
  return {
    id,
    faces,
    points: convexHull(corners),
    perspective: {
      faces: faces.length,
      widthIn: faces.reduce((n, f) => n + f.widthIn, 0),
      heightIn: faces.reduce((n, f) => Math.max(n, f.heightIn), 0),
    },
  };
}

const REGION_IDS: RegionId[] = ["backWall", "leftWall", "rightWall", "floor", "showerArea", "vanityArea", "vanityTop"];

/**
 * Every paintable region of the base scene.
 *
 * `showerArea` is the alcove — the tiled back wall, both returns and the niche back — and is
 * where a shower wall material belongs; panels line an enclosure, not a whole bathroom.
 * `vanityArea` is the cabinet's front face and `vanityTop` its countertop, both real
 * geometry in the scene rather than a patch of wall. `backWall`, `leftWall` and `rightWall`
 * are the full room surfaces, carried for a future wall-finish or paint selection; the
 * compositor leaves them as base scene today.
 */
export const SCENE_REGIONS: Record<RegionId, Region> = Object.fromEntries(
  REGION_IDS.map((id) => [id, toRegion(id, DATA.regions[id] ?? [])]),
) as Record<RegionId, Region>;

/** Where product cutouts are pinned. See Anchor for how `unitPerIn` scales them. */
const ANCHOR_IDS: AnchorId[] = ["faucet", "showerTrim", "showerHead", "tubSpout"];

export const SCENE_ANCHORS: Record<AnchorId, Anchor> = Object.fromEntries(
  ANCHOR_IDS.map((id) => {
    const a = DATA.anchors[id];
    return [id, { at: [a.at[0], a.at[1]] as Point, unitPerIn: a.unitPerIn }];
  }),
) as Record<AnchorId, Anchor>;

/**
 * How many times a tile of the given real-world size repeats across a face.
 *
 * Floored at one full repeat: a tile larger than the surface should be shown cropped at true
 * scale, not shrunk to fit, or a 48" panel and a 12" tile would look identical on the wall.
 */
export function tileRepeat(face: Face, tileWidthIn: number, tileHeightIn: number): { x: number; y: number } {
  return {
    x: Math.max(1, face.widthIn / Math.max(1, tileWidthIn)),
    y: Math.max(1, face.heightIn / Math.max(1, tileHeightIn)),
  };
}
