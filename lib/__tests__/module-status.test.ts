/**
 * How finished is one module, for one bathroom.
 *
 * The whole reason this exists: `isComplete` on a saved config is a CONSTANT. Every module
 * gates its own onComplete — shower, vanity and plumbing all `if (complete)` before emitting,
 * and the room hardcodes `isComplete: true` — so anything that reached a slot is complete by
 * construction. Reading the flag alone gives two states, which is what the cards already had.
 *
 * The third state comes from the hub knowing the module was OPENED and nothing came back.
 *
 * Node's built-in runner with type stripping — no framework:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { moduleStatus, moduleStatusLabelKey } from "../module-status.ts";

const CONFIG = { selections: {}, price: { total: 900, lines: [] }, isComplete: true, label: '36"' };

// ------------------------------------------------------------ the three states

test("nothing configured and never opened is UNSTARTED", () => {
  assert.equal(moduleStatus(null, false), "unstarted");
  assert.equal(moduleStatus(undefined, false), "unstarted");
});

test("opened but nothing committed is INCOMPLETE", () => {
  // The dealer walked into the module and left without adding anything to the quote.
  assert.equal(moduleStatus(null, true), "incomplete");
  assert.equal(moduleStatus(undefined, true), "incomplete");
});

test("a committed config is COMPLETE", () => {
  assert.equal(moduleStatus(CONFIG, true), "complete");
  // …and stays complete once the section is closed again.
  assert.equal(moduleStatus(CONFIG, false), "complete");
});

test("a committed config wins over the opened flag either way", () => {
  // Committing is the whole signal: having the module open at the time changes nothing.
  assert.equal(moduleStatus(CONFIG, true), moduleStatus(CONFIG, false));
});

// -------------------------------------------------------------- defensive

test("a committed config that says it is NOT complete reads as incomplete", () => {
  // Unreachable today because every module gates. Here so that a module which later lets a
  // half-built configuration onto the quote surfaces it, instead of it reading as done.
  assert.equal(moduleStatus({ ...CONFIG, isComplete: false }, false), "incomplete");
  assert.equal(moduleStatus({ ...CONFIG, isComplete: false }, true), "incomplete");
});

test("a committed config with no isComplete field at all reads as complete", () => {
  // Only an explicit `false` demotes it. A config saved before the flag existed, or a slot
  // holding something structurally unfamiliar, is still something the dealer added on purpose.
  assert.equal(moduleStatus({ selections: {} }, false), "complete");
  assert.equal(moduleStatus({ isComplete: "yes" }, false), "complete");
  assert.equal(moduleStatus({ isComplete: null }, false), "complete");
});

test("a falsy-but-present slot is not mistaken for an empty one", () => {
  // `!= null` rather than truthiness: 0 and "" are not configs anyone can produce, but the
  // distinction is what keeps an unusual jsonb value from silently reading as unstarted.
  assert.equal(moduleStatus(0, false), "complete");
  assert.equal(moduleStatus("", false), "complete");
});

// ----------------------------------------------------------------- labels

test("only the two states with an icon carry a label", () => {
  // Unstarted shows nothing on the card, so there is nothing to announce.
  assert.equal(moduleStatusLabelKey("complete"), "configurator.status.complete");
  assert.equal(moduleStatusLabelKey("incomplete"), "configurator.status.incomplete");
  assert.equal(moduleStatusLabelKey("unstarted"), null);
});
