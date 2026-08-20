// The order→inventory seam. Phase 3.
//
// Fires when an order enters 'in_transit' — the ready_to_ship → in_transit hand-off that the
// admin order page labels "Ship" and that stamps orders.shipped_at. There is no 'shipped'
// status in this system; see the header of 0016_inventory_reporting.sql.
//
// BEST-EFFORT AND NON-BLOCKING, always. The status write has already committed by the time
// any of this runs, so a failure here must never look like the ship failed:
// recordOrderShipment() resolves rather than rejects, and the caller decides how loudly to
// mention it.
//
// Touches KITIFY stock only, and in v1 does not touch even that — the RPC records what would
// have moved and applies nothing (strategy (c); the reasoning is in the migration header).
// It never touches partner_inventory_* under any circumstance.

import { supabase } from "@/lib/supabase";
import type { PostgrestError } from "@supabase/supabase-js";

export const SHIPMENT_STATUSES = ["success", "partial", "failed", "skipped"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** One candidate line as recorded by the RPC. `available` is null when the SKU didn't match. */
export type ShipmentLine = {
  skuId: string | null;
  skuCode: string | null;
  skuLabel: string;
  requested: number;
  available: number | null;
  source: string;
  matched: boolean;
};

export type OrderShipment = {
  id: string;
  orderId: string;
  attemptedAt: string;
  attemptedBy: string | null;
  status: ShipmentStatus;
  linesAttempted: number;
  linesApplied: number;
  errorNote: string | null;
  movementIds: string[];
  lines: ShipmentLine[];
};

/** What recordOrderShipment resolves to. `ok:false` means the attempt itself couldn't run. */
export type ShipmentOutcome =
  | { ok: true; alreadyRecorded: boolean; shipmentId: string; status: ShipmentStatus; linesAttempted: number; linesApplied: number; lines: ShipmentLine[] }
  | { ok: false; error: string };

function fail(context: string, error: PostgrestError | null): never {
  console.error(`[inventory-orders] ${context} failed:`, error);
  throw new Error(`inventory-orders: ${context} failed — ${error?.message ?? "unknown error"}`);
}

function parseLines(raw: unknown): ShipmentLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const requested = Number(r.requested);
    const available = r.available === null || r.available === undefined ? null : Number(r.available);
    return {
      skuId: typeof r.sku_id === "string" ? r.sku_id : null,
      skuCode: typeof r.sku_code === "string" ? r.sku_code : null,
      skuLabel: typeof r.sku_label === "string" ? r.sku_label : "—",
      requested: Number.isFinite(requested) ? requested : 1,
      available: available !== null && Number.isFinite(available) ? available : null,
      source: typeof r.source === "string" ? r.source : "",
      matched: !!r.matched,
    };
  });
}

type ShipmentRow = {
  id: string;
  order_id: string;
  attempted_at: string;
  attempted_by: string | null;
  status: ShipmentStatus;
  lines_attempted: number;
  lines_applied: number;
  error_note: string | null;
  movement_ids: string[] | null;
  unfulfillable: unknown;
};

const rowToShipment = (r: ShipmentRow): OrderShipment => ({
  id: r.id,
  orderId: r.order_id,
  attemptedAt: r.attempted_at,
  attemptedBy: r.attempted_by ?? null,
  status: r.status,
  linesAttempted: Number(r.lines_attempted) || 0,
  linesApplied: Number(r.lines_applied) || 0,
  errorNote: r.error_note ?? null,
  movementIds: Array.isArray(r.movement_ids) ? r.movement_ids : [],
  lines: parseLines(r.unfulfillable),
});

type RpcResult = {
  already_recorded?: boolean;
  shipment_id?: string;
  status?: ShipmentStatus;
  lines_attempted?: number;
  lines_applied?: number;
  unfulfillable?: unknown;
};

function toOutcome(data: RpcResult | null): ShipmentOutcome {
  return {
    ok: true,
    alreadyRecorded: !!data?.already_recorded,
    shipmentId: data?.shipment_id ?? "",
    status: data?.status ?? "failed",
    linesAttempted: Number(data?.lines_attempted) || 0,
    linesApplied: Number(data?.lines_applied) || 0,
    lines: parseLines(data?.unfulfillable),
  };
}

/**
 * Record the inventory impact of an order that has just shipped.
 *
 * RESOLVES ON FAILURE rather than throwing. The ship transition is already committed when
 * this runs; a rejected promise here would propagate into the admin's ship handler and read
 * as "shipping failed", which would be a lie. The caller surfaces `ok:false` as a notice.
 *
 * Admin-only — the RPC raises for a non-admin, which lands here as ok:false. A contractor
 * marking their own order along the pipeline simply records nothing, which is correct:
 * Kitify's stock is not their business.
 */
export async function recordOrderShipment(orderId: string): Promise<ShipmentOutcome> {
  try {
    const { data, error } = await supabase.rpc("apply_order_shipment", { p_order_id: orderId });
    if (error) {
      console.error("[inventory-orders] recordOrderShipment failed:", error);
      return { ok: false, error: error.message };
    }
    return toOutcome(data as RpcResult | null);
  } catch (e) {
    console.error("[inventory-orders] recordOrderShipment threw:", e);
    return { ok: false, error: e instanceof Error ? e.message : "unknown error" };
  }
}

/**
 * Force a fresh attempt, keeping the previous one as history. Used by the Retry button when
 * an attempt came back 'partial' or 'failed' — typically after receiving stock or fixing the
 * catalog. Unlike the automatic path this is a deliberate admin action, so it throws on
 * failure and the UI shows the error.
 */
export async function retryOrderShipment(orderId: string, shipmentId: string): Promise<ShipmentOutcome> {
  const { data, error } = await supabase.rpc("apply_order_shipment_retry", {
    p_order_id: orderId,
    p_shipment_id: shipmentId,
  });
  if (error) fail("retryOrderShipment", error);
  return toOutcome(data as RpcResult | null);
}

/** Every attempt for an order, newest first. Admin-only by RLS. */
export async function listOrderShipments(orderId: string): Promise<OrderShipment[]> {
  const { data, error } = await supabase
    .from("inventory_order_shipments")
    .select("*")
    .eq("order_id", orderId)
    .order("attempted_at", { ascending: false });
  if (error) fail("listOrderShipments", error);
  return (data ?? []).map(rowToShipment);
}
