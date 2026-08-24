/**
 * lib/hpl-tools.ts — the installation tools and replenishment a dealer can add to a job.
 *
 * NOT A TAKEOFF. Nothing here is computed from a shower: a grout tool is bought once every ten
 * or twenty kits, and a dealer restocking sealant wants three tubes for reasons the BOM cannot
 * know. So this is a fixed catalogue of things that can be ASKED about, and every one of them
 * arrives at quantity zero. Nothing is ever added without an explicit tap — the same
 * warn-don't-block rule the three HPL upsells follow.
 *
 * That is also why this file exists rather than the offers joining fireHplUpsells(): the
 * takeoff module's job is "what does this shower need", and the honest answer for a tool is
 * "that is not a question about this shower". Wax already sits outside the per-shower takeoff
 * for the same reason (computeHplOrderConsumables) — emitting it per shower would multiply it.
 *
 * FULL PRICE, all of them. The 25% mechanic belongs to the odd-panel offer alone, where it is
 * paid for by pack integrity — panels ship in twos, so the spare is already half-bought. There
 * is no equivalent argument for a second sealant tube, and a standing discount on consumables
 * would just be a lower price.
 *
 * Pure and import-free apart from the SKU codes, so the offer list can be asserted directly.
 */

import { HPL_CONSUMABLE_SKU_CODES, HPL_TOOL_SKU_CODES } from "./hpl-shower-takeoff.ts";

/** A tool or consumable the dealer can take, and how many. Persisted on the shower selections. */
export type HplToolPick = { skuCode: string; qty: number };

export type HplToolOffer = {
  skuCode: string;
  /** i18n key, resolved at render so a saved quote reads in the viewer's language. */
  labelKey: string;
  /**
   * A tool is a one-off purchase; replenishment is stock a dealer is topping up. Only used to
   * group them under two headings — nothing prices differently.
   */
  group: "tool" | "replenishment";
};

/**
 * The six things on offer, in the order they are shown.
 *
 * The two tools lead because they are the question being asked ("do you have what you need to
 * install this?"); replenishment follows because it is the smaller, more routine decision.
 */
export const HPL_TOOL_OFFERS: HplToolOffer[] = [
  { skuCode: HPL_TOOL_SKU_CODES.groutTool, labelKey: "configurator.shower.hplTools.groutTool", group: "tool" },
  { skuCode: HPL_TOOL_SKU_CODES.suctionCup, labelKey: "configurator.shower.hplTools.suctionCup", group: "tool" },
  { skuCode: HPL_CONSUMABLE_SKU_CODES.sealant, labelKey: "configurator.shower.hplTools.sealant", group: "replenishment" },
  { skuCode: HPL_CONSUMABLE_SKU_CODES.sprayCleaner, labelKey: "configurator.shower.hplTools.sprayCleaner", group: "replenishment" },
  { skuCode: HPL_CONSUMABLE_SKU_CODES.wipes, labelKey: "configurator.shower.hplTools.wipes", group: "replenishment" },
  { skuCode: HPL_CONSUMABLE_SKU_CODES.wax, labelKey: "configurator.shower.hplTools.wax", group: "replenishment" },
];

/** Ceiling on a single line. Not a stock rule — a guard against a stuck key or a fat finger. */
export const HPL_TOOL_MAX_QTY = 99;

/** Only codes on the offer list are honoured, so a stale saved quote cannot inject a SKU. */
const OFFERED = new Set(HPL_TOOL_OFFERS.map((o) => o.skuCode));

/**
 * Set one line's quantity. Zero removes it entirely rather than storing a zero, so "took none"
 * and "never asked" are the same thing in the saved quote — which is what makes an untouched
 * offer leave no trace on a reopened one.
 *
 * PURE: returns a new array. Order is preserved for lines that already exist, and a new line
 * appends, so the quote's own history is the order the dealer built it in.
 */
export function setToolQty(picks: HplToolPick[], skuCode: string, qty: number): HplToolPick[] {
  if (!OFFERED.has(skuCode)) return picks;
  const n = Math.max(0, Math.min(HPL_TOOL_MAX_QTY, Math.floor(Number.isFinite(qty) ? qty : 0)));
  if (n === 0) return picks.some((p) => p.skuCode === skuCode) ? picks.filter((p) => p.skuCode !== skuCode) : picks;
  if (picks.some((p) => p.skuCode === skuCode)) return picks.map((p) => (p.skuCode === skuCode ? { ...p, qty: n } : p));
  return [...picks, { skuCode, qty: n }];
}

/**
 * Coerce a stored value back into pick shape.
 *
 * Defensive because this rides inside a jsonb quote document: a hand-edited or half-written
 * value must degrade to "no tools taken" rather than putting a bad line on an order. Unknown
 * SKU codes are dropped for the same reason — a code retired from the offer list must not keep
 * being quoted off an old saved quote.
 */
export function toToolPicks(v: unknown): HplToolPick[] {
  if (!Array.isArray(v)) return [];
  const out: HplToolPick[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Partial<HplToolPick>;
    if (typeof p.skuCode !== "string" || !OFFERED.has(p.skuCode)) continue;
    const qty = Math.floor(Number(p.qty));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (out.some((x) => x.skuCode === p.skuCode)) continue; // first wins; a dupe is corruption
    out.push({ skuCode: p.skuCode, qty: Math.min(HPL_TOOL_MAX_QTY, qty) });
  }
  return out;
}

/** The offer a pick refers to, for rendering a saved line. Undefined once a code is retired. */
export const toolOfferFor = (skuCode: string) => HPL_TOOL_OFFERS.find((o) => o.skuCode === skuCode);
