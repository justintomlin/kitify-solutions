/**
 * lib/claim-scope.ts — what a warranty claim points at. Pure, imports only the Bathroom seam.
 *
 * claims.affected_products is a jsonb array of strings and has held bare product keys since
 * its first migration: 'room' | 'shower' | 'vanity' | 'plumbing'. On a one-bathroom order that
 * is a complete answer. On a two-bathroom order "shower" identifies nothing — the C survey's
 * risk 4 — and claims already filed have no bathroom in them to fall back on.
 *
 * So there are two shapes, permanently, and the schema does not change:
 *
 *   BARE     "shower". Every claim filed before C2, and every claim on a single-bathroom
 *            order after it. Nothing a bathroom id would add, and no reason to make old rows
 *            and new rows disagree about a job that only ever had one bathroom.
 *
 *   SCOPED   "b-4f2a91:shower". A multi-bathroom order. The bathroom id is the stable one
 *            from the frozen snapshot, so the claim keeps pointing at the same room after a
 *            rename — which is exactly why bathroom ids are ids and not positions.
 *
 * The scope rides inside the string rather than needing a new column, an array of objects, or
 * a migration over rows that are, in effect, filed paperwork. A value with no separator is
 * bare; that is the whole compatibility rule.
 */

import { quoteBathrooms, labelForBathroom, type Bathroom } from "./bathrooms.ts";

/** The four claimable products on a bathroom, in the order they are shown. */
export const PRODUCT_KEYS = ["room", "shower", "vanity", "plumbing"] as const;
export type ProductKey = (typeof PRODUCT_KEYS)[number];

export const PRODUCT_KEY_LABEL: Record<string, string> = {
  room: "configurator.roomTitle",
  shower: "configurator.showerTitle",
  vanity: "configurator.vanityTitle",
  plumbing: "configurator.plumbingTitle",
};

/**
 * Colon, and split on the FIRST one only. Bathroom ids are generated as `b-<base36>` and
 * product keys are a closed set, so neither can contain one — but splitting on the first
 * keeps a hand-edited value from silently losing its tail.
 */
const SCOPE_SEP = ":";

/** The stored key for one product of one bathroom on a multi-bathroom order. */
export const scopedProductKey = (bathroomId: string, kind: ProductKey) => `${bathroomId}${SCOPE_SEP}${kind}`;

/** Read a stored key back. `bathroomId` is null for the bare shape. */
export function parseProductKey(v: string): { bathroomId: string | null; kind: string } {
  const i = v.indexOf(SCOPE_SEP);
  return i < 0 ? { bathroomId: null, kind: v } : { bathroomId: v.slice(0, i), kind: v.slice(i + 1) };
}

/** Translator shape, matching the one the rest of the app uses. */
type Tr = (key: string, vars?: Record<string, string>) => string;

/** One pickable line on the claim form: the key that gets stored, and how to say it. */
export type ClaimLine = { key: string; kind: ProductKey; bathroom: string | null };

/**
 * The products on an order, scoped by bathroom only where that is a real distinction.
 *
 * Reads the snapshot through quoteBathrooms(), so a pre-C1 order — flat slots, no `bathrooms`
 * — yields exactly the bare list it always did, and a single-bathroom C2 order does too.
 */
export function claimLines(snapshotQuote: unknown, t: Tr): ClaimLine[] {
  if (!snapshotQuote || typeof snapshotQuote !== "object") return [];
  const baths = quoteBathrooms(snapshotQuote as Parameters<typeof quoteBathrooms>[0]);
  const multi = baths.length > 1;
  return baths.flatMap((b, i) =>
    PRODUCT_KEYS.filter((k) => (b as Bathroom)[k] != null).map((kind) => ({
      key: multi ? scopedProductKey(b.id, kind) : kind,
      kind,
      bathroom: multi ? labelForBathroom(b, i, t) : null,
    })),
  );
}

/**
 * How a stored key reads back on a filed claim.
 *
 * The bathroom NAME is not on the claim — only the id — so it is resolved from the order's
 * snapshot, which is the frozen record of what was sold and where the name lived when the
 * claim was filed. A snapshot that can no longer be read, or a bathroom no longer in it,
 * degrades to the product alone: showing a raw id would be worse than showing less.
 */
export function claimProductLabel(raw: string, snapshotQuote: unknown, t: Tr): string {
  const { bathroomId, kind } = parseProductKey(raw);
  const product = t(PRODUCT_KEY_LABEL[kind] ?? kind);
  if (!bathroomId) return product;
  if (!snapshotQuote || typeof snapshotQuote !== "object") return product;
  const baths = quoteBathrooms(snapshotQuote as Parameters<typeof quoteBathrooms>[0]);
  const i = baths.findIndex((b) => b.id === bathroomId);
  if (i < 0) return product;
  return t("myJobs.claimProductScoped", { bathroom: labelForBathroom(baths[i], i, t), product });
}
