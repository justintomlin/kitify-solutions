"use client";

// Shared loading + presentation for one contractor's inventory, used by BOTH the contractor's
// own /portal/inventory and the admin's /portal/admin/inventory/partner/[ownerId]. Same data,
// same rules, one implementation — an admin looking at a contractor's stock sees exactly what
// the contractor sees, which is the point of the partner view.
//
// The Kitify catalog is loaded here for LABELS ONLY (sku / name / dimensions). No Kitify
// quantity is fetched, displayed, or available to display — see lib/partner-inventory.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import {
  listPartnerSkus,
  listPartnerStock,
  listPartnerMovements,
  listKitifyCatalog,
  isPartnerLowStock,
  rowRef,
  type PartnerSku,
  type PartnerStockRow,
  type PartnerMovement,
  type KitifyCatalogSku,
  type SkuRef,
  type SkuSource,
  type InventoryCategory,
} from "@/lib/partner-inventory";
import { SourceBadge } from "./PartnerSkuPicker";
import { Badge, EmptyCard, fmtDate, SELECT } from "./ui";

const THIRTY_DAYS_MS = 30 * 86_400_000;

export type ItemLabel = { sku: string; name: string; category: InventoryCategory | null; dimensions: string | null };

export type PartnerInventoryData = {
  skus: PartnerSku[];
  catalog: KitifyCatalogSku[];
  stock: PartnerStockRow[];
  recent: PartnerMovement[]; // last 30 days
  /** Resolve a ref to its display label, whichever catalog it came from. */
  labelFor: (ref: SkuRef) => ItemLabel;
  loading: boolean;
  error: string;
  reload: () => void;
};

/**
 * Load everything one contractor's inventory screens need, in one place.
 *
 * `ownerId` is explicit rather than read from the session because the admin partner view
 * calls this for someone else. RLS decides whether that is allowed.
 */
export function usePartnerInventory(ownerId: string | null): PartnerInventoryData {
  const { t } = useLanguage();
  const [skus, setSkus] = useState<PartnerSku[]>([]);
  const [catalog, setCatalog] = useState<KitifyCatalogSku[]>([]);
  const [stock, setStock] = useState<PartnerStockRow[]>([]);
  const [recent, setRecent] = useState<PartnerMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((v) => v + 1), []);

  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    setLoading(true);
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    Promise.all([
      listPartnerSkus(ownerId),
      listKitifyCatalog(),
      listPartnerStock(ownerId),
      listPartnerMovements({ ownerId, since }),
    ])
      .then(([sk, cat, st, mv]) => {
        if (!active) return;
        setSkus(sk);
        setCatalog(cat);
        setStock(st);
        setRecent(mv);
        setError("");
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : t("partnerInv.errLoad"));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ownerId, tick, t]);

  const labelFor = useMemo(() => {
    const mine = new Map(skus.map((s) => [s.id, s]));
    const theirs = new Map(catalog.map((s) => [s.id, s]));
    return (ref: SkuRef): ItemLabel => {
      if (ref.source === "partner") {
        const s = mine.get(ref.id);
        return s
          ? { sku: s.sku, name: s.name, category: s.category, dimensions: s.dimensionsNote }
          : { sku: "—", name: t("partnerInv.unknownItem"), category: null, dimensions: null };
      }
      const s = theirs.get(ref.id);
      // A Kitify SKU retired after the contractor logged stock of it drops out of the
      // catalog read. Label it rather than showing a bare uuid.
      return s
        ? { sku: s.sku, name: s.name, category: s.category, dimensions: s.dimensionsNote }
        : { sku: "—", name: t("partnerInv.retiredKitifyItem"), category: null, dimensions: null };
    };
  }, [skus, catalog, t]);

  return { skus, catalog, stock, recent, labelFor, loading, error, reload };
}

// ------------------------------- stock table -------------------------------

export type StockTableRow = {
  stock: PartnerStockRow;
  ref: SkuRef;
  label: ItemLabel;
  low: boolean;
};

type SortKey = "sku" | "location" | "quantity" | "updatedAt";
type SourceFilter = "all" | SkuSource;
type StockFilter = "all" | "low" | "inStock" | "outOfStock";

export function PartnerStockTable({
  stock,
  labelFor,
  onRowClick,
  emptyMessage,
}: {
  stock: PartnerStockRow[];
  labelFor: (ref: SkuRef) => ItemLabel;
  onRowClick?: (ref: SkuRef) => void;
  emptyMessage: string;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [location, setLocation] = useState("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "sku", dir: "asc" });

  const locations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of stock) {
      const k = s.location.trim().toLowerCase();
      if (!seen.has(k)) seen.set(k, s.location.trim());
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [stock]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const built: StockTableRow[] = stock.map((s) => {
      const ref = rowRef(s);
      return { stock: s, ref, label: labelFor(ref), low: isPartnerLowStock(s) };
    });

    const filtered = built
      .filter((r) => source === "all" || r.ref.source === source)
      .filter((r) => location === "all" || r.stock.location.trim().toLowerCase() === location.toLowerCase())
      .filter((r) => !q || r.label.sku.toLowerCase().includes(q) || r.label.name.toLowerCase().includes(q))
      .filter((r) =>
        stockFilter === "all"
          ? true
          : stockFilter === "low"
            ? r.low
            : stockFilter === "inStock"
              ? r.stock.quantity > 0
              : r.stock.quantity === 0,
      );

    const dir = sort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      switch (sort.key) {
        case "quantity":
          return (a.stock.quantity - b.stock.quantity) * dir;
        case "location":
          return (a.stock.location.localeCompare(b.stock.location) || a.label.sku.localeCompare(b.label.sku)) * dir;
        case "updatedAt":
          return (Date.parse(a.stock.updatedAt) - Date.parse(b.stock.updatedAt)) * dir;
        default:
          return a.label.sku.localeCompare(b.label.sku) * dir;
      }
    });
  }, [stock, labelFor, query, source, location, stockFilter, sort]);

  function toggleSort(key: SortKey) {
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("partnerInv.searchPlaceholder")}
        className="w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} className={SELECT + " mt-0 w-auto"}>
          <option value="all">{t("partnerInv.allSources")}</option>
          <option value="partner">{t("partnerInv.sourceMine")}</option>
          <option value="kitify">{t("partnerInv.sourceKitify")}</option>
        </select>
        <select value={location} onChange={(e) => setLocation(e.target.value)} className={SELECT + " mt-0 w-auto"}>
          <option value="all">{t("partnerInv.allLocations")}</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value as StockFilter)} className={SELECT + " mt-0 w-auto"}>
          <option value="all">{t("partnerInv.filterAllStock")}</option>
          <option value="low">{t("partnerInv.filterLow")}</option>
          <option value="inStock">{t("partnerInv.filterInStock")}</option>
          <option value="outOfStock">{t("partnerInv.filterOutOfStock")}</option>
        </select>
      </div>

      {stock.length === 0 ? (
        <EmptyCard>{emptyMessage}</EmptyCard>
      ) : rows.length === 0 ? (
        <EmptyCard>{t("partnerInv.noResults")}</EmptyCard>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <Th label={t("partnerInv.colSku")} onClick={() => toggleSort("sku")} />
                <Th label={t("partnerInv.colName")} />
                <Th label={t("partnerInv.colLocation")} onClick={() => toggleSort("location")} />
                <Th label={t("partnerInv.colQuantity")} onClick={() => toggleSort("quantity")} align="right" />
                <Th label={t("partnerInv.colUpdated")} onClick={() => toggleSort("updatedAt")} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.stock.id}
                  onClick={onRowClick ? () => onRowClick(r.ref) : undefined}
                  className={`border-b border-line/60 transition last:border-0 ${
                    onRowClick ? "cursor-pointer hover:bg-paper/70" : ""
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <SourceBadge source={r.ref.source} />
                      <span className="font-mono text-[12px] text-ink">{r.label.sku}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink">{r.label.name}</td>
                  <td className="px-3 py-2.5 text-muted">{r.stock.location}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="font-display font-bold text-ink">{r.stock.quantity}</span>
                    {r.low && (
                      <span className="ml-2 align-middle">
                        <Badge tone="amber">{t("partnerInv.low")}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted">{fmtDate(r.stock.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ label, onClick, align = "left" }: { label: string; onClick?: () => void; align?: "left" | "right" }) {
  const base = `px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted ${
    align === "right" ? "text-right" : "text-left"
  }`;
  if (!onClick) return <th className={base}>{label}</th>;
  return (
    <th className={base}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition hover:text-accent ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );
}
