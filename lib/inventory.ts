// Data layer for Kitify's own inventory — backed by Supabase.
//
// Mirrors the conventions in lib/store.ts: every export is async, the app works in
// camelCase domain objects, and the mapping helpers convert to and from the flat
// snake_case columns (see supabase/migrations/0012_inventory.sql).
//
// ADMIN-ONLY. RLS (0013_inventory_rls.sql) restricts all four tables to profiles with
// role = 'admin', so these functions return nothing at all for a contractor — there is no
// owner filter to pass because there is no notion of ownership here. Kitify's stock levels
// are never shown to a contractor or a customer at any surface.
//
// The one rule that matters: NOTHING here writes inventory_stock or inventory_movements
// directly. Every stock change goes through applyMovements(), which calls the
// apply_inventory_movements RPC — one transaction that writes the audit row and updates
// the on-hand row together. Two client-side writes could half-succeed and silently
// desynchronise the ledger from the balance.

import { supabase } from "@/lib/supabase";
import type { PostgrestError } from "@supabase/supabase-js";

function fail(context: string, error: PostgrestError | null): never {
  console.error(`[inventory] ${context} failed:`, error);
  throw new Error(`inventory: ${context} failed — ${error?.message ?? "unknown error"}`);
}

// --------------------------------- types ----------------------------------

export const CATEGORIES = [
  "wall-panel",
  "plumbing",
  "install-part",
  "vanity",
  "base",
  "trim",
  "accessory",
  "sample-kit",
  "sample-piece",
  "other",
] as const;
export type InventoryCategory = (typeof CATEGORIES)[number];

export const UOMS = ["each", "box", "sheet", "pair", "set"] as const;
export type Uom = (typeof UOMS)[number];

export const MOVEMENT_REASONS = [
  "received",
  "shipped",
  "sample_sent",
  "sample_replenish",
  "adjustment",
  "damaged",
  "lost",
  "initial",
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

// Which way each reason moves stock. 'adjustment' is bidirectional — the admin picks the
// sign — which is why it maps to 0 rather than ±1. Kept in sync with the CASE expression in
// apply_inventory_movements(); the database is authoritative, this is for labelling the UI.
export const REASON_SIGN: Record<MovementReason, 1 | -1 | 0> = {
  received: 1,
  sample_replenish: 1,
  initial: 1,
  shipped: -1,
  sample_sent: -1,
  damaged: -1,
  lost: -1,
  adjustment: 0,
};

export type SampleKitItem = { skuId: string; qty: number };

export type InventoryLocation = {
  id: string;
  name: string;
  notes: string | null;
  active: boolean;
  createdAt: string;
};

export type InventorySku = {
  id: string;
  sku: string;
  name: string;
  category: InventoryCategory;
  subcategory: string | null;
  uom: Uom;
  defaultCostCents: number | null;
  defaultShipWeightG: number | null;
  dimensionsNote: string | null;
  isSample: boolean;
  sampleKitContents: SampleKitItem[] | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InventorySkuInput = {
  id?: string; // present ⇒ update, absent ⇒ insert
  sku: string;
  name: string;
  category: InventoryCategory;
  subcategory?: string | null;
  uom: Uom;
  defaultCostCents?: number | null;
  defaultShipWeightG?: number | null;
  dimensionsNote?: string | null;
  isSample: boolean;
  sampleKitContents?: SampleKitItem[] | null;
  active: boolean;
  notes?: string | null;
};

export type StockRow = {
  id: string;
  skuId: string;
  locationId: string;
  quantity: number;
  reorderThreshold: number | null;
  updatedAt: string;
};

export type Movement = {
  id: string;
  skuId: string;
  locationId: string;
  delta: number;
  reason: MovementReason;
  reference: string | null;
  note: string | null;
  performedBy: string | null;
  performedByName: string | null; // resolved separately — see listMovements
  performedAt: string;
};

// One line of a batch handed to applyMovements(). `qty` is always the POSITIVE number the
// admin typed; the RPC derives the sign from the reason. The exception is 'adjustment',
// where the sign is meaningful and is passed through as given.
export type MovementInput = {
  skuId: string;
  locationId: string;
  reason: MovementReason;
  qty: number;
  reference?: string | null;
  note?: string | null;
};

// A sample kit is a sample SKU in the 'sample-kit' category. Kits do not nest, so anything
// that can go INSIDE a kit is a sample SKU in any other category.
export function isSampleKit(s: InventorySku): boolean {
  return s.isSample && s.category === "sample-kit";
}
export function canBeKitChild(s: InventorySku): boolean {
  return s.isSample && s.category !== "sample-kit";
}

// -------------------------------- mapping ---------------------------------

type LocationRow = {
  id: string;
  name: string;
  notes: string | null;
  active: boolean | null;
  created_at: string;
};

function rowToLocation(r: LocationRow): InventoryLocation {
  return {
    id: r.id,
    name: r.name,
    notes: r.notes ?? null,
    active: r.active ?? true,
    createdAt: r.created_at,
  };
}

type SkuRow = {
  id: string;
  sku: string;
  name: string;
  category: InventoryCategory;
  subcategory: string | null;
  uom: Uom;
  default_cost_cents: number | null;
  default_ship_weight_g: number | null;
  dimensions_note: string | null;
  is_sample: boolean | null;
  sample_kit_contents: unknown;
  active: boolean | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// sample_kit_contents is free-form jsonb, so it is validated rather than trusted: a
// hand-edited row in the SQL editor must not be able to crash the contents editor.
function parseKitContents(raw: unknown): SampleKitItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SampleKitItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const skuId = typeof rec.sku_id === "string" ? rec.sku_id : typeof rec.skuId === "string" ? rec.skuId : null;
    if (!skuId) continue;
    const qty = Number(rec.qty);
    out.push({ skuId, qty: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1 });
  }
  return out;
}

function rowToSku(r: SkuRow): InventorySku {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category,
    subcategory: r.subcategory ?? null,
    uom: r.uom,
    defaultCostCents: r.default_cost_cents ?? null,
    defaultShipWeightG: r.default_ship_weight_g ?? null,
    dimensionsNote: r.dimensions_note ?? null,
    isSample: !!r.is_sample,
    sampleKitContents: parseKitContents(r.sample_kit_contents),
    active: r.active ?? true,
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function skuToRow(s: InventorySkuInput) {
  return {
    sku: s.sku.trim(),
    name: s.name.trim(),
    category: s.category,
    subcategory: s.subcategory?.trim() || null,
    uom: s.uom,
    default_cost_cents: s.defaultCostCents ?? null,
    default_ship_weight_g: s.defaultShipWeightG ?? null,
    dimensions_note: s.dimensionsNote?.trim() || null,
    is_sample: s.isSample,
    // Written back in the DB's snake_case shape so a row round-trips unchanged.
    sample_kit_contents: s.sampleKitContents?.length
      ? s.sampleKitContents.map((c) => ({ sku_id: c.skuId, qty: c.qty }))
      : null,
    active: s.active,
    notes: s.notes?.trim() || null,
  };
}

type StockRowRaw = {
  id: string;
  sku_id: string;
  location_id: string;
  quantity: number;
  reorder_threshold: number | null;
  updated_at: string;
};

function rowToStock(r: StockRowRaw): StockRow {
  return {
    id: r.id,
    skuId: r.sku_id,
    locationId: r.location_id,
    quantity: Number(r.quantity) || 0,
    reorderThreshold: r.reorder_threshold ?? null,
    updatedAt: r.updated_at,
  };
}

type MovementRowRaw = {
  id: string;
  sku_id: string;
  location_id: string;
  delta: number;
  reason: MovementReason;
  reference: string | null;
  note: string | null;
  performed_by: string | null;
  performed_at: string;
};

function rowToMovement(r: MovementRowRaw, names: Map<string, string>): Movement {
  return {
    id: r.id,
    skuId: r.sku_id,
    locationId: r.location_id,
    delta: Number(r.delta) || 0,
    reason: r.reason,
    reference: r.reference ?? null,
    note: r.note ?? null,
    performedBy: r.performed_by ?? null,
    performedByName: r.performed_by ? names.get(r.performed_by) ?? null : null,
    performedAt: r.performed_at,
  };
}

// ------------------------------- locations --------------------------------

export async function listLocations(): Promise<InventoryLocation[]> {
  const { data, error } = await supabase
    .from("inventory_locations")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) fail("listLocations", error);
  return (data ?? []).map(rowToLocation);
}

export async function createLocation(name: string, notes?: string | null): Promise<InventoryLocation> {
  const { data, error } = await supabase
    .from("inventory_locations")
    .insert({ name: name.trim(), notes: notes?.trim() || null })
    .select()
    .single();
  if (error) fail("createLocation", error);
  if (!data) fail("createLocation", null);
  return rowToLocation(data);
}

export async function updateLocation(
  id: string,
  patch: Partial<{ name: string; notes: string | null; active: boolean }>,
): Promise<InventoryLocation> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null;
  if (patch.active !== undefined) row.active = patch.active;
  const { data, error } = await supabase.from("inventory_locations").update(row).eq("id", id).select().single();
  if (error) fail("updateLocation", error);
  if (!data) fail("updateLocation", null);
  return rowToLocation(data);
}

// ---------------------------------- skus ----------------------------------

export async function listSkus(): Promise<InventorySku[]> {
  const { data, error } = await supabase.from("inventory_skus").select("*").order("sku", { ascending: true });
  if (error) fail("listSkus", error);
  return (data ?? []).map(rowToSku);
}

export async function getSku(id: string): Promise<InventorySku | null> {
  const { data, error } = await supabase.from("inventory_skus").select("*").eq("id", id).maybeSingle();
  if (error) fail("getSku", error);
  return data ? rowToSku(data) : null;
}

export async function saveSku(input: InventorySkuInput): Promise<InventorySku> {
  if (input.id) {
    const { data, error } = await supabase
      .from("inventory_skus")
      .update(skuToRow(input))
      .eq("id", input.id)
      .select()
      .single();
    if (error) fail("saveSku (update)", error);
    if (!data) fail("saveSku (update)", null);
    return rowToSku(data);
  }
  const { data, error } = await supabase.from("inventory_skus").insert(skuToRow(input)).select().single();
  if (error) fail("saveSku (insert)", error);
  if (!data) fail("saveSku (insert)", null);
  return rowToSku(data);
}

// --------------------------------- stock ----------------------------------

export async function listStock(): Promise<StockRow[]> {
  const { data, error } = await supabase.from("inventory_stock").select("*");
  if (error) fail("listStock", error);
  return (data ?? []).map(rowToStock);
}

export async function listStockForSku(skuId: string): Promise<StockRow[]> {
  const { data, error } = await supabase.from("inventory_stock").select("*").eq("sku_id", skuId);
  if (error) fail("listStockForSku", error);
  return (data ?? []).map(rowToStock);
}

export async function listStockAtLocation(locationId: string): Promise<StockRow[]> {
  const { data, error } = await supabase
    .from("inventory_stock")
    .select("*")
    .eq("location_id", locationId)
    .gt("quantity", 0);
  if (error) fail("listStockAtLocation", error);
  return (data ?? []).map(rowToStock);
}

// The reorder threshold is a per-(sku, location) alerting preference, not a stock change, so
// it is the one write that legitimately touches inventory_stock without a movement. Upsert
// because the pair may not have a row yet — you can set a threshold before the first receipt.
export async function setReorderThreshold(
  skuId: string,
  locationId: string,
  threshold: number | null,
): Promise<void> {
  const { error } = await supabase
    .from("inventory_stock")
    .upsert(
      { sku_id: skuId, location_id: locationId, reorder_threshold: threshold },
      { onConflict: "sku_id,location_id" },
    );
  if (error) fail("setReorderThreshold", error);
}

// ------------------------------- movements --------------------------------

// Resolve performer names in one extra query rather than a PostgREST embed — the embed
// depends on the FK's generated name and fails the whole query if it cannot be resolved.
async function resolvePerformerNames(rows: MovementRowRaw[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(rows.map((r) => r.performed_by).filter((v): v is string => !!v)));
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("profiles").select("id, name").in("id", ids);
  if (error) {
    // A missing name is cosmetic — never fail a history read over it.
    console.error("[inventory] resolvePerformerNames failed:", error);
    return new Map();
  }
  return new Map((data ?? []).map((p: { id: string; name: string | null }) => [p.id, p.name ?? ""]));
}

export async function listMovements(opts: {
  skuId?: string;
  since?: string; // ISO timestamp — movements at or after this instant
  limit?: number;
  offset?: number;
} = {}): Promise<Movement[]> {
  let q = supabase.from("inventory_movements").select("*").order("performed_at", { ascending: false });
  if (opts.skuId) q = q.eq("sku_id", opts.skuId);
  if (opts.since) q = q.gte("performed_at", opts.since);
  if (opts.limit !== undefined) {
    const from = opts.offset ?? 0;
    q = q.range(from, from + opts.limit - 1);
  }
  const { data, error } = await q;
  if (error) fail("listMovements", error);
  const rows = (data ?? []) as MovementRowRaw[];
  const names = await resolvePerformerNames(rows);
  return rows.map((r) => rowToMovement(r, names));
}

/**
 * Most recent movement timestamp for one SKU at each of the given locations.
 *
 * Done as one small query per location rather than reading the whole log: PostgREST cannot
 * GROUP BY, and inventory_stock.updated_at is not a safe proxy because editing a reorder
 * threshold also touches it. Location counts are single digits, so the fan-out is cheap.
 */
export async function lastMovementByLocation(
  skuId: string,
  locationIds: string[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    locationIds.map(async (locationId) => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("performed_at")
        .eq("sku_id", skuId)
        .eq("location_id", locationId)
        .order("performed_at", { ascending: false })
        .limit(1);
      if (error) {
        console.error("[inventory] lastMovementByLocation failed:", error);
        return null;
      }
      const at = (data ?? [])[0]?.performed_at as string | undefined;
      return at ? ([locationId, at] as const) : null;
    }),
  );
  return new Map(entries.filter((e): e is readonly [string, string] => e !== null));
}

export async function countMovementsForSku(skuId: string): Promise<number> {
  const { count, error } = await supabase
    .from("inventory_movements")
    .select("id", { count: "exact", head: true })
    .eq("sku_id", skuId);
  if (error) fail("countMovementsForSku", error);
  return count ?? 0;
}

// Raised when the RPC refuses a movement that would drive on-hand below zero — the single
// hard block in the system. Callers catch this specifically to show the "not enough stock"
// message instead of a generic failure.
export class NegativeStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NegativeStockError";
  }
}

/**
 * Apply a batch of movements atomically. One RPC call = one transaction: every line commits
 * or none does, and each line writes BOTH the inventory_movements audit row and the
 * inventory_stock balance. Used for single movements, bulk receive/ship, inter-location
 * moves (an out line plus an in line) and expanded sample kits alike.
 */
export async function applyMovements(rows: MovementInput[]): Promise<{ applied: number }> {
  if (rows.length === 0) return { applied: 0 };
  const payload = rows.map((r) => ({
    sku_id: r.skuId,
    location_id: r.locationId,
    reason: r.reason,
    // Positive as typed; the RPC applies the reason's sign. 'adjustment' is passed through
    // signed because it is the one reason that can go either way.
    delta: r.reason === "adjustment" ? Math.trunc(r.qty) : Math.abs(Math.trunc(r.qty)),
    reference: r.reference ?? null,
    note: r.note ?? null,
  }));

  const { data, error } = await supabase.rpc("apply_inventory_movements", { p_movements: payload });
  if (error) {
    if ((error.message ?? "").includes("INVENTORY_NEGATIVE")) {
      throw new NegativeStockError(error.message);
    }
    fail("applyMovements", error);
  }
  const applied = (data as { applied?: number } | null)?.applied ?? rows.length;
  return { applied };
}

/** Move stock between two locations: one negative adjustment out, one positive adjustment in. */
export async function moveBetweenLocations(args: {
  skuId: string;
  fromLocationId: string;
  toLocationId: string;
  qty: number;
  fromName: string;
  toName: string;
  note?: string | null;
}): Promise<{ applied: number }> {
  const qty = Math.abs(Math.trunc(args.qty));
  return applyMovements([
    {
      skuId: args.skuId,
      locationId: args.fromLocationId,
      reason: "adjustment",
      qty: -qty,
      reference: `→ ${args.toName}`,
      note: args.note ?? null,
    },
    {
      skuId: args.skuId,
      locationId: args.toLocationId,
      reason: "adjustment",
      qty: qty,
      reference: `← ${args.fromName}`,
      note: args.note ?? null,
    },
  ]);
}

// -------------------------------- derived ---------------------------------

/** On-hand summed across every location, keyed by sku id. */
export function onHandBySku(stock: StockRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of stock) m.set(s.skuId, (m.get(s.skuId) ?? 0) + s.quantity);
  return m;
}

/** A (sku, location) pair is low when it has a threshold set and has fallen to or below it. */
export function isLowStock(row: StockRow): boolean {
  return row.reorderThreshold !== null && row.quantity <= row.reorderThreshold;
}

/**
 * How many complete copies of a sample kit could be assembled right now, from the on-hand
 * count of its declared child pieces. A kit with no declared contents falls back to its own
 * on-hand count — some kits are stocked pre-boxed rather than assembled to order.
 */
export function kitBuildable(kit: InventorySku, onHand: Map<string, number>): number {
  const contents = kit.sampleKitContents;
  if (!contents || contents.length === 0) return onHand.get(kit.id) ?? 0;
  let min = Infinity;
  for (const c of contents) {
    const have = onHand.get(c.skuId) ?? 0;
    min = Math.min(min, Math.floor(have / Math.max(1, c.qty)));
  }
  return Number.isFinite(min) ? min : 0;
}

export type MovementSummary = {
  byReason: Record<MovementReason, number>; // movement COUNT per reason
  piecesReceived: number; // sum of positive deltas
  piecesShipped: number; // sum of |negative deltas|
  total: number;
};

/** Roll a window of movements up for the dashboard's "last 30 days" panel. */
export function summariseMovements(movements: Movement[]): MovementSummary {
  const byReason = Object.fromEntries(MOVEMENT_REASONS.map((r) => [r, 0])) as Record<MovementReason, number>;
  let piecesReceived = 0;
  let piecesShipped = 0;
  for (const m of movements) {
    byReason[m.reason] = (byReason[m.reason] ?? 0) + 1;
    if (m.delta > 0) piecesReceived += m.delta;
    else piecesShipped += -m.delta;
  }
  return { byReason, piecesReceived, piecesShipped, total: movements.length };
}

// --------------------------------- export ---------------------------------

// Per-SKU, all-time CSV of the movement log. This IS the historical record for now.
//
// Phase 3+ hook: cross-SKU historical reporting UI is deliberately NOT built in v1 — the
// inventory_movements table holds the complete history and admins pull custom cuts directly
// in the Supabase SQL editor until that UI exists.
export function movementsToCsv(
  movements: Movement[],
  locationNames: Map<string, string>,
  skuCode: string,
): string {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["performed_at", "sku", "location", "reason", "delta", "reference", "note", "performed_by"];
  const lines = movements.map((m) =>
    [
      esc(m.performedAt),
      esc(skuCode),
      esc(locationNames.get(m.locationId) ?? m.locationId),
      esc(m.reason),
      esc(m.delta),
      esc(m.reference),
      esc(m.note),
      esc(m.performedByName ?? m.performedBy),
    ].join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel reads the UTF-8 correctly — SKU codes carry ×, é and similar.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
