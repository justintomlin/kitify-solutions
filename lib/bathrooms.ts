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

// ---------------------------------------------------------------- mutation
// All of these are PURE: they return a new array and never touch the one passed in. The hub
// holds bathrooms in React state, and an in-place edit there is a re-render that doesn't happen.

/**
 * A fresh bathroom id.
 *
 * Random rather than sequential, because ids have to survive removal: numbering from
 * `bathrooms.length` re-issues an id the moment a middle bathroom is deleted, and a claim or
 * a shipment line pointing at the old one would silently re-target the new one. Not a uuid —
 * these live inside a jsonb document, are never joined on, and stay readable in a snapshot.
 */
export function nextBathroomId(existing: Bathroom[] = []): string {
  const taken = new Set(existing.map((b) => b.id));
  for (let i = 0; i < 50; i++) {
    const id = `b-${Math.random().toString(36).slice(2, 9)}`;
    if (!taken.has(id)) return id;
  }
  // Astronomically unlikely; falling back keeps this total rather than looping forever.
  return `b-${taken.size + 1}-${Date.now().toString(36)}`;
}

/** Append an empty bathroom. Returns the new array and the id to switch to. */
export function addBathroom(bathrooms: Bathroom[], name: string | null = null): { bathrooms: Bathroom[]; id: string } {
  const id = nextBathroomId(bathrooms);
  return { bathrooms: [...bathrooms, { id, name, room: null, shower: null, vanity: null, plumbing: null }], id };
}

/**
 * Remove a bathroom, and say which one should become active.
 *
 * REFUSES to remove the last one. quoteBathrooms() guarantees at least one bathroom, and a
 * quote with zero would contradict that everywhere downstream — so the floor is enforced here
 * rather than left to each caller to remember.
 *
 * The successor is the PREVIOUS bathroom where there is one, so removing from the end walks
 * left rather than jumping to the start.
 */
export function removeBathroom(bathrooms: Bathroom[], id: string): { bathrooms: Bathroom[]; activeId: string } {
  const idx = bathrooms.findIndex((b) => b.id === id);
  if (idx < 0 || bathrooms.length <= 1) {
    return { bathrooms, activeId: bathrooms[Math.max(0, idx)]?.id ?? bathrooms[0]?.id ?? id };
  }
  const next = bathrooms.filter((b) => b.id !== id);
  const successor = next[Math.max(0, idx - 1)] ?? next[0];
  return { bathrooms: next, activeId: successor.id };
}

/**
 * Rename a bathroom. An empty or whitespace-only name resets it to unnamed (null), which is
 * what makes "clear the field and tab away" mean "go back to the placeholder".
 */
export function renameBathroom(bathrooms: Bathroom[], id: string, name: string | null): Bathroom[] {
  const clean = name === null ? null : (name.trim() || null);
  return bathrooms.map((b) => (b.id === id ? { ...b, name: clean } : b));
}

/** Replace one bathroom's config slots, leaving id and name alone. */
export function setBathroomSlots(
  bathrooms: Bathroom[],
  id: string,
  slots: Partial<Pick<Bathroom, "room" | "shower" | "vanity" | "plumbing">>,
): Bathroom[] {
  return bathrooms.map((b) => (b.id === id ? { ...b, ...slots } : b));
}

/** True when a bathroom has nothing configured in it yet. */
export function isBathroomEmpty(b: Bathroom): boolean {
  return !b.room && !b.shower && !b.vanity && !b.plumbing;
}

// -------------------------------------------------------------- money
// A quote's total is the whole job — every bathroom on it. Freight and anything else charged
// once per job is added at quote level and deliberately never inside a bathroom, or a
// two-bathroom job would pay for it twice.

/** Each config object carries its own priced result. Read structurally — the slots are jsonb. */
type PricedSlot = { price?: { total?: unknown } | null } | null | undefined;

/**
 * One slot's contribution. Defensive because these are jsonb: a half-written or
 * hand-edited document would otherwise turn the whole quote total into NaN, which prints as
 * "$NaN" on a dealer's screen and saves as null.
 */
function slotTotal(v: unknown): number {
  const n = (v as PricedSlot)?.price?.total;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** What one bathroom costs the dealer: its four slots, summed. */
export function bathroomTotal(b: Bathroom): number {
  return slotTotal(b.room) + slotTotal(b.shower) + slotTotal(b.vanity) + slotTotal(b.plumbing);
}

/** What the whole quote costs the dealer. Identical to bathroomTotal for a one-bathroom quote. */
export function bathroomsTotal(bathrooms: Bathroom[]): number {
  return bathrooms.reduce((n, b) => n + bathroomTotal(b), 0);
}

// ------------------------------------------------------------------ labels

/** Translator shape, matching the one the configurators use. Kept local to stay import-free. */
type Tr = (key: string, vars?: Record<string, string>) => string;

/**
 * What to show on a bathroom's tab or header: the dealer's name, or a numbered placeholder.
 *
 * `index` is zero-based and the placeholder is one-based, because a dealer counts bathrooms
 * from one.
 */
export function labelForBathroom(b: Bathroom | undefined, index: number, t: Tr): string {
  const name = b?.name?.trim();
  return name || t("configurator.bathroom.numbered", { n: String(index + 1) });
}

/** The three proposal option slots, in the order a dealer sees them. */
export const OPTION_TIERS = ["good", "better", "best"] as const;
export type OptionTier = (typeof OPTION_TIERS)[number];
/** Dealer-supplied option names, keyed by the tier column they correspond to. */
export type OptionNames = { good: string | null; better: string | null; best: string | null };

/**
 * What to show for a proposal option: the dealer's name, or "Option N".
 *
 * The tier keys are a database detail — good/better/best is a ladder nobody chose and that a
 * two-option proposal cannot express — so nothing user-facing renders them. See migration
 * 0019 for why the columns keep those names anyway.
 */
export function labelForTier(tier: OptionTier, names: OptionNames | null | undefined, t: Tr): string {
  const name = names?.[tier]?.trim();
  return name || t("configurator.option.numbered", { n: String(OPTION_TIERS.indexOf(tier) + 1) });
}

/** Coerce a stored option_names value into the expected shape, or null. */
export function toOptionNames(v: unknown): OptionNames | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const one = (k: OptionTier) => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string) : null);
  const out = { good: one("good"), better: one("better"), best: one("best") };
  return out.good || out.better || out.best ? out : null;
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
