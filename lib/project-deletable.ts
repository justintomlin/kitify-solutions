/**
 * lib/project-deletable.ts — which projects a dealer may delete. Pure, zero imports.
 *
 * THE RULE: a project that has been ACCEPTED by a homeowner, or that has produced an ORDER,
 * can never be deleted. Everything up to acceptance is working material — drafts, quotes,
 * proposals nobody has said yes to — and a dealer who started a project by mistake should be
 * able to clear it away. The moment a homeowner accepts, the project is a record of a
 * commitment, and after an order it is a record of money.
 *
 * THE DATABASE ALREADY ENFORCES HALF OF THIS, and it is worth knowing which half:
 *
 *   quotes.project_id     → projects(id) ON DELETE CASCADE
 *   proposals.project_id  → projects(id) ON DELETE CASCADE
 *   orders.project_id     → projects(id)              -- no cascade: RESTRICT
 *   orders.quote_id       → quotes(id)                -- no cascade: RESTRICT
 *
 * So deleting a project with an order fails at the database, twice over — the order's own
 * reference blocks it, and so does the cascade's attempt to remove a quote an order points at.
 * That is a genuine backstop and this module is not a substitute for it.
 *
 * But an ACCEPTED proposal has no such protection. Acceptance sets accepted_quote_id and a
 * status; nothing in the schema stops the row being cascaded away. So the accepted case is
 * enforced HERE and only here, which is why it is a tested pure function rather than an inline
 * `.filter()` on a page.
 */

/** The minimum a proposal must look like to be judged. Structural, to stay import-free. */
export type DeleteGuardProposal = {
  projectId: string;
  status: string;
  /** Set by the accept flow. Non-null is acceptance, whatever the status column says. */
  acceptedQuoteId?: string | null;
};

/** The minimum an order must look like. An order existing at all is disqualifying. */
export type DeleteGuardOrder = { projectId: string };

/**
 * Has a homeowner said yes to this proposal?
 *
 * Reads BOTH the status and accepted_quote_id rather than trusting either alone. 'ordered' is
 * an accepted proposal that has been converted, so it counts; and a row whose status somehow
 * drifted but which carries an accepted_quote_id is still an acceptance — this question is one
 * where a false negative deletes a real commitment, so it is answered generously.
 */
export function isProposalAccepted(p: DeleteGuardProposal): boolean {
  return p.status === "accepted" || p.status === "ordered" || p.acceptedQuoteId != null;
}

/**
 * Every project id that must NOT be offered a delete control.
 *
 * A Set rather than a per-project predicate because the list page asks this once for every row
 * it renders, and re-scanning both arrays per row is quadratic on a dealer with a long history.
 */
export function undeletableProjectIds(
  proposals: DeleteGuardProposal[],
  orders: DeleteGuardOrder[],
): Set<string> {
  const blocked = new Set<string>();
  for (const p of proposals) if (isProposalAccepted(p)) blocked.add(p.projectId);
  // An order is disqualifying whatever its status — including 'cancelled'. A cancelled order
  // is still a thing that happened, with a number issued and a snapshot frozen, and deleting
  // the project it belongs to would orphan that record.
  for (const o of orders) blocked.add(o.projectId);
  return blocked;
}

/**
 * May this project be deleted?
 *
 * `blocked` is null while the guard data is still loading, and the honest answer then is NO.
 * Showing the control optimistically and withdrawing it a moment later would offer a delete on
 * a project that cannot have one — and a fast click would take the dealer to a confirmation
 * dialog for an action the database is about to refuse.
 */
export function canDeleteProject(projectId: string, blocked: Set<string> | null): boolean {
  return blocked != null && !blocked.has(projectId);
}
