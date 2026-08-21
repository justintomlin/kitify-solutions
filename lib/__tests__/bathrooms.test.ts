/**
 * The Bathroom seam (Phase C1).
 *
 * C1's entire contract is that nothing changes: every quote that exists today has
 * bathrooms = null and four populated flat columns, and must keep resolving to exactly the
 * configuration it always did. These tests are that contract, written down.
 *
 * Node's built-in runner with type stripping — no framework:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  quoteBathrooms, isMultiBathroom, toBathrooms, quoteFlatSlots, bathroomSlots,
  DEFAULT_BATHROOM_ID, type Bathroom,
} from "../bathrooms.ts";

const SHOWER = { selections: { baseId: "60x36" }, price: { total: 464.4, lines: [] } };
const VANITY = { selections: { size: 36 }, price: { total: 900, lines: [] } };
const ROOM = { selections: {}, price: { total: 100, lines: [] } };
const PLUMB = { selections: { order: { faucet: "DELTA-1" } }, price: { total: 200, lines: [] } };

const legacyQuote = () => ({ room: ROOM, shower: SHOWER, vanity: VANITY, plumbing: PLUMB, bathrooms: null });

// ------------------------------------------------------- the legacy contract

test("a legacy quote resolves to exactly one bathroom holding its four slots", () => {
  const b = quoteBathrooms(legacyQuote());
  assert.equal(b.length, 1);
  assert.equal(b[0].id, DEFAULT_BATHROOM_ID);
  assert.equal(b[0].name, null, "a synthesised bathroom is unnamed — C2 adds naming");
  assert.equal(b[0].room, ROOM);
  assert.equal(b[0].shower, SHOWER);
  assert.equal(b[0].vanity, VANITY);
  assert.equal(b[0].plumbing, PLUMB);
  assert.equal(isMultiBathroom(legacyQuote()), false);
});

test("quoteBathrooms is TOTAL — always at least one bathroom, whatever it is given", () => {
  // This is what makes quoteBathrooms(q)[0].shower safe at render sites that used to read
  // q.shower directly. If it could return [], every one of those becomes a crash.
  for (const input of [
    {},
    { bathrooms: null },
    { bathrooms: [] },
    { bathrooms: "nonsense" },
    { bathrooms: 42 },
    { bathrooms: [null, undefined] },
    { bathrooms: [{ noId: true }] },
    { bathrooms: {} },
    { room: null, shower: null, vanity: null, plumbing: null },
  ] as const) {
    const b = quoteBathrooms(input as never);
    assert.equal(b.length >= 1, true, `empty for ${JSON.stringify(input)}`);
    assert.equal(typeof b[0].id, "string");
  }
});

test("an empty legacy quote still yields one bathroom with four nulls, not undefined", () => {
  const b = quoteBathrooms({})[0];
  assert.deepEqual(bathroomSlots(b), { room: null, shower: null, vanity: null, plumbing: null });
});

// -------------------------------------------------------- the stored shape

test("a stored bathrooms array wins over the flat slots", () => {
  const baths: Bathroom[] = [
    { id: "b1", name: "Master", shower: SHOWER },
    { id: "b2", name: "Hall", vanity: VANITY },
  ];
  const q = { room: ROOM, shower: null, vanity: null, plumbing: null, bathrooms: baths };
  assert.deepEqual(quoteBathrooms(q), baths);
  assert.equal(isMultiBathroom(q), true);
});

test("a single-element array is a real bathroom, not a legacy quote", () => {
  const q = { room: ROOM, shower: SHOWER, vanity: null, plumbing: null,
              bathrooms: [{ id: "b1", name: "Master", vanity: VANITY }] };
  const b = quoteBathrooms(q);
  assert.equal(b.length, 1);
  assert.equal(b[0].id, "b1");
  assert.equal(b[0].name, "Master");
  // The array's content is authoritative — the flat slots are its mirror, not a merge source.
  assert.equal(b[0].vanity, VANITY);
  assert.equal(b[0].shower, undefined);
  assert.equal(isMultiBathroom(q), false);
});

test("toBathrooms drops entries with no stable id but keeps the rest", () => {
  const mixed = toBathrooms([{ id: "b1", name: null }, { name: "no id" }, null, 7, { id: "b2", name: null }]);
  assert.equal(mixed?.length, 2);
  assert.deepEqual(mixed?.map((b) => b.id), ["b1", "b2"]);
  // Nothing usable ⇒ null, which routes the caller back to the flat columns.
  assert.equal(toBathrooms([{ name: "no id" }]), null);
  assert.equal(toBathrooms([]), null);
  assert.equal(toBathrooms(null), null);
  assert.equal(toBathrooms({ id: "not-an-array" }), null);
});

// ------------------------------------------------------------- dual-write

test("dual-write: one bathroom mirrors into the flat columns", () => {
  // The rollback guarantee. Old code reads only the flat columns, so they must be complete.
  const q = { room: null, shower: null, vanity: null, plumbing: null,
              bathrooms: [{ id: "b1", name: null, room: ROOM, shower: SHOWER, vanity: VANITY, plumbing: PLUMB }] };
  assert.deepEqual(quoteFlatSlots(q), { room: ROOM, shower: SHOWER, vanity: VANITY, plumbing: PLUMB });
});

test("dual-write: a legacy save passes its flat slots straight through", () => {
  assert.deepEqual(quoteFlatSlots(legacyQuote()), { room: ROOM, shower: SHOWER, vanity: VANITY, plumbing: PLUMB });
});

test("dual-write: two bathrooms put the FIRST in the flat columns, not nothing", () => {
  // Deliberate. Writing nulls would make old code render an empty quote, which reads as data
  // loss; writing bathroom 1 makes it render a partial quote, which reads as an old client.
  const q = { bathrooms: [
    { id: "b1", name: "Master", room: ROOM, shower: SHOWER, vanity: null, plumbing: null },
    { id: "b2", name: "Hall", room: null, shower: null, vanity: VANITY, plumbing: PLUMB },
  ] };
  assert.deepEqual(quoteFlatSlots(q), { room: ROOM, shower: SHOWER, vanity: null, plumbing: null });
});

test("dual-write: a caller passing only flat slots still writes a real bathrooms array", () => {
  // This is what makes saving the per-row migration path: quoteToRow writes
  // quoteBathrooms(q), which is total, so a legacy quote gains its array the next time it is
  // touched and no sweep of the table is ever needed. Mirrors lib/store.ts quoteToRow.
  const row = { ...quoteFlatSlots(legacyQuote()), bathrooms: quoteBathrooms(legacyQuote()) };
  assert.equal(Array.isArray(row.bathrooms), true);
  assert.equal(row.bathrooms.length, 1);
  assert.equal(row.bathrooms[0].id, DEFAULT_BATHROOM_ID);
  assert.equal(row.bathrooms[0].shower, SHOWER);
  // …and the legacy columns are written too, which is the half that makes rollback safe.
  assert.equal(row.shower, SHOWER);
  assert.equal(row.room, ROOM);
});

test("round-trip: flat → bathrooms → flat is lossless for one bathroom", () => {
  const q = legacyQuote();
  const viaBathrooms = { bathrooms: quoteBathrooms(q) };
  assert.deepEqual(quoteFlatSlots(viaBathrooms), quoteFlatSlots(q));
});

// ------------------------------------------------- frozen snapshot reading

test("a frozen snapshot's quote object reads through the same accessor", () => {
  // The snapshot's `quote` is not a Quote — it has no id/status/timestamps — but it has the
  // same slots, which is why BathroomSlots is structural rather than importing Quote.
  const legacySnapshotQuote = { id: "q1", name: "Option A", room: ROOM, shower: SHOWER,
                                vanity: VANITY, plumbing: PLUMB, dealerTotal: 1664.4 };
  const b = quoteBathrooms(legacySnapshotQuote);
  assert.equal(b.length, 1);
  assert.equal(b[0].shower, SHOWER, "a pre-C1 order must still resolve its shower");

  const c1SnapshotQuote = { ...legacySnapshotQuote, bathrooms: [{ id: "b1", name: null, shower: SHOWER }] };
  assert.equal(quoteBathrooms(c1SnapshotQuote).length, 1);
});

test("quoteBathrooms does not mutate its input", () => {
  const q = legacyQuote();
  const before = JSON.stringify(q);
  quoteBathrooms(q);
  quoteFlatSlots(q);
  isMultiBathroom(q);
  assert.equal(JSON.stringify(q), before);
});
