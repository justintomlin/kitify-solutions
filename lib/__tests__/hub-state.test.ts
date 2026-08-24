/**
 * The configurator hub's per-bathroom bookkeeping (Phase C2).
 *
 * Two of the C survey's named risks are settled here, because both are about state LEAKING
 * between bathrooms and neither is visible when it goes wrong:
 *
 *   Risk 2 — "selecting a 60″ vanity in bathroom 2 rewrites bathroom 1's plumbing faucet
 *            quantity. High probability, low visibility." Every merge below asserts the OTHER
 *            bathroom is untouched, not just that this one is right.
 *
 *   Risk 3 — modules mounting once and being shared across bathrooms, which would show
 *            bathroom 1's floor plan under bathroom 2. Mounting is per (bathroom, section) and
 *            these tests are what say so.
 *
 * Node's built-in runner with type stripping — no framework:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  omitKey, mergeSharedBath, mergeSharedVanity, markSectionOpened, isSectionOpen,
  type ByBathroom, type OpenedSections, type SharedBath, type SharedVanity,
} from "../hub-state.ts";

// ------------------------------------------------- risk 2: the shared sizes

test("a bathing fixture chosen in one bathroom does not reach another", () => {
  let m: ByBathroom<SharedBath> = {};
  m = mergeSharedBath(m, "b1", { kind: "shower", baseId: "60x36", baseColor: "biscuit" });
  m = mergeSharedBath(m, "b2", { kind: "tub", baseId: "60x32" });
  assert.deepEqual(m.b1, { kind: "shower", baseId: "60x36", baseColor: "biscuit" });
  assert.deepEqual(m.b2, { kind: "tub", baseId: "60x32", baseColor: "white" });
});

test("a vanity size chosen in one bathroom does not reach another", () => {
  // The exact shape of the survey's risk 2: bathroom 2's sink count must not become the
  // faucet quantity the plumbing module seeds from in bathroom 1.
  let m: ByBathroom<SharedVanity> = {};
  m = mergeSharedVanity(m, "b1", { size: 36, sinks: 1, drilling: "1cc", sinkShape: "oval" });
  m = mergeSharedVanity(m, "b2", { size: 60, sinks: 2 });
  assert.equal(m.b1!.sinks, 1, "bathroom 1's sink count was rewritten by bathroom 2");
  assert.equal(m.b1!.size, 36);
  assert.equal(m.b2!.sinks, 2);
});

test("a room-sourced update keeps the fields only the other module knows", () => {
  // The room module reports a bath size but never a base colour, and a vanity size but never
  // drilling or sink shape. Those must survive, or moving a fixture on the plan would silently
  // reset a finish the dealer picked.
  let bath: ByBathroom<SharedBath> = {};
  bath = mergeSharedBath(bath, "b1", { kind: "shower", baseId: "60x36", baseColor: "biscuit" });
  bath = mergeSharedBath(bath, "b1", { kind: "shower", baseId: "48x36" }); // room-sourced
  assert.deepEqual(bath.b1, { kind: "shower", baseId: "48x36", baseColor: "biscuit" });

  let van: ByBathroom<SharedVanity> = {};
  van = mergeSharedVanity(van, "b1", { size: 60, sinks: 2, drilling: "8cc", sinkShape: "rectangle" });
  van = mergeSharedVanity(van, "b1", { size: 48, sinks: 1 }); // room-sourced
  assert.deepEqual(van.b1, { size: 48, sinks: 1, drilling: "8cc", sinkShape: "rectangle" });
});

test("a null update is ignored — removing a fixture never clears a shared size", () => {
  const bath = mergeSharedBath({ b1: { kind: "shower", baseId: "60x36" } }, "b1", null);
  assert.deepEqual(bath.b1, { kind: "shower", baseId: "60x36" });
  const van = mergeSharedVanity({ b1: { size: 36, sinks: 1, drilling: "1cc", sinkShape: "oval" } }, "b1", null);
  assert.equal(van.b1!.size, 36);
});

test("an unchanged merge returns the SAME map, by identity", () => {
  // Not a micro-optimisation. These run on every keystroke inside a module; a fresh object
  // each time is a re-render of the whole hub, and the room plan is expensive to redraw.
  const bath: ByBathroom<SharedBath> = { b1: { kind: "shower", baseId: "60x36", baseColor: "white" } };
  assert.equal(mergeSharedBath(bath, "b1", { kind: "shower", baseId: "60x36" }), bath);
  const van: ByBathroom<SharedVanity> = { b1: { size: 36, sinks: 1, drilling: "1cc", sinkShape: "oval" } };
  assert.equal(mergeSharedVanity(van, "b1", { size: 36, sinks: 1 }), van);
});

test("the merges are pure with respect to the map they are given", () => {
  const bath: ByBathroom<SharedBath> = { b1: { kind: "shower", baseId: "60x36" } };
  const before = JSON.stringify(bath);
  mergeSharedBath(bath, "b2", { kind: "tub", baseId: "60x32" });
  mergeSharedBath(bath, "b1", { kind: "tub", baseId: "60x32" });
  assert.equal(JSON.stringify(bath), before);
});

// --------------------------------------------- risk 3: mounting per bathroom

test("opening a section mounts it for THAT bathroom only", () => {
  // Bathroom 2's shower must not come up already mounted just because bathroom 1's was
  // opened — that is the shared-module-instance bug, which would show bathroom 1's work.
  let m: OpenedSections = {};
  m = markSectionOpened(m, "b1", "shower");
  assert.equal(isSectionOpen(m, "b1", "shower"), true);
  assert.equal(isSectionOpen(m, "b2", "shower"), false);
  assert.equal(isSectionOpen(m, "b1", "room"), false, "an unopened section must not mount");
});

test("a section never opened mounts nowhere, in any bathroom", () => {
  // The cost argument for mount-per-bathroom: untouched sections mount zero times, so the
  // usual one-to-three bathrooms carry no extra mounted modules at all.
  let m: OpenedSections = {};
  for (const id of ["b1", "b2", "b3"]) m = markSectionOpened(m, id, "shower");
  for (const id of ["b1", "b2", "b3"]) {
    assert.equal(isSectionOpen(m, id, "room"), false);
    assert.equal(isSectionOpen(m, id, "vanity"), false);
    assert.equal(isSectionOpen(m, id, "plumbing"), false);
  }
});

test("re-opening an already-mounted section is a no-op, by identity", () => {
  // A mounted module must not be re-created by clicking its tab again — that is exactly the
  // remount that would lose the room's placed fixtures.
  const m = markSectionOpened({}, "b1", "room");
  assert.equal(markSectionOpened(m, "b1", "room"), m);
});

test("markSectionOpened is pure and additive", () => {
  const m: OpenedSections = { b1: { room: true } };
  const before = JSON.stringify(m);
  const next = markSectionOpened(m, "b1", "shower");
  assert.equal(JSON.stringify(m), before, "the map it was given was mutated");
  assert.equal(isSectionOpen(next, "b1", "room"), true, "an existing mount was dropped");
  assert.equal(isSectionOpen(next, "b1", "shower"), true);
});

// ------------------------------------------------------ removal bookkeeping

test("omitKey drops one bathroom and leaves the rest alone", () => {
  const m: ByBathroom<SharedBath> = {
    b1: { kind: "shower", baseId: "60x36" },
    b2: { kind: "tub", baseId: "60x32" },
  };
  const next = omitKey(m, "b2");
  assert.equal("b2" in next, false);
  assert.deepEqual(next.b1, m.b1);
  assert.equal("b2" in m, true, "the map it was given was mutated");
});

test("omitting a key that isn't there returns the SAME map", () => {
  const m: ByBathroom<SharedBath> = { b1: { kind: "shower", baseId: "60x36" } };
  assert.equal(omitKey(m, "nope"), m);
});
