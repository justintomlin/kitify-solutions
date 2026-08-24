/**
 * lib/freight.ts — what it costs to get a job on a truck. Pure, imports only the Bathroom seam.
 *
 * Freight was specced as "per bathroom count" from the start and could not be built until a
 * bathroom was a real entity. Phase C made it one; this is the piece that was waiting.
 *
 * THE NUMBERS ARE ROUGH LTL ESTIMATES, not a rate card. They are held as a lookup table rather
 * than a formula for two reasons: they are not linear — a second bathroom rides the same truck,
 * so two bathrooms is $850 rather than $1,000 — and when real shipping data arrives, extending
 * to a third and fourth bathroom has to be a one-line change made by someone reading a rate
 * sheet, not a re-derivation.
 *
 * FREIGHT IS PASS-THROUGH. It is never multiplied by the proposal's markup: the homeowner sees
 * the same number the dealer sees, because it is a cost being passed on rather than goods being
 * resold. retailWithFreight() is the one place that composition lives, so no render surface can
 * get it wrong on its own.
 */

import { quoteBathrooms, type BathroomSlots } from "./bathrooms.ts";

/**
 * Freight by bathroom count. A key is a FLOOR: the largest key at or below the actual count
 * wins, so `2` covers two bathrooms and everything above it until someone adds a `3`.
 *
 * That is what makes extending this a one-line change — `3: 1200` and nothing else moves.
 */
export const FREIGHT_BY_BATHROOM_COUNT: Record<number, number> = {
  1: 500,
  2: 850,
};

/**
 * The estimate for a given number of bathrooms, or null for none.
 *
 * Reads the table rather than hard-coding its two rows, so a new row takes effect everywhere
 * at once — including in the tests, which assert the extension shape rather than the values.
 */
export function freightForBathroomCount(n: number): number | null {
  if (!Number.isFinite(n) || n < 1) return null;
  const count = Math.floor(n);
  let hit: number | null = null;
  for (const key of Object.keys(FREIGHT_BY_BATHROOM_COUNT).map(Number).sort((a, b) => a - b)) {
    if (count >= key) hit = FREIGHT_BY_BATHROOM_COUNT[key];
  }
  return hit;
}

/**
 * Does this quote ship anything that needs a truck?
 *
 * The bathing fixture is the freight driver — a pan or a tub is the big, heavy, palletised item
 * on the order. A vanity-only or flooring-only quote does NOT auto-add freight: those ship
 * differently, and quoting $500 against a $900 vanity would be wrong in a way a dealer would
 * have to notice and undo every time.
 *
 * Reads the `shower` slot specifically, not the room's placed bath. The room module draws a
 * fixture on a plan; the shower module is what puts an orderable pan or tub on the quote, and
 * only the second one goes on a truck.
 */
export function hasBathingConfiguration(q: BathroomSlots): boolean {
  return quoteBathrooms(q).some((b) => b.shower != null);
}

/**
 * The computed freight estimate for a whole quote, or null when none applies.
 *
 * PER QUOTE, from that quote's own bathroom count. The three options on a proposal usually
 * cover the same bathrooms and so usually agree, but each is computed independently — an option
 * that drops the second bathroom genuinely ships on a smaller truck.
 */
export function freightForQuote(q: BathroomSlots): number | null {
  if (!hasBathingConfiguration(q)) return null;
  return freightForBathroomCount(quoteBathrooms(q).length);
}

/** What freight is actually in force, and how that was arrived at. */
export type ResolvedFreight = {
  /** What will be charged. */
  amount: number;
  /** What the table said, kept even when overridden so the dealer can see the gap. */
  computed: number | null;
  /** True when a dealer typed a number over the estimate — they may hold a real freight quote. */
  overridden: boolean;
};

/**
 * Reconcile the computed estimate with a dealer's override. Null means no freight line at all.
 *
 * Warn-don't-block: an override is accepted whatever it says, including a zero (freight
 * absorbed into the price, or collected by the customer) and including a number on a quote the
 * table would not have charged freight for. The computed figure rides along so the surfaces can
 * say what the estimate was rather than quietly replacing it.
 */
export function resolveFreight(computed: number | null, override: number | null | undefined): ResolvedFreight | null {
  const hasOverride = typeof override === "number" && Number.isFinite(override);
  if (!hasOverride) return computed == null ? null : { amount: computed, computed, overridden: false };
  return { amount: override as number, computed, overridden: true };
}

/**
 * The retail figure: goods marked up, freight added flat.
 *
 * The ONE place this composition lives. Freight sitting inside the markup would silently bill a
 * homeowner 40% on a shipping cost, which is not what a markup percentage means to the dealer
 * setting it — and the mistake is invisible in the total, so it would survive review.
 */
export function retailWithFreight(dealerTotal: number, markupPct: number, freightAmount: number | null): number {
  return dealerTotal * (1 + (markupPct || 0) / 100) + (freightAmount ?? 0);
}
