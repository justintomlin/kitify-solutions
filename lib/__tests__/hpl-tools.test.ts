/**
 * HPL tools & replenishment (Phase D).
 *
 * The one rule that matters: NOTHING IS EVER ADDED WITHOUT A TAP. A tool is bought once every
 * ten or twenty kits, so an offer that auto-added — or that quietly persisted a zero, or that
 * survived being retired from the catalogue — would put a line on an order the dealer never
 * asked for and might not notice.
 *
 * Node's built-in runner with type stripping — no framework:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  HPL_TOOL_OFFERS, HPL_TOOL_MAX_QTY, setToolQty, toToolPicks, toolOfferFor, type HplToolPick,
} from "../hpl-tools.ts";
import { HPL_TOOL_SKU_CODES, HPL_REQUIRED_SKU_CODES } from "../hpl-shower-takeoff.ts";

const GROUT = HPL_TOOL_SKU_CODES.groutTool;
const SUCTION = HPL_TOOL_SKU_CODES.suctionCup;

// ----------------------------------------------------------- the catalogue

test("the offer list is the six specced items, tools first", () => {
  assert.equal(HPL_TOOL_OFFERS.length, 6);
  assert.deepEqual(HPL_TOOL_OFFERS.filter((o) => o.group === "tool").map((o) => o.skuCode), [GROUT, SUCTION]);
  assert.equal(HPL_TOOL_OFFERS.filter((o) => o.group === "replenishment").length, 4);
});

test("both tool SKUs are on the list an admin has to create", () => {
  // HPL_REQUIRED_SKU_CODES is what the inventory seam checks against; a tool missing from it
  // would order as an unmatched line forever.
  assert.equal(HPL_REQUIRED_SKU_CODES.includes(GROUT), true);
  assert.equal(HPL_REQUIRED_SKU_CODES.includes(SUCTION), true);
});

test("every offer resolves to a distinct SKU with a label key", () => {
  const codes = HPL_TOOL_OFFERS.map((o) => o.skuCode);
  assert.equal(new Set(codes).size, codes.length, "two offers share a SKU");
  for (const o of HPL_TOOL_OFFERS) {
    assert.match(o.labelKey, /^configurator\.shower\.hplTools\./);
    assert.equal(toolOfferFor(o.skuCode), o);
  }
});

// ------------------------------------------------------------- quantities

test("nothing is taken until a quantity is set", () => {
  assert.deepEqual(toToolPicks(undefined), []);
  assert.deepEqual(toToolPicks(null), []);
  assert.deepEqual(toToolPicks([]), []);
});

test("setting a quantity adds a line; raising it edits in place", () => {
  let picks: HplToolPick[] = [];
  picks = setToolQty(picks, GROUT, 1);
  assert.deepEqual(picks, [{ skuCode: GROUT, qty: 1 }]);
  picks = setToolQty(picks, GROUT, 3);
  assert.deepEqual(picks, [{ skuCode: GROUT, qty: 3 }], "a second line was added instead of editing");
});

test("zero REMOVES the line rather than storing a zero", () => {
  // "Took none" and "was never asked" have to be the same thing in a saved quote, or an offer
  // the dealer opened and closed would leave a trace on a reopened one.
  const picks = setToolQty([{ skuCode: GROUT, qty: 2 }], GROUT, 0);
  assert.deepEqual(picks, []);
  // …and stepping below zero cannot go negative.
  assert.deepEqual(setToolQty([{ skuCode: GROUT, qty: 1 }], GROUT, -5), []);
});

test("quantities are clamped and whole", () => {
  assert.deepEqual(setToolQty([], GROUT, 2.7), [{ skuCode: GROUT, qty: 2 }]);
  assert.deepEqual(setToolQty([], GROUT, 5000), [{ skuCode: GROUT, qty: HPL_TOOL_MAX_QTY }]);
  assert.deepEqual(setToolQty([], GROUT, NaN), []);
});

test("lines keep the order the dealer built them in", () => {
  let picks: HplToolPick[] = [];
  picks = setToolQty(picks, SUCTION, 1);
  picks = setToolQty(picks, GROUT, 2);
  picks = setToolQty(picks, SUCTION, 4); // editing the first must not move it to the end
  assert.deepEqual(picks.map((p) => p.skuCode), [SUCTION, GROUT]);
});

test("setToolQty is pure", () => {
  const picks: HplToolPick[] = [{ skuCode: GROUT, qty: 1 }];
  const before = JSON.stringify(picks);
  setToolQty(picks, GROUT, 9);
  setToolQty(picks, SUCTION, 2);
  setToolQty(picks, GROUT, 0);
  assert.equal(JSON.stringify(picks), before);
});

// ------------------------------------------------------ reading back a quote

test("an unknown SKU is refused on the way in and dropped on the way out", () => {
  // A code retired from the offer list must stop being quoted off old saved quotes, and a
  // hand-edited document must not be able to inject a SKU that was never on offer.
  assert.deepEqual(setToolQty([], "HPL-TOOL-NOPE", 3), []);
  assert.deepEqual(toToolPicks([{ skuCode: "HPL-TOOL-NOPE", qty: 3 }]), []);
});

test("a malformed stored value degrades to nothing taken, never to a bad line", () => {
  // This rides inside a jsonb quote document, so it has to survive anything.
  for (const bad of ["nonsense", 42, {}, [null], [7], [{ qty: 2 }], [{ skuCode: GROUT }],
                     [{ skuCode: GROUT, qty: 0 }], [{ skuCode: GROUT, qty: -1 }], [{ skuCode: GROUT, qty: "x" }]]) {
    assert.deepEqual(toToolPicks(bad), [], `${JSON.stringify(bad)} produced a line`);
  }
});

test("a duplicated SKU in a stored quote reads once, not twice", () => {
  assert.deepEqual(
    toToolPicks([{ skuCode: GROUT, qty: 2 }, { skuCode: GROUT, qty: 5 }]),
    [{ skuCode: GROUT, qty: 2 }],
  );
});

test("a good stored value round-trips", () => {
  const stored = [{ skuCode: GROUT, qty: 1 }, { skuCode: SUCTION, qty: 3 }];
  assert.deepEqual(toToolPicks(JSON.parse(JSON.stringify(stored))), stored);
});
