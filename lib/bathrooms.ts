/**
 * lib/bathrooms.ts — the Bathroom seam. Pure, zero imports.
 *
 * A quote has always been exactly ONE bathroom's worth of work: four singular jsonb columns
 * (room / shower / vanity / plumbing), one of each, with no way to express a second. Phase C1
 * adds a `bathrooms` array alongside them without changing a single visible behaviour.
 *
 * Two shapes therefore exist at once, permanently:
 *
 *   LEGACY   bathrooms = null, the four flat slots populated. Every row written before C1,
 *            and every snapshot frozen before it. There is no backfill and there never will
 *            be — rewriting live rows would gain nothing and would have to be re-run for
 *            anything created between the deploy and the migration.
 *
 *   CURRENT  bathrooms = [...]. A one-bathroom quote ALSO keeps the flat slots populated
 *            (see quoteFlatSlots), so a rolled-back deployment still reads it correctly.
 *            Only a genuinely multi-bathroom quote relies on the array alone.
 *
 * Everything that enumerates a quote's configurations goes through quoteBathrooms(), which
 * resolves both shapes to the same thing. That is what lets the rest of the app stop caring
 * which era a row is from.
 *
 * Kept free of imports — no Supabase, no React — so it is unit-testable on its own. lib/store
 * re-exports these, so callers import from wherever is natural.
 */

/** One bathroom's worth of configuration. */
export type Bathroom = {
  /**
   * Stable identity. Survives reorder and rename, because C2's UX allows both and a
   * positional index would silently re-point a claim or a shipment line at the wrong room.
   */
  id: string;
  /** Dealer-supplied. Null until named — a single-bathroom quote never asks. */
  name: string | null;
  room?: unknown | null;
  shower?: unknown | null;
  vanity?: unknown | null;
  plumbing?: unknown | null;
};

/** The id given to the bathroom synthesised from a legacy quote's four flat columns. */
export const DEFAULT_BATHROOM_ID = "default";

/**
 * The minimum a value must look like to be read as a quote here.
 *
 * Structural rather than importing `Quote`, so this module stays import-free and so a
 * snapshot's frozen `quote` object — which is not a Quote, but has the same slots — can be
 * passed straight in.
 */
export type BathroomSlots = {
  room?: unknown | null;
  shower?: unknown | null;
  vanity?: unknown | null;
  plumbing?: unknown | null;
  bathrooms?: unknown;
};

/**
 * Coerce a stored `bathrooms` value to a usable array, or null.
 *
 * Deliberately defensive. The column is jsonb, so the database will hold a scalar, an object
 * or a half-written array just as happily as the right shape, and a bad value propagating
 * into every enumeration would be hard to trace. Null routes the caller back to the flat
 * columns, which are still populated for every single-bathroom quote.
 */
export function toBathrooms(v: unknown): Bathroom[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out = v.filter(
    (b): b is Bathroom => !!b && typeof b === "object" && !Array.isArray(b) && typeof (b as Bathroom).id === "string",
  );
  return out.length ? out : null;
}

/**
 * The bathrooms of a quote, whichever shape it was stored in. ALWAYS at least one.
 *
 * The guarantee that it is never empty is what makes this safe to use at render sites that
 * previously read `q.shower` directly: `quoteBathrooms(q)[0].shower` is total, where an
 * `Array.find` would not be.
 */
export function quoteBathrooms(q: BathroomSlots): Bathroom[] {
  const stored = toBathrooms(q.bathrooms);
  if (stored) return stored;
  return [{
    id: DEFAULT_BATHROOM_ID,
    name: null,
    room: q.room ?? null,
    shower: q.shower ?? null,
    vanity: q.vanity ?? null,
    plumbing: q.plumbing ?? null,
  }];
}

/**
 * True when a quote covers more than one bathroom.
 *
 * Named rather than inlined because "is this the ordinary single-bathroom case" is a question
 * several surfaces ask, and C1's entire contract is that the answer is false for every quote
 * that exists today.
 */
export function isMultiBathroom(q: BathroomSlots): boolean {
  return quoteBathrooms(q).length > 1;
}

/** A bathroom's four config slots, for a caller that wants them flat. */
export function bathroomSlots(b: Bathroom) {
  return {
    room: b.room ?? null,
    shower: b.shower ?? null,
    vanity: b.vanity ?? null,
    plumbing: b.plumbing ?? null,
  };
}

/**
 * What the four LEGACY columns should hold when writing this quote — the dual-write rule.
 *
 * One bathroom: the flat columns mirror it exactly, so anything that has not been taught
 * about bathrooms — including a rolled-back deployment — still reads the whole quote.
 *
 * Two or more: the flat columns hold the FIRST bathroom and the array holds the truth. There
 * is no honest way to flatten two bathrooms into four singular columns, and writing nothing
 * would leave old code showing an empty quote rather than a partial one. Callers must treat
 * the flat slots as a lossy mirror the moment `bathrooms.length > 1`.
 */
export function quoteFlatSlots(q: BathroomSlots) {
  const baths = toBathrooms(q.bathrooms);
  if (!baths) {
    return {
      room: q.room ?? null,
      shower: q.shower ?? null,
      vanity: q.vanity ?? null,
      plumbing: q.plumbing ?? null,
    };
  }
  return bathroomSlots(baths[0]);
}
