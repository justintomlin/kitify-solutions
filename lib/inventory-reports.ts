// Reporting over Kitify's inventory. Phase 3.
//
// READ-ONLY, and no new schema: every number here derives from inventory_skus +
// inventory_stock + inventory_movements as Phase 1 left them. The functions below are pure —
// the page fetches the three tables once and passes them in, so each panel is a computation
// over the same data rather than its own round trip.
//
// Three panels, three questions an admin actually has:
//   1. What am I holding, by category?
//   2. What's moving, and which way?
//   3. What's sitting still?

import {
  isLowStock,
  type InventorySku,
  type StockRow,
  type Movement,
  type InventoryCategory,
} from "@/lib/inventory";

export const REPORT_WINDOWS = [30, 60, 90, 180] as const;
export type ReportWindow = (typeof REPORT_WINDOWS)[number];

/** Anything older than this without a movement counts as stale, when it still has stock. */
export const STALE_DAYS = 60;

export const windowStartIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

// ------------------------- panel 1: on-hand by category -------------------------

export type CategoryRollup = {
  category: InventoryCategory;
  skus: number;
  onHand: number;
  lowStock: number;
};

/**
 * On-hand grouped by category. Counts ACTIVE SKUs only — a retired SKU with leftover stock is
 * the stale-stock panel's problem, and including it here would inflate the catalog counts an
 * admin reads as "what we carry".
 */
export function rollupByCategory(skus: InventorySku[], stock: StockRow[]): CategoryRollup[] {
  const active = skus.filter((s) => s.active);
  const byId = new Map(active.map((s) => [s.id, s]));

  const acc = new Map<InventoryCategory, CategoryRollup>();
  for (const s of active) {
    if (!acc.has(s.category)) acc.set(s.category, { category: s.category, skus: 0, onHand: 0, lowStock: 0 });
    acc.get(s.category)!.skus += 1;
  }
  for (const row of stock) {
    const sku = byId.get(row.skuId);
    if (!sku) continue; // stock against a retired/deleted SKU — not part of this view
    const entry = acc.get(sku.category);
    if (!entry) continue;
    entry.onHand += row.quantity;
    if (isLowStock(row)) entry.lowStock += 1;
  }
  return Array.from(acc.values()).sort((a, b) => b.onHand - a.onHand || a.category.localeCompare(b.category));
}

// --------------------------- panel 2: movement velocity ---------------------------

export type VelocityRow = {
  skuId: string;
  sku: string;
  name: string;
  category: InventoryCategory;
  in: number;
  out: number;
  net: number;
  movements: number;
  onHand: number;
};

/**
 * Pieces in, pieces out and net delta per SKU over the supplied movement window.
 *
 * Only SKUs that actually moved appear — a report of everything, mostly zeroes, buries the
 * signal. Default order is by absolute net movement descending, so the SKUs whose position
 * changed most are first regardless of direction.
 */
export function velocityBySku(
  skus: InventorySku[],
  stock: StockRow[],
  movements: Movement[],
): VelocityRow[] {
  const byId = new Map(skus.map((s) => [s.id, s]));

  const onHand = new Map<string, number>();
  for (const r of stock) onHand.set(r.skuId, (onHand.get(r.skuId) ?? 0) + r.quantity);

  const acc = new Map<string, VelocityRow>();
  for (const m of movements) {
    const sku = byId.get(m.skuId);
    if (!sku) continue;
    let row = acc.get(m.skuId);
    if (!row) {
      row = {
        skuId: m.skuId,
        sku: sku.sku,
        name: sku.name,
        category: sku.category,
        in: 0,
        out: 0,
        net: 0,
        movements: 0,
        onHand: onHand.get(m.skuId) ?? 0,
      };
      acc.set(m.skuId, row);
    }
    if (m.delta > 0) row.in += m.delta;
    else row.out += -m.delta;
    row.net += m.delta;
    row.movements += 1;
  }

  return Array.from(acc.values()).sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.sku.localeCompare(b.sku));
}

// ------------------------ panel 3: stale / never-moved stock ------------------------

export type StaleRow = {
  skuId: string;
  sku: string;
  name: string;
  category: InventoryCategory;
  onHand: number;
  lastMovedAt: string | null; // null = never moved (or older than the sampled window)
  daysSince: number | null;
  active: boolean;
};

/**
 * SKUs holding stock that hasn't moved in `staleDays` — capital sitting on a shelf.
 *
 * Includes retired SKUs deliberately: stock of something Kitify no longer carries is the most
 * stale inventory there is, and it would otherwise be invisible in every other view. The
 * `active` flag is carried through so the UI can mark it.
 *
 * A SKU with no recorded movement at all sorts first (daysSince null → treated as infinite):
 * stock that arrived without a ledger entry is both the oldest and the most suspect.
 */
export function staleStock(
  skus: InventorySku[],
  stock: StockRow[],
  lastMoved: Map<string, string>,
  staleDays = STALE_DAYS,
): StaleRow[] {
  const byId = new Map(skus.map((s) => [s.id, s]));
  const onHand = new Map<string, number>();
  for (const r of stock) onHand.set(r.skuId, (onHand.get(r.skuId) ?? 0) + r.quantity);

  const cutoff = Date.now() - staleDays * 86_400_000;
  const rows: StaleRow[] = [];

  for (const [skuId, qty] of onHand) {
    if (qty <= 0) continue;
    const sku = byId.get(skuId);
    if (!sku) continue;
    const at = lastMoved.get(skuId) ?? null;
    const ts = at ? Date.parse(at) : null;
    if (ts !== null && ts > cutoff) continue; // moved recently — not stale
    rows.push({
      skuId,
      sku: sku.sku,
      name: sku.name,
      category: sku.category,
      onHand: qty,
      lastMovedAt: at,
      daysSince: ts === null ? null : Math.floor((Date.now() - ts) / 86_400_000),
      active: sku.active,
    });
  }

  return rows.sort((a, b) => {
    const ad = a.daysSince ?? Number.POSITIVE_INFINITY;
    const bd = b.daysSince ?? Number.POSITIVE_INFINITY;
    return bd - ad || b.onHand - a.onHand;
  });
}

// --------------------------------- CSV export ---------------------------------

const esc = (v: string | number | null) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Generic CSV writer over the panel row types. Takes the columns in the order the panel is
 * currently showing them, so the export matches what the admin is looking at — including
 * whatever sort they applied, since the caller passes the already-sorted rows.
 */
export function panelToCsv<T>(rows: T[], columns: { header: string; value: (row: T) => string | number | null }[]): string {
  return [
    columns.map((c) => esc(c.header)).join(","),
    ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(",")),
  ].join("\n");
}
