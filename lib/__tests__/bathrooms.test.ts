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
  addBathroom, removeBathroom, renameBathroom, setBathroomSlots, isBathroomEmpty,
  bathroomTotal, bathroomsTotal,
  labelForBathroom, labelForTier, toOptionNames,
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

// ------------------------------------------------------------- C2 mutation

test("addBathroom appends an empty bathroom with a fresh id", () => {
  const start = quoteBathrooms(legacyQuote());
  const { bathrooms, id } = addBathroom(start);
  assert.equal(bathrooms.length, 2);
  assert.equal(bathrooms[0], start[0], "the existing bathroom is untouched");
  assert.equal(bathrooms[1].id, id);
  assert.equal(bathrooms[1].name, null);
  assert.equal(isBathroomEmpty(bathrooms[1]), true);
  assert.notEqual(id, start[0].id);
});

test("bathroom ids are never reused after a middle removal", () => {
  // Sequential ids from length would re-issue "b2" here, and a claim pointing at the old b2
  // would silently re-target the new one.
  let baths = quoteBathrooms(legacyQuote());
  const a = addBathroom(baths); baths = a.bathrooms;
  const b = addBathroom(baths); baths = b.bathrooms;
  const removed = removeBathroom(baths, a.id).bathrooms;
  const c = addBathroom(removed);
  assert.equal(c.bathrooms.some((x) => x.id === a.id), false, `${a.id} was reissued`);
  assert.equal(new Set(c.bathrooms.map((x) => x.id)).size, c.bathrooms.length);
});

test("removeBathroom refuses to remove the last one", () => {
  // quoteBathrooms() guarantees at least one; a zero-bathroom quote would contradict that
  // everywhere downstream, so the floor lives here rather than in each caller.
  const one = quoteBathrooms(legacyQuote());
  const r = removeBathroom(one, one[0].id);
  assert.equal(r.bathrooms.length, 1);
  assert.equal(r.bathrooms[0], one[0]);
  assert.equal(r.activeId, one[0].id);
});

test("removing the active bathroom falls back to the PREVIOUS one", () => {
  const baths: Bathroom[] = [
    { id: "b1", name: "Master" }, { id: "b2", name: "Hall" }, { id: "b3", name: "Guest" },
  ];
  assert.equal(removeBathroom(baths, "b2").activeId, "b1", "middle → previous");
  assert.equal(removeBathroom(baths, "b3").activeId, "b2", "last → previous");
  // Removing the first has no previous, so it walks right instead of off the end.
  assert.equal(removeBathroom(baths, "b1").activeId, "b2");
  assert.deepEqual(removeBathroom(baths, "b2").bathrooms.map((b) => b.id), ["b1", "b3"]);
});

test("removing an unknown id is a no-op", () => {
  const baths: Bathroom[] = [{ id: "b1", name: null }, { id: "b2", name: null }];
  assert.deepEqual(removeBathroom(baths, "nope").bathrooms, baths);
});

test("renameBathroom trims, and an empty name resets to unnamed", () => {
  const baths: Bathroom[] = [{ id: "b1", name: null }, { id: "b2", name: "Hall" }];
  assert.equal(renameBathroom(baths, "b1", "  Master  ")[0].name, "Master");
  // "clear the field and tab away" must mean "go back to the placeholder", not "".
  assert.equal(renameBathroom(baths, "b2", "")[1].name, null);
  assert.equal(renameBathroom(baths, "b2", "   ")[1].name, null);
  assert.equal(renameBathroom(baths, "b2", null)[1].name, null);
  // Other bathrooms are untouched.
  assert.equal(renameBathroom(baths, "b1", "Master")[1].name, "Hall");
});

test("setBathroomSlots edits one bathroom and leaves the others alone", () => {
  const baths: Bathroom[] = [{ id: "b1", name: "Master", shower: SHOWER }, { id: "b2", name: "Hall" }];
  const next = setBathroomSlots(baths, "b2", { vanity: VANITY });
  assert.equal(next[1].vanity, VANITY);
  assert.equal(next[1].name, "Hall", "name survives a slot edit");
  assert.equal(next[0].shower, SHOWER, "the other bathroom is untouched");
  assert.equal(next[0], baths[0], "…and not even re-created");
});

test("every mutation helper is pure", () => {
  const baths: Bathroom[] = [{ id: "b1", name: "Master", shower: SHOWER }, { id: "b2", name: null }];
  const before = JSON.stringify(baths);
  addBathroom(baths);
  removeBathroom(baths, "b2");
  renameBathroom(baths, "b1", "Renamed");
  setBathroomSlots(baths, "b1", { vanity: VANITY });
  assert.equal(JSON.stringify(baths), before, "a helper mutated the array it was given");
});

// --------------------------------------------------------------- C2 money

test("a quote's total is every bathroom on it", () => {
  // The whole job, not the open tab. A dealer looking at bathroom 2 must still see what the
  // quote costs, and the saved `total` column is what a proposal marks up.
  const baths: Bathroom[] = [
    { id: "b1", name: "Master", room: ROOM, shower: SHOWER, vanity: VANITY, plumbing: PLUMB },
    { id: "b2", name: "Hall", shower: SHOWER },
  ];
  assert.equal(bathroomTotal(baths[0]), 100 + 464.4 + 900 + 200);
  assert.equal(bathroomTotal(baths[1]), 464.4);
  assert.equal(bathroomsTotal(baths), 1664.4 + 464.4);
  // One bathroom: the same number the hub summed from four slots before C2 existed.
  assert.equal(bathroomsTotal(quoteBathrooms(legacyQuote())), 1664.4);
});

test("an empty or malformed slot contributes zero rather than NaN", () => {
  // These are jsonb. A half-written or hand-edited document must not turn a dealer's total
  // into "$NaN" — and, worse, save as null.
  assert.equal(bathroomTotal({ id: "b1", name: null }), 0);
  assert.equal(
    bathroomTotal({ id: "b1", name: null, shower: { price: { total: "464.40" } }, vanity: { price: null }, room: {} }),
    0,
  );
  assert.equal(bathroomsTotal([]), 0);
});

// -------------------------------------------------------------- C2 labels

const t: (k: string, v?: Record<string, string>) => string = (k, v) =>
  k === "configurator.bathroom.numbered" ? `Bathroom ${v?.n}` :
  k === "configurator.option.numbered" ? `Option ${v?.n}` : k;

test("a bathroom label falls back to a one-based number", () => {
  assert.equal(labelForBathroom({ id: "b1", name: null }, 0, t), "Bathroom 1");
  assert.equal(labelForBathroom({ id: "b2", name: "  " }, 1, t), "Bathroom 2", "whitespace is not a name");
  assert.equal(labelForBathroom({ id: "b1", name: "Master" }, 0, t), "Master");
  assert.equal(labelForBathroom(undefined, 4, t), "Bathroom 5");
});

test("an option label falls back to Option N, never to the tier key", () => {
  // good/better/best is a database detail and a ladder nobody chose — it must not reach the UI.
  assert.equal(labelForTier("good", null, t), "Option 1");
  assert.equal(labelForTier("better", null, t), "Option 2");
  assert.equal(labelForTier("best", null, t), "Option 3");
  const names = { good: "SPC package", better: null, best: "  " };
  assert.equal(labelForTier("good", names, t), "SPC package");
  assert.equal(labelForTier("better", names, t), "Option 2");
  assert.equal(labelForTier("best", names, t), "Option 3", "whitespace is not a name");
});

test("toOptionNames keeps real names and collapses empty shapes to null", () => {
  assert.deepEqual(toOptionNames({ good: "SPC", better: null, best: null }), { good: "SPC", better: null, best: null });
  assert.equal(toOptionNames({ good: "", better: "  ", best: null }), null, "all-empty reads as unnamed");
  assert.equal(toOptionNames(null), null);
  assert.equal(toOptionNames("nonsense"), null);
  assert.equal(toOptionNames([]), null);
  // Unknown keys are dropped rather than carried through.
  assert.deepEqual(toOptionNames({ good: "A", nope: "B" }), { good: "A", better: null, best: null });
});

test("quoteBathrooms does not mutate its input", () => {
  const q = legacyQuote();
  const before = JSON.stringify(q);
  quoteBathrooms(q);
  quoteFlatSlots(q);
  isMultiBathroom(q);
  assert.equal(JSON.stringify(q), before);
});
