"use client";

/**
 * Kitify — Room Configurator (reusable module).
 *
 * Faithful React/TypeScript port of docs/room-editor-prototype.html — a top-down
 * bathroom room editor (vanilla JS + SVG). The geometry, clearance, collision and
 * fitting math is ported verbatim; only the rendering (SVG string -> JSX) and the
 * state plumbing (globals -> React state) were re-shaped.
 *
 * Contract mirrors the vanity/shower modules: mode in, RoomConfig out via onComplete.
 * The room is not priced yet, so price.total is 0 and lines is [].
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { RotateCcw, Undo2 } from "lucide-react";
import { SHOWER_BASES as BASES, TUBS, VANITY_SIZES, VANITY_DEPTH as VANITY_D, WALL_PANEL, wallPanelTakeoff, FLOORING_COLORS, FLOORING_LINE, flooringTakeoff, WALL_BASE_COLORS, WALL_BASE_HEIGHTS, wallBaseTakeoff, type FlooringColor } from "@/lib/catalog";
import { useLanguage } from "@/components/LanguageContext";

// All user-facing copy comes from the shared i18n dictionary (lib/i18n.ts). Numeric
// values, dimension strings (8'0" × 5'0") and SKU labels are never translated.
type Tr = (key: string, vars?: Record<string, string>) => string;
// translated fixture name (with article) for clearance sentences
const fxName = (t: Tr, name: string) => t(name === "toilet" ? "configurator.room.fxToilet" : name === "vanity" ? "configurator.room.fxVanity" : name === "tub" ? "configurator.room.fxTub" : name === "door" ? "configurator.room.fxDoor" : "configurator.room.fxShower");

// ============================== Types =====================================
type Shape = "rect" | "L";
type Corner = "tl" | "tr" | "bl" | "br";
type Pt = [number, number];
// A mountable surface. Perimeter walls come from build(); interior partition FACES are
// appended as surfaces too (pass 3), so a fixture can anchor to either by the same model.
// `nrm` (partition faces only) is the fixed outward normal — the direction depth projects,
// away from the partition body. Perimeter walls leave it undefined and derive the inward
// normal from the centroid. `partId` marks a partition face (its owning partition's id).
type Edge = { a: Pt; b: Pt; len: number; p: string; side: string; nrm?: { x: number; y: number }; partId?: string };
type Sku = { id: string; w: number; d: number };

export type RoomDims = { w: number; d: number; h: number; cw: number; cd: number; corner: Corner };
export type RoomDoor = { edge: number; side: string; t: number; w: number; type: "opening" | "swing" | "sliding"; swing: string; orphaned?: boolean };
export type RoomToilet = { edge: number; side: string; t: number; rough: number; orphaned?: boolean; conflictWith?: string | null; conflict?: boolean };
export type RoomBath = {
  edge: number; side: string; t: number; kind: "shower" | "tub"; sku: string; rot: boolean;
  snapped?: "a" | "b" | null; overhang?: boolean; tooWide?: boolean; overBy?: number; orphaned?: boolean;
  // `sku` is always the requested/quoted product (never silently shrunk). `drawId` is
  // the catalogue unit actually drawn on the plan — equal to `sku` when it fits this
  // wall, otherwise the largest unit that does fit. `sizeConflict` flags the mismatch.
  drawId?: string; sizeConflict?: { requested: string; fitsHere: string | null } | null; conflict?: boolean;
};
export type RoomVanity = { edge: number; side: string; t: number; w: number; sinks: number; sinkShape?: "oval" | "rectangle"; overhang?: boolean; orphaned?: boolean; conflictWith?: string | null; conflict?: boolean };

// Per-wall surface treatment, keyed by the wall's stable side identity (top/right/
// bottom/left/cutH/cutV) so it survives geometry changes, exactly like fixture
// anchoring. Missing keys default to "paint".
export type WallTreatment = "panel" | "paint" | "none";
export type WallTreatments = Record<string, WallTreatment>;

// Flooring selection: a Durato V-EVO MAX color plus the waste factor used for the
// carton takeoff. Absent = no flooring chosen.
export type RoomFlooring = { colorId: string; wastePct: number };

// Wall base (baseboard) selection: 4"/6" height, a solid color and the waste factor used
// for the stick takeoff. Absent = no wall base chosen.
export type RoomWallBase = { heightIn: 4 | 6; colorId: string; wastePct: number };

// Interior partition (stud wall), ANCHORED to a perimeter wall by one end. The anchor is
// `{ side, offsetIn }` — the wall's stable side identity (top/right/bottom/left/cutH/cutV)
// plus the distance in inches from that wall's start corner (edge.a) to the anchored end.
// The partition projects perpendicular (90°) into the room by `lengthIn` to a free end.
// Drawn endpoints are DERIVED from anchor + length + inward normal, never stored raw, so a
// partition survives geometry changes the way fixtures do (by side identity, not coords).
// `thicknessIn` is the finished wall thickness (framing + drywall); `heightIn` the wall
// height (full-height by default = ceiling). It never edits the rectangle/L perimeter model.
export type RoomPartition = { id: string; side: string; offsetIn: number; lengthIn: number; thicknessIn: number; heightIn: number };

// A price line carries a dictionary key + params (not finished text) so it renders in the
// viewer's language, matching the shower/vanity/plumbing modules.
export type PriceLine = { key: string; params?: Record<string, string>; amount: number };
export type RoomConfig = {
  selections: {
    shape: Shape;
    dims: RoomDims;
    door: RoomDoor | null;
    toilet: RoomToilet | null;
    bath: RoomBath | null;
    vanity: RoomVanity | null;
    treatments: WallTreatments; // per-wall surface finish, keyed by stable side identity
    flooring: RoomFlooring | null;
    wallBase: RoomWallBase | null;
    partitions: RoomPartition[];
  };
  metrics: { perimeterIn: number; wallSF: number; floorSF: number; baseboardLF: number; ceilingIn: number; panelCount: number; panelledSF: number; flooringCartons: number; flooringSF: number; wallBaseSticks: number; wallBaseLF: number; partitionCount: number; partitionWallSF: number };
  clearanceIssues: string[];
  price: { total: number; lines: PriceLine[] };
  isComplete: boolean;
  label: string;
};

type Doc = {
  shape: Shape;
  S: RoomDims;
  door: RoomDoor | null;
  toilet: RoomToilet | null;
  bath: RoomBath | null;
  vanity: RoomVanity | null;
  excluded: number[];
  treatments: WallTreatments;
  flooring?: RoomFlooring;
  wallBase?: RoomWallBase;
  partitions: RoomPartition[];
};
type Fixtures = { door: RoomDoor | null; toilet: RoomToilet | null; bath: RoomBath | null; vanity: RoomVanity | null };
type Kind = "door" | "toilet" | "bath" | "vanity";

// ============================== Constants =================================
const DOOR_SIZES = [24, 28, 30, 32, 36], RO = 2, TOILET_W = 20, TOILET_D = 30; // RO: rough opening = door size + 2"
const roOf = (w: number) => w + RO;
// SKU footprints (BASES, TUBS) and vanity sizing come from the shared catalog
// (@/lib/catalog) so the room editor can never disagree with the shower/vanity
// configurators. The room only needs each SKU's id / w / d for its footprint math.
const maxSinks = (w: number) => (w >= 48 ? 2 : 1);
const SNAP_IN = 6; // inches of travel within which we snap flush to a corner
const MINR = 24, MAXR = 480; // 2ft .. 40ft
const W = 620, H = 440;
// Stable wall identifiers (W1, W2 …) derived from side identity — NOT array index — so the
// walls table and the on-plan labels always agree, even if an edge is dropped after a shape
// edit. Order matches build()'s SIDE array so rect/L number the same walls consistently.
const SIDE_ORDER = ["top", "right", "bottom", "left", "cutH", "cutV"];
const wallLabel = (side: string) => "W" + (SIDE_ORDER.indexOf(side) + 1);

// ============================== Formatting ================================
const ftin = (v: number) => { v = Math.round(v); const f = Math.floor(v / 12), i = v - f * 12; return (f ? f + "'" : "") + (i || !f ? i + '"' : ""); };
const ftinFull = (v: number) => { v = Math.round(v); return `${Math.floor(v / 12)}'${v % 12}"`; };
function parseLen(str: string | null): number | null {
  if (str == null) return null; str = ("" + str).trim(); if (!str) return null;
  const q = str.indexOf("'");
  if (q >= 0) { const f = parseFloat(str.slice(0, q)) || 0, r = str.slice(q + 1).replace('"', "").trim(), i = r ? parseFloat(r) || 0 : 0; return Math.max(0, Math.round(f * 12 + i)); }
  const p = str.split(/\s+/).map(parseFloat).filter((n) => !isNaN(n)); if (p.length === 2) return Math.max(0, Math.round(p[0] * 12 + p[1]));
  const n = parseFloat(str); return isNaN(n) ? null : Math.max(0, Math.round(n));
}

// ============================== Geometry ==================================
function clampShapeObj(shape: Shape, S: RoomDims): RoomDims {
  const out = { ...S };
  out.w = Math.min(MAXR, Math.max(MINR, out.w));
  out.d = Math.min(MAXR, Math.max(MINR, out.d));
  out.h = Math.min(240, Math.max(48, out.h));
  if (shape === "L") { out.cw = Math.max(6, Math.min(out.cw, out.w - 6)); out.cd = Math.max(6, Math.min(out.cd, out.d - 6)); }
  return out;
}
function build(shape: Shape, Sin: RoomDims): { verts: Pt[]; edges: Edge[]; S: RoomDims } {
  const S = clampShapeObj(shape, Sin); const w = S.w, d = S.d;
  let V: Pt[], C: string[], SIDE: string[];
  if (shape === "rect") { V = [[0, 0], [w, 0], [w, d], [0, d]]; C = ["w", "d", "w", "d"]; SIDE = ["top", "right", "bottom", "left"]; }
  else {
    const cw = S.cw, cd = S.cd;
    V = [[cw, 0], [w, 0], [w, d], [0, d], [0, cd], [cw, cd]]; C = ["w", "d", "w", "d", "cw", "cd"];
    SIDE = ["top", "right", "bottom", "left", "cutH", "cutV"];
    const mx = (S.corner === "tr" || S.corner === "br"), my = (S.corner === "bl" || S.corner === "br");
    V = V.map(([x, y]) => [mx ? w - x : x, my ? d - y : y] as Pt);
  }
  const edges: Edge[] = [], n = V.length;
  for (let i = 0; i < n; i++) { const a = V[i], b = V[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.5) continue; edges.push({ a, b, len: L, p: C[i], side: SIDE[i] }); }
  return { verts: V, edges, S };
}
const edgeVec = (e: Edge) => { const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L = Math.hypot(dx, dy) || 1; return { ux: dx / L, uy: dy / L, L }; };
// Outward normal of a surface at a point: partition faces carry a fixed normal (depth
// projects away from the body); perimeter walls point inward, toward the room centroid.
function surfNormal(e: Edge, mid: Pt, cen: Pt): { nx: number; ny: number } {
  if (e.nrm) return { nx: e.nrm.x, ny: e.nrm.y };
  const v = edgeVec(e);
  let nx = -v.uy, ny = v.ux;
  if ((cen[0] - mid[0]) * nx + (cen[1] - mid[1]) * ny < 0) { nx = -nx; ny = -ny; }
  return { nx, ny };
}
function clampFix<T extends { edge: number; t: number }>(o: T | null, widthIn: number, edges: Edge[]): T | null {
  if (!o) return null; if (o.edge >= edges.length) return null;
  const { L } = edgeVec(edges[o.edge]); const half = widthIn / 2 / L;
  o.t = half >= 0.5 ? 0.5 : Math.max(half, Math.min(1 - half, o.t)); return o;
}
function minWallFor(kind: Kind): number {
  if (kind === "door") return roOf(Math.min(...DOOR_SIZES)); // 24" door + 2" R.O.
  if (kind === "toilet") return TOILET_W + 4;
  if (kind === "bath") return Math.min(...BASES.map((x) => x.w), ...TUBS.map((x) => x.w));
  if (kind === "vanity") return Math.min(...VANITY_SIZES);
  return 0;
}
// footprint of a wall-mounted fixture, in room coords, as 4 corners
function footprint(edges: Edge[], o: { edge: number; t: number }, w: number, d: number, cen: Pt) {
  const e = edges[o.edge]; if (!e) return null;
  const v = edgeVec(e);
  const mid: Pt = [e.a[0] + v.ux * v.L * o.t, e.a[1] + v.uy * v.L * o.t];
  const { nx, ny } = surfNormal(e, mid, cen);
  const P4 = (a: number, i2: number): Pt => [mid[0] + v.ux * a + nx * i2, mid[1] + v.uy * a + ny * i2];
  return { pts: [P4(-w / 2, 0), P4(w / 2, 0), P4(w / 2, d), P4(-w / 2, d)] as Pt[], u: { x: v.ux, y: v.uy }, n: { x: nx, y: ny }, mid, L: v.L, e };
}
// project a set of points onto an axis -> [min,max]
function proj(pts: Pt[], ax: { x: number; y: number }, origin: Pt): [number, number] { const vals = pts.map((p) => (p[0] - origin[0]) * ax.x + (p[1] - origin[1]) * ax.y); return [Math.min(...vals), Math.max(...vals)]; }
// Detection only: does `mover` overlap `blocker`? (Footprint projected onto the mover's
// wall axes — exact for same-wall fixtures, which is where conflicts arise.) Fixtures are
// NEVER repositioned after placement; this only reports so the caller can flag amber.
function overlapsBlocker(edges: Edge[], mover: { edge: number; t: number }, mw: number, md: number, blocker: { edge: number; t: number }, bw: number, bd: number, cen: Pt): boolean {
  const A = footprint(edges, mover, mw, md, cen), B = footprint(edges, blocker, bw, bd, cen);
  if (!A || !B) return false;
  const origin = A.e.a;
  const [an0, an1] = proj(A.pts, A.n, origin), [bn0, bn1] = proj(B.pts, A.n, origin);
  if (an1 <= bn0 + 0.5 || bn1 <= an0 + 0.5) return false; // depths don't overlap
  const [au0, au1] = proj(A.pts, A.u, origin), [bu0, bu1] = proj(B.pts, A.u, origin);
  if (au1 <= bu0 + 0.5 || bu1 <= au0 + 0.5) return false; // along-wall extents clear
  return true;
}
function inPoly(pt: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-9) + xi)) c = !c;
  }
  return c;
}
// does a fixture of w x d on this edge at position t sit fully inside the room?
function fits(verts: Pt[], e: Edge, t: number, w: number, d: number, cen: Pt): boolean {
  const v = edgeVec(e);
  const mid: Pt = [e.a[0] + v.ux * v.L * t, e.a[1] + v.uy * v.L * t];
  const { nx, ny } = surfNormal(e, mid, cen);
  const IN = 0.75; // pull test points just inside the outline
  const corners: [number, number][] = [[-w / 2 + IN, IN], [w / 2 - IN, IN], [w / 2 - IN, d - IN], [-w / 2 + IN, d - IN], [0, d - IN], [0, IN]];
  return corners.every(([a, i2]) => inPoly([mid[0] + v.ux * a + nx * i2, mid[1] + v.uy * a + ny * i2], verts));
}
// biggest catalogue unit that genuinely fits this wall, snapped into a corner
// Largest catalogue unit that fits this wall at TRUE orientation only — width runs
// along the wall, depth into the room. The unit is never turned sideways to fit.
function bestFit(verts: Pt[], e: Edge, list: Sku[], cen: Pt): { sku: Sku; t: number; rot: boolean } | null {
  const L = edgeVec(e).L;
  const cands = [...list].sort((a, b) => (b.w * b.d) - (a.w * a.d)); // biggest usable area first
  for (const x of cands) {
    if (x.w > L) continue;
    const half = x.w / 2 / L;
    for (const t of [half, 1 - half, 0.5]) if (fits(verts, e, t, x.w, x.d, cen)) return { sku: x, t, rot: false };
  }
  return null;
}
// bathSku: the requested/quoted product (what the user picked). bathDrawnSku: the
// unit actually drawn on the plan (drawId, set during resolve). Physical geometry
// — art, clearances, deductions, collision — all use the drawn dims.
const bathSku = (bath: RoomBath): Sku => (bath.kind === "tub" ? TUBS : BASES).find((x) => x.id === bath.sku) || (bath.kind === "tub" ? TUBS : BASES)[0];
const bathDrawnSku = (bath: RoomBath): Sku => { const list = bath.kind === "tub" ? TUBS : BASES; return list.find((x) => x.id === (bath.drawId ?? bath.sku)) || list[0]; };
const bathDims = (bath: RoomBath): { w: number; d: number } => { const k = bathDrawnSku(bath); return bath.rot ? { w: k.d, d: k.w } : { w: k.w, d: k.d }; };
const cenOf = (v: Pt[]): Pt => [v.reduce((a, p) => a + p[0], 0) / v.length, v.reduce((a, p) => a + p[1], 0) / v.length];

// ---------- CLEARANCES ----------
const RULES = {
  std: { toiletSide: 15, toiletFront: 21, vanityFront: 21, showerFront: 24, doorClear: 0, turn: 0, label: "IRC minimum" },
  ada: { toiletSide: 30, toiletFront: 56, vanityFront: 48, showerFront: 36, doorClear: 32, turn: 60, label: "ADA / ANSI A117.1" },
};
function aabb(pts: Pt[]) { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; }
function overlaps(a: ReturnType<typeof aabb>, b: ReturnType<typeof aabb>, tol = 0.5) { return !(a.x1 <= b.x0 + tol || b.x1 <= a.x0 + tol || a.y1 <= b.y0 + tol || b.y1 <= a.y0 + tol); }
// rectangle on a wall: centred at t, `w` along wall, from `from` to `to` inches deep
function zoneOn(edges: Edge[], o: { edge: number; t: number }, w: number, from: number, to: number, cen: Pt): Pt[] | null {
  const e = edges[o.edge]; if (!e) return null;
  const v = edgeVec(e);
  const mid: Pt = [e.a[0] + v.ux * v.L * o.t, e.a[1] + v.uy * v.L * o.t];
  const { nx, ny } = surfNormal(e, mid, cen);
  const P4 = (a: number, i2: number): Pt => [mid[0] + v.ux * a + nx * i2, mid[1] + v.uy * a + ny * i2];
  return [P4(-w / 2, from), P4(w / 2, from), P4(w / 2, to), P4(-w / 2, to)];
}
type ActiveFix = { k: Kind; name: string; o: { edge: number; t: number }; w: number; d: number };
function activeFixtures(edges: Edge[], fx: Fixtures): ActiveFix[] {
  const out: ActiveFix[] = [];
  if (fx.toilet) out.push({ k: "toilet", name: "toilet", o: fx.toilet, w: TOILET_W, d: TOILET_D });
  if (fx.vanity) out.push({ k: "vanity", name: "vanity", o: fx.vanity, w: fx.vanity.w, d: VANITY_D });
  if (fx.bath) { const b = bathDims(fx.bath); out.push({ k: "bath", name: fx.bath.kind === "tub" ? "tub" : "shower", o: fx.bath, w: b.w, d: b.d }); }
  if (fx.door) out.push({ k: "door", name: "door", o: fx.door, w: roOf(fx.door.w), d: 4 });
  return out.filter((f) => edges[f.o.edge]);
}
type ClearZone = { pts: Pt[]; ok: boolean };
type ClearResult = { issues: string[]; zones: ClearZone[]; turnCircle: { x: number; y: number; r: number } | null; mode: string };
function checkClearances(verts: Pt[], edges: Edge[], cen: Pt, ada: boolean, fx: Fixtures, t: Tr, partGeoms: PartGeom[] = []): ClearResult {
  const R = ada ? RULES.ada : RULES.std;
  const list = activeFixtures(edges, fx), issues: string[] = [], zones: ClearZone[] = [];
  const rectOf = (f: ActiveFix) => aabb(zoneOn(edges, f.o, f.w, 0, f.d, cen)!);
  const inside = (pts: Pt[]) => pts.every((pt) => inPoly(pt, verts));
  // Partition bodies are obstructions: their finished-thickness footprints block clearance
  // zones and the turn circle just like fixture footprints (warn-don't-block).
  const partBoxes = partGeoms.map((g) => aabb(g.corners));

  const test = (f: ActiveFix, zonePts: Pt[] | null, label: string, req: number) => {
    if (!zonePts) return;
    const z: ClearZone = { pts: zonePts, ok: true }; zones.push(z);
    const za = aabb(zonePts);
    let bad: string | null = null;
    if (!inside(zonePts)) bad = t("configurator.room.fxWall");
    else for (const g of list) { if (g === f) continue; if (g.k === "door") continue; if (overlaps(za, rectOf(g))) { bad = fxName(t, g.name); break; } }
    if (!bad) for (const pb of partBoxes) { if (overlaps(za, pb)) { bad = t("configurator.room.fxPartition"); break; } }
    if (bad) { z.ok = false; issues.push(t("configurator.room.clrBlocked", { req: String(req), label, fixture: fxName(t, f.name), blocker: bad })); }
  };

  for (const f of list) {
    if (f.k === "toilet") {
      test(f, zoneOn(edges, f.o, R.toiletSide * 2, 0, f.d, cen), t(ada ? "configurator.room.clrWidthAda" : "configurator.room.clrSide"), R.toiletSide);
      test(f, zoneOn(edges, f.o, R.toiletSide * 2, f.d, f.d + R.toiletFront, cen), t("configurator.room.clrDepth"), R.toiletFront);
    } else if (f.k === "vanity") {
      test(f, zoneOn(edges, f.o, f.w, f.d, f.d + R.vanityFront, cen), t(ada ? "configurator.room.clrVanityAda" : "configurator.room.clrVanityFront"), R.vanityFront);
    } else if (f.k === "bath") {
      test(f, zoneOn(edges, f.o, f.w, f.d, f.d + R.showerFront, cen), t("configurator.room.clrEntry"), R.showerFront);
    }
  }
  // ---- ADA-only checks ----
  let turnCircle: { x: number; y: number; r: number } | null = null;
  if (ada) {
    if (fx.door && fx.door.w < 36) issues.push(t("configurator.room.clrAdaDoor", { w: String(fx.door.w) }));
    const R60 = R.turn / 2;
    const xs = verts.map((p) => p[0]), ys = verts.map((p) => p[1]);
    let best: { x: number; y: number } | null = null;
    for (let x = Math.min(...xs) + R60; x <= Math.max(...xs) - R60; x += 3) {
      for (let y = Math.min(...ys) + R60; y <= Math.max(...ys) - R60; y += 3) {
        const box = { x0: x - R60, x1: x + R60, y0: y - R60, y1: y + R60 };
        const cornersIn = ([[x - R60, y - R60], [x + R60, y - R60], [x + R60, y + R60], [x - R60, y + R60], [x, y]] as Pt[]).every((pt) => inPoly(pt, verts));
        if (!cornersIn) continue;
        let clear = true;
        for (const g of list) { if (g.k === "door") continue; const ga = aabb(zoneOn(edges, g.o, g.w, 0, g.d, cen)!); if (overlaps(box, ga)) { clear = false; break; } }
        if (clear) for (const pb of partBoxes) { if (overlaps(box, pb)) { clear = false; break; } } // avoid partitions
        if (clear) { best = { x, y }; break; }
      }
      if (best) break;
    }
    if (best) turnCircle = { x: best.x, y: best.y, r: R60 };
    else issues.push(t("configurator.room.clrAdaTurn"));
  }
  return { issues, zones, turnCircle, mode: t(ada ? "configurator.room.adaLabel" : "configurator.room.ircLabel") };
}
// largest size that fits this wall AND clears every other fixture already placed
function freeFit(verts: Pt[], edges: Edge[], i: number, sizes: number[], depth: number, cen: Pt, skipKind: Kind, fx: Fixtures): { w: number; t: number } | null {
  const e = edges[i]; if (!e) return null;
  const L = edgeVec(e).L;
  const others = activeFixtures(edges, fx).filter((f) => f.k !== skipKind);
  const boxes = others.map((g) => aabb(zoneOn(edges, g.o, g.w, 0, g.d, cen)!));
  for (const w of [...sizes].sort((a, b) => b - a)) {
    if (w > L) continue;
    const half = w / 2;
    for (let c = half; c <= L - half; c += 1) {
      const t = c / L;
      if (!fits(verts, e, t, w, depth, cen)) continue;
      const za = aabb(zoneOn(edges, { edge: i, t }, w, 0, depth, cen)!);
      if (boxes.some((b) => overlaps(za, b))) continue;
      return { w, t };
    }
  }
  return null;
}
// Placement position for a FIXED-size fixture (toilet, bathing area): first t on this
// wall where it fits and clears every other fixture. If no such spot exists, the t of
// maximum separation (footprint center farthest from the nearest other fixture). This is
// applied only at placement time — nothing is repositioned afterwards.
function placeClear(verts: Pt[], edges: Edge[], i: number, w: number, depth: number, cen: Pt, skipKind: Kind, fx: Fixtures): number {
  const e = edges[i]; if (!e) return 0.5;
  const L = edgeVec(e).L, half = w / 2;
  if (half >= L / 2) return 0.5; // wider than the wall — center it (overhang handled in resolve)
  const boxes = activeFixtures(edges, fx).filter((f) => f.k !== skipKind).map((g) => aabb(zoneOn(edges, g.o, g.w, 0, g.d, cen)!));
  const centerAt = (t: number): Pt => { const b = aabb(zoneOn(edges, { edge: i, t }, w, 0, depth, cen)!); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; };
  // pass 1: first clear + fitting position
  for (let c = half; c <= L - half; c += 1) {
    const t = c / L;
    if (!fits(verts, e, t, w, depth, cen)) continue;
    const za = aabb(zoneOn(edges, { edge: i, t }, w, 0, depth, cen)!);
    if (!boxes.some((b) => overlaps(za, b))) return t;
  }
  // pass 2: no clear spot — maximum separation from the other fixtures
  if (!boxes.length) return 0.5;
  const otherCenters = boxes.map((b): Pt => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
  let bestT = 0.5, bestSep = -1;
  for (let c = half; c <= L - half; c += 1) {
    const t = c / L;
    if (!fits(verts, e, t, w, depth, cen)) continue;
    const cc = centerAt(t);
    const minDist = Math.min(...otherCenters.map((o) => Math.hypot(o[0] - cc[0], o[1] - cc[1])));
    if (minDist > bestSep) { bestSep = minDist; bestT = t; }
  }
  return bestSep >= 0 ? bestT : 0.5;
}
// Keep fixtures on the surface they were placed on (perimeter wall OR partition face), even
// when the shape changes. If that surface is gone — a wall removed by a shape edit, or a
// partition deleted/orphaned — fall back to the longest PERIMETER wall and flag `orphaned`
// so the UI shows the "relocated" notice. A partition face is never a fallback target.
function reanchor(surfaces: Edge[], fixtures: (RoomDoor | RoomToilet | RoomBath | RoomVanity | null)[]) {
  const longestPerim = () => surfaces.reduce((b, e, k) => (!e.partId && e.len > (surfaces[b] && !surfaces[b].partId ? surfaces[b].len : -1) ? k : b), 0);
  for (const o of fixtures) {
    if (!o) continue;
    if (o.side) {
      const i = surfaces.findIndex((e) => e.side === o.side);
      if (i >= 0) { o.edge = i; o.orphaned = false; }
      else {
        const alt = longestPerim();
        o.edge = alt; o.side = surfaces[alt].side; o.orphaned = true;
      }
    } else if (surfaces[o.edge]) o.side = surfaces[o.edge].side;
  }
}
// how much of each wall is taken up by the bathing area
function wallDeductions(edges: Edge[], fx: Fixtures): number[] {
  const ded = edges.map(() => 0);
  const bath = fx.bath;
  if (bath && edges[bath.edge]) {
    const b = bathDims(bath), e = edges[bath.edge], v = edgeVec(e);
    ded[bath.edge] += Math.min(b.w, e.len);
    const half = b.w / 2 / v.L, atA = Math.abs(bath.t - half) < 0.01, atB = Math.abs(bath.t - (1 - half)) < 0.01;
    if (atA || atB) {
      const corner = atA ? e.a : e.b;
      edges.forEach((o, i) => {
        if (i === bath.edge) return;
        const touches = (Math.hypot(o.a[0] - corner[0], o.a[1] - corner[1]) < 1) || (Math.hypot(o.b[0] - corner[0], o.b[1] - corner[1]) < 1);
        if (touches) ded[i] += Math.min(b.d, o.len);
      });
    }
  }
  return ded;
}
// baseboard runs the perimeter, less door openings, less the bathing area, less the vanity
// face. Door/vanity only reduce the perimeter run when they're actually ON a perimeter wall
// (edge index within the perimeter range) — one anchored to a partition face doesn't.
function baseboardLF(edges: Edge[], ded: number[], fx: Fixtures): number {
  let lf = edges.reduce((a, e, i) => a + Math.max(0, e.len - ded[i]), 0);
  if (fx.door && fx.door.edge < edges.length) lf -= roOf(fx.door.w);
  if (fx.vanity && fx.vanity.edge < edges.length) lf -= fx.vanity.w;
  return Math.max(0, lf) / 12;
}
// Build the two long FACES of every partition as mountable surfaces (pass 3). Face `a` sits
// on the +along-wall side of the body, face `b` on the −side; each runs anchor→free (length
// = lengthIn) with a fixed outward normal pointing away from the body. Stable side identity
// `partition:{id}:a|b` lets a fixture anchor to one face and survive edits, like a wall side.
function partitionFaces(partGeoms: PartGeom[]): Edge[] {
  const faces: Edge[] = [];
  for (const g of partGeoms) {
    const v = edgeVec(g.e), h = g.p.thicknessIn / 2;
    const oa: Pt = [g.anchor[0] + v.ux * h, g.anchor[1] + v.uy * h], ob: Pt = [g.free[0] + v.ux * h, g.free[1] + v.uy * h];
    faces.push({ a: oa, b: ob, len: g.p.lengthIn, p: "", side: `partition:${g.p.id}:a`, nrm: { x: v.ux, y: v.uy }, partId: g.p.id });
    const ba: Pt = [g.anchor[0] - v.ux * h, g.anchor[1] - v.uy * h], bb: Pt = [g.free[0] - v.ux * h, g.free[1] - v.uy * h];
    faces.push({ a: ba, b: bb, len: g.p.lengthIn, p: "", side: `partition:${g.p.id}:b`, nrm: { x: -v.ux, y: -v.uy }, partId: g.p.id });
  }
  return faces;
}
// Along-face length each fixture covers on the partition face it's anchored to, keyed by that
// face's side identity — so a covered face isn't over-counted in the two-face wall area (the
// same idea as the bathing-area/vanity deductions on perimeter walls).
function partitionFaceCover(surfaces: Edge[], fx: Fixtures): Record<string, number> {
  const cover: Record<string, number> = {};
  const add = (o: { edge: number } | null, w: number) => {
    if (!o) return; const s = surfaces[o.edge]; if (!s || !s.partId) return;
    cover[s.side] = (cover[s.side] ?? 0) + w;
  };
  add(fx.door, fx.door ? roOf(fx.door.w) : 0);
  add(fx.toilet, TOILET_W);
  add(fx.vanity, fx.vanity ? fx.vanity.w : 0);
  add(fx.bath, fx.bath ? bathDims(fx.bath).w : 0);
  return cover;
}
function shoelace(v: Pt[]): number { let A = 0; for (let i = 0; i < v.length; i++) { const j = (i + 1) % v.length; A += v[i][0] * v[j][1] - v[j][0] * v[i][1]; } return Math.abs(A) / 2 / 144; }

// ---------- PARTITIONS ---------- (interior stud walls, anchored to a wall, 90° only)
const partLen = (p: RoomPartition): number => p.lengthIn;
// Point inside OR on the room polygon (a small tolerance toward the centroid accepts
// boundary points, since ray-casting is unreliable exactly on an edge).
function insideOrOn(pt: Pt, verts: Pt[], cen: Pt): boolean {
  if (inPoly(pt, verts)) return true;
  const dx = cen[0] - pt[0], dy = cen[1] - pt[1], L = Math.hypot(dx, dy) || 1;
  return inPoly([pt[0] + (dx / L) * 1, pt[1] + (dy / L) * 1], verts); // nudge ~1" inward
}
// The anchor point on a wall + the inward normal the partition extends along, from a
// { side, offsetIn } anchor. Null when the wall no longer exists (orphaned this pass).
function anchorFrame(anchor: { side: string; offsetIn: number }, edges: Edge[], cen: Pt): { pt: Pt; nx: number; ny: number; e: Edge; i: number } | null {
  const i = edges.findIndex((e) => e.side === anchor.side);
  if (i < 0) return null;
  const e = edges[i], v = edgeVec(e);
  const off = Math.max(0, Math.min(v.L, anchor.offsetIn));
  const pt: Pt = [e.a[0] + v.ux * off, e.a[1] + v.uy * off];
  let nx = -v.uy, ny = v.ux; // inward normal (points toward the room centroid)
  if ((cen[0] - pt[0]) * nx + (cen[1] - pt[1]) * ny < 0) { nx = -nx; ny = -ny; }
  return { pt, nx, ny, e, i };
}
// A partition's fully-derived drawn geometry: the anchored end (on the wall), the free end
// (projected inward by lengthIn), the finished-thickness rectangle corners, and the mid.
export type PartGeom = { p: RoomPartition; i: number; e: Edge; anchor: Pt; free: Pt; corners: Pt[]; mid: Pt };
function partGeom(p: RoomPartition, edges: Edge[], cen: Pt): PartGeom | null {
  const f = anchorFrame(p, edges, cen); if (!f) return null;
  const anchor = f.pt;
  const free: Pt = [anchor[0] + f.nx * p.lengthIn, anchor[1] + f.ny * p.lengthIn];
  const v = edgeVec(f.e), h = p.thicknessIn / 2; // half-thickness offset runs ALONG the wall
  const corners: Pt[] = [
    [anchor[0] + v.ux * h, anchor[1] + v.uy * h], [free[0] + v.ux * h, free[1] + v.uy * h],
    [free[0] - v.ux * h, free[1] - v.uy * h], [anchor[0] - v.ux * h, anchor[1] - v.uy * h],
  ];
  const mid: Pt = [(anchor[0] + free[0]) / 2, (anchor[1] + free[1]) / 2];
  return { p, i: f.i, e: f.e, anchor, free, corners, mid };
}
// Resolve every partition, dropping any whose anchored wall no longer exists.
function resolvePartitions(partitions: RoomPartition[], edges: Edge[], cen: Pt): PartGeom[] {
  return partitions.map((p) => partGeom(p, edges, cen)).filter((g): g is PartGeom => g != null);
}
// The nearest perimeter wall to a raw point, as its anchor { side, offsetIn } (whole inches,
// clamped to the wall span). Used at placement to snap the anchored end to a wall.
function nearestWallAnchor(pt: Pt, edges: Edge[]): { side: string; offsetIn: number } | null {
  let best: { side: string; offsetIn: number } | null = null, bestD = Infinity;
  for (const e of edges) {
    const v = edgeVec(e);
    const tt = Math.max(0, Math.min(v.L, (pt[0] - e.a[0]) * v.ux + (pt[1] - e.a[1]) * v.uy));
    const proj: Pt = [e.a[0] + v.ux * tt, e.a[1] + v.uy * tt];
    const d = Math.hypot(pt[0] - proj[0], pt[1] - proj[1]);
    if (d < bestD) { bestD = d; best = { side: e.side, offsetIn: Math.round(tt) }; }
  }
  return best;
}
// Does a partition sit fully inside the room? The anchored end is on the wall by
// construction; check the free end and the two free-side corners.
function partInside(p: RoomPartition, edges: Edge[], verts: Pt[], cen: Pt): boolean {
  const g = partGeom(p, edges, cen); if (!g) return false;
  return [g.free, g.corners[1], g.corners[2]].every((pt) => insideOrOn(pt, verts, cen));
}
// Largest whole-inch length that keeps the partition inside the room (0 if none fits).
function clampInsideLen(p: RoomPartition, edges: Edge[], verts: Pt[], cen: Pt): number {
  for (let len = Math.max(1, Math.round(p.lengthIn)); len >= 1; len--) {
    if (partInside({ ...p, lengthIn: len }, edges, verts, cen)) return len;
  }
  return 0;
}

// ============================== Resolve ===================================
type Model = {
  // `edges` are the perimeter walls; `surfaces` = perimeter walls + partition faces, the set
  // a fixture can anchor to. Fixture `edge` indexes into `surfaces`; wall/panel takeoff uses `edges`.
  verts: Pt[]; edges: Edge[]; surfaces: Edge[]; S: RoomDims; cen: Pt; P: (x: number, y: number) => Pt; s: number; ox: number; oy: number;
  minX: number; maxX: number; minY: number; maxY: number; bw: number; bh: number;
  door: RoomDoor | null; toilet: RoomToilet | null; bath: RoomBath | null; vanity: RoomVanity | null; fx: Fixtures;
  perim: number; wallSF: number; wallSFgross: number; floorSF: number; bbLF: number; ded: number[];
  excluded: Set<number>; CL: ClearResult; label: string;
  // wall panels: per-edge treatment, and the offcut-aware takeoff over panelled walls
  treat: WallTreatment[]; panelWallCount: number; panelCount: number; panelledSF: number; panelHeightExceeded: boolean;
  // flooring: the chosen color/waste and the carton takeoff over the floor area
  flooring: RoomFlooring | null; flooringCartons: number; flooringCoverageSF: number; flooringCost: number;
  // wall base: the chosen height/color/waste and the stick takeoff over the baseboard LF
  wallBase: RoomWallBase | null; wallBaseSticks: number; wallBaseCoverageLF: number; wallBaseCost: number;
  // interior partitions: the objects + their footprint (deducted from floor) and two-face wall
  // area, plus the resolved drawn geometry (endpoints/corners derived from each anchor).
  partitions: RoomPartition[]; partGeoms: PartGeom[]; partitionCount: number; partitionWallSF: number;
};

function resolveModel(doc: Doc, ada: boolean, t: Tr): Model {
  let door: RoomDoor | null = doc.door ? { ...doc.door } : null;
  let toilet: RoomToilet | null = doc.toilet ? { ...doc.toilet } : null;
  let bath: RoomBath | null = doc.bath ? { ...doc.bath } : null;
  let vanity: RoomVanity | null = doc.vanity ? { ...doc.vanity } : null;
  const excluded = new Set(doc.excluded);

  const { verts, edges, S } = build(doc.shape, doc.S);
  const cen = cenOf(verts);
  // ---- interior partitions (resolved FIRST) ---- each length is re-clamped to stay inside
  // the (possibly changed) room, exactly as fixtures re-clamp their position. The two faces of
  // every partition then join the perimeter walls as mountable `surfaces`, so a fixture can
  // anchor to a partition face by the same edge/side/t model. Fixture geometry below runs on
  // `surfaces`; wall/panel/base takeoff stays on the perimeter `edges`.
  const partitions = (doc.partitions ?? []).map((p) => {
    const fitted = clampInsideLen(p, edges, verts, cen);
    return fitted >= 1 && fitted !== p.lengthIn ? { ...p, lengthIn: fitted } : p;
  });
  const partGeoms = resolvePartitions(partitions, edges, cen);
  const surfaces: Edge[] = [...edges, ...partitionFaces(partGeoms)];
  reanchor(surfaces, [door, toilet, bath, vanity]);

  if (door && surfaces[door.edge]) { const L = edgeVec(surfaces[door.edge]).L; const allow = DOOR_SIZES.filter((w) => roOf(w) <= L); if (allow.length && !allow.includes(door.w)) door.w = Math.max(...allow); }
  door = clampFix(door, door ? roOf(door.w) : 0, surfaces);
  toilet = clampFix(toilet, TOILET_W, surfaces);
  if (bath) {
    if (!surfaces[bath.edge]) bath = null;
    else {
      const e = surfaces[bath.edge], { L } = edgeVec(e);
      const reqSku = bathSku(bath); // requested product — never silently shrunk or rotated
      const reqHalf = reqSku.w / 2 / L;
      // Does the requested size fit this surface at TRUE orientation (some valid position)?
      const reqFits = reqSku.w <= L && [reqHalf, 1 - reqHalf, 0.5].some((t) => fits(verts, e, t, reqSku.w, reqSku.d, cen));
      let drawSku = reqSku;
      if (reqFits) {
        bath.sizeConflict = null; // requested fits here — draw it, no conflict
      } else {
        // Requested doesn't fit here. Keep it as the product choice, but draw the largest
        // catalogue unit that DOES fit (true orientation). Flag the conflict.
        const best = bestFit(verts, e, bath.kind === "tub" ? TUBS : BASES, cen);
        bath.sizeConflict = { requested: reqSku.id, fitsHere: best ? best.sku.id : null };
        if (best) drawSku = best.sku; // else nothing fits — fall back to drawing the requested overhanging
      }
      bath.drawId = drawSku.id;

      const sk = { w: drawSku.w, d: drawSku.d }, half = sk.w / 2 / L;
      bath.tooWide = sk.w > L; bath.overBy = Math.max(0, sk.w - L);
      bath.snapped = null;
      if (bath.tooWide) { bath.t = 0.5; }
      else {
        bath.t = Math.max(half, Math.min(1 - half, bath.t));
        if (Math.abs(bath.t - half) * L <= SNAP_IN) { bath.t = half; bath.snapped = "a"; }
        else if (Math.abs((1 - half) - bath.t) * L <= SNAP_IN) { bath.t = 1 - half; bath.snapped = "b"; }
      }
      bath.overhang = bath.tooWide || !fits(verts, e, bath.t, sk.w, sk.d, cen);
    }
  }

  const perim = edges.reduce((a, e) => a + e.len, 0);
  const fxForDed: Fixtures = { door, toilet, bath, vanity };
  const ded = wallDeductions(edges, fxForDed);
  // ---- interior partitions ---- footprint deducts from floor SF; each face adds length ×
  // height to the billable wall area, LESS the along-face length any fixture now covers (so a
  // vanity/toilet on a pony wall doesn't over-count the face), mirroring perimeter deductions.
  const partitionCount = partitions.length;
  const faceCover = partitionFaceCover(surfaces, fxForDed);
  const partitionFootprintSF = partitions.reduce((a, p) => a + partLen(p) * p.thicknessIn / 144, 0);
  const partitionWallSF = partitions.reduce((a, p) => {
    const cA = faceCover[`partition:${p.id}:a`] ?? 0, cB = faceCover[`partition:${p.id}:b`] ?? 0;
    return a + (Math.max(0, p.lengthIn - cA) + Math.max(0, p.lengthIn - cB)) * p.heightIn / 144;
  }, 0);
  const wallSFgross = edges.reduce((a, e) => a + e.len * S.h / 144, 0);
  const wallSFperim = edges.reduce((a, e, i) => a + (excluded.has(i) ? 0 : Math.max(0, e.len - ded[i]) * S.h / 144), 0);
  const wallSF = wallSFperim + partitionWallSF;
  const bbLF = baseboardLF(edges, ded, fxForDed);
  const floorSF = Math.max(0, shoelace(verts) - partitionFootprintSF);

  // ---- wall panels ----
  // Each wall's treatment is keyed by its stable side identity (survives geometry
  // changes); missing -> "paint". A wall the bathing area reduces (ded > 0) is owned
  // by the shower module and is never panelled here, so it can't be double-counted.
  const treat: WallTreatment[] = edges.map((e) => doc.treatments[e.side] ?? "paint");
  const panelNets = edges
    .map((e, i) => (treat[i] === "panel" && ded[i] === 0 ? Math.max(0, e.len - ded[i]) : 0))
    .filter((net) => net > 0);
  const panelCount = wallPanelTakeoff(panelNets).totalPanels;
  const panelledSF = panelNets.reduce((a, net) => a + net * S.h / 144, 0);
  const panelHeightExceeded = S.h > WALL_PANEL.heightIn;

  // ---- flooring ---- carton takeoff over the floor area, whole cartons only
  const flooring = doc.flooring ?? null;
  const flTake = flooring ? flooringTakeoff(floorSF, flooring.wastePct) : null;
  const flooringCartons = flTake ? flTake.cartons : 0;
  const flooringCoverageSF = flTake ? flTake.coverageSF : 0;
  const flooringCost = flTake ? flTake.cost : 0;

  // ---- wall base ---- stick takeoff over the baseboard LF (already less door/vanity/bath)
  const wallBase = doc.wallBase ?? null;
  const wbTake = wallBase ? wallBaseTakeoff(bbLF, wallBase.wastePct) : null;
  const wallBaseSticks = wbTake ? wbTake.sticks : 0;
  const wallBaseCoverageLF = wbTake ? wbTake.coverageLF : 0;
  const wallBaseCost = wbTake ? wbTake.cost : 0;
  const xs = verts.map((p) => p[0]), ys = verts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const bwv = Math.max(1, maxX - minX), bhv = Math.max(1, maxY - minY), pad = 84;
  const s = Math.min((W - pad * 2) / bwv, (H - pad * 2) / bhv), ox = (W - bwv * s) / 2 - minX * s, oy = (H - bhv * s) / 2 - minY * s;
  const P = (x: number, y: number): Pt => [x * s + ox, y * s + oy];

  // Keep the vanity on its surface (bounds only — NOT collision) and flag overhang.
  if (vanity && surfaces[vanity.edge]) {
    const { L } = edgeVec(surfaces[vanity.edge]), half = vanity.w / 2 / L;
    vanity.t = half >= 0.5 ? 0.5 : Math.max(half, Math.min(1 - half, vanity.t));
    vanity.overhang = vanity.w > L || !fits(verts, surfaces[vanity.edge], vanity.t, vanity.w, VANITY_D, cen);
  }
  if (vanity && !surfaces[vanity.edge]) vanity = null;

  // Overlap DETECTION only — fixtures are never repositioned (placeClear already lands
  // them clear at placement). `conflictWith` is the subject→blocker message on one side of
  // each pair; `conflict` marks every fixture in an overlap so it draws the amber outline.
  if (toilet) { toilet.conflictWith = null; toilet.conflict = false; }
  if (vanity) { vanity.conflictWith = null; vanity.conflict = false; }
  if (bath) bath.conflict = false;
  const bathToken = bath ? (bath.kind === "tub" ? "tub" : "shower") : null;
  const bathSk = bath ? bathDims(bath) : null;
  if (vanity && surfaces[vanity.edge]) {
    if (bath && bathSk && surfaces[bath.edge] && overlapsBlocker(surfaces, vanity, vanity.w, VANITY_D, bath, bathSk.w, bathSk.d, cen)) { vanity.conflictWith = bathToken; vanity.conflict = true; bath.conflict = true; }
    if (toilet && surfaces[toilet.edge] && overlapsBlocker(surfaces, vanity, vanity.w, VANITY_D, toilet, TOILET_W, TOILET_D, cen)) { if (!vanity.conflictWith) vanity.conflictWith = "toilet"; vanity.conflict = true; toilet.conflict = true; }
    if (door && surfaces[door.edge] && overlapsBlocker(surfaces, vanity, vanity.w, VANITY_D, door, roOf(door.w), 6, cen)) { if (!vanity.conflictWith) vanity.conflictWith = "door"; vanity.conflict = true; }
  }
  if (toilet && surfaces[toilet.edge]) {
    if (bath && bathSk && surfaces[bath.edge] && overlapsBlocker(surfaces, toilet, TOILET_W, TOILET_D, bath, bathSk.w, bathSk.d, cen)) { toilet.conflictWith = bathToken; toilet.conflict = true; bath.conflict = true; }
    if (door && surfaces[door.edge] && overlapsBlocker(surfaces, toilet, TOILET_W, TOILET_D, door, roOf(door.w), 6, cen)) { if (!toilet.conflictWith) toilet.conflictWith = "door"; toilet.conflict = true; }
  }

  const fx: Fixtures = { door, toilet, bath, vanity };
  const CL = checkClearances(verts, surfaces, cen, ada, fx, t, partGeoms);
  // Surface overlap conflicts in the same amber issues list as clearance failures.
  if (toilet?.conflictWith) CL.issues.push(t("configurator.room.overlapWarn", { fixture: t("configurator.room.toiletHdr"), blocker: fxName(t, toilet.conflictWith) }));
  if (vanity?.conflictWith) CL.issues.push(t("configurator.room.overlapWarn", { fixture: t("configurator.room.vanityHdr"), blocker: fxName(t, vanity.conflictWith) }));
  const label = `${ftinFull(bwv)} × ${ftinFull(bhv)}${doc.shape === "L" ? " " + t("configurator.label.lShaped") : ""} · ${floorSF.toFixed(1)} sf`;

  return {
    verts, edges, surfaces, S, cen, P, s, ox, oy, minX, maxX, minY, maxY, bw: bwv, bh: bhv,
    door, toilet, bath, vanity, fx, perim, wallSF, wallSFgross, floorSF, bbLF, ded, excluded, CL, label,
    treat, panelWallCount: panelNets.length, panelCount, panelledSF, panelHeightExceeded,
    flooring, flooringCartons, flooringCoverageSF, flooringCost,
    wallBase, wallBaseSticks, wallBaseCoverageLF, wallBaseCost,
    partitions, partGeoms, partitionCount, partitionWallSF,
  };
}

const initialDoc: Doc = {
  shape: "rect",
  S: { w: 96, d: 60, h: 96, cw: 36, cd: 28, corner: "tl" }, // 8'0 x 5'0 room, 3'0 x 2'4 cutout top-left
  door: null, toilet: null, bath: null, vanity: null, excluded: [], treatments: {}, partitions: [],
};

// ============================== SVG artwork ===============================
const ACCENT = "#0e6e6e", INK = "#14181c", MUTED = "#8a8a84", PAPER = "#faf9f7", AMBER = "#b47216", GHOST = "#b9b6ae";

// `hitR` is the invisible grab-target radius; it shrinks (via `crowded`) when another
// handle sits within roughly a handle-diameter, so overlapping handles don't fully
// occlude each other and the covered fixture stays reachable.
function PickCircles({ kind, cx, cy, selected, crowded = false, onSelect, onDragStart }: { kind: Kind; cx: number; cy: number; selected: boolean; crowded?: boolean; onSelect: () => void; onDragStart: (e: React.PointerEvent, kind: Kind) => void }) {
  const sel = (e: React.MouseEvent) => { e.stopPropagation(); onSelect(); };
  const down = (e: React.PointerEvent) => onDragStart(e, kind);
  const hitR = crowded ? 12 : 22;
  return (
    <>
      <circle r={hitR} fill="transparent" cx={cx} cy={cy} style={{ cursor: "grab" }} onClick={sel} onPointerDown={down} />
      <circle cx={cx} cy={cy} r={11} fill={ACCENT} fillOpacity={selected ? 0.35 : 0.15} stroke={ACCENT} strokeWidth={selected ? 2 : 1.2} style={{ cursor: "grab" }} onClick={sel} onPointerDown={down} />
    </>
  );
}

function DoorArt({ m, sel, onSelect, onDragStart, interactive = true, crowded = false }: { m: Model; sel: boolean; onSelect: () => void; onDragStart: (e: React.PointerEvent, k: Kind) => void; interactive?: boolean; crowded?: boolean }) {
  const door = m.door!; const e = m.surfaces[door.edge]; if (!e) return null;
  const v = edgeVec(e), ow = roOf(door.w), half = ow / 2 / v.L;
  const p0: Pt = [e.a[0] + v.ux * v.L * (door.t - half), e.a[1] + v.uy * v.L * (door.t - half)];
  const p1: Pt = [e.a[0] + v.ux * v.L * (door.t + half), e.a[1] + v.uy * v.L * (door.t + half)];
  const [x0, y0] = m.P(p0[0], p0[1]), [x1, y1] = m.P(p1[0], p1[1]);
  const mid: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const { nx, ny } = surfNormal(e, mid, m.cen);
  const inPt = (a: number, i2: number) => m.P(mid[0] + v.ux * a + nx * i2, mid[1] + v.uy * a + ny * i2);
  const parts: React.ReactNode[] = [];
  parts.push(<line key="gap" x1={x0} y1={y0} x2={x1} y2={y1} stroke={PAPER} strokeWidth={7} strokeLinecap="butt" pointerEvents="none" />);
  if (door.type === "swing") {
    const dpix = Math.hypot(x1 - x0, y1 - y0), hl = door.swing.endsWith("l"), out = door.swing.startsWith("out");
    const hx = hl ? x0 : x1, hy = hl ? y0 : y1;
    const sx2 = hl ? x1 : x0, sy2 = hl ? y1 : y0;
    const tip = inPt(hl ? -ow / 2 : ow / 2, out ? -ow : ow);
    parts.push(<path key="arc" d={`M ${sx2} ${sy2} A ${dpix} ${dpix} 0 0 ${((hl ? 1 : 0) ^ (out ? 1 : 0))} ${tip[0]} ${tip[1]}`} fill="none" stroke={INK} strokeWidth={1.2} pointerEvents="none" />);
    parts.push(<line key="leaf" x1={hx} y1={hy} x2={tip[0]} y2={tip[1]} stroke={INK} strokeWidth={3} pointerEvents="none" />);
  } else if (door.type === "sliding") {
    const o = inPt(0, 4), a0 = inPt(-ow * 0.45, 4), a1 = inPt(ow * 0.45, 4);
    parts.push(<line key="s0" x1={a0[0]} y1={a0[1]} x2={o[0]} y2={o[1]} stroke={INK} strokeWidth={3} pointerEvents="none" />);
    parts.push(<line key="s1" x1={o[0]} y1={o[1]} x2={a1[0]} y2={a1[1]} stroke={INK} strokeWidth={1} pointerEvents="none" />);
  }
  const dm = inPt(0, 0);
  return <g>{parts}{interactive && <PickCircles kind="door" cx={dm[0]} cy={dm[1]} selected={sel} crowded={crowded} onSelect={onSelect} onDragStart={onDragStart} />}</g>;
}

function ToiletArt({ m, sel, onSelect, onDragStart, interactive = true, bodySelectable = false, crowded = false }: { m: Model; sel: boolean; onSelect: () => void; onDragStart: (e: React.PointerEvent, k: Kind) => void; interactive?: boolean; bodySelectable?: boolean; crowded?: boolean }) {
  const toilet = m.toilet!; const e = m.surfaces[toilet.edge]; if (!e) return null;
  const v = edgeVec(e);
  const mid: Pt = [e.a[0] + v.ux * v.L * toilet.t, e.a[1] + v.uy * v.L * toilet.t];
  const { nx, ny } = surfNormal(e, mid, m.cen);
  const pt = (a: number, i2: number) => m.P(mid[0] + v.ux * a + nx * i2, mid[1] + v.uy * a + ny * i2);
  const TD = 8, BL = TOILET_D - TD, BW = 15;
  const c1 = pt(-TOILET_W / 2, 0), c2 = pt(TOILET_W / 2, 0), c3 = pt(TOILET_W / 2, TD), c4 = pt(-TOILET_W / 2, TD);
  const warn = !!toilet.conflict;
  const stroke = warn ? AMBER : (sel ? ACCENT : INK), sw = warn ? 2 : (sel ? 2 : 1.5);
  const bodyEvt = bodySelectable ? { onClick: (ev: React.MouseEvent) => { ev.stopPropagation(); onSelect(); }, style: { cursor: "pointer" as const } } : { pointerEvents: "none" as const };
  const bc = pt(0, TD + BL / 2), e2 = m.P(mid[0] + v.ux, mid[1] + v.uy), e0 = m.P(mid[0], mid[1]);
  const ang = Math.atan2(e2[1] - e0[1], e2[0] - e0[0]) * 180 / Math.PI;
  const rx = Math.hypot(pt(BW / 2, 0)[0] - pt(0, 0)[0], pt(BW / 2, 0)[1] - pt(0, 0)[1]);
  const ry = Math.hypot(pt(0, BL / 2)[0] - pt(0, 0)[0], pt(0, BL / 2)[1] - pt(0, 0)[1]);
  const h = pt(0, TD / 2);
  return (
    <g>
      <polygon {...bodyEvt} points={`${c1.join(",")} ${c2.join(",")} ${c3.join(",")} ${c4.join(",")}`} fill="#fff" stroke={stroke} strokeWidth={sw} />
      <ellipse {...bodyEvt} cx={bc[0]} cy={bc[1]} rx={rx} ry={ry} transform={`rotate(${ang} ${bc[0]} ${bc[1]})`} fill="#fff" stroke={stroke} strokeWidth={sw} />
      {interactive && <PickCircles kind="toilet" cx={h[0]} cy={h[1]} selected={sel} crowded={crowded} onSelect={onSelect} onDragStart={onDragStart} />}
    </g>
  );
}

function BathArt({ m, sel, onSelect, onDragStart, interactive = true, bodySelectable = false, crowded = false, t }: { m: Model; sel: boolean; onSelect: () => void; onDragStart: (e: React.PointerEvent, k: Kind) => void; interactive?: boolean; bodySelectable?: boolean; crowded?: boolean; t: Tr }) {
  const bath = m.bath!; const e = m.surfaces[bath.edge]; if (!e) return null;
  const v = edgeVec(e), sku = bathDims(bath);
  const mid: Pt = [e.a[0] + v.ux * v.L * bath.t, e.a[1] + v.uy * v.L * bath.t];
  const { nx, ny } = surfNormal(e, mid, m.cen);
  const pt = (a: number, i2: number) => m.P(mid[0] + v.ux * a + nx * i2, mid[1] + v.uy * a + ny * i2);
  const hw = sku.w / 2, dp = sku.d;
  const q1 = pt(-hw, 0), q2 = pt(hw, 0), q3 = pt(hw, dp), q4 = pt(-hw, dp);
  const warn = bath.overhang || !!bath.sizeConflict || !!bath.conflict;
  const stroke = warn ? AMBER : (sel ? ACCENT : INK), sw = warn ? 2 : (sel ? 2 : 1.5);
  const bodyEvt = bodySelectable ? { onClick: (ev: React.MouseEvent) => { ev.stopPropagation(); onSelect(); }, style: { cursor: "pointer" as const } } : { pointerEvents: "none" as const };
  const parts: React.ReactNode[] = [];
  parts.push(<polygon key="box" {...bodyEvt} points={`${q1.join(",")} ${q2.join(",")} ${q3.join(",")} ${q4.join(",")}`} fill="#fff" stroke={stroke} strokeWidth={sw} />);
  if (bath.kind === "shower") {
    parts.push(<line key="x1" x1={q1[0]} y1={q1[1]} x2={q3[0]} y2={q3[1]} stroke={stroke} strokeWidth={1} pointerEvents="none" />);
    parts.push(<line key="x2" x1={q2[0]} y1={q2[1]} x2={q4[0]} y2={q4[1]} stroke={stroke} strokeWidth={1} pointerEvents="none" />);
  } else {
    const inr = 6, r1 = pt(-hw + inr, inr), r2 = pt(hw - inr, inr), r3 = pt(hw - inr, dp - inr), r4 = pt(-hw + inr, dp - inr);
    parts.push(<polygon key="inner" pointerEvents="none" points={`${r1.join(",")} ${r2.join(",")} ${r3.join(",")} ${r4.join(",")}`} fill="none" stroke={stroke} strokeWidth={1} opacity={0.8} />);
    const dr = pt(-hw + 7, dp / 2);
    parts.push(<circle key="drain" cx={dr[0]} cy={dr[1]} r={3} fill="none" stroke={stroke} strokeWidth={1} pointerEvents="none" />);
  }
  if (bath.snapped) { const cc = bath.snapped === "a" ? q1 : q2; parts.push(<circle key="snap" cx={cc[0]} cy={cc[1]} r={6} fill="none" stroke={ACCENT} strokeWidth={2} pointerEvents="none" />); }
  if (bath.sizeConflict) {
    const req = (bath.kind === "tub" ? TUBS : BASES).find((x) => x.id === bath.sizeConflict!.requested);
    const label = req ? `${req.w}×${req.d} ${t("configurator.room.doesntFitHere")}` : t("configurator.room.selectedDoesntFit");
    const wp = pt(0, dp + 9);
    parts.push(<rect key="wr" pointerEvents="none" x={wp[0] - 88} y={wp[1] - 10} width={176} height={20} rx={10} fill="#f6e8cf" stroke={AMBER} />);
    parts.push(<text key="wt" x={wp[0]} y={wp[1]} textAnchor="middle" dominantBaseline="middle" fontFamily="monospace" fontSize={10} fill={AMBER} pointerEvents="none">{label}</text>);
  } else if (bath.overhang) {
    const wp = pt(0, dp + 9);
    parts.push(<rect key="wr" pointerEvents="none" x={wp[0] - 78} y={wp[1] - 10} width={156} height={20} rx={10} fill="#f6e8cf" stroke={AMBER} />);
    parts.push(<text key="wt" x={wp[0]} y={wp[1]} textAnchor="middle" dominantBaseline="middle" fontFamily="monospace" fontSize={10} fill={AMBER} pointerEvents="none">{t("configurator.room.doesntFitThisWall")}</text>);
  }
  const h = pt(0, dp / 2);
  return <g>{parts}{interactive && <PickCircles kind="bath" cx={h[0]} cy={h[1]} selected={sel} crowded={crowded} onSelect={onSelect} onDragStart={onDragStart} />}</g>;
}

function VanityArt({ m, sel, onSelect, onDragStart, interactive = true, bodySelectable = false, crowded = false, t }: { m: Model; sel: boolean; onSelect: () => void; onDragStart: (e: React.PointerEvent, k: Kind) => void; interactive?: boolean; bodySelectable?: boolean; crowded?: boolean; t: Tr }) {
  const vanity = m.vanity!; const e = m.surfaces[vanity.edge]; if (!e) return null;
  const v = edgeVec(e);
  const mid: Pt = [e.a[0] + v.ux * v.L * vanity.t, e.a[1] + v.uy * v.L * vanity.t];
  const { nx, ny } = surfNormal(e, mid, m.cen);
  const pt = (a: number, i2: number) => m.P(mid[0] + v.ux * a + nx * i2, mid[1] + v.uy * a + ny * i2);
  const hw = vanity.w / 2, dp = VANITY_D;
  const q1 = pt(-hw, 0), q2 = pt(hw, 0), q3 = pt(hw, dp), q4 = pt(-hw, dp);
  const warn = vanity.overhang || !!vanity.conflict;
  const stroke = warn ? AMBER : (sel ? ACCENT : INK), sw = warn ? 2 : (sel ? 2 : 1.5);
  const bodyEvt = bodySelectable ? { onClick: (ev: React.MouseEvent) => { ev.stopPropagation(); onSelect(); }, style: { cursor: "pointer" as const } } : { pointerEvents: "none" as const };
  const e2 = m.P(mid[0] + v.ux, mid[1] + v.uy), e0 = m.P(mid[0], mid[1]);
  const ang = Math.atan2(e2[1] - e0[1], e2[0] - e0[0]) * 180 / Math.PI;
  const n = vanity.sinks || 1;
  const parts: React.ReactNode[] = [];
  parts.push(<polygon key="box" {...bodyEvt} points={`${q1.join(",")} ${q2.join(",")} ${q3.join(",")} ${q4.join(",")}`} fill="#fff" stroke={stroke} strokeWidth={sw} />);
  const rectSink = (vanity.sinkShape ?? "oval") === "rectangle";
  for (let k = 0; k < n; k++) {
    const off = n === 1 ? 0 : (k === 0 ? -vanity.w * 0.24 : vanity.w * 0.24);
    const bc = pt(off, dp * 0.55);
    const rx = Math.hypot(pt(off + (n === 1 ? 9 : 7), dp * 0.55)[0] - bc[0], pt(off + (n === 1 ? 9 : 7), dp * 0.55)[1] - bc[1]);
    const ry = Math.hypot(pt(off, dp * 0.55 + 6)[0] - bc[0], pt(off, dp * 0.55 + 6)[1] - bc[1]);
    // Same shape logic as VanityPreview so the plan and the preview agree.
    parts.push(rectSink
      ? <rect key={`b${k}`} pointerEvents="none" x={bc[0] - rx} y={bc[1] - ry} width={rx * 2} height={ry * 2} rx={2} transform={`rotate(${ang} ${bc[0]} ${bc[1]})`} fill="none" stroke={stroke} strokeWidth={1} />
      : <ellipse key={`b${k}`} pointerEvents="none" cx={bc[0]} cy={bc[1]} rx={rx} ry={ry} transform={`rotate(${ang} ${bc[0]} ${bc[1]})`} fill="none" stroke={stroke} strokeWidth={1} />);
  }
  if (vanity.overhang) {
    const wp = pt(0, dp + 9);
    parts.push(<rect key="wr" pointerEvents="none" x={wp[0] - 70} y={wp[1] - 10} width={140} height={20} rx={10} fill="#f6e8cf" stroke={AMBER} />);
    parts.push(<text key="wt" x={wp[0]} y={wp[1]} textAnchor="middle" dominantBaseline="middle" fontFamily="monospace" fontSize={10} fill={AMBER} pointerEvents="none">{t("configurator.room.doesntFitHere")}</text>);
  }
  const h = pt(0, dp / 2);
  return <g>{parts}{interactive && <PickCircles kind="vanity" cx={h[0]} cy={h[1]} selected={sel} crowded={crowded} onSelect={onSelect} onDragStart={onDragStart} />}</g>;
}

const IN_CLS = "w-11 rounded-md border border-line bg-card px-1 py-1 text-center font-mono text-xs";
const BTN = "font-display text-xs font-semibold border border-line bg-card text-ink rounded-lg px-2.5 py-1.5 text-center transition hover:bg-ink/5 disabled:opacity-35 disabled:cursor-not-allowed";
const BTN_ACTIVE = "border-accent bg-accent-soft text-accent";

type EditTarget = { type: "dim"; d: "w" | "d" } | { type: "seg"; p: string; len: number };
type EditorState = { left: number; top: number; value: string; target: EditTarget } | null;

export function RoomConfigurator({ mode = "dealer", onComplete, onChange, initialBath = null, initialVanity = null, initialTreatments = null, initialFlooring = null, initialWallBase = null, initialPartitions = null, primaryLabel }: {
  mode?: "dealer" | "customer";
  onComplete?: (config: RoomConfig) => void;
  onChange?: (config: RoomConfig) => void;
  initialBath?: { kind: "shower" | "tub"; baseId: string } | null;
  initialVanity?: { size: number; sinks: 1 | 2; sinkShape?: "oval" | "rectangle" } | null;
  // Per-wall treatments to restore on mount (from a saved quote). Keyed by side identity;
  // sides that no longer exist after a shape edit are simply ignored by resolveModel.
  initialTreatments?: WallTreatments | null;
  // Flooring selection to restore on mount (from a saved quote), same round-trip pattern.
  initialFlooring?: RoomFlooring | null;
  // Wall base selection to restore on mount (from a saved quote), same round-trip pattern.
  initialWallBase?: RoomWallBase | null;
  // Interior partitions to restore on mount (from a saved quote), same round-trip pattern.
  initialPartitions?: RoomPartition[] | null;
  primaryLabel?: string;
}) {
  const { t } = useLanguage();
  // Seed once at mount so a restored quote reopens with its wall finishes / flooring / wall
  // base / partitions; later edits are the user's, so the props are NOT live-synced after.
  const [doc, setDoc] = useState<Doc>(() => {
    let d = initialDoc;
    if (initialTreatments && Object.keys(initialTreatments).length) d = { ...d, treatments: { ...initialTreatments } };
    if (initialFlooring) d = { ...d, flooring: { ...initialFlooring } };
    if (initialWallBase) d = { ...d, wallBase: { ...initialWallBase } };
    if (initialPartitions && initialPartitions.length) d = { ...d, partitions: initialPartitions.map((p) => ({ ...p })) };
    return d;
  });
  const [sel, setSel] = useState<Kind | null>(null);
  const [selPart, setSelPart] = useState<string | null>(null);
  const [armed, setArmed] = useState<Kind | null>(null);
  const [armPartition, setArmPartition] = useState(false);
  const [partAnchor, setPartAnchor] = useState<{ side: string; offsetIn: number } | null>(null);
  const [partHover, setPartHover] = useState<Pt | null>(null);
  const [ada, setAda] = useState(false);
  const [showClear, setShowClear] = useState(true);
  const [shapeNote, setShapeNote] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);

  const historyRef = useRef<string[]>([]);
  const docRef = useRef(doc); docRef.current = doc;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const model = useMemo(() => resolveModel(doc, ada, t), [doc, ada, t]);
  const modelRef = useRef(model); modelRef.current = model;

  // effective selection: only if the selected fixture / partition still exists
  const effSel: Kind | null = sel && model[sel] ? sel : null;
  const effSelPart: string | null = selPart && model.partitions.some((p) => p.id === selPart) ? selPart : null;

  // ---- mutation helpers ----
  const commit = useCallback((updater: (prev: Doc) => Doc) => {
    setDoc((prev) => { historyRef.current.push(JSON.stringify(prev)); if (historyRef.current.length > 60) historyRef.current.shift(); return updater(prev); });
  }, []);
  const patchFix = useCallback((kind: Kind, patch: Record<string, unknown>, withHistory: boolean) => {
    setDoc((prev) => {
      if (!prev[kind]) return prev;
      if (withHistory) { historyRef.current.push(JSON.stringify(prev)); if (historyRef.current.length > 60) historyRef.current.shift(); }
      return { ...prev, [kind]: { ...(prev[kind] as object), ...patch } };
    });
  }, []);
  const undo = useCallback(() => { const h = historyRef.current; if (!h.length) return; const prevStr = h.pop()!; setDoc(JSON.parse(prevStr)); }, []);
  const editS = useCallback((mut: (S: RoomDims, shape: Shape) => RoomDims) => { commit((prev) => ({ ...prev, S: clampShapeObj(prev.shape, mut(prev.S, prev.shape)) })); }, [commit]);

  // ---- toolbar ----
  const arm = (k: Kind) => { setArmed((a) => (a === k ? null : k)); setArmPartition(false); setPartAnchor(null); };
  const armPartitionToggle = () => { setArmPartition((v) => !v); setArmed(null); setPartAnchor(null); setPartHover(null); };
  function resetAll() {
    if (!(typeof window === "undefined") && !window.confirm(t("configurator.room.confirmReset"))) return;
    historyRef.current = []; setDoc(initialDoc); setSel(null); setSelPart(null); setArmed(null); setArmPartition(false); setPartAnchor(null); setPartHover(null); setAda(false); setShowClear(true); setShapeNote(false);
  }

  // ---- room ----
  function setShape(s: Shape) {
    if (s === doc.shape) return;
    const had = !!(doc.door || doc.toilet || doc.bath || doc.vanity);
    if (had && !window.confirm(t("configurator.room.confirmShape"))) return;
    commit((prev) => ({ ...prev, shape: s, door: null, toilet: null, bath: null, vanity: null, excluded: [], partitions: [] }));
    setSel(null); setSelPart(null); setArmed(null); setArmPartition(false); setPartAnchor(null);
    setShapeNote(had);
  }
  const setCorner = (c: Corner) => commit((prev) => ({ ...prev, S: { ...prev.S, corner: c } }));
  const toggleEx = (i: number, billable: boolean) => commit((prev) => ({ ...prev, excluded: billable ? prev.excluded.filter((x) => x !== i) : [...prev.excluded, i] }));

  // ---- wall treatments ---- (keyed by side identity; bathing-area walls not assignable)
  const setTreatment = (side: string, tr: WallTreatment) => commit((prev) => ({ ...prev, treatments: { ...prev.treatments, [side]: tr } }));
  const setAllPanels = (tr: WallTreatment) => commit((prev) => {
    const m = modelRef.current, next = { ...prev.treatments };
    m.edges.forEach((e, i) => { if (m.ded[i] === 0) next[e.side] = tr; }); // only assignable walls
    return { ...prev, treatments: next };
  });

  // ---- flooring ---- color picks default to 10% waste; waste is only meaningful once a color is chosen
  const setFlooringColor = (colorId: string) => commit((prev) => ({ ...prev, flooring: { colorId, wastePct: prev.flooring?.wastePct ?? 10 } }));
  const setFlooringWaste = (wastePct: number) => commit((prev) => (prev.flooring ? { ...prev, flooring: { ...prev.flooring, wastePct } } : prev));
  const clearFlooring = () => commit((prev) => (prev.flooring ? { ...prev, flooring: undefined } : prev));

  // ---- wall base ---- color pick defaults to 4" @ 10% waste; height/waste apply once chosen
  const setWallBaseColor = (colorId: string) => commit((prev) => ({ ...prev, wallBase: { heightIn: prev.wallBase?.heightIn ?? 4, colorId, wastePct: prev.wallBase?.wastePct ?? 10 } }));
  const setWallBaseHeight = (heightIn: 4 | 6) => commit((prev) => (prev.wallBase ? { ...prev, wallBase: { ...prev.wallBase, heightIn } } : prev));
  const setWallBaseWaste = (wastePct: number) => commit((prev) => (prev.wallBase ? { ...prev, wallBase: { ...prev.wallBase, wastePct } } : prev));
  const clearWallBase = () => commit((prev) => (prev.wallBase ? { ...prev, wallBase: undefined } : prev));

  // ---- contextual fixture edits ----
  const setDoorProp = (k: string, v: unknown) => patchFix("door", { [k]: v }, true);
  const setToiletRough = (r: number) => patchFix("toilet", { rough: r }, true);
  const setBathSku = (id: string) => patchFix("bath", { sku: id }, true);
  function setBathKind(k: "shower" | "tub") {
    const b = doc.bath; if (!b) return;
    const prev = bathSku(b); const list = k === "tub" ? TUBS : BASES;
    const same = list.find((x) => x.id === prev.id) || list.reduce((bb, x) => (Math.abs(x.w - prev.w) < Math.abs(bb.w - prev.w) ? x : bb), list[0]);
    patchFix("bath", { kind: k, sku: same.id }, true);
  }
  function setVanityProp(k: "w" | "sinks", v: number) {
    const van = doc.vanity; if (!van) return;
    const patch: Record<string, unknown> = { [k]: v };
    if (k === "w" && (van.sinks || 1) > maxSinks(v)) patch.sinks = 1;
    patchFix("vanity", patch, true);
  }
  function del(k: Kind) { commit((prev) => ({ ...prev, [k]: null })); setSel(null); }

  // ---- placement ---- `i` indexes into surfaces (a perimeter wall OR a partition face), so
  // a fixture mounts to either by the same offset-along-surface model.
  function placeOnWall(i: number) {
    const m = modelRef.current; const { verts, surfaces, cen } = m; const surf = surfaces[i]; if (!surf) return; const L = edgeVec(surf).L;
    if (armed === "door") {
      const allow = DOOR_SIZES.filter((w) => roOf(w) <= L); if (!allow.length) return;
      const pref = ada ? 36 : 30; const w = allow.includes(pref) ? pref : Math.max(...allow);
      commit((prev) => ({ ...prev, door: { edge: i, side: surf.side, t: 0.5, w, type: "opening", swing: "in-r" } })); setSel("door");
    } else if (armed === "toilet") {
      // Land in clear space on this surface (freeFit approach for a fixed-size fixture).
      const t = placeClear(verts, surfaces, i, TOILET_W, TOILET_D, cen, "toilet", m.fx);
      commit((prev) => ({ ...prev, toilet: { edge: i, side: surf.side, t, rough: 12 } })); setSel("toilet");
    } else if (armed === "vanity") {
      const f = freeFit(verts, surfaces, i, VANITY_SIZES, VANITY_D, cen, "vanity", m.fx); if (!f) return;
      commit((prev) => ({ ...prev, vanity: { edge: i, side: surf.side, t: f.t, w: f.w, sinks: maxSinks(f.w) } })); setSel("vanity");
    } else if (armed === "bath") {
      // Choose a base that fits this surface (prefer 60x32), then land it in clear space.
      const pref = BASES.find((x) => x.id === "60x32"); let sku: Sku | undefined;
      if (pref && pref.w <= L && [pref.w / 2 / L, 1 - pref.w / 2 / L, 0.5].some((t) => fits(verts, surf, t, pref.w, pref.d, cen))) sku = pref;
      if (!sku) { const bf = bestFit(verts, surf, BASES, cen); if (bf) sku = bf.sku; }
      if (!sku) return;
      const t = placeClear(verts, surfaces, i, sku.w, sku.d, cen, "bath", m.fx);
      commit((prev) => ({ ...prev, bath: { edge: i, side: surf.side, t, kind: "shower", sku: sku!.id, rot: false, snapped: null } })); setSel("bath");
    }
    if (shapeNote) setShapeNote(false);
    setArmed(null);
  }

  // ---- partition placement (click 1 anchors to the nearest wall, click 2 sets the length,
  //      projecting perpendicular into the room; whole-inch, clamped to stay inside) ----
  const genPartId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "part-" + Math.random().toString(36).slice(2));
  function onPlanPoint(rx: number, ry: number) {
    if (!armPartition) return;
    const m = modelRef.current;
    if (!partAnchor) {
      const a = nearestWallAnchor([rx, ry], m.edges); // snap the anchored end to a wall
      if (a) setPartAnchor(a);
    } else {
      const f = anchorFrame(partAnchor, m.edges, m.cen); if (!f) { setPartAnchor(null); return; }
      const want = Math.round((rx - f.pt[0]) * f.nx + (ry - f.pt[1]) * f.ny); // perpendicular length
      const np: RoomPartition = { id: genPartId(), side: partAnchor.side, offsetIn: partAnchor.offsetIn, lengthIn: Math.max(1, want), thicknessIn: 4.5, heightIn: m.S.h };
      const fitted = clampInsideLen(np, m.edges, m.verts, m.cen); // reject/clamp so it stays inside
      if (fitted < 1) return;
      np.lengthIn = fitted;
      commit((prev) => ({ ...prev, partitions: [...prev.partitions, np] }));
      setPartAnchor(null); setPartHover(null); setArmPartition(false);
      setSel(null); setSelPart(np.id);
    }
  }
  const onPlanHover = (rx: number, ry: number) => { if (armPartition && partAnchor) setPartHover([rx, ry]); };

  // Room coords of a pointer event, given the current model's transform.
  const evToRoom = (ev: PointerEvent, svg: SVGSVGElement): Pt => {
    const rr = svg.getBoundingClientRect(), m = modelRef.current;
    const ux = (ev.clientX - rr.left) * (W / rr.width), uy = (ev.clientY - rr.top) * (H / rr.height);
    return [(ux - m.ox) / m.s, (uy - m.oy) / m.s];
  };
  // ---- partition slide (drag the body: move the anchor ALONG its wall; whole-inch, stays inside) ----
  const startPartSlide = useCallback((e: React.PointerEvent, id: string) => {
    e.preventDefault(); e.stopPropagation(); setSel(null); setSelPart(id);
    historyRef.current.push(JSON.stringify(docRef.current)); if (historyRef.current.length > 60) historyRef.current.shift();
    const svg = svgRef.current; if (!svg) return;
    const p0 = docRef.current.partitions.find((p) => p.id === id); if (!p0) return;
    const move = (ev: PointerEvent) => {
      ev.preventDefault();
      const m = modelRef.current;
      const eIdx = m.edges.findIndex((ed) => ed.side === p0.side); if (eIdx < 0) return;
      const e2 = m.edges[eIdx], v = edgeVec(e2);
      const [rx, ry] = evToRoom(ev, svg);
      let off = Math.round((rx - e2.a[0]) * v.ux + (ry - e2.a[1]) * v.uy);
      off = Math.max(0, Math.min(Math.round(v.L), off));
      const cand: RoomPartition = { ...p0, offsetIn: off };
      if (!partInside(cand, m.edges, m.verts, m.cen)) return; // freeze where it would leave the room
      setDoc((prev) => ({ ...prev, partitions: prev.partitions.map((pp) => (pp.id === id ? { ...pp, offsetIn: off } : pp)) }));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }, []);
  // ---- partition resize (drag the free end: change lengthIn; whole-inch, clamped inside) ----
  const startPartResize = useCallback((e: React.PointerEvent, id: string) => {
    e.preventDefault(); e.stopPropagation(); setSel(null); setSelPart(id);
    historyRef.current.push(JSON.stringify(docRef.current)); if (historyRef.current.length > 60) historyRef.current.shift();
    const svg = svgRef.current; if (!svg) return;
    const p0 = docRef.current.partitions.find((p) => p.id === id); if (!p0) return;
    const move = (ev: PointerEvent) => {
      ev.preventDefault();
      const m = modelRef.current;
      const f = anchorFrame({ side: p0.side, offsetIn: p0.offsetIn }, m.edges, m.cen); if (!f) return;
      const [rx, ry] = evToRoom(ev, svg);
      const want = Math.max(1, Math.round((rx - f.pt[0]) * f.nx + (ry - f.pt[1]) * f.ny));
      const fitted = clampInsideLen({ ...p0, lengthIn: want }, m.edges, m.verts, m.cen);
      if (fitted < 1) return;
      setDoc((prev) => ({ ...prev, partitions: prev.partitions.map((pp) => (pp.id === id ? { ...pp, lengthIn: fitted } : pp)) }));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }, []);

  // ---- partition property edits ----
  const patchPart = (id: string, patch: Partial<RoomPartition>) => commit((prev) => ({ ...prev, partitions: prev.partitions.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const setPartThickness = (id: string, thicknessIn: number) => patchPart(id, { thicknessIn: Math.max(0.5, thicknessIn) });
  const setPartHeight = (id: string, heightIn: number) => patchPart(id, { heightIn: Math.max(1, Math.round(heightIn)) });
  function setPartLength(id: string, newLen: number) {
    const m = modelRef.current, p = m.partitions.find((x) => x.id === id); if (!p) return;
    // Clamp to the largest whole-inch length that keeps the free end inside the room.
    const fitted = clampInsideLen({ ...p, lengthIn: Math.max(1, Math.round(newLen)) }, m.edges, m.verts, m.cen);
    if (fitted >= 1) patchPart(id, { lengthIn: fitted });
  }
  const delPart = (id: string) => { commit((prev) => ({ ...prev, partitions: prev.partitions.filter((p) => p.id !== id) })); setSelPart(null); };

  // ---- drag ----
  const startDrag = useCallback((e: React.PointerEvent, kind: Kind) => {
    e.preventDefault(); e.stopPropagation(); setSel(kind);
    historyRef.current.push(JSON.stringify(docRef.current)); if (historyRef.current.length > 60) historyRef.current.shift();
    const svg = svgRef.current; if (!svg) return;
    const move = (ev: PointerEvent) => {
      ev.preventDefault();
      const rr = svg.getBoundingClientRect();
      const ux = (ev.clientX - rr.left) * (W / rr.width), uy = (ev.clientY - rr.top) * (H / rr.height);
      const m = modelRef.current; const rf = m[kind]; if (!rf) return;
      const edge = m.surfaces[rf.edge]; if (!edge) return;
      const v = edgeVec(edge);
      const rx = (ux - m.ox) / m.s, ry = (uy - m.oy) / m.s;
      const t = ((rx - edge.a[0]) * v.ux + (ry - edge.a[1]) * v.uy) / v.L;
      const wf = kind === "door" ? roOf((rf as RoomDoor).w) : kind === "toilet" ? TOILET_W : kind === "vanity" ? (rf as RoomVanity).w : bathDims(rf as RoomBath).w;
      const half = wf / 2 / v.L;
      let tt = half >= 0.5 ? 0.5 : Math.max(half, Math.min(1 - half, t));
      const inches = Math.round(tt * v.L); tt = Math.max(half, Math.min(1 - half, inches / v.L));
      const finalT = half >= 0.5 ? 0.5 : tt;
      setDoc((prev) => (prev[kind] ? { ...prev, [kind]: { ...(prev[kind] as object), t: finalT } } : prev));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }, []);

  // ---- keyboard: undo / escape / nudge ----
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // Ignore global shortcuts while the plan is hidden (mounted but inactive in the hub).
      if (containerRef.current && containerRef.current.offsetParent === null) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); undo(); return; }
      if (ev.key === "Escape") {
        if (partAnchor) { setPartAnchor(null); setPartHover(null); return; } // cancel in-progress partition
        setArmed(null); setArmPartition(false); setSel(null); setSelPart(null); return;
      }
      const tag = (ev.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (!sel) return;
      const m = modelRef.current; const rf = m[sel]; if (!rf) return;
      const step = ev.shiftKey ? 6 : 1; let dir = 0;
      if (ev.key === "ArrowRight" || ev.key === "ArrowDown") dir = 1;
      if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") dir = -1;
      if (!dir) return; ev.preventDefault();
      const edge = m.surfaces[rf.edge]; if (!edge) return;
      patchFix(sel, { t: rf.t + (dir * step) / edgeVec(edge).L }, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, undo, patchFix, partAnchor]);

  // ---- inline dimension editor ----
  function openEditor(vbX: number, vbY: number, value: string, target: EditTarget) {
    const svg = svgRef.current, cont = containerRef.current; if (!svg || !cont) return;
    const r = svg.getBoundingClientRect(), cr = cont.getBoundingClientRect();
    const left = (r.left - cr.left) + vbX * (r.width / W), top = (r.top - cr.top) + vbY * (r.height / H);
    setEditor({ left, top, value, target });
  }
  function commitEditor() {
    setEditor((cur) => {
      if (!cur) return null;
      const v = parseLen(cur.value);
      if (v != null) {
        const tgt = cur.target;
        if (tgt.type === "dim") editS((S) => ({ ...S, [tgt.d]: Math.max(12, v) }));
        else {
          const p = tgt.p as "w" | "d" | "cw" | "cd";
          editS((S) => ({ ...S, [p]: (p === "w" || p === "d") ? Math.max(12, S[p] + (v - tgt.len)) : Math.max(6, S[p] + (v - tgt.len)) }));
        }
      }
      return null;
    });
  }

  // ---- add to quote ----
  const buildConfig = useCallback((): RoomConfig => {
    // Price: flooring by whole cartons, wall base by whole 8-ft sticks — coverage purchased,
    // not raw area/length.
    const lines: PriceLine[] = [];
    if (model.flooring) {
      const color = FLOORING_COLORS.find((c) => c.id === model.flooring!.colorId);
      lines.push({
        key: model.flooringCartons === 1 ? "configurator.room.priceLine.flooringOne" : "configurator.room.priceLine.flooringMany",
        params: { product: `${FLOORING_LINE.brand} ${FLOORING_LINE.name}`, color: color?.name ?? "—", n: String(model.flooringCartons), sf: model.flooringCoverageSF.toFixed(1) },
        amount: model.flooringCost,
      });
    }
    if (model.wallBase) {
      const color = WALL_BASE_COLORS.find((c) => c.id === model.wallBase!.colorId);
      lines.push({
        key: model.wallBaseSticks === 1 ? "configurator.room.priceLine.wallBaseOne" : "configurator.room.priceLine.wallBaseMany",
        params: { height: String(model.wallBase.heightIn), color: color?.name ?? "—", n: String(model.wallBaseSticks), lf: model.wallBaseCoverageLF.toFixed(1) },
        amount: model.wallBaseCost,
      });
    }
    return {
      // Emit treatments keyed by the CURRENT walls' side identity only (stale sides drop
      // out); "paint" is the default so it's omitted and simply restores as paint.
      selections: {
        shape: doc.shape, dims: model.S, door: model.door, toilet: model.toilet, bath: model.bath, vanity: model.vanity,
        treatments: Object.fromEntries(model.edges.map((e, i) => [e.side, model.treat[i]] as [string, WallTreatment]).filter(([, v]) => v !== "paint")),
        flooring: model.flooring,
        wallBase: model.wallBase,
        partitions: model.partitions,
      },
      metrics: { perimeterIn: model.perim, wallSF: model.wallSF, floorSF: model.floorSF, baseboardLF: model.bbLF, ceilingIn: model.S.h, panelCount: model.panelCount, panelledSF: model.panelledSF, flooringCartons: model.flooringCartons, flooringSF: model.flooringCoverageSF, wallBaseSticks: model.wallBaseSticks, wallBaseLF: model.wallBaseCoverageLF, partitionCount: model.partitionCount, partitionWallSF: model.partitionWallSF },
      clearanceIssues: model.CL.issues,
      price: { total: lines.reduce((a, l) => a + l.amount, 0), lines },
      isComplete: true,
      label: model.label,
    };
  }, [doc.shape, model]);
  function addToQuote() { onComplete?.(buildConfig()); }

  // Emit onChange on every committed change so the hub can keep a live copy of
  // the room (and derive the shared bath/vanity sizes) before "Add to quote".
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  useEffect(() => { onChangeRef.current?.(buildConfig()); }, [buildConfig]);

  // Live-sync sizes chosen elsewhere (shower/vanity) onto the already-placed
  // fixtures — non-destructively: only the size/sku changes, never the wall or
  // position. If the new size no longer fits, resolveModel's overhang warning
  // handles it (we never relocate or remove the fixture).
  useEffect(() => {
    if (!initialBath) return;
    const list = initialBath.kind === "tub" ? TUBS : BASES;
    if (!list.some((x) => x.id === initialBath.baseId)) return; // unknown sku — ignore silently
    setDoc((prev) => {
      if (!prev.bath) return prev; // nothing placed to apply to
      if (prev.bath.kind === initialBath.kind && prev.bath.sku === initialBath.baseId) return prev;
      return { ...prev, bath: { ...prev.bath, kind: initialBath.kind, sku: initialBath.baseId } };
    });
  }, [initialBath?.kind, initialBath?.baseId]);
  useEffect(() => {
    if (!initialVanity) return;
    const size = initialVanity.size;
    const sinks = initialVanity.sinks === 2 && size >= 48 ? 2 : 1;
    const sinkShape = initialVanity.sinkShape ?? "oval";
    setDoc((prev) => {
      if (!prev.vanity) return prev;
      if (prev.vanity.w === size && (prev.vanity.sinks || 1) === sinks && (prev.vanity.sinkShape ?? "oval") === sinkShape) return prev;
      return { ...prev, vanity: { ...prev.vanity, w: size, sinks, sinkShape } };
    });
  }, [initialVanity?.size, initialVanity?.sinks, initialVanity?.sinkShape]);

  // ---- derived UI ----
  const anyFix = !!(model.door || model.toilet || model.bath || model.vanity);
  const moved = ([["door", model.door], ["toilet", model.toilet], ["bath", model.bath], ["vanity", model.vanity]] as [string, { orphaned?: boolean } | null][]).filter(([, o]) => o && o.orphaned).map(([n]) => n);
  const armHint = (() => {
    if (armPartition) return partAnchor ? t("configurator.room.hintPartEnd") : t("configurator.room.hintPartStart");
    if (armed === "bath") { const any = model.edges.some((e) => bestFit(model.verts, e, BASES, model.cen)); return any ? t("configurator.room.hintBath") : t("configurator.room.hintBathNone"); }
    return armed ? t("configurator.room.hintPlace", { item: t(armed === "door" ? "configurator.room.fixtureDoor" : armed === "vanity" ? "configurator.room.fixtureVanity" : "configurator.room.fixtureToilet") }) : "";
  })();

  // In-progress partition placement: the resolved anchor dot on the wall, and a perpendicular
  // rubber-band preview to the cursor (length = perpendicular distance, ≥1").
  const partAnchorPt = useMemo(() => (partAnchor ? anchorFrame(partAnchor, model.edges, model.cen)?.pt ?? null : null), [partAnchor, model.edges, model.cen]);
  const partPreview = useMemo(() => {
    if (!partAnchor || !partHover) return null;
    const f = anchorFrame(partAnchor, model.edges, model.cen); if (!f) return null;
    const len = Math.max(1, Math.round((partHover[0] - f.pt[0]) * f.nx + (partHover[1] - f.pt[1]) * f.ny));
    return partGeom({ id: "prev", side: partAnchor.side, offsetIn: partAnchor.offsetIn, lengthIn: len, thicknessIn: 4.5, heightIn: 0 }, model.edges, model.cen);
  }, [partAnchor, partHover, model.edges, model.cen]);

  const S = model.S;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_330px]">
      {/* ---------------- Plan (left) ---------------- */}
      <div ref={containerRef} className="relative rounded-2xl border border-line bg-card p-4">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span className="mr-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.add")}</span>
          {([["door", "configurator.room.addDoor"], ["bath", "configurator.room.addBath"], ["toilet", "configurator.room.addToilet"], ["vanity", "configurator.room.addVanity"]] as [Kind, string][]).map(([k, label]) => (
            <button key={k} onClick={() => arm(k)} className={`${BTN} ${armed === k ? BTN_ACTIVE : ""}`}>{t(label)}</button>
          ))}
          <button onClick={armPartitionToggle} className={`${BTN} ${armPartition ? BTN_ACTIVE : ""}`}>{t("configurator.room.addPartition")}</button>
          <span className="min-w-[8px] flex-1" />
          {armHint && <span className="text-xs font-semibold text-accent">{armHint}</span>}
          <button onClick={undo} title="Undo (Ctrl+Z)" className={`${BTN} inline-flex items-center gap-1`}><Undo2 className="h-3.5 w-3.5" /> {t("configurator.room.undo")}</button>
          <button onClick={resetAll} className={`${BTN} inline-flex items-center gap-1`}><RotateCcw className="h-3.5 w-3.5" /> {t("configurator.room.reset")}</button>
        </div>

        <Plan svgRef={svgRef} model={model} armed={armed} showClear={showClear} sel={effSel}
          onBackground={() => { setSel(null); setSelPart(null); }} onPlace={placeOnWall}
          onSelect={(k) => { setSel(k); setSelPart(null); }} onDragStart={startDrag} onEdit={openEditor} S={S}
          selPart={effSelPart} onSelectPart={(id) => { setSelPart(id); setSel(null); }} onPartSlideStart={startPartSlide} onPartResizeStart={startPartResize}
          armPartition={armPartition} onPlanPoint={onPlanPoint} onPlanHover={onPlanHover}
          partAnchorPt={partAnchorPt} partPreview={partPreview} />

        {editor && (
          <input
            autoFocus
            value={editor.value}
            onChange={(e) => setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
            onKeyDown={(e) => { if (e.key === "Enter") commitEditor(); if (e.key === "Escape") setEditor(null); }}
            onBlur={commitEditor}
            onFocus={(e) => e.target.select()}
            style={{ position: "absolute", left: editor.left - 30, top: editor.top - 13, width: 60 }}
            className="z-50 rounded-md border border-accent bg-card px-1 py-0.5 text-center font-mono text-xs"
          />
        )}

        {/* metrics */}
        <div className="mt-3 flex flex-wrap items-center gap-5 border-t border-line pt-3">
          <Metric label={t("configurator.room.perimeter")} value={ftin(model.perim)} />
          <Metric label={t("configurator.room.wallSF")} value={`${model.wallSF.toFixed(1)} sf`} />
          <Metric label={t("configurator.room.floorSF")} value={`${model.floorSF.toFixed(1)} sf`} />
          <span className="flex-1" />
          <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            <input type="checkbox" checked={showClear} onChange={(e) => setShowClear(e.target.checked)} /> {t("configurator.room.clearances")}
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            <input type="checkbox" checked={ada} onChange={(e) => setAda(e.target.checked)} /> {t("configurator.room.adaMode")}
          </label>
        </div>

        {/* materials */}
        <div className="mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
          {model.flooring ? (
            <div className="rounded-[10px] border border-line p-2.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.flooring")}</div>
              <div className="text-[15px] font-bold">{t(model.flooringCartons === 1 ? "configurator.room.cartonsOne" : "configurator.room.cartonsMany", { n: String(model.flooringCartons) })}</div>
              <div className="text-[11px] text-muted">{FLOORING_LINE.brand} {FLOORING_LINE.name} · {FLOORING_COLORS.find((c) => c.id === model.flooring!.colorId)?.name ?? "—"}</div>
              <div className="text-[11px] text-muted">{t("configurator.room.coverageNote", { sf: `${model.flooringCoverageSF.toFixed(1)}`, pct: String(model.flooring.wastePct) })}</div>
            </div>
          ) : (
            <MatCard label={t("configurator.room.flooring")} big={`${model.floorSF.toFixed(1)} sf`} sub={t("configurator.room.wasteNote", { sf: `${(model.floorSF * 1.1).toFixed(1)} sf` })} />
          )}
          {model.wallBase ? (
            <div className="rounded-[10px] border border-line p-2.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.baseboard")}</div>
              <div className="text-[15px] font-bold">{t(model.wallBaseSticks === 1 ? "configurator.room.sticksOne" : "configurator.room.sticksMany", { n: String(model.wallBaseSticks) })}</div>
              <div className="text-[11px] text-muted">{model.wallBase.heightIn}&quot; · {WALL_BASE_COLORS.find((c) => c.id === model.wallBase!.colorId)?.name ?? "—"}</div>
              <div className="text-[11px] text-muted">{t("configurator.room.wbCoverageNote", { lf: `${model.wallBaseCoverageLF.toFixed(1)}`, pct: String(model.wallBase.wastePct) })}</div>
              <div className="text-[11px] text-muted">{t("configurator.room.baseboardSub")}</div>
            </div>
          ) : (
            <MatCard label={t("configurator.room.baseboard")} big={`${model.bbLF.toFixed(1)} lf`} sub={t("configurator.room.baseboardSub")} />
          )}
          <MatCard label={t("configurator.room.wallAreaBillable")} big={`${model.wallSF.toFixed(1)} sf`} sub={model.bath ? t("configurator.room.bathingExcluded", { sf: `${(model.wallSFgross - (model.wallSF - model.partitionWallSF)).toFixed(1)} sf` }) : t("configurator.room.noBathingArea")} />
          {model.panelWallCount > 0 && (
            <div className="rounded-[10px] border border-line p-2.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.wallPanels")}</div>
              <div className="text-[15px] font-bold">{t(model.panelCount === 1 ? "configurator.room.panelsOne" : "configurator.room.panelsMany", { n: String(model.panelCount) })}</div>
              <div className="text-[11px] text-muted">{model.panelledSF.toFixed(1)} sf · {t("configurator.room.panelSub", { w: String(WALL_PANEL.widthIn), h: String(WALL_PANEL.heightIn) })}</div>
            </div>
          )}
          {model.partitionCount > 0 && (
            <div className="rounded-[10px] border border-line p-2.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.partitions")}</div>
              <div className="text-[15px] font-bold">{t(model.partitionCount === 1 ? "configurator.room.partitionsOne" : "configurator.room.partitionsMany", { n: String(model.partitionCount) })}</div>
              <div className="text-[11px] text-muted">{t("configurator.room.partitionWallNote", { sf: model.partitionWallSF.toFixed(1) })}</div>
            </div>
          )}
        </div>
        {model.panelWallCount > 0 && model.panelHeightExceeded && (
          <div className="mt-2.5 rounded-[10px] border p-3" style={{ borderColor: AMBER, background: "#f6e8cf" }}>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: AMBER }}>⚠ {t("configurator.room.panelHeightTitle")}</div>
            <div className="text-xs leading-relaxed" style={{ color: "#7a4d0f" }}>{t("configurator.room.panelHeightWarn", { ceil: ftin(model.S.h), ph: String(WALL_PANEL.heightIn) })}</div>
          </div>
        )}

        {/* clearance / warning box */}
        <ClearanceBox shapeNote={shapeNote} anyFix={anyFix} moved={moved} CL={model.CL} hasFixtures={activeFixtures(model.surfaces, model.fx).length > 0} />

        <p className="mt-2 text-xs text-muted">{t("configurator.room.clickToEdit")}</p>

        {/* add to quote */}
        <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{mode === "dealer" ? t("configurator.room.roomHdr") : t("configurator.room.yourSpace")}</div>
            <div className="truncate text-sm font-semibold">{model.label}</div>
          </div>
          <button onClick={addToQuote} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">{primaryLabel ?? t("configurator.addToQuote")}</button>
        </div>
      </div>

      {/* ---------------- Properties (right) ---------------- */}
      <div className="rounded-2xl border border-line bg-card p-4">
        {/* Room (always visible) */}
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.roomHdr")}</div>
        <div className="mt-1.5 flex gap-1.5">
          <button onClick={() => setShape("rect")} className={`${BTN} flex-1 ${doc.shape === "rect" ? BTN_ACTIVE : ""}`}>{t("configurator.room.rectangle")}</button>
          <button onClick={() => setShape("L")} className={`${BTN} flex-1 ${doc.shape === "L" ? BTN_ACTIVE : ""}`}>{t("configurator.room.lshape")}</button>
        </div>
        {doc.shape === "L" && (
          <div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.cutoutCorner")}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {([["tl", "configurator.room.cornerTL"], ["tr", "configurator.room.cornerTR"], ["bl", "configurator.room.cornerBL"], ["br", "configurator.room.cornerBR"]] as [Corner, string][]).map(([k, ck]) => (
                <button key={k} onClick={() => setCorner(k)} className={`${BTN} flex-1 ${S.corner === k ? BTN_ACTIVE : ""}`}>{t(ck)}</button>
              ))}
            </div>
          </div>
        )}
        <Field label={t("configurator.room.width")}><FtIn valueIn={S.w} onChange={(v) => editS((s) => ({ ...s, w: v }))} /></Field>
        <Field label={t("configurator.room.depth")}><FtIn valueIn={S.d} onChange={(v) => editS((s) => ({ ...s, d: v }))} /></Field>
        {doc.shape === "L" && <Field label={t("configurator.room.cutoutWidth")}><FtIn valueIn={S.cw} onChange={(v) => editS((s) => ({ ...s, cw: v }))} /></Field>}
        {doc.shape === "L" && <Field label={t("configurator.room.cutoutDepth")}><FtIn valueIn={S.cd} onChange={(v) => editS((s) => ({ ...s, cd: v }))} /></Field>}
        <Field label={t("configurator.room.ceilingHeight")}><FtIn valueIn={S.h} onChange={(v) => editS((s) => ({ ...s, h: v }))} /></Field>

        {/* Contextual — properties of the selected partition / fixture (or a hint) */}
        <div className="mt-3.5 border-t border-line pt-2.5">
          {effSelPart ? (
            <PartitionPanel
              key={effSelPart}
              partition={model.partitions.find((p) => p.id === effSelPart)!}
              ceilingIn={model.S.h}
              onThickness={(v) => setPartThickness(effSelPart, v)}
              onHeight={(v) => setPartHeight(effSelPart, v)}
              onLength={(v) => setPartLength(effSelPart, v)}
              onRemove={() => delPart(effSelPart)}
            />
          ) : (
            <ContextPanel
              model={model} sel={effSel}
              onDoor={setDoorProp} onToiletRough={setToiletRough} onBathKind={setBathKind} onBathSku={setBathSku}
              onVanity={setVanityProp} onDel={del}
            />
          )}
        </div>

        {/* Surfaces — always visible, independent of any fixture selection */}
        <div className="mt-3.5 border-t border-line pt-2.5">
          <Surfaces
            model={model} onToggleEx={toggleEx}
            onTreatment={setTreatment} onAllPanels={setAllPanels}
            onFlooringColor={setFlooringColor} onFlooringWaste={setFlooringWaste} onFlooringClear={clearFlooring}
            onWallBaseColor={setWallBaseColor} onWallBaseHeight={setWallBaseHeight} onWallBaseWaste={setWallBaseWaste} onWallBaseClear={clearWallBase}
          />
        </div>
      </div>
    </div>
  );
}

// Screen position of a fixture's drag handle, matching where each *Art component draws
// it (mid of the wall span + normal offset into the room). Used to detect when handles
// crowd each other so their hit-targets can shrink.
function handleCenterFor(m: Model, kind: Kind): Pt | null {
  const rf = m[kind]; if (!rf) return null;
  const e = m.surfaces[rf.edge]; if (!e) return null;
  const v = edgeVec(e);
  const mid: Pt = [e.a[0] + v.ux * v.L * rf.t, e.a[1] + v.uy * v.L * rf.t];
  const { nx, ny } = surfNormal(e, mid, m.cen);
  const i2 = kind === "door" ? 0 : kind === "toilet" ? 4 : kind === "bath" ? bathDims(m.bath!).d / 2 : VANITY_D / 2;
  return m.P(mid[0] + nx * i2, mid[1] + ny * i2);
}

// ============================== Plan render ===============================
function Plan({ svgRef, model, armed, showClear, sel, onBackground, onPlace, onSelect, onDragStart, onEdit, S, interactive = true, showDimensions = true, className,
  selPart = null, onSelectPart, onPartSlideStart, onPartResizeStart, armPartition = false, onPlanPoint, onPlanHover, partAnchorPt = null, partPreview = null }: {
  svgRef: React.RefObject<SVGSVGElement | null>; model: Model; armed: Kind | null; showClear: boolean; sel: Kind | null;
  onBackground?: () => void; onPlace?: (i: number) => void; onSelect?: (k: Kind) => void;
  onDragStart?: (e: React.PointerEvent, k: Kind) => void; onEdit?: (x: number, y: number, value: string, target: EditTarget) => void;
  S: RoomDims; interactive?: boolean; showDimensions?: boolean; className?: string;
  // partitions (interior stud walls) — rendered in both editor and read-only plan. Slide drags
  // the anchor along its wall; resize drags the free end. Geometry comes from model.partGeoms.
  selPart?: string | null; onSelectPart?: (id: string) => void;
  onPartSlideStart?: (e: React.PointerEvent, id: string) => void; onPartResizeStart?: (e: React.PointerEvent, id: string) => void;
  armPartition?: boolean; onPlanPoint?: (rx: number, ry: number) => void; onPlanHover?: (rx: number, ry: number) => void;
  partAnchorPt?: Pt | null; partPreview?: PartGeom | null;
}) {
  const { t } = useLanguage();
  const { verts, edges, surfaces, P, cen, excluded, floorSF, CL } = model;
  const roomPts = verts.map((p) => P(p[0], p[1]).join(",")).join(" ");

  // Floor texture: when a flooring color is chosen, fill the room polygon with that
  // product's swatch image as a tiling <pattern> instead of the flat accent tint. The
  // pattern id is namespaced per instance with useId() — the plan renders in at least two
  // places at once (editor + read-only RoomPlanSVG); a hard-coded id would resolve to
  // whichever appears first in the DOM. Kept at low opacity so dimensions stay legible.
  const floorUid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const floorPatId = `floorPat-${floorUid}`;
  const floorImage = model.flooring ? FLOORING_COLORS.find((c) => c.id === model.flooring!.colorId)?.image : undefined;

  // overall dims
  const dc = MUTED, tk = 5;
  const [blx, bly] = P(model.minX, model.maxY), [brx] = P(model.maxX, model.maxY), [tlx, tly] = P(model.minX, model.minY);
  const wy = bly + 34;
  const dx0 = tlx - 34;

  // armed hit targets — every surface (perimeter wall AND partition face) is a candidate;
  // only those the fixture actually fits highlight as placeable, the rest gray out.
  const need = armed ? minWallFor(armed) : 0;
  const hits: { i: number; ax: number; ay: number; bx: number; by: number }[] = [];
  const gray: { i: number; ax: number; ay: number; bx: number; by: number }[] = [];
  if (interactive && armed) {
    surfaces.forEach((e, i) => {
      const [ax, ay] = P(e.a[0], e.a[1]), [bx, by] = P(e.b[0], e.b[1]);
      const ok = armed === "bath" ? !!bestFit(verts, e, BASES, cen)
        : armed === "toilet" ? (e.len >= need && fits(verts, e, 0.5, TOILET_W, TOILET_D, cen))
        : armed === "vanity" ? !!freeFit(verts, surfaces, i, VANITY_SIZES, VANITY_D, cen, "vanity", model.fx)
        : e.len >= need;
      (ok ? hits : gray).push({ i, ax, ay, bx, by });
    });
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} aria-label="Room plan" className={`block h-auto w-full rounded-[10px]${className ? " " + className : ""}`} style={interactive ? { background: PAPER } : { background: PAPER, pointerEvents: "none" }}
      onClick={interactive ? (e) => { if (e.target === e.currentTarget) onBackground?.(); } : undefined}>
      {floorImage && (
        <defs>
          <pattern id={floorPatId} patternUnits="userSpaceOnUse" width={88} height={88}>
            <image href={floorImage} x={0} y={0} width={88} height={88} preserveAspectRatio="xMidYMid slice" />
          </pattern>
        </defs>
      )}
      {/* room fill — flooring texture (tiled, low opacity) when chosen, else the flat tint */}
      {floorImage
        ? <polygon pointerEvents="none" points={roomPts} fill={`url(#${floorPatId})`} fillOpacity={0.4} />
        : <polygon pointerEvents="none" points={roomPts} fill={ACCENT} fillOpacity={0.05} />}

      {showDimensions && (<>
      {/* overall width dim */}
      <line x1={blx} y1={bly + 8} x2={blx} y2={wy + tk} stroke={dc} pointerEvents="none" />
      <line x1={brx} y1={bly + 8} x2={brx} y2={wy + tk} stroke={dc} pointerEvents="none" />
      <line x1={blx} y1={wy} x2={brx} y2={wy} stroke={dc} pointerEvents="none" />
      <g style={interactive ? { cursor: "pointer" } : undefined} onClick={interactive ? (e) => { e.stopPropagation(); onEdit?.((blx + brx) / 2, wy, ftin(S.w), { type: "dim", d: "w" }); } : undefined}>
        <rect x={(blx + brx) / 2 - 24} y={wy - 9} width={48} height={18} rx={4} fill={PAPER} pointerEvents="none" />
        <text x={(blx + brx) / 2} y={wy} textAnchor="middle" dominantBaseline="middle" fontFamily="monospace" fontSize={11} fontWeight={700} pointerEvents="none">{ftin(model.bw)}</text>
      </g>
      {/* overall depth dim */}
      <line x1={tlx - 8} y1={tly} x2={dx0 - tk} y2={tly} stroke={dc} pointerEvents="none" />
      <line x1={blx - 8} y1={bly} x2={dx0 - tk} y2={bly} stroke={dc} pointerEvents="none" />
      <line x1={dx0} y1={tly} x2={dx0} y2={bly} stroke={dc} pointerEvents="none" />
      <g style={interactive ? { cursor: "pointer" } : undefined} onClick={interactive ? (e) => { e.stopPropagation(); onEdit?.(dx0, (tly + bly) / 2, ftin(S.d), { type: "dim", d: "d" }); } : undefined}>
        <rect x={dx0 - 9} y={(tly + bly) / 2 - 24} width={18} height={48} fill={PAPER} pointerEvents="none" />
        <text x={dx0} y={(tly + bly) / 2} textAnchor="middle" dominantBaseline="middle" transform={`rotate(-90 ${dx0} ${(tly + bly) / 2})`} fontFamily="monospace" fontSize={11} fontWeight={700} pointerEvents="none">{ftin(model.bh)}</text>
      </g>
      </>)}

      {/* walls */}
      {edges.map((e, i) => { const [ax, ay] = P(e.a[0], e.a[1]), [bx, by] = P(e.b[0], e.b[1]); return <line key={`w${i}`} x1={ax} y1={ay} x2={bx} y2={by} stroke={excluded.has(i) ? GHOST : INK} strokeWidth={3} strokeLinecap="round" pointerEvents="none" />; })}
      {/* gray (not-ok) armed decorations */}
      {gray.map((h) => <line key={`g${h.i}`} pointerEvents="none" x1={h.ax} y1={h.ay} x2={h.bx} y2={h.by} stroke={GHOST} strokeOpacity={0.25} strokeWidth={14} strokeLinecap="round" />)}

      {/* segment labels */}
      {edges.map((e, i) => {
        const [ax, ay] = P(e.a[0], e.a[1]), [bx, by] = P(e.b[0], e.b[1]);
        let dx = bx - ax, dy = by - ay; const L = Math.hypot(dx, dy) || 1; let px = -dy / L, py = dx / L;
        const [cx, cy] = P(cen[0], cen[1]), mx = (ax + bx) / 2, my = (ay + by) / 2;
        if ((mx - cx) * px + (my - cy) * py < 0) { px = -px; py = -py; }
        const lx = mx + px * 15, ly = my + py * 15;
        return (
          <g key={`sl${i}`} style={interactive ? { cursor: "pointer" } : undefined} onClick={interactive ? (ev) => { ev.stopPropagation(); onEdit?.(lx, ly, ftin(e.len), { type: "seg", p: e.p, len: e.len }); } : undefined}>
            <rect x={lx - 20} y={ly - 10} width={40} height={20} rx={5} fill="#fff" fillOpacity={0.01} pointerEvents={interactive ? undefined : "none"} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontFamily="monospace" fontSize={11} fill={excluded.has(i) ? GHOST : INK} pointerEvents="none">{ftin(e.len)}</text>
          </g>
        );
      })}

      {/* clearance zones */}
      {showClear && CL.turnCircle && (() => {
        const c0 = P(CL.turnCircle.x, CL.turnCircle.y), edge = P(CL.turnCircle.x + CL.turnCircle.r, CL.turnCircle.y);
        const rp = Math.hypot(edge[0] - c0[0], edge[1] - c0[1]);
        return <g key="turn"><circle pointerEvents="none" cx={c0[0]} cy={c0[1]} r={rp} fill={ACCENT} fillOpacity={0.05} stroke={ACCENT} strokeWidth={1} strokeDasharray="6 4" /><text pointerEvents="none" x={c0[0]} y={c0[1] - rp + 12} textAnchor="middle" fontFamily="monospace" fontSize={9} fill={ACCENT}>{`60" ${t("configurator.room.turning")}`}</text></g>;
      })()}
      {showClear && CL.zones.map((z, i) => (
        <polygon key={`z${i}`} pointerEvents="none" points={z.pts.map((pt) => P(pt[0], pt[1]).join(",")).join(" ")} fill={z.ok ? ACCENT : AMBER} fillOpacity={z.ok ? 0.06 : 0.16} stroke={z.ok ? ACCENT : AMBER} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={z.ok ? 0.4 : 0.9} />
      ))}

      {/* fixtures — bodies are click-to-select when nothing is armed (so a covered fixture
          stays reachable); when armed they're inert so wall hit-targets win. Rendered with
          the selected fixture LAST so its handle draws on top; crowded handles shrink. */}
      {(() => {
        const kinds: Kind[] = ["door", "toilet", "bath", "vanity"];
        const centers: Partial<Record<Kind, Pt>> = {};
        kinds.forEach((k) => { const c = handleCenterFor(model, k); if (c) centers[k] = c; });
        const CROWD = 40;
        const crowdedOf = (k: Kind) => { const c = centers[k]; return !!c && kinds.some((o) => o !== k && centers[o] && Math.hypot(centers[o]![0] - c[0], centers[o]![1] - c[1]) < CROWD); };
        const bodySel = interactive && !armed;
        const drag = onDragStart ?? (() => {});
        const order = kinds.slice().sort((a, b) => (a === sel ? 1 : 0) - (b === sel ? 1 : 0)); // selected last
        return order.map((k) => {
          if (k === "door" && model.door) return <DoorArt key="door" m={model} sel={sel === "door"} crowded={crowdedOf("door")} onSelect={() => onSelect?.("door")} onDragStart={drag} interactive={interactive} />;
          if (k === "toilet" && model.toilet) return <ToiletArt key="toilet" m={model} sel={sel === "toilet"} bodySelectable={bodySel} crowded={crowdedOf("toilet")} onSelect={() => onSelect?.("toilet")} onDragStart={drag} interactive={interactive} />;
          if (k === "bath" && model.bath) return <BathArt key="bath" m={model} sel={sel === "bath"} bodySelectable={bodySel} crowded={crowdedOf("bath")} onSelect={() => onSelect?.("bath")} onDragStart={drag} interactive={interactive} t={t} />;
          if (k === "vanity" && model.vanity) return <VanityArt key="vanity" m={model} sel={sel === "vanity"} bodySelectable={bodySel} crowded={crowdedOf("vanity")} onSelect={() => onSelect?.("vanity")} onDragStart={drag} interactive={interactive} t={t} />;
          return null;
        });
      })()}

      {/* interior partitions — filled finished-thickness rectangle drawn like a real wall,
          anchored to a perimeter wall by one end. Body click selects; the midpoint handle
          slides the anchor along its wall; the free-end handle resizes the length. */}
      {model.partGeoms.map((g) => {
        const p = g.p;
        const pts = g.corners.map(([x, y]) => P(x, y).join(",")).join(" ");
        const [ax, ay] = P(g.anchor[0], g.anchor[1]), [fx, fy] = P(g.free[0], g.free[1]);
        const [mx, my] = P(g.mid[0], g.mid[1]);
        const selected = selPart === p.id;
        const stroke = selected ? ACCENT : INK;
        const bodyEvt = interactive && !armed && !armPartition
          ? { onClick: (ev: React.MouseEvent) => { ev.stopPropagation(); onSelectPart?.(p.id); }, style: { cursor: "pointer" as const } }
          : { pointerEvents: "none" as const };
        const pick = (ev: React.MouseEvent) => { ev.stopPropagation(); onSelectPart?.(p.id); };
        return (
          <g key={p.id}>
            <polygon {...bodyEvt} points={pts} fill="#e7e4dd" stroke={stroke} strokeWidth={selected ? 2.5 : 2} strokeLinejoin="round" />
            <circle cx={ax} cy={ay} r={3.5} fill={stroke} pointerEvents="none" />
            {interactive && !armPartition && !armed ? (
              <>
                {/* slide handle (midpoint) — moves the anchor along its wall */}
                <circle r={15} cx={mx} cy={my} fill="transparent" style={{ cursor: "grab" }} onClick={pick} onPointerDown={(ev) => onPartSlideStart?.(ev, p.id)} />
                <circle cx={mx} cy={my} r={9} fill={ACCENT} fillOpacity={selected ? 0.35 : 0.15} stroke={ACCENT} strokeWidth={selected ? 2 : 1.2} style={{ cursor: "grab" }} onClick={pick} onPointerDown={(ev) => onPartSlideStart?.(ev, p.id)} />
                {/* resize handle (free end) — changes the length */}
                <circle r={14} cx={fx} cy={fy} fill="transparent" style={{ cursor: "grab" }} onClick={pick} onPointerDown={(ev) => onPartResizeStart?.(ev, p.id)} />
                <circle cx={fx} cy={fy} r={selected ? 6 : 5} fill="#fff" stroke={ACCENT} strokeWidth={selected ? 2 : 1.5} style={{ cursor: "grab" }} onClick={pick} onPointerDown={(ev) => onPartResizeStart?.(ev, p.id)} />
              </>
            ) : (
              <circle cx={fx} cy={fy} r={3} fill={stroke} pointerEvents="none" />
            )}
          </g>
        );
      })}
      {/* in-progress partition placement: anchor dot on the wall + perpendicular rubber-band */}
      {partAnchorPt && (() => { const [sx, sy] = P(partAnchorPt[0], partAnchorPt[1]); return <circle key="ps" cx={sx} cy={sy} r={4} fill={ACCENT} pointerEvents="none" />; })()}
      {partPreview && (() => {
        const pts = partPreview.corners.map(([x, y]) => P(x, y).join(",")).join(" ");
        return <polygon key="pp" points={pts} fill={ACCENT} fillOpacity={0.15} stroke={ACCENT} strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />;
      })()}

      {/* vertices + area label */}
      {verts.map((p, i) => { const [qx, qy] = P(p[0], p[1]); return <circle key={`v${i}`} cx={qx} cy={qy} r={4} fill={ACCENT} pointerEvents="none" />; })}
      {(() => { const [cx, cy] = P(cen[0], cen[1]); return <text x={cx} y={cy} textAnchor="middle" fontFamily="monospace" fontSize={12} fill={MUTED} pointerEvents="none">{floorSF.toFixed(1)} sf</text>; })()}

      {/* wall identifiers (W1, W2 …) — keyed by stable side identity so they match the walls
          table exactly (never array index). Placed just inside each wall on a chip so they
          stay legible over the flooring texture. Inert — the dimension labels sit outside. */}
      {edges.map((e, i) => {
        const [ax, ay] = P(e.a[0], e.a[1]), [bx, by] = P(e.b[0], e.b[1]);
        let dx = bx - ax, dy = by - ay; const Ls = Math.hypot(dx, dy) || 1; let px = -dy / Ls, py = dx / Ls;
        const [cx, cy] = P(cen[0], cen[1]), mx = (ax + bx) / 2, my = (ay + by) / 2;
        if ((mx - cx) * px + (my - cy) * py > 0) { px = -px; py = -py; } // point INWARD (toward centroid)
        const lx = mx + px * 16, ly = my + py * 16, label = wallLabel(e.side);
        return (
          <g key={`wl${i}`} pointerEvents="none">
            <rect x={lx - 11} y={ly - 8} width={22} height={16} rx={4} fill={PAPER} fillOpacity={0.85} />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontFamily="monospace" fontSize={9} fontWeight={700} fill={excluded.has(i) ? GHOST : MUTED}>{label}</text>
          </g>
        );
      })}

      {/* placement targets sit above all artwork */}
      {hits.map((h) => <line key={`h${h.i}`} x1={h.ax} y1={h.ay} x2={h.bx} y2={h.by} stroke={ACCENT} strokeOpacity={0.16} strokeWidth={18} strokeLinecap="round" style={{ cursor: "pointer" }} onClick={(ev) => { ev.stopPropagation(); onPlace?.(h.i); }} />)}

      {/* partition placement catcher — topmost when arming, so a click anywhere in the plan
          registers a point (and hover drives the preview). */}
      {interactive && armPartition && (
        <rect x={0} y={0} width={W} height={H} fill="transparent" style={{ cursor: "crosshair" }}
          onClick={(ev) => { ev.stopPropagation(); const svg = svgRef.current; if (!svg) return; const rr = svg.getBoundingClientRect(); const ux = (ev.clientX - rr.left) * (W / rr.width), uy = (ev.clientY - rr.top) * (H / rr.height); onPlanPoint?.((ux - model.ox) / model.s, (uy - model.oy) / model.s); }}
          onPointerMove={(ev) => { const svg = svgRef.current; if (!svg) return; const rr = svg.getBoundingClientRect(); const ux = (ev.clientX - rr.left) * (W / rr.width), uy = (ev.clientY - rr.top) * (H / rr.height); onPlanHover?.((ux - model.ox) / model.s, (uy - model.oy) / model.s); }}
        />
      )}
    </svg>
  );
}

// ===================== Reusable read-only plan =============================
// A room state the plan can be drawn from — the same shape as RoomConfig.selections
// (plus optional excluded walls). One source of truth for the drawing: RoomPlanSVG
// resolves this into the identical Model and renders the identical <Plan>.
export type RoomPlanState = {
  shape: Shape;
  dims: RoomDims;
  door: RoomDoor | null;
  toilet: RoomToilet | null;
  bath: RoomBath | null;
  vanity: RoomVanity | null;
  excluded?: number[];
  treatments?: WallTreatments;
  flooring?: RoomFlooring | null;
  wallBase?: RoomWallBase | null;
  partitions?: RoomPartition[];
};
function planStateToDoc(s: RoomPlanState): Doc {
  return { shape: s.shape, S: s.dims, door: s.door, toilet: s.toilet, bath: s.bath, vanity: s.vanity, excluded: s.excluded ?? [], treatments: s.treatments ?? {}, flooring: s.flooring ?? undefined, wallBase: s.wallBase ?? undefined, partitions: s.partitions ?? [] };
}

/**
 * Standalone plan renderer. With interactive={false} it draws the exact same
 * geometry, walls, dimensions, fixtures and labels as the full configurator, but
 * read-only: no click handlers, no drag handles, no wall targets, pointer-events
 * disabled on every element. Conflict/overhang amber states render identically, so
 * the miniature is never prettier than the editor.
 */
export function RoomPlanSVG({ state, interactive = true, showDimensions = true, showClearances = true, className }: {
  state: RoomPlanState;
  interactive?: boolean;
  showDimensions?: boolean;
  showClearances?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const model = useMemo(() => resolveModel(planStateToDoc(state), false, t), [state, t]);
  const svgRef = useRef<SVGSVGElement>(null);
  return (
    <Plan svgRef={svgRef} model={model} armed={null} sel={null} showClear={showClearances} showDimensions={showDimensions} interactive={interactive} S={model.S} className={className} />
  );
}

// ============================== Small UI ==================================
function Metric({ label, value }: { label: string; value: string }) {
  return <div><div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div><div className="text-lg font-bold">{value}</div></div>;
}
function MatCard({ label, big, sub }: { label: string; big: string; sub: string }) {
  return <div className="rounded-[10px] border border-line p-2.5"><div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div><div className="text-[15px] font-bold">{big}</div><div className="text-[11px] text-muted">{sub}</div></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="my-2 flex items-center justify-between gap-2 text-[13px]"><span>{label}</span>{children}</div>;
}
// Feet/inch dimension entry. While a field is focused it holds raw text in local state
// and does NOT apply anything; the value is parsed and committed only on blur or Enter.
// An empty or unparseable value on commit reverts (no change) rather than clamping the
// room to its minimum — the previous bug where clearing a field collapsed the room and
// re-fitted every fixture. Escape cancels the edit. Range clamping happens in editS,
// i.e. only on commit.
function FtIn({ valueIn, onChange }: { valueIn: number; onChange: (totalIn: number) => void }) {
  const ft = Math.floor(valueIn / 12), inch = valueIn % 12;
  const [draft, setDraft] = useState<{ field: "ft" | "inch"; value: string } | null>(null);
  const commit = (field: "ft" | "inch", raw: string) => {
    setDraft(null);
    const n = parseInt(raw, 10);
    if (raw.trim() === "" || isNaN(n)) return; // revert to previous value
    const next = field === "ft" ? Math.max(0, n) * 12 + inch : ft * 12 + Math.max(0, Math.min(11, n));
    if (next !== valueIn) onChange(next);
  };
  const bind = (field: "ft" | "inch") => ({
    value: draft?.field === field ? draft.value : String(field === "ft" ? ft : inch),
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => { setDraft({ field, value: String(field === "ft" ? ft : inch) }); e.target.select(); },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ field, value: e.target.value }),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { commit(field, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); }
      else if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => { if (draft?.field === field) commit(field, e.target.value); },
  });
  return (
    <span className="inline-flex items-center gap-0.5">
      <input type="number" {...bind("ft")} className={IN_CLS} />
      <span className="text-[11px] text-muted">&apos;</span>
      <input type="number" min={0} max={11} {...bind("inch")} className={IN_CLS} />
      <span className="text-[11px] text-muted">&quot;</span>
    </span>
  );
}

function ClearanceBox({ shapeNote, anyFix, moved, CL, hasFixtures }: { shapeNote: boolean; anyFix: boolean; moved: string[]; CL: ClearResult; hasFixtures: boolean }) {
  const { t } = useLanguage();
  if (shapeNote && !anyFix) return <div className="mt-2.5 rounded-[10px] border border-line bg-paper px-3 py-2 text-xs text-muted">{t("configurator.room.shapeCleared")}</div>;
  if (moved.length) {
    const list = moved.map((m) => t(m === "door" ? "configurator.room.movedDoor" : m === "toilet" ? "configurator.room.movedToilet" : m === "bath" ? "configurator.room.movedBath" : "configurator.room.movedVanity")).join(t("configurator.room.andSep"));
    return (
      <div className="mt-2.5 rounded-[10px] border p-3" style={{ borderColor: AMBER, background: "#f6e8cf" }}>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: AMBER }}>⚠ {t("configurator.room.wallRemoved")}</div>
        <div className="text-xs leading-relaxed" style={{ color: "#7a4d0f" }}>{t(moved.length > 1 ? "configurator.room.movedWarnMany" : "configurator.room.movedWarnOne", { list })}</div>
      </div>
    );
  }
  if (CL.issues.length) return (
    <div className="mt-2.5 rounded-[10px] border p-3" style={{ borderColor: AMBER, background: "#f6e8cf" }}>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: AMBER }}>⚠ {CL.mode} — {CL.issues.length} {CL.issues.length > 1 ? t("configurator.room.issues") : t("configurator.room.issue")}</div>
      {CL.issues.map((msg, i) => <div key={i} className="text-xs leading-relaxed" style={{ color: "#7a4d0f" }}>• {msg}</div>)}
    </div>
  );
  if (hasFixtures) return <div className="mt-2.5 rounded-[10px] border border-accent bg-accent-soft px-3 py-2 text-xs text-accent">✓ {t("configurator.room.meetsClearances", { mode: CL.mode })}</div>;
  return null;
}

// ============================== Context panel =============================
function ContextPanel({ model, sel, onDoor, onToiletRough, onBathKind, onBathSku, onVanity, onDel }: {
  model: Model; sel: Kind | null;
  onDoor: (k: string, v: unknown) => void; onToiletRough: (r: number) => void;
  onBathKind: (k: "shower" | "tub") => void; onBathSku: (id: string) => void;
  onVanity: (k: "w" | "sinks", v: number) => void; onDel: (k: Kind) => void;
}) {
  const { t } = useLanguage();
  const { surfaces } = model; // a selected fixture's `edge` indexes into surfaces (wall or face)
  const SB = "font-display text-[11px] font-semibold border border-line bg-card text-ink rounded-lg px-2 py-1 transition hover:bg-ink/5 disabled:opacity-35 disabled:cursor-not-allowed";
  const hdr = (title: string, k: Kind) => (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink">{title}</span>
      <span className="flex-1" />
      <button onClick={() => onDel(k)} className={SB}>{t("configurator.remove")}</button>
    </div>
  );

  if (sel === "door" && model.door) {
    const door = model.door; const L = edgeVec(surfaces[door.edge]).L;
    return (
      <div>
        {hdr(t("configurator.room.entryDoor"), "door")}
        <Field label={t("configurator.room.typeLbl")}><span className="flex gap-1.5">{([["opening", "configurator.room.opening"], ["swing", "configurator.room.swingType"], ["sliding", "configurator.room.sliding"]] as [string, string][]).map(([k, lk]) => <button key={k} onClick={() => onDoor("type", k)} className={`${SB} ${door.type === k ? BTN_ACTIVE : ""}`}>{t(lk)}</button>)}</span></Field>
        <Field label={t("configurator.room.widthLbl")}><span className="flex flex-wrap gap-1.5">{DOOR_SIZES.map((w) => <button key={w} disabled={roOf(w) > L} onClick={() => onDoor("w", w)} className={`${SB} ${door.w === w ? BTN_ACTIVE : ""}`}>{w}&quot;</button>)}</span></Field>
        <p className="-mt-0.5 text-xs text-muted">{t("configurator.room.doorInfo", { w: String(door.w), ro: String(roOf(door.w)), wall: ftin(L) })}</p>
        {door.type === "swing" && <Field label={t("configurator.room.swingLbl")}><span className="flex flex-wrap gap-1.5">{([["in-l", "configurator.room.swingInL"], ["in-r", "configurator.room.swingInR"], ["out-l", "configurator.room.swingOutL"], ["out-r", "configurator.room.swingOutR"]] as [string, string][]).map(([k, lk]) => <button key={k} onClick={() => onDoor("swing", k)} className={`${SB} ${door.swing === k ? BTN_ACTIVE : ""}`}>{t(lk)}</button>)}</span></Field>}
        <p className="mt-1 text-xs text-muted">{t("configurator.room.doorHelp")}</p>
      </div>
    );
  }
  if (sel === "bath" && model.bath) {
    const bath = model.bath; const L = edgeVec(surfaces[bath.edge]).L; const list = bath.kind === "tub" ? TUBS : BASES; const sku = bathSku(bath);
    return (
      <div>
        {hdr(t("configurator.room.bathingArea"), "bath")}
        <Field label={t("configurator.room.typeLbl")}><span className="flex gap-1.5">{([["shower", "configurator.room.showerOpt"], ["tub", "configurator.room.tubOpt"]] as ["shower" | "tub", string][]).map(([k, lk]) => <button key={k} onClick={() => onBathKind(k)} className={`${SB} ${bath.kind === k ? BTN_ACTIVE : ""}`}>{t(lk)}</button>)}</span></Field>
        <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.sizeLbl")}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {list.map((x) => { const over = x.w > L; return <button key={x.id} onClick={() => onBathSku(x.id)} className={`${SB} ${sku.id === x.id ? BTN_ACTIVE : ""}`} style={over ? { borderColor: AMBER, color: AMBER } : undefined}>{x.w}×{x.d}{over ? " !" : ""}</button>; })}
        </div>
        {bath.sizeConflict ? (
          <p className="text-xs" style={{ color: AMBER }}>
            <b>{t("configurator.room.bathConflict", { size: `${sku.w}×${sku.d}` })}</b>{t("configurator.room.bathConflictMove")}
            {(() => { const fh = bath.sizeConflict!.fitsHere ? list.find((x) => x.id === bath.sizeConflict!.fitsHere) : undefined; return fh ? t("configurator.room.bathDrawing", { fits: `${fh.w}×${fh.d}` }) : null; })()}
          </p>
        ) : bath.overhang ? (
          <p className="text-xs" style={{ color: AMBER }}>
            <b>{bath.tooWide ? t("configurator.room.bathTooWide", { w: String(sku.w), over: ftin(bath.overBy ?? 0), wall: ftin(L) }) : t("configurator.room.bathRunsPast", { size: `${sku.w}×${sku.d}` })}</b>{t("configurator.room.bathKept")}
          </p>
        ) : (
          <p className="text-xs text-muted">{bath.snapped ? <><b>{t("configurator.room.snappedCorner")}</b> — </> : null}{t("configurator.room.bathSnapHelp")}</p>
        )}
      </div>
    );
  }
  if (sel === "vanity" && model.vanity) {
    const vanity = model.vanity; const L = edgeVec(surfaces[vanity.edge]).L;
    return (
      <div>
        {hdr(t("configurator.room.vanityHdr"), "vanity")}
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.sizeLbl")}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">{VANITY_SIZES.map((w) => <button key={w} onClick={() => onVanity("w", w)} className={`${SB} ${vanity.w === w ? BTN_ACTIVE : ""}`} style={w > L ? { borderColor: AMBER, color: AMBER } : undefined}>{w}&quot;</button>)}</div>
        <Field label={t("configurator.room.sinksLbl")}><span className="flex gap-1.5">{[1, 2].map((n) => <button key={n} disabled={n > maxSinks(vanity.w)} onClick={() => onVanity("sinks", n)} className={`${SB} ${(vanity.sinks || 1) === n ? BTN_ACTIVE : ""}`}>{n}</button>)}</span></Field>
        {vanity.overhang
          ? <p className="text-xs" style={{ color: AMBER }}><b>{t("configurator.room.vanityDoesntFit", { w: String(vanity.w) })}</b>{t("configurator.room.vanityKept")}</p>
          : <p className="text-xs text-muted">{t("configurator.room.vanityInfo", { w: String(vanity.w), d: String(VANITY_D) })}</p>}
      </div>
    );
  }
  if (sel === "toilet" && model.toilet) {
    const toilet = model.toilet;
    return (
      <div>
        {hdr(t("configurator.room.toiletHdr"), "toilet")}
        <Field label={t("configurator.room.roughIn")}><span className="flex gap-1.5">{[10, 12, 14].map((r) => <button key={r} onClick={() => onToiletRough(r)} className={`${SB} ${toilet.rough === r ? BTN_ACTIVE : ""}`}>{r}&quot;</button>)}</span></Field>
        <p className="text-xs text-muted">{t("configurator.room.toiletInfo")}</p>
      </div>
    );
  }
  // Nothing selected: the contextual panel only shows fixture properties, so it hands off
  // to a short hint. Room-level surface controls live in the always-visible Surfaces panel.
  return <p className="text-xs text-muted">{t("configurator.room.clickToEdit")}</p>;
}

// ============================== Partition panel ===========================
// Properties for a selected interior partition: thickness presets (+ custom), full/custom
// height, a click-to-edit length, and Remove. Keyed by id at the call site so its local
// custom-field state resets when a different partition is picked.
function PartitionPanel({ partition, ceilingIn, onThickness, onHeight, onLength, onRemove }: {
  partition: RoomPartition; ceilingIn: number;
  onThickness: (v: number) => void; onHeight: (v: number) => void; onLength: (v: number) => void; onRemove: () => void;
}) {
  const { t } = useLanguage();
  const p = partition;
  const SB = "font-display text-[11px] font-semibold border border-line bg-card text-ink rounded-lg px-2 py-1 transition hover:bg-ink/5 disabled:opacity-35 disabled:cursor-not-allowed";
  const len = Math.round(p.lengthIn);
  const [customT, setCustomT] = useState(!(p.thicknessIn === 4.5 || p.thicknessIn === 6.5));
  const [customH, setCustomH] = useState(!(Math.abs(p.heightIn - ceilingIn) < 0.5));
  const [editingLen, setEditingLen] = useState(false);
  const commitLen = (raw: string) => { setEditingLen(false); const v = parseLen(raw); if (v != null && v > 0) onLength(v); };
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink">{t("configurator.room.partitionHdr")}</span>
        <span className="flex-1" />
        <button onClick={onRemove} className={SB}>{t("configurator.remove")}</button>
      </div>

      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.thickness")}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <button onClick={() => { setCustomT(false); onThickness(4.5); }} className={`${SB} ${!customT && p.thicknessIn === 4.5 ? BTN_ACTIVE : ""}`}>{t("configurator.room.thick2x4")}</button>
        <button onClick={() => { setCustomT(false); onThickness(6.5); }} className={`${SB} ${!customT && p.thicknessIn === 6.5 ? BTN_ACTIVE : ""}`}>{t("configurator.room.thick2x6")}</button>
        <button onClick={() => setCustomT(true)} className={`${SB} ${customT ? BTN_ACTIVE : ""}`}>{t("configurator.room.thickCustom")}</button>
      </div>
      {customT && (
        <div className="mt-1.5 flex items-center gap-1">
          <input type="number" step={0.25} min={0.5} value={p.thicknessIn} onChange={(e) => onThickness(parseFloat(e.target.value) || 0.5)} className={IN_CLS} />
          <span className="text-[11px] text-muted">&quot;</span>
        </div>
      )}

      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.heightLbl")}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <button onClick={() => { setCustomH(false); onHeight(ceilingIn); }} className={`${SB} ${!customH ? BTN_ACTIVE : ""}`}>{t("configurator.room.fullHeight")}</button>
        <button onClick={() => setCustomH(true)} className={`${SB} ${customH ? BTN_ACTIVE : ""}`}>{t("configurator.room.heightCustom")}</button>
      </div>
      {customH && (
        <div className="mt-1.5 flex items-center gap-1">
          <input type="number" min={1} value={p.heightIn} onChange={(e) => onHeight(parseInt(e.target.value) || 1)} className={IN_CLS} />
          <span className="text-[11px] text-muted">&quot;</span>
        </div>
      )}

      <Field label={t("configurator.room.lengthLbl")}>
        {editingLen ? (
          <input autoFocus defaultValue={ftin(len)}
            onKeyDown={(e) => { if (e.key === "Enter") { commitLen((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") { setEditingLen(false); (e.target as HTMLInputElement).blur(); } }}
            onBlur={(e) => commitLen(e.target.value)} onFocus={(e) => e.target.select()}
            className="w-16 rounded-md border border-accent bg-card px-1 py-0.5 text-center font-mono text-xs" />
        ) : (
          <button onClick={() => setEditingLen(true)} className={SB}>{ftin(len)}</button>
        )}
      </Field>

      <p className="mt-1 text-xs text-muted">{t("configurator.room.partitionAnchorNote")}</p>
      <p className="mt-1 text-xs text-muted">{t("configurator.room.partitionThicknessNote")}</p>
      <p className="mt-1 text-xs text-muted">{t("configurator.room.partitionHeightNote")}</p>
    </div>
  );
}

// ============================== Surfaces panel ============================
// Always-visible room-level surfaces: the walls table + treatments (Wrap/Clear/per-wall
// Finish) and the flooring section. Relocated out of ContextPanel so selecting a fixture
// no longer hides them. Behaviour and styling are unchanged from their previous home.
function Surfaces({ model, onToggleEx, onTreatment, onAllPanels, onFlooringColor, onFlooringWaste, onFlooringClear, onWallBaseColor, onWallBaseHeight, onWallBaseWaste, onWallBaseClear }: {
  model: Model;
  onToggleEx: (i: number, billable: boolean) => void;
  onTreatment: (side: string, tr: WallTreatment) => void; onAllPanels: (tr: WallTreatment) => void;
  onFlooringColor: (colorId: string) => void; onFlooringWaste: (wastePct: number) => void; onFlooringClear: () => void;
  onWallBaseColor: (colorId: string) => void; onWallBaseHeight: (heightIn: 4 | 6) => void; onWallBaseWaste: (wastePct: number) => void; onWallBaseClear: () => void;
}) {
  const { t } = useLanguage();
  const { edges } = model;
  const SB = "font-display text-[11px] font-semibold border border-line bg-card text-ink rounded-lg px-2 py-1 transition hover:bg-ink/5 disabled:opacity-35 disabled:cursor-not-allowed";
  const ded = model.ded, treat = model.treat;
  const assignableCount = edges.reduce((a, _e, i) => a + (ded[i] === 0 ? 1 : 0), 0);
  const FINISH_SEL = "w-full rounded border border-line bg-card px-1 py-0.5 font-mono text-[10px]";
  const flooring = model.flooring;
  const selFloorColor = flooring ? FLOORING_COLORS.find((c) => c.id === flooring.colorId) : null;
  const wastePct = flooring?.wastePct ?? 10;
  const wallBase = model.wallBase;
  const selWbColor = wallBase ? WALL_BASE_COLORS.find((c) => c.id === wallBase.colorId) : null;
  const wbHeight = wallBase?.heightIn ?? 4, wbWaste = wallBase?.wastePct ?? 10;
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.walls")}</div>
      {/* Wrap / clear the room in panels (assignable walls only) */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <button onClick={() => onAllPanels("panel")} disabled={!assignableCount}
          className="flex-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35">
          {t("configurator.room.wrapRoom")}
        </button>
        <button onClick={() => onAllPanels("paint")} disabled={!assignableCount} className={BTN}>{t("configurator.room.clearPanels")}</button>
      </div>
      <table className="mt-2 w-full border-collapse text-[13px]">
        <thead><tr>{["#", t("configurator.room.colWall"), t("configurator.room.colBath"), t("configurator.room.colNet"), t("configurator.room.colFinish"), t("configurator.room.colBill")].map((h) => <th key={h} className="p-1 text-left font-mono text-[9px] uppercase tracking-[0.08em] text-muted">{h}</th>)}</tr></thead>
        <tbody>
          {edges.map((e, i) => { const net = Math.max(0, e.len - ded[i]); const owned = ded[i] > 0; return (
            <tr key={i} className="border-t border-line">
              <td className="p-1 font-mono text-[10px] uppercase text-muted">{wallLabel(e.side)}</td>
              <td className="p-1">{ftin(e.len)}</td>
              <td className="p-1 text-[11px]" style={{ color: ded[i] ? AMBER : MUTED }}>{ded[i] ? "−" + ftin(ded[i]) : "—"}</td>
              <td className="p-1">{ftin(net)}</td>
              <td className="p-1">
                {owned ? (
                  <span className="font-mono text-[10px] text-muted" title={t("configurator.room.panelOwned")}>{t("configurator.room.finishShower")}</span>
                ) : (
                  <select value={treat[i]} onChange={(ev) => onTreatment(e.side, ev.target.value as WallTreatment)} className={FINISH_SEL}>
                    <option value="panel">{t("configurator.room.finishPanel")}</option>
                    <option value="paint">{t("configurator.room.finishPaint")}</option>
                    <option value="none">{t("configurator.room.finishNone")}</option>
                  </select>
                )}
              </td>
              <td className="p-1"><input type="checkbox" checked={!model.excluded.has(i)} onChange={(ev) => onToggleEx(i, ev.target.checked)} /></td>
            </tr>
          ); })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">{t("configurator.room.panelsHelp")}</p>
      <p className="mt-1 text-xs text-muted">{t("configurator.room.wallsHelp")}</p>

      {/* Flooring */}
      <div className="mt-3.5 border-t border-line pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.flooring")}</span>
          <button onClick={onFlooringClear} disabled={!flooring} className={SB}>{t("configurator.room.noFlooring")}</button>
        </div>
        <div className="mt-1.5 grid grid-cols-6 gap-1.5">
          {FLOORING_COLORS.map((c) => (
            <FloorSwatch key={c.id} c={c} selected={flooring?.colorId === c.id} onSelect={() => onFlooringColor(c.id)} />
          ))}
        </div>
        <div className="mt-1.5 text-[11px]">
          {selFloorColor
            ? <><span className="font-semibold text-ink">{FLOORING_LINE.brand} {FLOORING_LINE.name}</span> <span className="text-muted">· {selFloorColor.name}</span></>
            : <span className="text-muted">{t("configurator.room.flooringNoColor")}</span>}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.wasteFactor")}</span>
          <span className="flex gap-1.5">{[5, 10, 15, 20].map((w) => (
            <button key={w} disabled={!flooring} onClick={() => onFlooringWaste(w)} className={`${SB} ${wastePct === w ? BTN_ACTIVE : ""}`}>{w}%</button>
          ))}</span>
        </div>
      </div>

      {/* Wall base */}
      <div className="mt-3.5 border-t border-line pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.wallBase")}</span>
          <button onClick={onWallBaseClear} disabled={!wallBase} className={SB}>{t("configurator.room.noWallBase")}</button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.wbHeight")}</span>
          <span className="flex gap-1.5">{WALL_BASE_HEIGHTS.map((h) => (
            <button key={h} disabled={!wallBase} onClick={() => onWallBaseHeight(h)} className={`${SB} ${wbHeight === h ? BTN_ACTIVE : ""}`}>{h}&quot;</button>
          ))}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {WALL_BASE_COLORS.map((c) => (
            <button key={c.id} onClick={() => onWallBaseColor(c.id)} title={c.name}
              className={`h-8 w-8 rounded-full border-2 transition ${wallBase?.colorId === c.id ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-ink/30"}`}
              style={{ background: c.hex }} />
          ))}
        </div>
        <div className="mt-1.5 text-[11px]">
          {selWbColor
            ? <span className="text-muted">{selWbColor.name}</span>
            : <span className="text-muted">{t("configurator.room.wallBaseNoColor")}</span>}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.room.wasteFactor")}</span>
          <span className="flex gap-1.5">{[5, 10, 15, 20].map((w) => (
            <button key={w} disabled={!wallBase} onClick={() => onWallBaseWaste(w)} className={`${SB} ${wbWaste === w ? BTN_ACTIVE : ""}`}>{w}%</button>
          ))}</span>
        </div>
      </div>
    </div>
  );
}

function FloorSwatch({ c, selected, onSelect }: { c: FlooringColor; selected: boolean; onSelect: () => void }) {
  const [err, setErr] = useState(false);
  const ring = selected ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-ink/30";
  return (
    <button onClick={onSelect} title={c.name} className={`aspect-square overflow-hidden rounded-md border-2 transition ${ring}`} style={err ? { background: "#e8e5df" } : undefined}>
      {!err && <img src={c.image} alt={c.name} className="h-full w-full object-cover" onError={() => setErr(true)} />}
    </button>
  );
}
