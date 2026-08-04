/**
 * lib/defaults.ts — the one place the "smart default" rule lives.
 *
 * GOVERNING RULE (Stage 1 punch list §0a): a default is SELECTED and priced in, and the
 * user may always deselect or change it. A default therefore only ever fills a field the
 * user hasn't set — it never silently overrides an explicit choice.
 *
 * Every auto-selection across the configurators resolves through here rather than through
 * a per-module patch, so the rule can't drift between the plumbing, shower and room
 * modules the way six separate one-off defaults would.
 *
 * THE ONE EXCEPTION, and why it isn't a violation: a stored choice that is no longer on
 * offer — a finish the newly-picked collection doesn't sell, a door that no longer fits the
 * opening — has stopped being a preference and become a dead value. Leaving it in place
 * strands the quote on a SKU nobody can order, so `resolveDefault` re-defaults instead.
 * Validity is judged only against the options passed in, so a caller that wants a choice
 * preserved simply keeps it in that list.
 */

/**
 * The value a defaulted field should hold.
 *
 * Returns `current` when the user's choice is still among `options`. Otherwise falls back to
 * the first option matching `prefer` (the smart default), then to `options[0]`, then to
 * undefined when there is nothing to pick at all.
 *
 * `idOf` maps an option to the identity the field stores, so callers can hold an id (a
 * finish id, a door series id) or a bare value (a door width in inches) without either
 * side having to know the other's shape.
 */
export function resolveDefault<T, K>(
  current: K | undefined,
  options: readonly T[],
  idOf: (o: T) => K,
  prefer?: (o: T) => boolean,
): K | undefined {
  // An explicit choice that is still offered always wins — this is the governing rule.
  if (current !== undefined && options.some((o) => idOf(o) === current)) return current;
  const pick = (prefer && options.find(prefer)) ?? options[0];
  return pick === undefined ? undefined : idOf(pick);
}

/**
 * Chrome is the portal-wide default finish — plumbing trim, shower door hardware and
 * shower accessories all land here so a set reads as one package out of the box.
 * Held as a constant rather than a literal at each call site so the three modules can't
 * drift onto different defaults.
 */
export const DEFAULT_FINISH_ID = "chrome";

/**
 * Quantity policy for accessories.
 *
 * INCLUDED items start on the quote and the user steps them to 0 to remove them — that is
 * the punch-list rule that they be "included by default, deselectable". OPT_IN items start
 * at 0 because they are a preference or accessibility choice rather than a standard
 * fitting (the shower grab bar), so pre-selecting one would put a decision on the quote
 * that nobody made.
 */
export const INCLUDED_QTY = 1;
export const OPT_IN_QTY = 0;
