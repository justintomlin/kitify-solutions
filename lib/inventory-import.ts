// CSV import for the KITIFY SKU CATALOG (public.inventory_skus). Phase 3.
//
// Catalog only. A CSV row describes an item Kitify can ship; it is NOT a receipt, so this
// module never writes inventory_stock or inventory_movements. Loading opening balances is a
// movement import, which is a different file with different validation (Phase 4) — and a CSV
// carrying stock or movement columns is REFUSED with an actionable error rather than being
// silently half-honoured.
//
// Partner catalogs (partner_inventory_skus) are out of scope: contractors own those and edit
// them one at a time.
//
// The flow is parse → review → commit, deliberately in three steps. An admin sees exactly
// which rows insert, which update an existing SKU, and which are broken, before anything is
// written.

import { supabase } from "@/lib/supabase";
import { CATEGORIES, UOMS, type InventoryCategory, type Uom } from "@/lib/inventory";

// Columns that mean "this is stock data, not catalog data". Their presence is the signal that
// someone is trying to load balances through the catalog importer, which would quietly create
// SKUs and silently drop the quantities.
const STOCK_COLUMNS = [
  "quantity", "qty", "on_hand", "onhand", "stock", "location", "location_id",
  "delta", "reason", "movement", "reorder_threshold", "performed_at", "reference",
];

export type ParsedRow = {
  /** 1-based line number in the source file, counting the header — what the admin sees. */
  line: number;
  sku: string;
  name: string;
  category: InventoryCategory;
  subcategory: string | null;
  uom: Uom;
  defaultCostCents: number | null;
  defaultShipWeightG: number | null;
  dimensionsNote: string | null;
  notes: string | null;
  isSample: boolean;
  active: boolean;
  /** Resolved against the live catalog by checkExisting(). */
  action: "insert" | "update";
};

export type RowError = { line: number; sku: string; column: string; message: string };
export type DuplicateWarning = { line: number; sku: string; kind: "in-file" | "in-catalog"; firstLine?: number };

export type ParseResult = {
  rows: ParsedRow[];
  errors: RowError[];
  duplicates: DuplicateWarning[];
  /** Set when the whole file is rejected — wrong columns, no header, empty. */
  fatal: string | null;
};

// ------------------------------- CSV parsing -------------------------------

/**
 * Minimal RFC4180-ish splitter: handles quoted fields, escaped quotes ("") and commas or
 * newlines inside quotes. Written rather than pulled in because the project runs on zero
 * runtime dependencies beyond lucide-react, and this is the entire surface we need.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM — Excel writes one and it would otherwise corrupt the first header.
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  // Trailing field / row (a file not ending in a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank lines — trailing newlines are near-universal in exported CSVs.
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");

function parseBool(raw: string, fallback: boolean): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === "") return fallback;
  if (["true", "t", "yes", "y", "1"].includes(v)) return true;
  if (["false", "f", "no", "n", "0"].includes(v)) return false;
  return null;
}

function parseIntField(raw: string): number | null | "invalid" {
  const v = raw.trim();
  if (v === "") return null;
  const n = Number(v.replace(/[,_]/g, ""));
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return "invalid";
  return n;
}

/** cost_usd is the friendlier column; default_cost_cents is accepted for a straight re-import. */
function parseCost(usd: string, cents: string): number | null | "invalid" {
  if (cents.trim() !== "") return parseIntField(cents);
  const v = usd.trim();
  if (v === "") return null;
  const n = Number(v.replace(/[$,]/g, ""));
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return Math.round(n * 100);
}

/**
 * Parse and validate a catalog CSV. Never throws — a malformed file comes back as
 * `fatal`, and a malformed row as an entry in `errors`, so the UI can show everything at once.
 */
export function parseCatalogCsv(text: string): ParseResult {
  const empty: ParseResult = { rows: [], errors: [], duplicates: [], fatal: null };
  const grid = parseCsv(text);
  if (grid.length === 0) return { ...empty, fatal: "empty" };

  const header = grid[0].map(norm);

  // Refuse stock/movement columns outright rather than importing the catalog half of the file.
  const offending = header.filter((h) => STOCK_COLUMNS.includes(h));
  if (offending.length > 0) {
    return { ...empty, fatal: `stock-columns:${offending.join(", ")}` };
  }

  const col = (name: string) => header.indexOf(name);
  const iSku = col("sku");
  const iName = col("name");
  if (iSku < 0 || iName < 0) return { ...empty, fatal: "missing-required-columns" };

  const idx = {
    sku: iSku,
    name: iName,
    category: col("category"),
    subcategory: col("subcategory"),
    uom: col("uom"),
    costUsd: col("cost_usd"),
    costCents: col("default_cost_cents"),
    weight: col("default_ship_weight_g"),
    dimensions: col("dimensions_note"),
    notes: col("notes"),
    isSample: col("is_sample"),
    active: col("active"),
  };

  const cell = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i] : "");

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const duplicates: DuplicateWarning[] = [];
  const seen = new Map<string, number>(); // lowercased sku → first line

  for (let r = 1; r < grid.length; r++) {
    const raw = grid[r];
    const line = r + 1; // 1-based, header is line 1
    const sku = cell(raw, idx.sku).trim();
    const name = cell(raw, idx.name).trim();

    if (!sku) {
      errors.push({ line, sku: "", column: "sku", message: "required" });
      continue;
    }
    if (!name) errors.push({ line, sku, column: "name", message: "required" });

    const key = sku.toLowerCase();
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      // A second row for the same SKU would make the upsert order decide which one wins —
      // never silently. Flagged as an error, not a warning.
      errors.push({ line, sku, column: "sku", message: `duplicate of line ${firstLine}` });
      duplicates.push({ line, sku, kind: "in-file", firstLine });
      continue;
    }
    seen.set(key, line);

    const categoryRaw = cell(raw, idx.category).trim().toLowerCase();
    const category = (categoryRaw || "other") as InventoryCategory;
    if (!CATEGORIES.includes(category)) {
      errors.push({ line, sku, column: "category", message: `must be one of: ${CATEGORIES.join(" | ")}` });
    }

    const uomRaw = cell(raw, idx.uom).trim().toLowerCase();
    const uom = (uomRaw || "each") as Uom;
    if (!UOMS.includes(uom)) {
      errors.push({ line, sku, column: "uom", message: `must be one of: ${UOMS.join(" | ")}` });
    }

    const cost = parseCost(cell(raw, idx.costUsd), cell(raw, idx.costCents));
    if (cost === "invalid") errors.push({ line, sku, column: "cost", message: "must be a non-negative number" });

    const weight = parseIntField(cell(raw, idx.weight));
    if (weight === "invalid") {
      errors.push({ line, sku, column: "default_ship_weight_g", message: "must be a non-negative whole number" });
    }

    const isSample = parseBool(cell(raw, idx.isSample), false);
    if (isSample === null) errors.push({ line, sku, column: "is_sample", message: "must be true or false" });

    const active = parseBool(cell(raw, idx.active), true);
    if (active === null) errors.push({ line, sku, column: "active", message: "must be true or false" });

    rows.push({
      line,
      sku,
      name,
      category,
      subcategory: cell(raw, idx.subcategory).trim() || null,
      uom,
      defaultCostCents: cost === "invalid" ? null : cost,
      defaultShipWeightG: weight === "invalid" ? null : weight,
      dimensionsNote: cell(raw, idx.dimensions).trim() || null,
      notes: cell(raw, idx.notes).trim() || null,
      isSample: isSample === null ? false : isSample,
      active: active === null ? true : active,
      action: "insert", // refined by checkExisting()
    });
  }

  return { rows, errors, duplicates, fatal: null };
}

/**
 * Mark which parsed rows would UPDATE an existing SKU rather than insert a new one, so the
 * preview can say so before the admin commits. Reads only the `sku` column.
 */
export async function checkExisting(rows: ParsedRow[]): Promise<{ rows: ParsedRow[]; duplicates: DuplicateWarning[] }> {
  if (rows.length === 0) return { rows, duplicates: [] };
  const { data, error } = await supabase.from("inventory_skus").select("sku");
  if (error) {
    console.error("[inventory-import] checkExisting failed:", error);
    return { rows, duplicates: [] };
  }
  const existing = new Set((data ?? []).map((r) => String(r.sku).toLowerCase()));
  const duplicates: DuplicateWarning[] = [];
  const marked = rows.map((r) => {
    const hit = existing.has(r.sku.toLowerCase());
    if (hit) duplicates.push({ line: r.line, sku: r.sku, kind: "in-catalog" });
    return { ...r, action: hit ? ("update" as const) : ("insert" as const) };
  });
  return { rows: marked, duplicates };
}

// -------------------------------- committing --------------------------------

export type CommitResult = { inserted: number; updated: number };

/**
 * Write the batch. One upsert on the `sku` unique constraint rather than N calls to
 * saveSku(): the row shape is identical to what skuToRow() produces in lib/inventory.ts, and
 * a 300-row catalog load should be one round trip, not 300.
 *
 * Chunked because PostgREST has a practical payload ceiling and a partial failure is easier
 * to reason about in 200-row bites. Deliberately does NOT touch inventory_stock or
 * inventory_movements — a catalog row is not a receipt.
 */
export async function commitCatalogRows(rows: ParsedRow[]): Promise<CommitResult> {
  const inserted = rows.filter((r) => r.action === "insert").length;
  const updated = rows.filter((r) => r.action === "update").length;
  const CHUNK = 200;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const payload = rows.slice(i, i + CHUNK).map((r) => ({
      sku: r.sku,
      name: r.name,
      category: r.category,
      subcategory: r.subcategory,
      uom: r.uom,
      default_cost_cents: r.defaultCostCents,
      default_ship_weight_g: r.defaultShipWeightG,
      dimensions_note: r.dimensionsNote,
      is_sample: r.isSample,
      active: r.active,
      notes: r.notes,
    }));
    const { error } = await supabase.from("inventory_skus").upsert(payload, { onConflict: "sku" });
    if (error) {
      console.error("[inventory-import] commit failed:", error);
      throw new Error(`inventory-import: commit failed — ${error.message}`);
    }
  }
  return { inserted, updated };
}

/** Errors as a CSV the admin can open next to the source file and fix line by line. */
export function errorsToCsv(errors: RowError[]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    ["line", "sku", "column", "problem"].join(","),
    ...errors.map((e) => [esc(e.line), esc(e.sku), esc(e.column), esc(e.message)].join(",")),
  ].join("\n");
}
