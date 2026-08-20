/**
 * Reference-matrix fixture for the HPL shower takeoff.
 *
 * Every row of JT's supplier-verified BOM matrix is asserted exactly. The Aug 3 handoff was
 * explicit that this must not be spot-checked — a wrong panel count ships a job short, which
 * is a field-credibility failure rather than a UI bug.
 *
 * Runs on Node's built-in runner with type stripping — no React, no DOM, no Supabase, no
 * bundler, no test framework dependency:  npm test
 *
 * HPL ONLY. There are deliberately no SPC assertions: SPC is a different physical product
 * whose takeoff has not been specced.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import catalog from "../data/naturepanel-catalog.json" with { type: "json" };
import {
  computeHplShowerBom,
  computeHplPanelCount,
  computeHplTrimCount,
  computeHplConsumablesCount,
  computeHplOrderConsumables,
  fireHplUpsells,
  hplEndCapSignature,
  HPL_PANEL_WIDTH_IN,
  HPL_PANEL_HEIGHT_IN,
  type HplShowerConfig,
  type HplShowerType,
  type HplWallSpec,
} from "../hpl-shower-takeoff.ts";

// --------------------------------------------------------------- helpers

const wall = (id: string, widthIn: number, skuCode = "HPL-TEST-DECOR"): HplWallSpec => ({
  id, widthIn, skuCode, skuLabel: skuCode,
});

const config = (type: HplShowerType, widths: number[], skus?: string[]): HplShowerConfig => ({
  type,
  walls: widths.map((w, i) => wall(["back", "left", "right"][i] ?? `w${i}`, w, skus?.[i])),
});

// ------------------------------------------------- the reference matrix

type Row = {
  name: string;
  type: HplShowerType;
  widths: number[];
  panels: number;
  interiorCorner: number;
  baseProfile: number;
  endCap: number;
  sealant: number;
};

const MATRIX: Row[] = [
  { name: "32×32 corner shower",        type: "corner",       widths: [32, 32],     panels: 4, interiorCorner: 1, baseProfile: 1, endCap: 2, sealant: 2 },
  { name: "32×60 alcove (3-wall)",      type: "alcove",       widths: [60, 32, 32], panels: 7, interiorCorner: 2, baseProfile: 2, endCap: 4, sealant: 4 },
  { name: "36×60 alcove (3×5, 3-wall)", type: "alcove",       widths: [60, 36, 36], panels: 7, interiorCorner: 2, baseProfile: 2, endCap: 4, sealant: 4 },
  { name: "48×60 alcove (4×5, 3-wall)", type: "alcove",       widths: [60, 48, 48], panels: 9, interiorCorner: 2, baseProfile: 2, endCap: 6, sealant: 5 },
  { name: "60×60 alcove (5×5, 3-wall)", type: "alcove",       widths: [60, 60, 60], panels: 9, interiorCorner: 2, baseProfile: 2, endCap: 6, sealant: 5 },
  { name: "60×32 tub surround (3-wall)", type: "tub-surround", widths: [60, 32, 32], panels: 7, interiorCorner: 2, baseProfile: 2, endCap: 4, sealant: 4 },
];

for (const row of MATRIX) {
  test(`reference matrix — ${row.name}`, () => {
    const bom = computeHplShowerBom(config(row.type, row.widths));

    assert.equal(bom.panels.total, row.panels, "panel count");
    assert.equal(bom.trim.interiorCorner, row.interiorCorner, "interior corner");
    assert.equal(bom.trim.baseProfile, row.baseProfile, "base profile");
    assert.equal(bom.trim.endCap, row.endCap, "end cap");
    assert.equal(bom.consumables.sealant, row.sealant, "sealant");

    // Stated flat in the rules, but cheap to lock down so a future edit cannot drift them.
    assert.equal(bom.consumables.sprayCleaner, 1, "spray cleaner");
    assert.equal(bom.consumables.wipes, 1, "wipes");

    // Every reference configuration must come from the lookup, never the fallback.
    assert.equal(bom.trim.endCapEstimated, false, "end cap should be a known configuration");
  });
}

// --------------------------------------------------------- panel rule

test("panel rule is per-wall ceiling with a minimum of one — no cross-wall offcut reuse", () => {
  // 32" is 1.41 panels. Reuse would pack the two 9.25" remainders into one sheet and return 3.
  assert.equal(computeHplPanelCount(config("corner", [32, 32]).walls).total, 4);
  // A wall narrower than one panel still takes a whole panel.
  assert.equal(computeHplPanelCount([wall("back", 12)]).total, 1);
  // Exactly one panel wide is one panel, not two — the ceiling must not be tripped by float.
  assert.equal(computeHplPanelCount([wall("back", HPL_PANEL_WIDTH_IN)]).total, 1);
  // Zero-width walls contribute nothing rather than a floor of 1.
  assert.equal(computeHplPanelCount([wall("back", 0)]).total, 0);
});

test("mixed-decor showers total the same as single-decor showers", () => {
  const single = computeHplShowerBom(config("alcove", [60, 32, 32]));
  const mixed = computeHplShowerBom(
    config("alcove", [60, 32, 32], ["HPL-MARRAKECH", "HPL-PURE-WHITE", "HPL-PURE-WHITE"]),
  );

  assert.equal(mixed.panels.total, single.panels.total, "total is decor-independent");
  assert.equal(mixed.panels.total, 7);

  // ...but it splits across the two decors, which is what actually gets ordered.
  const bySku = Object.fromEntries(mixed.panels.bySku.map((s) => [s.skuCode, s.panels]));
  assert.deepEqual(bySku, { "HPL-MARRAKECH": 3, "HPL-PURE-WHITE": 4 });
});

// ------------------------------------------------------------ consumables

test("sealant is ceil(panels / 2) with no order-level sharing", () => {
  for (const [panels, sealant] of [[1, 1], [2, 1], [3, 2], [4, 2], [7, 4], [8, 4], [9, 5]] as const) {
    assert.equal(computeHplConsumablesCount(panels).sealant, sealant, `${panels} panels`);
  }
  // An 8-panel shower always needs 4 — never 3 with a tube borrowed from the next shower.
  assert.equal(computeHplConsumablesCount(8).sealant, 4);
});

test("wax is order-level, one tube per 8 showers", () => {
  assert.equal(computeHplOrderConsumables(0).wax, 0);
  assert.equal(computeHplOrderConsumables(1).wax, 1);
  assert.equal(computeHplOrderConsumables(3).wax, 1, "an order of 3 showers needs 1 tube, not 3");
  assert.equal(computeHplOrderConsumables(8).wax, 1);
  assert.equal(computeHplOrderConsumables(9).wax, 2);
});

test("wax is not emitted per shower", () => {
  const bom = computeHplShowerBom(config("alcove", [60, 32, 32]));
  assert.equal(bom.lines.filter((l) => l.kind === "wax").length, 0);
});

// --------------------------------------------------------------- upsells

test("panel upsell fires per decor whose own count is odd", () => {
  // 7 panels all one decor — odd, so one offer.
  const odd = computeHplShowerBom(config("alcove", [60, 32, 32]));
  const panelOffers = odd.upsells.offers.filter((o) => o.kind === "panel");
  assert.equal(panelOffers.length, 1);
  assert.equal(panelOffers[0].discountPct, 25);
  assert.equal(panelOffers[0].qty, 1);

  // 4 panels, even — no panel offer, but the insurance offers still stand.
  const even = computeHplShowerBom(config("corner", [32, 32]));
  assert.equal(even.upsells.offers.filter((o) => o.kind === "panel").length, 0);
  assert.equal(even.upsells.offers.filter((o) => o.kind === "sealant").length, 1);
  assert.equal(even.upsells.offers.filter((o) => o.kind === "trim").length, 3);
});

test("mixed decors fire a panel upsell only for the odd decor", () => {
  // Marrakech 3 (odd) + Pure White 4 (even) — the 2-pack only breaks on the Marrakech.
  const bom = computeHplShowerBom(
    config("alcove", [60, 32, 32], ["HPL-MARRAKECH", "HPL-PURE-WHITE", "HPL-PURE-WHITE"]),
  );
  const panelOffers = bom.upsells.offers.filter((o) => o.kind === "panel");
  assert.equal(panelOffers.length, 1);
  assert.equal(panelOffers[0].skuCode, "HPL-MARRAKECH");
});

test("accepted upsells become distinguishable extra lines, not bumped quantities", () => {
  const base = computeHplShowerBom(config("alcove", [60, 32, 32]));
  const offer = base.upsells.offers.find((o) => o.kind === "panel")!;
  const withUpsell = computeHplShowerBom(config("alcove", [60, 32, 32]), { acceptedUpsellIds: [offer.id] });

  // The base panel line is untouched...
  const basePanelLine = withUpsell.lines.find((l) => l.kind === "panel" && !l.upsell)!;
  assert.equal(basePanelLine.qty, 7);
  // ...and the upsell rides alongside it at 25% off.
  const upsellLine = withUpsell.lines.find((l) => l.kind === "panel" && l.upsell)!;
  assert.equal(upsellLine.qty, 1);
  assert.equal(upsellLine.discountPct, 25);
  // 7 for the job + 1 as cover = 8, which keeps the 2-packs whole.
  assert.equal(withUpsell.lines.filter((l) => l.kind === "panel").reduce((a, l) => a + l.qty, 0), 8);
});

// -------------------------------------------------------- end-cap lookup

test("end-cap signature ignores wall order", () => {
  assert.equal(hplEndCapSignature(config("alcove", [60, 32, 32]).walls), "3:32,32,60");
  assert.equal(hplEndCapSignature(config("alcove", [32, 60, 32]).walls), "3:32,32,60");
});

test("an unknown configuration is flagged rather than refused", () => {
  const bom = computeHplShowerBom(config("alcove", [72, 42, 42]));
  assert.equal(bom.trim.endCapEstimated, true, "flagged as an estimate");
  assert.ok(bom.trim.endCap > 0, "still produces a usable number — warn, don't block");
  assert.ok(bom.notes.some((n) => n.code === "end-cap-estimated"), "and surfaces a note");
});

test("an unselected wall still counts panels and is noted", () => {
  const cfg: HplShowerConfig = { type: "alcove", walls: [wall("back", 60), { id: "left", widthIn: 32, skuCode: null }] };
  const bom = computeHplShowerBom(cfg);
  assert.equal(bom.panels.total, 5, "geometry drives the count, not the decor choice");
  assert.ok(bom.notes.some((n) => n.code === "wall-unselected"));
});

// --------------------------------------------------- geometry provenance

test("panel constants match the Nature Panel catalogue", () => {
  // The takeoff module holds no imports so it stays node-testable; this is the guard that
  // stops that copy drifting from the physical spec it mirrors.
  assert.equal(HPL_PANEL_WIDTH_IN, catalog.panel_specs.width_in);
  assert.equal(HPL_PANEL_HEIGHT_IN, catalog.panel_specs.height_in);
});

test("all 21 HPL decors share one physical size", () => {
  // panel_specs sits at the catalogue ROOT, not per decor — which is why pattern never
  // affects the count. If a decor ever carries its own size this test fails loudly.
  const all = catalog.collections.flatMap((c: { panels: unknown[] }) => c.panels);
  assert.equal(all.length, 21);
  assert.ok(!all.some((p) => Object.prototype.hasOwnProperty.call(p, "panel_specs")));
});

// --------------------------------------------------------------- trim rule

test("interior corner is one per internal junction", () => {
  assert.equal(computeHplTrimCount(config("corner", [32, 32])).interiorCorner, 1);
  assert.equal(computeHplTrimCount(config("alcove", [60, 32, 32])).interiorCorner, 2);
});

test("base profile is a per-shower length takeoff with no cross-shower reuse", () => {
  // 64" of wall fits inside one 94.5" length; 124" needs two.
  assert.equal(computeHplTrimCount(config("corner", [32, 32])).baseProfile, 1);
  assert.equal(computeHplTrimCount(config("alcove", [60, 32, 32])).baseProfile, 2);
  // Two identical showers on one order are two separate takeoffs — never shared.
  const one = computeHplTrimCount(config("corner", [32, 32])).baseProfile;
  assert.equal(one + one, 2);
});

test("fireHplUpsells is pure with respect to its input", () => {
  const bom = computeHplShowerBom(config("alcove", [60, 32, 32]));
  assert.deepEqual(fireHplUpsells(bom), fireHplUpsells(bom));
});
