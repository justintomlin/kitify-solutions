/**
 * What a warranty claim points at (Phase C2).
 *
 * The C survey's risk 4: claims.affected_products holds bare strings — 'room' | 'shower' |
 * 'vanity' | 'plumbing' — and with two bathrooms "shower" no longer identifies a product.
 * Existing claims have no bathroom in them and never will.
 *
 * So the contract has two halves and both are asserted here:
 *
 *   A single-bathroom order — which is every order placed before C2 — produces and reads back
 *   BARE keys, exactly as it always did. Nothing about an old claim changes.
 *
 *   A multi-bathroom order produces SCOPED keys, and a scoped key read back names the room.
 *
 * Node's built-in runner with type stripping — no framework:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  claimLines, claimProductLabel, parseProductKey, scopedProductKey, PRODUCT_KEYS,
} from "../claim-scope.ts";

const SHOWER = { selections: {}, price: { total: 464.4, lines: [] } };
const VANITY = { selections: {}, price: { total: 900, lines: [] } };
const PLUMB = { selections: {}, price: { total: 200, lines: [] } };

// Mirrors the app's translator closely enough to assert on what a contractor reads.
const t: (k: string, v?: Record<string, string>) => string = (k, v) =>
  k === "configurator.bathroom.numbered" ? `Bathroom ${v?.n}`
  : k === "myJobs.claimProductScoped" ? `${v?.bathroom} · ${v?.product}`
  : k === "configurator.roomTitle" ? "Room"
  : k === "configurator.showerTitle" ? "Shower"
  : k === "configurator.vanityTitle" ? "Vanity"
  : k === "configurator.plumbingTitle" ? "Plumbing"
  : k;

// A snapshot frozen before Phase C1: four flat slots, no `bathrooms`.
const legacySnapshotQuote = { id: "q1", name: "Option A", room: null, shower: SHOWER, vanity: VANITY, plumbing: null };

const twoBathroomSnapshotQuote = {
  id: "q2", name: "Option A",
  room: null, shower: SHOWER, vanity: VANITY, plumbing: null, // the lossy flat mirror
  bathrooms: [
    { id: "b-aaa", name: "Master", shower: SHOWER, vanity: VANITY },
    { id: "b-bbb", name: null, plumbing: PLUMB },
  ],
};

// ------------------------------------------------- one bathroom: unchanged

test("a pre-C2 order still offers bare product keys", () => {
  const lines = claimLines(legacySnapshotQuote, t);
  assert.deepEqual(lines.map((l) => l.key), ["shower", "vanity"]);
  assert.deepEqual(lines.map((l) => l.bathroom), [null, null], "one bathroom is not worth naming");
  assert.deepEqual(lines.map((l) => l.kind), ["shower", "vanity"]);
});

test("a single-bathroom C2 order is bare too, not scoped to a bathroom of one", () => {
  // A real one-element array, not a synthesised one. Old rows and new rows must not disagree
  // about a job that only ever had one bathroom.
  const q = { bathrooms: [{ id: "b-aaa", name: "Master", shower: SHOWER }] };
  assert.deepEqual(claimLines(q, t).map((l) => l.key), ["shower"]);
});

test("a bare key reads back as just the product", () => {
  assert.equal(claimProductLabel("shower", legacySnapshotQuote, t), "Shower");
  // …including on an order whose snapshot can no longer be read at all.
  assert.equal(claimProductLabel("shower", null, t), "Shower");
});

test("only the products actually on the order are offered", () => {
  assert.deepEqual(claimLines({ room: null, shower: null, vanity: null, plumbing: null }, t), []);
  assert.deepEqual(claimLines(null, t), []);
});

// ---------------------------------------------- two bathrooms: scoped keys

test("a multi-bathroom order scopes every key to its bathroom", () => {
  const lines = claimLines(twoBathroomSnapshotQuote, t);
  assert.deepEqual(lines.map((l) => l.key), ["b-aaa:shower", "b-aaa:vanity", "b-bbb:plumbing"]);
  // The picker says which room, because "Shower" on a two-bathroom job is not an answer.
  assert.deepEqual(lines.map((l) => l.bathroom), ["Master", "Master", "Bathroom 2"]);
});

test("a scoped key reads back as the room and the product", () => {
  assert.equal(claimProductLabel("b-aaa:shower", twoBathroomSnapshotQuote, t), "Master · Shower");
  // An unnamed bathroom numbers itself, from its position in the order it was sold in.
  assert.equal(claimProductLabel("b-bbb:plumbing", twoBathroomSnapshotQuote, t), "Bathroom 2 · Plumbing");
});

test("a scoped key whose bathroom is gone degrades to the product, never a raw id", () => {
  assert.equal(claimProductLabel("b-zzz:shower", twoBathroomSnapshotQuote, t), "Shower");
  assert.equal(claimProductLabel("b-zzz:shower", null, t), "Shower");
});

test("a rename cannot re-target a claim", () => {
  // The whole reason bathrooms carry ids rather than positions. The claim is unchanged and
  // still points at the same room; only what it is called moves.
  const renamed = {
    ...twoBathroomSnapshotQuote,
    bathrooms: [{ ...twoBathroomSnapshotQuote.bathrooms[0], name: "Primary" }, twoBathroomSnapshotQuote.bathrooms[1]],
  };
  assert.equal(claimProductLabel("b-aaa:shower", renamed, t), "Primary · Shower");
});

// ----------------------------------------------------- the encoding itself

test("parseProductKey splits on the FIRST separator only", () => {
  assert.deepEqual(parseProductKey("shower"), { bathroomId: null, kind: "shower" });
  assert.deepEqual(parseProductKey("b-aaa:shower"), { bathroomId: "b-aaa", kind: "shower" });
  // A hand-edited value keeps its tail rather than silently losing it.
  assert.deepEqual(parseProductKey("b-aaa:odd:shower"), { bathroomId: "b-aaa", kind: "odd:shower" });
});

test("scoping round-trips for every product key", () => {
  for (const k of PRODUCT_KEYS) {
    assert.deepEqual(parseProductKey(scopedProductKey("b-aaa", k)), { bathroomId: "b-aaa", kind: k });
  }
});

test("an unrecognised key is shown as-is rather than dropped", () => {
  // A claim is filed paperwork. Whatever is in it gets rendered, even if this build has never
  // heard of it — silently omitting an affected product would understate a warranty claim.
  assert.equal(claimProductLabel("skylight", legacySnapshotQuote, t), "skylight");
  assert.equal(claimProductLabel("b-aaa:skylight", twoBathroomSnapshotQuote, t), "Master · skylight");
});
