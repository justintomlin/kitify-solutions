/**
 * lib/module-status.ts — how finished is one module, for one bathroom. Pure, zero imports.
 *
 * The hub's four cards run Room → Shower → Vanity → Plumbing, and that order is a real
 * dependency chain: the room sets the geometry, the shower picks the base, the vanity fixes
 * the drilling, and the plumbing follows all three. The step numbers say so; this says how far
 * along each one is.
 *
 * WHY `isComplete` ON THE SAVED CONFIG CANNOT ANSWER THIS. Every one of the four modules gates
 * its own onComplete — shower, vanity and plumbing all `if (complete)` before emitting, and
 * the room hardcodes `isComplete: true` in buildConfig. So a config that reached a slot is
 * ALWAYS complete, and the flag is a constant rather than a signal. Reading it alone would
 * give two states, not three, which is what the cards already showed.
 *
 * The missing third state therefore comes from the hub's own knowledge: a module that has been
 * OPENED for this bathroom but has not committed anything is a module the dealer walked into
 * and left. That is exactly "you still need to finish this".
 *
 * A CONSEQUENCE WORTH KNOWING: `opened` is session state and is not persisted. Reload the hub
 * and a module that was entered but never committed reads as unstarted again. That is honest —
 * nothing about that visit was saved, the drafts included — but it does mean the warning is a
 * within-session nudge rather than a durable flag on the quote.
 */

/** How far along a module is, for one bathroom. */
export type ModuleStatus = "unstarted" | "incomplete" | "complete";

/** The only thing this needs from a committed config, read structurally — slots are jsonb. */
type MaybeComplete = { isComplete?: unknown };

/**
 * The state of one module for one bathroom.
 *
 * `committed` is that bathroom's slot (null when nothing has been added to the quote).
 * `opened` is whether the dealer has entered this module for THIS bathroom in this session.
 *
 * The `isComplete === false` branch is defensive rather than reachable today: no module emits
 * it, because they all gate. It is here so that a module which later stops gating — letting a
 * dealer park a half-built configuration on the quote — surfaces as incomplete instead of
 * silently reading as done.
 */
export function moduleStatus(committed: unknown, opened: boolean): ModuleStatus {
  if (committed != null) {
    return (committed as MaybeComplete).isComplete === false ? "incomplete" : "complete";
  }
  return opened ? "incomplete" : "unstarted";
}

/** i18n key for the status, or null where there is nothing to announce. */
export function moduleStatusLabelKey(status: ModuleStatus): string | null {
  if (status === "complete") return "configurator.status.complete";
  if (status === "incomplete") return "configurator.status.incomplete";
  return null;
}
