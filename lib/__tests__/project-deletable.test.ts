/**
 * Which projects may be deleted.
 *
 * The database blocks a project that has an ORDER — orders.project_id and orders.quote_id are
 * both RESTRICT — so that half has a backstop underneath it. An ACCEPTED proposal has no such
 * protection: quotes and proposals both cascade, and nothing in the schema stops an accepted
 * job being cascaded away. That case is enforced here and ONLY here, which is what these tests
 * are for.
 *
 * Node's built-in runner with type stripping — no framework:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  isProposalAccepted, undeletableProjectIds, canDeleteProject,
  type DeleteGuardProposal,
} from "../project-deletable.ts";

const prop = (over: Partial<DeleteGuardProposal> = {}): DeleteGuardProposal =>
  ({ projectId: "p1", status: "draft", acceptedQuoteId: null, ...over });

// ------------------------------------------------------------- acceptance

test("a draft or shared proposal is not acceptance", () => {
  assert.equal(isProposalAccepted(prop({ status: "draft" })), false);
  assert.equal(isProposalAccepted(prop({ status: "shared" })), false);
  assert.equal(isProposalAccepted(prop({ status: "archived" })), false);
});

test("accepted and ordered both count", () => {
  // 'ordered' is an accepted proposal that has been converted — still a commitment.
  assert.equal(isProposalAccepted(prop({ status: "accepted" })), true);
  assert.equal(isProposalAccepted(prop({ status: "ordered" })), true);
});

test("an accepted_quote_id counts whatever the status says", () => {
  // Answered generously on purpose: a false negative here deletes a real commitment, and the
  // two fields are written by the same flow but are not constrained to agree.
  assert.equal(isProposalAccepted(prop({ status: "draft", acceptedQuoteId: "q1" })), true);
  assert.equal(isProposalAccepted(prop({ status: "shared", acceptedQuoteId: "q1" })), true);
});

// ------------------------------------------------------------ the blocked set

test("a project with only drafts is deletable", () => {
  const blocked = undeletableProjectIds([prop({ projectId: "p1", status: "draft" })], []);
  assert.equal(blocked.size, 0);
  assert.equal(canDeleteProject("p1", blocked), true);
});

test("an accepted proposal blocks its project and no other", () => {
  const blocked = undeletableProjectIds(
    [prop({ projectId: "p1", status: "accepted" }), prop({ projectId: "p2", status: "draft" })],
    [],
  );
  assert.equal(canDeleteProject("p1", blocked), false);
  assert.equal(canDeleteProject("p2", blocked), true);
});

test("ANY order blocks, including a cancelled one", () => {
  // A cancelled order still had a number issued and a snapshot frozen. Deleting the project
  // it belongs to would orphan that record.
  const blocked = undeletableProjectIds([], [{ projectId: "p1" }]);
  assert.equal(canDeleteProject("p1", blocked), false);
});

test("a project blocked by both reasons is blocked once", () => {
  const blocked = undeletableProjectIds([prop({ projectId: "p1", status: "accepted" })], [{ projectId: "p1" }]);
  assert.equal(blocked.size, 1);
  assert.equal(canDeleteProject("p1", blocked), false);
});

test("a project with no proposals and no orders is deletable", () => {
  assert.equal(canDeleteProject("p1", undeletableProjectIds([], [])), true);
});

// --------------------------------------------------- the loading / failure state

test("NOTHING is deletable while the guard is unknown", () => {
  // null is both "still loading" and "the guard failed to load". Either way the honest answer
  // is no: an empty Set would read as "everything is deletable", which is the one wrong answer
  // that loses data.
  assert.equal(canDeleteProject("p1", null), false);
  assert.equal(canDeleteProject("anything", null), false);
});

test("an empty guard set is NOT the same as a missing one", () => {
  // Guarding the distinction itself, because collapsing them is the easy mistake.
  assert.equal(canDeleteProject("p1", new Set()), true);
  assert.equal(canDeleteProject("p1", null), false);
});

// ------------------------------------------------------------------ purity

test("undeletableProjectIds does not mutate its inputs", () => {
  const proposals = [prop({ projectId: "p1", status: "accepted" })];
  const orders = [{ projectId: "p2" }];
  const before = JSON.stringify({ proposals, orders });
  undeletableProjectIds(proposals, orders);
  assert.equal(JSON.stringify({ proposals, orders }), before);
});
