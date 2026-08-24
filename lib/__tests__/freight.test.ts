/**
 * Freight (Phase D).
 *
 * Four rules, all of which are business decisions rather than derivations, and all of which are
 * invisible when they go wrong — a wrong freight number looks exactly like a right one:
 *
 *   1. Two bathrooms is NOT twice one bathroom. The second rides the same truck.
 *   2. Freight is gated on a bathing configuration. A vanity-only quote ships differently and
 *      must not silently acquire $500.
 *   3. Freight is NEVER marked up. It is a cost passed through, not goods resold.
 *   4. A zero override means "charge no freight" and is not the same as "no override".
 *
 * Node's built-in runner with type stripping — no framework:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  FREIGHT_BY_BATHROOM_COUNT, freightForBathroomCount, freightForQuote,
  hasBathingConfiguration, resolveFreight, retailWithFreight,
} from "../freight.ts";
import type { Bathroom } from "../bathrooms.ts";

const SHOWER = { selections: { path: "shower", baseId: "60x36" }, price: { total: 464.4, lines: [] } };
const VANITY = { selections: { size: 36 }, price: { total: 900, lines: [] } };
const ROOM = { selections: {}, price: { total: 100, lines: [] } };

const bath = (id: string, slots: Partial<Bathroom> = {}): Bathroom => ({ id, name: null, ...slots });

// ------------------------------------------------------------ the lookup

test("one bathroom is $500 and two are $850 — flat, not doubled", () => {
  // The whole reason this is a table. A linear rule would say $1,000 for two, and the second
  // bathroom genuinely rides the same truck.
  assert.equal(freightForBathroomCount(1), 500);
  assert.equal(freightForBathroomCount(2), 850);
  assert.notEqual(freightForBathroomCount(2), (freightForBathroomCount(1) as number) * 2);
});

test("a count above the largest key holds at the largest value", () => {
  // Three bathrooms is not a case anyone has priced yet. Holding at $850 is the honest
  // placeholder — under-quoting a truck is a business problem, but inventing a number for a
  // configuration nobody has shipped would be worse.
  assert.equal(freightForBathroomCount(3), 850);
  assert.equal(freightForBathroomCount(9), 850);
});

test("no bathrooms means no freight", () => {
  assert.equal(freightForBathroomCount(0), null);
  assert.equal(freightForBathroomCount(-1), null);
  assert.equal(freightForBathroomCount(NaN), null);
});

test("adding a row to the table is the ONLY change needed to extend it", () => {
  // The extension shape, asserted rather than described. A `3: 1200` must take effect
  // everywhere at once — if this test needs editing to add a row, the lookup grew a formula.
  const table = { ...FREIGHT_BY_BATHROOM_COUNT };
  try {
    (FREIGHT_BY_BATHROOM_COUNT as Record<number, number>)[3] = 1200;
    assert.equal(freightForBathroomCount(3), 1200);
    assert.equal(freightForBathroomCount(4), 1200, "a new key becomes the floor for everything above it");
    assert.equal(freightForBathroomCount(2), 850, "existing rows are untouched");
  } finally {
    delete (FREIGHT_BY_BATHROOM_COUNT as Record<number, number>)[3];
    assert.deepEqual(FREIGHT_BY_BATHROOM_COUNT, table);
  }
});

// ------------------------------------------------- the bathing-config gate

test("a quote with no bathing configuration carries no freight", () => {
  // A vanity-only or flooring-only quote. Quoting $500 against a $900 vanity would be wrong in
  // a way the dealer would have to notice and undo on every single quote.
  assert.equal(hasBathingConfiguration({ vanity: VANITY }), false);
  assert.equal(freightForQuote({ vanity: VANITY }), null);
  assert.equal(freightForQuote({ room: ROOM }), null);
  assert.equal(freightForQuote({}), null);
});

test("a legacy single-bathroom quote with a shower is $500", () => {
  // Through the accessor, so a quote written before bathrooms existed prices identically.
  assert.equal(freightForQuote({ room: ROOM, shower: SHOWER, vanity: VANITY, plumbing: null }), 500);
});

test("a two-bathroom quote is $850 even when only one bathroom has the shower", () => {
  // Freight is about the truck, not about which room the pan ends up in.
  const q = { bathrooms: [bath("b1", { shower: SHOWER }), bath("b2", { vanity: VANITY })] };
  assert.equal(freightForQuote(q), 850);
});

test("a three-bathroom quote holds at the top of the table", () => {
  const q = { bathrooms: [bath("b1", { shower: SHOWER }), bath("b2", { shower: SHOWER }), bath("b3", { vanity: VANITY })] };
  assert.equal(freightForQuote(q), 850);
});

test("two bathrooms with no shower anywhere still carries no freight", () => {
  // The gate is the bathing fixture, not the bathroom count — adding a second vanity-only
  // bathroom must not conjure a freight charge that one vanity-only bathroom did not have.
  const q = { bathrooms: [bath("b1", { vanity: VANITY }), bath("b2", { vanity: VANITY })] };
  assert.equal(freightForQuote(q), null);
});

// --------------------------------------------------------- the override

test("no override uses the computed estimate", () => {
  assert.deepEqual(resolveFreight(500, null), { amount: 500, computed: 500, overridden: false });
  assert.deepEqual(resolveFreight(500, undefined), { amount: 500, computed: 500, overridden: false });
  assert.equal(resolveFreight(null, null), null, "nothing computed and nothing typed = no line at all");
});

test("an override replaces the estimate and keeps it visible", () => {
  // The computed figure survives so the dealer can be shown the gap rather than having the
  // estimate quietly disappear behind their own number.
  assert.deepEqual(resolveFreight(500, 650), { amount: 650, computed: 500, overridden: true });
});

test("a ZERO override means charge no freight — not 'use the estimate'", () => {
  // The single most dangerous confusion here. Freight absorbed into the price, or the customer
  // collecting, is a real answer, and `|| null` anywhere on this path would turn it into $500.
  const r = resolveFreight(500, 0);
  assert.deepEqual(r, { amount: 0, computed: 500, overridden: true });
  assert.notEqual(r!.amount, 500);
});

test("an override applies even where nothing was computed", () => {
  // A vanity-only proposal the dealer knows will still need a truck.
  assert.deepEqual(resolveFreight(null, 300), { amount: 300, computed: null, overridden: true });
});

test("a non-numeric override falls back to the estimate rather than to NaN", () => {
  assert.deepEqual(resolveFreight(500, NaN), { amount: 500, computed: 500, overridden: false });
});

// ------------------------------------------------- freight is never marked up

test("markup does not reach freight", () => {
  // THE load-bearing assertion of this module. $1,000 of goods at 100% markup plus $500 of
  // freight is $2,500 — not $3,000. The error is invisible in the total, so nothing but a test
  // would catch it coming back.
  assert.equal(retailWithFreight(1000, 100, 500), 2500);
  assert.notEqual(retailWithFreight(1000, 100, 500), (1000 + 500) * 2);
});

test("the freight component is identical at every markup", () => {
  // Stated as the property rather than as one example: the homeowner sees the same freight
  // number the dealer does, whatever the dealer's margin happens to be.
  const goods = 1000;
  for (const markup of [0, 15, 40, 100]) {
    const withFreight = retailWithFreight(goods, markup, 500);
    const without = retailWithFreight(goods, markup, null);
    assert.equal(round(withFreight - without), 500, `markup ${markup}% moved the freight`);
  }
});

test("no freight adds nothing at all", () => {
  assert.equal(retailWithFreight(1000, 40, null), 1400);
  assert.equal(retailWithFreight(1000, 0, null), 1000);
});

const round = (n: number) => Math.round(n * 100) / 100;
