// Client-only persistence for the configurator hub's current quote. Everything is
// wrapped in try/catch and fails silently: localStorage may be unavailable during SSR,
// in private mode, or when the quota is exceeded — none of that should ever throw into
// the UI. Only the emitted config objects are stored (never React state/refs).

/**
 * Bumped to 2 in Phase C1 (`bathrooms` joined the shape) and to 3 in C2, when the hub started
 * writing a real bathrooms array and an active tab.
 *
 * loadCurrentQuote rejects any version it does not recognise, so an older autosave is
 * discarded rather than half-loaded. That costs a dealer who is mid-configuration at deploy
 * time their in-flight work — acceptable for crash-recovery data that is re-created on the
 * next edit, and much safer than guessing at a shape.
 */
export const QUOTE_SCHEMA_VERSION = 3;

/**
 * Versions loadCurrentQuote will still read. 3 is current; 2 is read because it needs no
 * guessing — a v2 draft is the four flat slots, which is exactly what quoteBathrooms()
 * synthesises a first bathroom from, so the upgrade is the accessor the hub already runs.
 *
 * 1 stays rejected. It predates `bathrooms` entirely and is not distinguishable from 2 by
 * shape, only by this number, so honouring the bump is the only way to be sure.
 *
 * Nothing below 2 is worth an upgrader: this is crash-recovery data that the next edit
 * rewrites, and a wrong guess at a shape costs more than a discarded draft.
 */
const READABLE_VERSIONS = new Set<number>([2, QUOTE_SCHEMA_VERSION]);

export type StoredQuote = {
  version: number;
  savedAt: string; // ISO timestamp
  /**
   * The four legacy slots. Still written, and still holding bathroom 1, mirroring the
   * dual-write in lib/store.ts — so anything reading this the old way finds something real.
   */
  room: unknown | null;
  shower: unknown | null;
  vanity: unknown | null;
  plumbing: unknown | null;
  /** The whole quote, from C2 onward. This is what the hub restores from. */
  bathrooms?: unknown[] | null;
  /** Which tab was open. Restored so a reload does not jump the dealer back to bathroom 1. */
  activeBathroomId?: string | null;
};

// `userKey` is the caller's stable auth uuid (see app/portal/configurator/page.tsx), so the
// autosaved current quote is scoped per user and survives a display-name change. Current-quote
// autosave intentionally stays in localStorage for now; the saved quotes live in Supabase.
const keyFor = (userKey: string) => `kitify:quote:current:${userKey}`;

export function loadCurrentQuote(userKey: string): StoredQuote | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(keyFor(userKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredQuote;
    // Reject anything we don't recognise rather than partially loading an unknown schema.
    if (!parsed || typeof parsed !== "object" || !READABLE_VERSIONS.has(parsed.version)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCurrentQuote(userKey: string, q: Omit<StoredQuote, "version" | "savedAt">): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const stored: StoredQuote = { version: QUOTE_SCHEMA_VERSION, savedAt: new Date().toISOString(), ...q };
    window.localStorage.setItem(keyFor(userKey), JSON.stringify(stored));
  } catch {
    // Ignore quota / serialisation / access errors — persistence is best-effort.
  }
}

export function clearCurrentQuote(userKey: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(keyFor(userKey));
  } catch {
    // Ignore.
  }
}
