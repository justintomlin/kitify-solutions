// Data layer for PARTNER inventory — a contractor's own stock.
//
// Companion to lib/inventory.ts (Kitify's own stock, admin-only). The two are deliberately
// separate all the way down: separate tables, separate ledger, separate RPC. See
// supabase/migrations/0014_partner_inventory.sql.
//
// THE RULE THIS FILE EXISTS TO KEEP: a contractor may read Kitify's SKU *catalog* and may
// never read Kitify's *quantities*. listKitifyCatalog() below is the ONLY function here that
// touches a Phase 1 table, it selects an explicit column list that contains no quantity and
// no cost, and nothing in this file queries inventory_stock or inventory_movements at all.
// RLS (0015) enforces the same rule server-side; this is the client-side half.
//
// Every stock change goes through applyPartnerMovements() -> the
// apply_partner_inventory_movements RPC, which writes the ledger row and the on-hand row in
// one transaction. Nothing here writes partner_inventory_stock or _movements directly.

import { supabase } from "@/lib/supabase";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  CATEGORIES,
  UOMS,
  REASON_SIGN,
  downloadCsv,
  type InventoryCategory,
  type Uom,
  type MovementReason,
} from "@/lib/inventory";

// Re-exported so contractor-facing routes import from this module only — they have no
// business reaching into the Kitify inventory module even for a constant. (downloadCsv is a
// pure browser helper with no data access; it lives there because Phase 1 needed it first.)
export { CATEGORIES, UOMS, REASON_SIGN, downloadCsv };
export type { InventoryCategory, Uom, MovementReason };

function fail(context: string, error: PostgrestError | null): never {
  console.error(`[partner-inventory] ${context} failed:`, error);
  throw new Error(`partner-inventory: ${context} failed — ${error?.message ?? "unknown error"}`);
}

// --------------------------------- types ----------------------------------

/**
 * Which catalog an item came from. A stock or movement row references exactly one — the
 * DB enforces it with a CHECK — and this is how the app carries that choice around.
 */
export type SkuSource = "kitify" | "partner";
export type SkuRef = { source: SkuSource; id: string };

/** Stable map key for a ref, so Kitify SKU X and partner SKU X can never collide. */
export const refKey = (ref: SkuRef) => `${ref.source}:${ref.id}`;
export const rowRef = (row: { kitifySkuId: string | null; partnerSkuId: string | null }): SkuRef =>
  row.kitifySkuId ? { source: "kitify", id: row.kitifySkuId } : { source: "partner", id: row.partnerSkuId! };

/**
 * The contractor-facing reason list. Two differences from the admin enum:
 *   • 'used_on_job' is a UI-only choice that maps to 'shipped' — same ledger entry, a label
 *     that matches how a contractor actually thinks about stock leaving the truck.
 *   • 'sample_sent' / 'sample_replenish' are absent. They are Kitify's concepts, and the RPC
 *     rejects them from a non-admin caller, so hiding them here is not the only defence.
 */
export const PARTNER_REASONS = [
  "received",
  "shipped",
  "used_on_job",
  "adjustment",
  "damaged",
  "lost",
  "initial",
] as const;
export type PartnerReasonChoice = (typeof PARTNER_REASONS)[number];

export const partnerReasonToDb = (choice: PartnerReasonChoice): MovementReason =>
  choice === "used_on_job" ? "shipped" : choice;

/** Sign for a contractor-facing choice — resolved through the DB reason it maps to. */
export const partnerReasonSign = (choice: PartnerReasonChoice) => REASON_SIGN[partnerReasonToDb(choice)];

export type PartnerSku = {
  id: string;
  ownerId: string;
  sku: string;
  name: string;
  category: InventoryCategory;
  subcategory: string | null;
  uom: Uom;
  defaultCostCents: number | null;
  defaultShipWeightG: number | null;
  dimensionsNote: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PartnerSkuInput = {
  id?: string; // present ⇒ update, absent ⇒ insert
  ownerId: string;
  sku: string;
  name: string;
  category: InventoryCategory;
  subcategory?: string | null;
  uom: Uom;
  defaultCostCents?: number | null;
  defaultShipWeightG?: number | null;
  dimensionsNote?: string | null;
  notes?: string | null;
  active: boolean;
};

/**
 * A Kitify catalog entry as a contractor is allowed to see it: identity and dimensions only.
 * There is deliberately no quantity field and no cost field on this type — if a future change
 * tries to surface Kitify's stock on a contractor screen, there is nowhere to put it.
 */
export type KitifyCatalogSku = {
  id: string;
  sku: string;
  name: string;
  category: InventoryCategory;
  subcategory: string | null;
  uom: Uom;
  dimensionsNote: string | null;
};

export type PartnerStockRow = {
  id: string;
  ownerId: string;
  kitifySkuId: string | null;
  partnerSkuId: string | null;
  location: string;
  quantity: number;
  reorderThreshold: number | null;
  updatedAt: string;
};

export type PartnerMovement = {
  id: string;
  ownerId: string;
  kitifySkuId: string | null;
  partnerSkuId: string | null;
  location: string;
  delta: number;
  reason: MovementReason;
  reference: string | null;
  note: string | null;
  performedBy: string | null;
  performedByName: string | null;
  performedAt: string;
};

/** One line of a batch. `qty` is the positive number typed by the user; the RPC signs it. */
export type PartnerMovementInput = {
  ref: SkuRef;
  location: string;
  reason: PartnerReasonChoice;
  qty: number;
  reference?: string | null;
  note?: string | null;
};

// -------------------------------- mapping ---------------------------------

type PartnerSkuRow = {
  id: string;
  owner_id: string;
  sku: string;
  name: string;
  category: InventoryCategory;
  subcategory: string | null;
  uom: Uom;
  default_cost_cents: number | null;
  default_ship_weight_g: number | null;
  dimensions_note: string | null;
  notes: string | null;
  active: boolean | null;
  created_at: string;
  updated_at: string;
};

const rowToPartnerSku = (r: PartnerSkuRow): PartnerSku => ({
  id: r.id,
  ownerId: r.owner_id,
  sku: r.sku,
  name: r.name,
  category: r.category,
  subcategory: r.subcategory ?? null,
  uom: r.uom,
  defaultCostCents: r.default_cost_cents ?? null,
  defaultShipWeightG: r.default_ship_weight_g ?? null,
  dimensionsNote: r.dimensions_note ?? null,
  notes: r.notes ?? null,
  active: r.active ?? true,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const partnerSkuToRow = (s: PartnerSkuInput) => ({
  owner_id: s.ownerId,
  sku: s.sku.trim(),
  name: s.name.trim(),
  category: s.category,
  subcategory: s.subcategory?.trim() || null,
  uom: s.uom,
  default_cost_cents: s.defaultCostCents ?? null,
  default_ship_weight_g: s.defaultShipWeightG ?? null,
  dimensions_note: s.dimensionsNote?.trim() || null,
  notes: s.notes?.trim() || null,
  active: s.active,
});

type PartnerStockRowRaw = {
  id: string;
  owner_id: string;
  kitify_sku_id: string | null;
  partner_sku_id: string | null;
  location: string;
  quantity: number;
  reorder_threshold: number | null;
  updated_at: string;
};

const rowToPartnerStock = (r: PartnerStockRowRaw): PartnerStockRow => ({
  id: r.id,
  ownerId: r.owner_id,
  kitifySkuId: r.kitify_sku_id ?? null,
  partnerSkuId: r.partner_sku_id ?? null,
  location: r.location,
  quantity: Number(r.quantity) || 0,
  reorderThreshold: r.reorder_threshold ?? null,
  updatedAt: r.updated_at,
});

type PartnerMovementRowRaw = {
  id: string;
  owner_id: string;
  kitify_sku_id: string | null;
  partner_sku_id: string | null;
  location: string;
  delta: number;
  reason: MovementReason;
  reference: string | null;
  note: string | null;
  performed_by: string | null;
  performed_at: string;
};

const rowToPartnerMovement = (r: PartnerMovementRowRaw, names: Map<string, string>): PartnerMovement => ({
  id: r.id,
  ownerId: r.owner_id,
  kitifySkuId: r.kitify_sku_id ?? null,
  partnerSkuId: r.partner_sku_id ?? null,
  location: r.location,
  delta: Number(r.delta) || 0,
  reason: r.reason,
  reference: r.reference ?? null,
  note: r.note ?? null,
  performedBy: r.performed_by ?? null,
  performedByName: r.performed_by ? names.get(r.performed_by) ?? null : null,
  performedAt: r.performed_at,
});

// ------------------------- the Kitify reference catalog -------------------------

/**
 * Kitify's SKU catalog, read-only, as reference for a contractor logging their own stock.
 *
 * The explicit column list is load-bearing, not style: `select("*")` here would pull
 * default_cost_cents (Kitify's cost basis) into a contractor's browser. Quantities are not
 * on this table at all — they live in inventory_stock, which no contractor can read — so the
 * only thing to guard against is the cost column, and naming columns guards against it
 * permanently.
 *
 * RLS (0015) independently limits a contractor to active, non-sample rows; the filters below
 * are so an ADMIN calling this helper sees the same catalog a contractor would.
 */
export async function listKitifyCatalog(): Promise<KitifyCatalogSku[]> {
  const { data, error } = await supabase
    .from("inventory_skus")
    .select("id, sku, name, category, subcategory, uom, dimensions_note")
    .eq("active", true)
    .eq("is_sample", false)
    .order("sku", { ascending: true });
  if (error) fail("listKitifyCatalog", error);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    sku: r.sku as string,
    name: r.name as string,
    category: r.category as InventoryCategory,
    subcategory: (r.subcategory as string | null) ?? null,
    uom: r.uom as Uom,
    dimensionsNote: (r.dimensions_note as string | null) ?? null,
  }));
}

// ----------------------------- partner SKUs ------------------------------

export async function listPartnerSkus(ownerId: string): Promise<PartnerSku[]> {
  const { data, error } = await supabase
    .from("partner_inventory_skus")
    .select("*")
    .eq("owner_id", ownerId)
    .order("sku", { ascending: true });
  if (error) fail("listPartnerSkus", error);
  return (data ?? []).map(rowToPartnerSku);
}

export async function getPartnerSku(id: string): Promise<PartnerSku | null> {
  const { data, error } = await supabase.from("partner_inventory_skus").select("*").eq("id", id).maybeSingle();
  if (error) fail("getPartnerSku", error);
  return data ? rowToPartnerSku(data) : null;
}

export async function savePartnerSku(input: PartnerSkuInput): Promise<PartnerSku> {
  if (input.id) {
    const { data, error } = await supabase
      .from("partner_inventory_skus")
      .update(partnerSkuToRow(input))
      .eq("id", input.id)
      .select()
      .single();
    if (error) fail("savePartnerSku (update)", error);
    if (!data) fail("savePartnerSku (update)", null);
    return rowToPartnerSku(data);
  }
  const { data, error } = await supabase
    .from("partner_inventory_skus")
    .insert(partnerSkuToRow(input))
    .select()
    .single();
  if (error) fail("savePartnerSku (insert)", error);
  if (!data) fail("savePartnerSku (insert)", null);
  return rowToPartnerSku(data);
}

// ----------------------------- partner stock -----------------------------

export async function listPartnerStock(ownerId: string): Promise<PartnerStockRow[]> {
  const { data, error } = await supabase.from("partner_inventory_stock").select("*").eq("owner_id", ownerId);
  if (error) fail("listPartnerStock", error);
  return (data ?? []).map(rowToPartnerStock);
}

export async function listPartnerStockForRef(ownerId: string, ref: SkuRef): Promise<PartnerStockRow[]> {
  const column = ref.source === "kitify" ? "kitify_sku_id" : "partner_sku_id";
  const { data, error } = await supabase
    .from("partner_inventory_stock")
    .select("*")
    .eq("owner_id", ownerId)
    .eq(column, ref.id);
  if (error) fail("listPartnerStockForRef", error);
  return (data ?? []).map(rowToPartnerStock);
}

/**
 * The reorder threshold is an alerting preference, not a stock change, so it is the one
 * write that legitimately updates a stock row outside the RPC. Targets an existing row by id
 * — a threshold cannot be set for a (sku, location) pair that has never held stock, which is
 * fine: recording the first movement creates the row.
 */
export async function setPartnerReorderThreshold(stockRowId: string, threshold: number | null): Promise<void> {
  const { error } = await supabase
    .from("partner_inventory_stock")
    .update({ reorder_threshold: threshold })
    .eq("id", stockRowId);
  if (error) fail("setPartnerReorderThreshold", error);
}

// --------------------------- partner movements ---------------------------

async function resolvePerformerNames(rows: PartnerMovementRowRaw[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(rows.map((r) => r.performed_by).filter((v): v is string => !!v)));
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("profiles").select("id, name").in("id", ids);
  if (error) {
    console.error("[partner-inventory] resolvePerformerNames failed:", error);
    return new Map();
  }
  return new Map((data ?? []).map((p: { id: string; name: string | null }) => [p.id, p.name ?? ""]));
}

export async function listPartnerMovements(opts: {
  ownerId: string;
  ref?: SkuRef;
  since?: string;
  limit?: number;
  offset?: number;
}): Promise<PartnerMovement[]> {
  let q = supabase
    .from("partner_inventory_movements")
    .select("*")
    .eq("owner_id", opts.ownerId)
    .order("performed_at", { ascending: false });
  if (opts.ref) q = q.eq(opts.ref.source === "kitify" ? "kitify_sku_id" : "partner_sku_id", opts.ref.id);
  if (opts.since) q = q.gte("performed_at", opts.since);
  if (opts.limit !== undefined) {
    const from = opts.offset ?? 0;
    q = q.range(from, from + opts.limit - 1);
  }
  const { data, error } = await q;
  if (error) fail("listPartnerMovements", error);
  const rows = (data ?? []) as PartnerMovementRowRaw[];
  const names = await resolvePerformerNames(rows);
  return rows.map((r) => rowToPartnerMovement(r, names));
}

export async function countPartnerMovements(ownerId: string, ref?: SkuRef): Promise<number> {
  let q = supabase
    .from("partner_inventory_movements")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);
  if (ref) q = q.eq(ref.source === "kitify" ? "kitify_sku_id" : "partner_sku_id", ref.id);
  const { count, error } = await q;
  if (error) fail("countPartnerMovements", error);
  return count ?? 0;
}

// ------------------------- admin cross-contractor reads -------------------------
// Both of these return every contractor's rows and therefore only work for an admin — RLS
// narrows a contractor to their own, which would silently make the cross-contractor index
// look like a one-row list. They are used solely by /portal/admin/inventory/partners.

export async function listAllPartnerStock(): Promise<PartnerStockRow[]> {
  const { data, error } = await supabase.from("partner_inventory_stock").select("*");
  if (error) fail("listAllPartnerStock", error);
  return (data ?? []).map(rowToPartnerStock);
}

/**
 * Most recent movement timestamp per contractor.
 *
 * Reads a bounded, newest-first slice rather than the whole ledger and keeps the first
 * timestamp seen for each owner — which is that owner's latest, since the rows arrive
 * ordered. A contractor whose last movement falls outside the slice simply shows no date,
 * which is the right failure for a summary tile. PostgREST cannot GROUP BY, and per-owner
 * queries would fan out once per contractor.
 */
export async function latestMovementByOwner(sampleSize = 2000): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("partner_inventory_movements")
    .select("owner_id, performed_at")
    .order("performed_at", { ascending: false })
    .limit(sampleSize);
  if (error) fail("latestMovementByOwner", error);
  const out = new Map<string, string>();
  for (const r of (data ?? []) as { owner_id: string; performed_at: string }[]) {
    if (!out.has(r.owner_id)) out.set(r.owner_id, r.performed_at);
  }
  return out;
}

/** Thrown when the RPC refuses a movement that would drive on-hand below zero. */
export class PartnerNegativeStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartnerNegativeStockError";
  }
}

/**
 * Apply a batch of partner movements atomically. One RPC call = one transaction: every line
 * commits or none does, and each writes BOTH the ledger row and the on-hand row.
 *
 * `ownerId` is explicit rather than implied by the session because an admin records movements
 * on a contractor's behalf from the partner view. A contractor passing anyone else's id is
 * rejected by the RPC and, independently, by RLS.
 */
export async function applyPartnerMovements(
  ownerId: string,
  rows: PartnerMovementInput[],
): Promise<{ applied: number }> {
  if (rows.length === 0) return { applied: 0 };
  const payload = rows.map((r) => ({
    kitify_sku_id: r.ref.source === "kitify" ? r.ref.id : null,
    partner_sku_id: r.ref.source === "partner" ? r.ref.id : null,
    location: r.location,
    reason: partnerReasonToDb(r.reason),
    // Positive as typed; the RPC applies the reason's sign. 'adjustment' passes through
    // signed because it is the one reason that can go either way.
    delta: r.reason === "adjustment" ? Math.trunc(r.qty) : Math.abs(Math.trunc(r.qty)),
    reference: r.reference ?? null,
    note: r.note ?? null,
  }));

  const { data, error } = await supabase.rpc("apply_partner_inventory_movements", {
    p_owner_id: ownerId,
    p_movements: payload,
  });
  if (error) {
    if ((error.message ?? "").includes("PARTNER_INVENTORY_NEGATIVE")) {
      throw new PartnerNegativeStockError(error.message);
    }
    fail("applyPartnerMovements", error);
  }
  const applied = (data as { applied?: number } | null)?.applied ?? rows.length;
  return { applied };
}

// ---------------------------- the feature toggle ----------------------------

/**
 * Flip a contractor's "Inventory tracking" toggle. Admin-only, enforced inside the RPC.
 *
 * A plain update on profiles would not work: 0002 gives profiles an UPDATE policy of
 * id = auth.uid() and no admin equivalent, so an admin writing another contractor's row
 * matches zero rows and fails silently. See the rationale in 0015.
 */
export async function setInventoryTracking(ownerId: string, enabled: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_inventory_tracking", {
    p_owner_id: ownerId,
    p_enabled: enabled,
  });
  if (error) fail("setInventoryTracking", error);
  return !!data;
}

// -------------------------------- derived ---------------------------------

/** On-hand summed across a contractor's locations, keyed by refKey(). */
export function partnerOnHandByRef(stock: PartnerStockRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of stock) {
    const k = refKey(rowRef(s));
    m.set(k, (m.get(k) ?? 0) + s.quantity);
  }
  return m;
}

export function isPartnerLowStock(row: PartnerStockRow): boolean {
  return row.reorderThreshold !== null && row.quantity <= row.reorderThreshold;
}

/** Distinct locations a contractor has actually used — feeds the location autocomplete. */
export function distinctLocations(stock: PartnerStockRow[]): string[] {
  const seen = new Map<string, string>();
  for (const s of stock) {
    const key = s.location.trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, s.location.trim());
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

export type PartnerMovementSummary = {
  total: number;
  piecesReceived: number;
  piecesOut: number;
};

export function summarisePartnerMovements(movements: PartnerMovement[]): PartnerMovementSummary {
  let piecesReceived = 0;
  let piecesOut = 0;
  for (const m of movements) {
    if (m.delta > 0) piecesReceived += m.delta;
    else piecesOut += -m.delta;
  }
  return { total: movements.length, piecesReceived, piecesOut };
}

// --------------------------------- export ---------------------------------

export function partnerMovementsToCsv(
  movements: PartnerMovement[],
  labelFor: (ref: SkuRef) => { sku: string; name: string },
): string {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "performed_at", "sku", "name", "source", "location", "reason", "delta", "reference", "note", "performed_by",
  ];
  const lines = movements.map((m) => {
    const ref = rowRef(m);
    const label = labelFor(ref);
    return [
      esc(m.performedAt),
      esc(label.sku),
      esc(label.name),
      esc(ref.source === "kitify" ? "Kitify catalog" : "Mine"),
      esc(m.location),
      esc(m.reason),
      esc(m.delta),
      esc(m.reference),
      esc(m.note),
      esc(m.performedByName ?? m.performedBy),
    ].join(",");
  });
  return [header.join(","), ...lines].join("\n");
}
