// Region geometry for the hero compositor's base bathroom scene.
//
// There are two plates, and they are registered in completely different ways.
//
// THE THREE.JS PLATE (public/hero/base-modern.png) is generated. Its numbers come from
// lib/data/hero-scene.json, which scripts/render-base-scene.mjs writes at the same time it
// renders the image, so the polygons cannot drift out of register with the picture — re-run
// the script and the geometry follows the render. That JSON is not hand-editable. Occlusion
// comes from a second render pass, an ID map in which every paintable surface is a flat
// colour, so the depth buffer sorts fixtures out for free.
//
// THE PHOTO PLATE (public/hero/base-photo.png) is an AI-generated photograph. There is no
// camera to project from and no way to render an ID pass, so lib/data/hero-photo-regions.json
// is measured off the image by hand and IS meant to be edited by hand. Occlusion is a
// hand-traced clip polygon per region instead of a mask image. It is also not dimensionally
// honest — a generative plate puts a shower head wherever it looks right — so its anchors are
// sized from measured pixels rather than from inches of room.
//
// COORDINATES are fractions of the image, x rightward and y downward, with (0,0) at the top
// left and (1,1) at the bottom right. They are deliberately NOT clamped: a side wall runs
// well past the frame in both directions, and clamping its corners would bend the surface it
// describes. Consumers clip to the canvas instead. (The photo JSON stores percentages for
// legibility while hand-editing; they are divided down to fractions on the way in here, so
// everything downstream of this module speaks one unit.)

import scene from "./data/hero-scene.json";
import photo from "./data/hero-photo-regions.json";

export type Point = readonly [number, number];
export type Quad = readonly [Point, Point, Point, Point];
/** A closed outline. Not required to be convex; consumers fill it even-odd. */
export type Polygon = readonly Point[];

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

export type RegionId =
  | "backWall" | "leftWall" | "rightWall"
  | "floor" | "showerArea" | "showerWallBack" | "showerWallLeft" | "showerWallRight"
  | "showerFloor" | "vanityArea" | "vanityTop" | "vanityBacksplash" | "vanitySideSplash";

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

/**
 * A box around a fixture already present in the plate, as image fractions [x, y, w, h].
 *
 * The counterpart to an Anchor, for the opposite strategy: an anchor says where to PIN a
 * product photograph, a FixtureBox says where to RECOLOUR what the plate already shows.
 */
export type FixtureBox = readonly [number, number, number, number];
/**
 * One recolourable fixture GROUP. A group is a thing the dealer picks a finish for, not a
 * rectangle: the sliding door's hardware is one choice but nine separate pieces of metal
 * scattered across the alcove, so a group carries a list of boxes rather than a single box.
 * Tight boxes beat one loose box — a loose one is only safe while nothing else dark falls
 * inside it, and on this plate the head, the track and the valve are close enough together
 * that a generous box catches its neighbour.
 */
export type FixtureId = "showerHead" | "valveTrim" | "sinkFaucet" | "doorHardware" | "vanitySconce";

/**
 * Everything the compositor needs to paint one plate.
 *
 * Occlusion arrives as EITHER `maskColors` (decode the ID render named by `maskSrc`) or
 * `clips` (fill these polygons), never both and never neither. The two plates are registered
 * by different means and this is where that difference is declared, so the compositor can
 * branch once on which field is present rather than knowing anything about plates.
 */
export type SceneBundle = {
  scene: {
    id: string;
    src: string;
    /** The region ID render. Only present on a generated plate. */
    maskSrc: string | null;
    /**
     * Foreground objects that stand in front of paintable surfaces, as an alpha mask.
     *
     * Photo plate only, and the counterpart to `maskSrc` rather than a duplicate of it: an ID
     * render says which surface each pixel BELONGS to, this says which pixels belong to no
     * surface at all because something is in the way. Built by scripts/build-occlusion-mask.mjs.
     */
    occlusionSrc: string | null;
    width: number;
    height: number;
    /** Needed to letterbox/cover-fit the scene into a container of a different shape. */
    aspect: number;
  };
  /** Interior dimensions of the modelled room, in inches. */
  room: { widthIn: number; heightIn: number; depthIn: number };
  regions: Record<RegionId, Region>;
  /** Flat colour each region is painted in within the mask, as "#rrggbb". Generated plate only. */
  maskColors: Record<string, string> | null;
  /**
   * Where each region's paint is allowed to land, as image-fraction outlines. Photo plate only.
   *
   * Filled with the even-odd rule, which is what makes one list do two jobs: disjoint outlines
   * (the alcove's back wall and its two returns) all fill, while an outline nested inside
   * another (the faucet's footprint on the countertop) punches a hole. No separate
   * outer/holes structure, and no ordering requirement.
   */
  clips: Partial<Record<RegionId, Polygon[]>> | null;
  anchors: Record<AnchorId, Anchor>;
  /**
   * Boxes around fixtures baked into the plate, to be recoloured in place. Empty on a plate
   * whose fixtures are modelled rather than photographed, which is why the render plate has
   * none: there, a fixture is pinned as a product photo at an anchor instead.
   */
  fixtureBoxes: Partial<Record<FixtureId, FixtureBox[]>>;
  /**
   * Corners to darken once the materials are down, keyed by name.
   *
   * A region seam alone does not read as a corner: two planes meeting at a clean edge, both
   * carrying the same texture at the same brightness, still look like one flat wall with a
   * line ruled on it. What sells the geometry is the ambient occlusion in the crease, which
   * the plate has and a freshly-painted material does not.
   */
  seams: Record<string, SeamShade>;
  /**
   * Edits applied to the plate itself before anything composites onto it.
   *
   * The compositor's blends are all multiplicative or additive over the photograph, so a dark
   * artefact in the plate survives every one of them — a fixture the design has moved cannot
   * be hidden, only darkened. These repair the source instead. Empty on the render plate,
   * which has no photographed fixtures to remove.
   */
  plateRepairs: PlateRepair[];
  /**
   * A fixture the compositor DRAWS rather than recolours or pins, in image fractions.
   *
   * Null where the plate already photographs the fixture in the right place. Present here
   * because the shower head was moved off the back wall onto the left return, so there is
   * nothing on that wall to recolour.
   */
  modeledHead: ModeledHead | null;
  /** The sliding door's glazing, or null on a plate that has none. */
  glass: Glass | null;
};

/** One repair op on the plate. `box` is [x, y, w, h] in image fractions. */
export type PlateRepair =
  /**
   * Replace the box outright, interpolating the surrounding wall inward. For artefacts too
   * dark to lighten — a matte-black fixture against a mid-grey wall has no headroom.
   */
  | { kind: "fill"; box: readonly [number, number, number, number]; ring: number; feather: number }
  /**
   * Pull pixels darker than the local ambient back toward it, in proportion to how far below
   * they sit. For soft shadows, where erasing outright would leave a flat patch more obvious
   * than the shadow was.
   */
  | { kind: "lighten"; box: readonly [number, number, number, number]; ring: number;
      minK: number; maxK: number; deficitFull: number };

/**
 * The door's glazing, as outlines plus how strongly to put it back.
 *
 * Photo plate only — the Three.js scene has no glass in it, and RENDER_SCENE sets this null so
 * the compositor's own guard is the only branch anyone has to read.
 */
export type Glass = { polygons: Polygon[]; alpha: number };

/** A drawn shower head: where it hangs, and how big an inch is there. */
export type ModeledHead = {
  at: Point;
  /** Fraction of image HEIGHT per real inch, on the plane the head is mounted to. */
  unitPerIn: number;
  armIn: number;
  headIn: number;
  thicknessIn: number;
};

/** A corner to shade: a line segment, a fade distance either side, and how dark at its centre. */
export type SeamShade = {
  from: Point;
  to: Point;
  /** Fade distance either side of the line, in image fractions of WIDTH. */
  halfWidth: number;
  /** Peak darkening at the line, 0-1. 0.07 means the corner lands at 93% of its lit value. */
  strength: number;
};

const REGION_IDS: RegionId[] = [
  "backWall", "leftWall", "rightWall", "floor", "showerArea",
  "showerWallBack", "showerWallLeft", "showerWallRight",
  "showerFloor", "vanityArea", "vanityTop", "vanityBacksplash", "vanitySideSplash",
];
const ANCHOR_IDS: AnchorId[] = ["faucet", "showerTrim", "showerHead", "tubSpout"];

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

type RawFace = { quad: number[][]; widthIn: number; heightIn: number };

/** `scale` is 1 for the generated JSON (already fractions) and 1/100 for the hand-authored one. */
function toFace(raw: RawFace, scale: number): Face {
  const q = raw.quad.map((p) => [p[0] * scale, p[1] * scale] as Point);
  return { quad: [q[0], q[1], q[2], q[3]], widthIn: raw.widthIn, heightIn: raw.heightIn };
}

function toRegion(id: RegionId, raw: RawFace[], scale: number): Region {
  const faces = raw.map((f) => toFace(f, scale));
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

function toAnchors(raw: Record<string, { at: number[]; unitPerIn: number }>, scale: number): Record<AnchorId, Anchor> {
  return Object.fromEntries(
    ANCHOR_IDS.map((id) => {
      const a = raw[id];
      return [id, { at: [a.at[0] * scale, a.at[1] * scale] as Point, unitPerIn: a.unitPerIn }];
    }),
  ) as Record<AnchorId, Anchor>;
}

// ------------------------- the generated Three.js plate ---------------------

type RawScene = {
  scene: { id: string; image: string; mask: string; width: number; height: number };
  room: { widthIn: number; heightIn: number; depthIn: number };
  maskColors: Record<string, string>;
  regions: Record<string, RawFace[]>;
  anchors: Record<string, { at: number[]; unitPerIn: number }>;
};

const THREE = scene as unknown as RawScene;

export const RENDER_SCENE: SceneBundle = {
  scene: {
    id: THREE.scene.id,
    src: THREE.scene.image,
    maskSrc: THREE.scene.mask,
    occlusionSrc: null,
    width: THREE.scene.width,
    height: THREE.scene.height,
    aspect: THREE.scene.width / THREE.scene.height,
  },
  room: THREE.room,
  regions: Object.fromEntries(
    REGION_IDS.map((id) => [id, toRegion(id, THREE.regions[id] ?? [], 1)]),
  ) as Record<RegionId, Region>,
  maskColors: THREE.maskColors,
  clips: null,
  anchors: toAnchors(THREE.anchors, 1),
  fixtureBoxes: {},
  seams: {},
  plateRepairs: [],
  modeledHead: null,
  glass: null,
};

// ---------------------------- the photo plate -------------------------------

type RawPhoto = {
  scene: { id: string; image: string; width: number; height: number };
  room: { widthIn: number; heightIn: number; depthIn: number };
  faces: Record<string, RawFace[]>;
  clips: Record<string, number[][][]>;
  anchors: Record<string, { at: number[]; unitPerIn: number }>;
  fixtureRegions: Record<string, number[][]>;
  seams: Record<string, { from: number[]; to: number[]; halfWidthPct: number; strength: number }>;
  plateRepairs: Record<string, {
    type: string; box: number[]; ringPct: number; featherPct?: number;
    minK?: number; maxK?: number; deficitFull?: number;
  }>;
  modeledHead?: { at: number[]; unitPerIn: number; armIn: number; headIn: number; thicknessIn: number };
  doorGlass?: { alpha: number; polygons: Record<string, number[][]> };
};

const FIXTURE_IDS: FixtureId[] = ["showerHead", "valveTrim", "sinkFaucet", "doorHardware", "vanitySconce"];

const PHOTO = photo as unknown as RawPhoto;
const PCT = 1 / 100;

/**
 * Which hand-mapped surfaces make up each compositor region.
 *
 * The JSON is named for what things ARE in the photograph — a back wall, two returns, a
 * countertop — because that is what someone re-measuring it against the image is looking at.
 * The compositor paints by ROLE: whatever the shower material goes on, whatever the flooring
 * goes on. This table is the join, and it is the only place the two vocabularies meet.
 *
 * `showerArea` collects the alcove's back wall and its left return so a wall panel wraps the
 * corner the way a real panel kit does. The bare room walls have no entry: this plate's left
 * wall, ceiling and vanity nook are not offered as selectable surfaces, so nothing may paint
 * them.
 *
 * There is no right return on the CURRENT photo plate — see _right_return_dropped in the JSON
 * for the profiles that rule it out. The id stays listed here so the render plate, which does
 * have one, keeps working: with the key absent from the JSON the region resolves to zero faces
 * and the compositor skips it, which is what makes wallColors[2] a no-op rather than an error.
 */
const PHOTO_FACES: Record<RegionId, string[]> = {
  backWall: [],
  leftWall: [],
  rightWall: [],
  floor: ["floor"],
  // The alcove is TWO planes on this plate, not one. `showerArea` stays empty so nothing
  // paints it; the render plate still uses it, and keeping the id lets both share a type.
  showerArea: [],
  showerWallBack: ["showerWallBack"],
  showerWallLeft: ["showerWallLeft"],
  showerWallRight: ["showerWallRight"],
  showerFloor: ["showerFloor"],
  vanityArea: ["vanityFace"],
  vanityTop: ["vanityTop"],
  vanityBacksplash: ["vanityBacksplash"],
  vanitySideSplash: ["vanitySideSplash"],
};

export const PHOTO_SCENE: SceneBundle = {
  scene: {
    id: PHOTO.scene.id,
    src: PHOTO.scene.image,
    maskSrc: null,
    occlusionSrc: "/hero/base-photo-occlusion.png",
    width: PHOTO.scene.width,
    height: PHOTO.scene.height,
    aspect: PHOTO.scene.width / PHOTO.scene.height,
  },
  room: PHOTO.room,
  regions: Object.fromEntries(
    REGION_IDS.map((id) => [
      id,
      toRegion(id, PHOTO_FACES[id].flatMap((name) => PHOTO.faces[name] ?? []), PCT),
    ]),
  ) as Record<RegionId, Region>,
  maskColors: null,
  clips: Object.fromEntries(
    REGION_IDS.map((id) => [
      id,
      PHOTO_FACES[id].flatMap((name) =>
        (PHOTO.clips[name] ?? []).map((poly) => poly.map((p) => [p[0] * PCT, p[1] * PCT] as Point)),
      ),
    ]).filter(([, polys]) => (polys as Polygon[]).length > 0),
  ) as Partial<Record<RegionId, Polygon[]>>,
  anchors: toAnchors(PHOTO.anchors, PCT),
  fixtureBoxes: Object.fromEntries(
    FIXTURE_IDS.flatMap((id) => {
      const g = PHOTO.fixtureRegions[id];
      return g?.length
        ? [[id, g.map((b) => [b[0] * PCT, b[1] * PCT, b[2] * PCT, b[3] * PCT] as FixtureBox)]]
        : [];
    }),
  ) as Partial<Record<FixtureId, FixtureBox[]>>,
  seams: Object.fromEntries(
    Object.entries(PHOTO.seams ?? {}).map(([k, v]) => [k, {
      from: [v.from[0] * PCT, v.from[1] * PCT] as Point,
      to: [v.to[0] * PCT, v.to[1] * PCT] as Point,
      halfWidth: v.halfWidthPct * PCT,
      strength: v.strength,
    }]),
  ),
  plateRepairs: Object.values(PHOTO.plateRepairs ?? {}).map((r) => {
    const box = [r.box[0] * PCT, r.box[1] * PCT, r.box[2] * PCT, r.box[3] * PCT] as const;
    return r.type === "fill"
      ? { kind: "fill" as const, box, ring: r.ringPct * PCT, feather: (r.featherPct ?? 0.4) * PCT }
      : {
          kind: "lighten" as const, box, ring: r.ringPct * PCT,
          minK: r.minK ?? 0.5, maxK: r.maxK ?? 0.85, deficitFull: r.deficitFull ?? 25,
        };
  }),
  // RETIRED on this plate. modeledHead existed because the previous plate's head was in the
  // wrong place and had to be painted out and redrawn. This plate photographs its head on the
  // left return at a true 72in above the pan, so there is nothing to draw and nothing to
  // repair — the head is a fixtureRegions group like every other piece of metal. The field and
  // drawModeledHead stay for the Three.js path, which still resolves this from its own JSON.
  modeledHead: null,
  glass: PHOTO.doorGlass
    ? {
        alpha: PHOTO.doorGlass.alpha,
        polygons: Object.values(PHOTO.doorGlass.polygons).map(
          (poly) => poly.map((p) => [p[0] * PCT, p[1] * PCT] as Point),
        ),
      }
    : null,
};

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
