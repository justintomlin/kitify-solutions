// Client-only persistence for the configurator hub's current quote. Everything is
// wrapped in try/catch and fails silently: localStorage may be unavailable during SSR,
// in private mode, or when the quota is exceeded — none of that should ever throw into
// the UI. Only the emitted config objects are stored (never React state/refs).

export const QUOTE_SCHEMA_VERSION = 1;

export type StoredQuote = {
  version: number;
  savedAt: string; // ISO timestamp
  room: unknown | null;
  shower: unknown | null;
  vanity: unknown | null;
  plumbing: unknown | null;
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
    if (!parsed || typeof parsed !== "object" || parsed.version !== QUOTE_SCHEMA_VERSION) return null;
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
