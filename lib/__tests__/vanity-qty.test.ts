/**
 * Twin vanities — one configuration, a count of how many of it to take.
 *
 * A primary bath with his-and-hers cabinets is the SAME cabinet twice. The count is what the
 * price multiplies, what the faucet quantity follows, and what the room plan draws twice. The
 * contract that matters is that a bathroom with one vanity — every bathroom that exists today
 * — resolves and totals byte-identically to what it did before the count existed.
 *
 * Node's built-in runner with type stripping — no framework:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  vanityCount, isTwinVanity, setVanityQty, bathroomSinkCount, MAX_VANITY_QTY,
  bathroomTotal, bathroomsTotal, quoteBathrooms, quoteFlatSlots, isBathroomEmpty,
  type Bathroom,
} from "../bathrooms.ts";

const ROOM = { selections: {}, price: { total: 100, lines: [] } };
const SHOWER = { selections: {}, price: { total: 464.4, lines: [] } };
const PLUMB = { selections: {}, price: { total: 200, lines: [] } };
const VANITY = { selections: { size: 36, sinks: 1 }, price: { total: 900, lines: [] } };
const VANITY_DOUBLE = { selections: { size: 60, sinks: 2 }, price: { total: 1200, lines: [] } };

const bath = (over: Partial<Bathroom> = {}): Bathroom => ({ id: "b1", name: null, ...over });

// ------------------------------------------------------- the legacy contract

test("a bathroom with no vanityQty takes exactly one", () => {
  // Absent is what every bathroom written before this carries, and it must be
  // indistinguishable from an explicit 1.
  assert.equal(vanityCount(bath({ vanity: VANITY })), 1);
  assert.equal(vanityCount(bath({ vanity: VANITY, vanityQty: 1 })), 1);
  assert.equal(vanityCount(bath({ vanity: VANITY, vanityQty: null })), 1);
  assert.equal(isTwinVanity(bath({ vanity: VANITY })), false);
});

test("a bathroom with no vanity takes ZERO, not one", () => {
  // The count answers "how many cabinets are on this quote". Answering 1 for a bathroom with
  // no vanity would put a phantom faucet on the plumbing seed.
  assert.equal(vanityCount(bath()), 0);
  assert.equal(vanityCount(bath({ vanity: null })), 0);
  assert.equal(vanityCount(bath({ vanity: null, vanityQty: 2 })), 0, "a count without a cabinet is still none");
  assert.equal(vanityCount(bath({ shower: SHOWER })), 0);
});

test("one vanity totals exactly what it always did", () => {
  // The byte-identity guarantee, stated as a number.
  const b = bath({ room: ROOM, shower: SHOWER, vanity: VANITY, plumbing: PLUMB });
  assert.equal(bathroomTotal(b), 100 + 464.4 + 900 + 200);
  assert.equal(bathroomTotal({ ...b, vanityQty: 1 }), 1664.4, "an explicit 1 must not change the number");
});

// ------------------------------------------------------------------- money

test("a twin vanity is charged twice", () => {
  // Off the slot alone the second cabinet would be silently free — a $900 error that looks
  // exactly like a correct quote.
  const b = bath({ room: ROOM, shower: SHOWER, vanity: VANITY, vanityQty: 2, plumbing: PLUMB });
  assert.equal(bathroomTotal(b), 100 + 464.4 + 900 * 2 + 200);
});

test("the count multiplies ONLY the vanity", () => {
  // Room, shower and plumbing are per-bathroom whatever the cabinet count is. A second sink
  // does not mean a second shower.
  const one = bath({ room: ROOM, shower: SHOWER, vanity: VANITY, plumbing: PLUMB });
  const two = { ...one, vanityQty: 2 };
  assert.equal(bathroomTotal(two) - bathroomTotal(one), 900);
});

test("a multi-bathroom quote totals twins per bathroom", () => {
  const baths: Bathroom[] = [
    bath({ id: "b1", vanity: VANITY, vanityQty: 2 }),
    { id: "b2", name: null, vanity: VANITY_DOUBLE },
  ];
  assert.equal(bathroomsTotal(baths), 900 * 2 + 1200);
});

// -------------------------------------------------------------- the cap

test("the count is clamped to the cap, and the cap is two", () => {
  // Two is a design decision, not an accident: the affordance is a checkbox, and the room
  // plan carries the twin as a second FIXTURE rather than a list.
  assert.equal(MAX_VANITY_QTY, 2);
  assert.equal(vanityCount(bath({ vanity: VANITY, vanityQty: 99 })), 2);
  assert.equal(vanityCount(bath({ vanity: VANITY, vanityQty: 3 })), 2);
});

test("a nonsense stored count resolves to one rather than propagating", () => {
  // jsonb: a string, a float, a negative and a NaN all have to land somewhere sane.
  for (const q of [0, -1, 0.5, NaN, Infinity, "two" as unknown as number, null, undefined]) {
    assert.equal(vanityCount(bath({ vanity: VANITY, vanityQty: q as number })), 1, `qty ${String(q)}`);
  }
  // …except a legitimate float, which floors toward the count actually orderable.
  assert.equal(vanityCount(bath({ vanity: VANITY, vanityQty: 2.9 })), 2);
});

test("setVanityQty clamps and is pure", () => {
  const baths = [bath({ id: "b1", vanity: VANITY }), { id: "b2", name: null, vanity: VANITY }];
  const before = JSON.stringify(baths);
  assert.equal(setVanityQty(baths, "b1", 2)[0].vanityQty, 2);
  assert.equal(setVanityQty(baths, "b1", 9)[0].vanityQty, 2, "clamped up");
  assert.equal(setVanityQty(baths, "b1", 0)[0].vanityQty, 1, "clamped down");
  assert.equal(setVanityQty(baths, "b1", 2)[1].vanityQty, undefined, "the other bathroom is untouched");
  assert.equal(JSON.stringify(baths), before, "setVanityQty mutated its input");
  assert.deepEqual(setVanityQty(baths, "nope", 2), baths.map((b) => ({ ...b })));
});

// ------------------------------------------------------------- sink count

test("the sink count is every basin across every cabinet", () => {
  // This is what the faucet quantity follows. Two double-sink vanities is FOUR faucets, and
  // reading one cabinet's sink count would have shipped two.
  assert.equal(bathroomSinkCount(bath({ vanity: VANITY })), 1);
  assert.equal(bathroomSinkCount(bath({ vanity: VANITY, vanityQty: 2 })), 2);
  assert.equal(bathroomSinkCount(bath({ vanity: VANITY_DOUBLE })), 2);
  assert.equal(bathroomSinkCount(bath({ vanity: VANITY_DOUBLE, vanityQty: 2 })), 4);
});

test("a bathroom with no vanity has no sinks", () => {
  assert.equal(bathroomSinkCount(bath()), 0);
  assert.equal(bathroomSinkCount(bath({ shower: SHOWER })), 0);
});

test("a vanity with no recorded sink count is read as one basin", () => {
  // An older or half-built vanity document. Assuming one is the safe direction: it under-seeds
  // the faucet count, which a dealer can see and raise, rather than over-ordering silently.
  assert.equal(bathroomSinkCount(bath({ vanity: { price: { total: 900 } } })), 1);
  assert.equal(bathroomSinkCount(bath({ vanity: { selections: {} }, vanityQty: 2 })), 2);
  assert.equal(bathroomSinkCount(bath({ vanity: { selections: { sinks: "2" } } })), 1);
});

// ------------------------------------------------- nothing else moved

test("the flat mirror still carries the CONFIGURATION, and loses the count", () => {
  // Documented lossiness, same rule as two bathrooms in four flat columns: an untaught reader
  // gets one real cabinet rather than none. The bathrooms array carries the truth.
  const q = { bathrooms: [bath({ vanity: VANITY, vanityQty: 2 })] };
  assert.equal(quoteFlatSlots(q).vanity, VANITY);
  assert.equal(quoteBathrooms(q)[0].vanityQty, 2, "…and the array still has the count");
});

test("a legacy quote is untouched by any of this", () => {
  const q = { room: ROOM, shower: SHOWER, vanity: VANITY, plumbing: PLUMB, bathrooms: null };
  const b = quoteBathrooms(q);
  assert.equal(b.length, 1);
  assert.equal(vanityCount(b[0]), 1);
  assert.equal(bathroomTotal(b[0]), 1664.4);
  assert.deepEqual(quoteFlatSlots(q), { room: ROOM, shower: SHOWER, vanity: VANITY, plumbing: PLUMB });
});

test("emptiness is unaffected by the count", () => {
  assert.equal(isBathroomEmpty(bath()), true);
  assert.equal(isBathroomEmpty(bath({ vanityQty: 2 })), true, "a count with no cabinet is still empty");
  assert.equal(isBathroomEmpty(bath({ vanity: VANITY })), false);
});
