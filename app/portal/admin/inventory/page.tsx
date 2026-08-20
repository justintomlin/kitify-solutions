"use client";

// Inventory dashboard — Kitify's own stock at a glance, plus the searchable SKU table.
// Admin-only (AdminGuard + admin-only RLS on every inventory table).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Plus, MapPin, ArrowUpDown, Users } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import {
  listSkus,
  listStock,
  listLocations,
  listMovements,
  onHandBySku,
  isLowStock,
  kitBuildable,
  isSampleKit,
  summariseMovements,
  CATEGORIES,
  MOVEMENT_REASONS,
  type InventorySku,
  type StockRow,
  type InventoryLocation,
  type Movement,
  type InventoryCategory,
} from "@/lib/inventory";
import {
  StatCard,
  Badge,
  EmptyCard,
  PageHeading,
  categoryLabel,
  reasonLabel,
  fmtDate,
  INPUT,
  SELECT,
  BTN_PRIMARY,
  BTN_GHOST,
} from "@/components/inventory/ui";

type SortKey = "sku" | "name" | "category" | "onHand" | "updatedAt";
type StockFilter = "all" | "low" | "inStock" | "outOfStock";

const THIRTY_DAYS_MS = 30 * 86_400_000;

export default function InventoryDashboardPage() {
  return (
    <AdminGuard>
      <InventoryDashboard />
    </AdminGuard>
  );
}

function InventoryDashboard() {
  const { t } = useLanguage();
  const router = useRouter();

  const [skus, setSkus] = useState<InventorySku[] | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [recent, setRecent] = useState<Movement[]>([]);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<InventoryCategory | "all">("all");
  const [subcategory, setSubcategory] = useState("all");
  const [locationId, setLocationId] = useState("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "sku", dir: "asc" });

  const load = useCallback(() => {
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    Promise.all([listSkus(), listStock(), listLocations(), listMovements({ since })])
      .then(([sk, st, lo, mv]) => {
        setSkus(sk);
        setStock(st);
        setLocations(lo);
        setRecent(mv);
        setError("");
      })
      .catch((e: unknown) => {
        setSkus([]);
        setError(e instanceof Error ? e.message : t("inventory.errLoad"));
      });
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  // On-hand summed across all locations, and per-location for the location filter.
  const totalOnHand = useMemo(() => onHandBySku(stock), [stock]);
  const onHandForFilter = useMemo(() => {
    if (locationId === "all") return totalOnHand;
    return onHandBySku(stock.filter((s) => s.locationId === locationId));
  }, [stock, locationId, totalOnHand]);

  // A SKU is "low" if ANY of its (sku, location) rows has crossed its threshold.
  const lowSkuIds = useMemo(() => {
    const s = new Set<string>();
    for (const row of stock) if (isLowStock(row)) s.add(row.skuId);
    return s;
  }, [stock]);

  const subcategories = useMemo(() => {
    const set = new Set<string>();
    for (const s of skus ?? []) if (s.subcategory) set.add(s.subcategory);
    return Array.from(set).sort();
  }, [skus]);

  const summary = useMemo(() => {
    const list = skus ?? [];
    const active = list.filter((s) => s.active);
    const distinctInStock = active.filter((s) => (totalOnHand.get(s.id) ?? 0) > 0).length;
    const pieces = stock.reduce((a, r) => a + r.quantity, 0);
    const kits = active.filter(isSampleKit).filter((k) => kitBuildable(k, totalOnHand) > 0).length;
    return {
      skus: active.length,
      distinctInStock,
      pieces,
      low: lowSkuIds.size,
      kits,
    };
  }, [skus, stock, totalOnHand, lowSkuIds]);

  const movementSummary = useMemo(() => summariseMovements(recent), [recent]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (skus ?? [])
      .filter((s) => (showInactive ? true : s.active))
      .filter((s) => category === "all" || s.category === category)
      .filter((s) => subcategory === "all" || (s.subcategory ?? "") === subcategory)
      .filter((s) => !q || s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .map((s) => ({ s, onHand: onHandForFilter.get(s.id) ?? 0, low: lowSkuIds.has(s.id) }))
      // The location filter narrows to SKUs actually held there — a SKU with no row at
      // that location is not "0 at this location", it is simply not stocked there.
      .filter((r) => locationId === "all" || stock.some((x) => x.skuId === r.s.id && x.locationId === locationId))
      .filter((r) =>
        stockFilter === "all"
          ? true
          : stockFilter === "low"
            ? r.low
            : stockFilter === "inStock"
              ? r.onHand > 0
              : r.onHand === 0,
      );

    const dir = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      switch (sort.key) {
        case "onHand":
          return (a.onHand - b.onHand) * dir;
        case "name":
          return a.s.name.localeCompare(b.s.name) * dir;
        case "category":
          return (a.s.category.localeCompare(b.s.category) || a.s.sku.localeCompare(b.s.sku)) * dir;
        case "updatedAt":
          return (Date.parse(a.s.updatedAt) - Date.parse(b.s.updatedAt)) * dir;
        default:
          return a.s.sku.localeCompare(b.s.sku) * dir;
      }
    });
  }, [skus, query, category, subcategory, locationId, stockFilter, showInactive, sort, onHandForFilter, lowSkuIds, stock]);

  function toggleSort(key: SortKey) {
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  const reasonsWithActivity = MOVEMENT_REASONS.filter((r) => movementSummary.byReason[r] > 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        eyebrow={t("inventory.title")}
        sub={t("inventory.subtitle")}
        right={
          <div className="flex shrink-0 flex-wrap gap-2">
            {/* Partner inventory is a separate view of separate tables — contractors' own
                stock never merges into the Kitify list below. */}
            <Link href="/portal/admin/inventory/partners" className={BTN_GHOST}>
              <Users className="h-4 w-4" /> {t("partnerInv.partnersTab")}
            </Link>
            <Link href="/portal/admin/inventory/locations" className={BTN_GHOST}>
              <MapPin className="h-4 w-4" /> {t("inventory.locations")}
            </Link>
            <Link href="/portal/admin/inventory/movement/new" className={BTN_PRIMARY}>
              <Plus className="h-4 w-4" /> {t("inventory.newMovement")}
            </Link>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">{error}</div>
      )}

      {/* At-a-glance */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label={t("inventory.statSkus")} value={String(summary.skus)} />
        <StatCard label={t("inventory.statInStock")} value={String(summary.distinctInStock)} />
        <StatCard label={t("inventory.statPieces")} value={String(summary.pieces)} />
        <StatCard label={t("inventory.statLow")} value={String(summary.low)} />
        <StatCard label={t("inventory.statKits")} value={String(summary.kits)} />
      </div>

      {/* Movements — last 30 days. The historical hook: the raw movement log is the record,
          this is just the recent-activity roll-up. */}
      <div className="mt-4 rounded-2xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("inventory.last30")}</div>
          <div className="flex gap-4 text-sm">
            <span className="text-muted">
              {t("inventory.piecesReceived")}:{" "}
              <span className="font-display font-bold text-ink">+{movementSummary.piecesReceived}</span>
            </span>
            <span className="text-muted">
              {t("inventory.piecesShipped")}:{" "}
              <span className="font-display font-bold text-ink">−{movementSummary.piecesShipped}</span>
            </span>
          </div>
        </div>
        {movementSummary.total === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("inventory.noRecentMovements")}</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {reasonsWithActivity.map((r) => (
              <span key={r} className="text-[13px] text-muted">
                {reasonLabel(t, r)}: <span className="font-semibold text-ink">{movementSummary.byReason[r]}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Search + filters */}
      <div className="mt-5 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("inventory.searchPlaceholder")}
            className="w-full rounded-lg border border-line bg-card py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value as InventoryCategory | "all")} className={SELECT + " mt-0 w-auto"}>
            <option value="all">{t("inventory.allCategories")}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(t, c)}
              </option>
            ))}
          </select>
          <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)} className={SELECT + " mt-0 w-auto"}>
            <option value="all">{t("inventory.allSubcategories")}</option>
            {subcategories.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={SELECT + " mt-0 w-auto"}>
            <option value="all">{t("inventory.allLocations")}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value as StockFilter)} className={SELECT + " mt-0 w-auto"}>
            <option value="all">{t("inventory.filterAllStock")}</option>
            <option value="low">{t("inventory.filterLow")}</option>
            <option value="inStock">{t("inventory.filterInStock")}</option>
            <option value="outOfStock">{t("inventory.filterOutOfStock")}</option>
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-accent" />
            {t("inventory.showInactive")}
          </label>
        </div>
      </div>

      {/* SKU table */}
      <div className="mt-4">
        {skus === null ? (
          <EmptyCard>{t("inventory.loading")}</EmptyCard>
        ) : skus.length === 0 ? (
          <EmptyCard>{t("inventory.emptyCatalog")}</EmptyCard>
        ) : rows.length === 0 ? (
          <EmptyCard>{t("inventory.noResults")}</EmptyCard>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <Th onClick={() => toggleSort("sku")} label={t("inventory.colSku")} />
                  <Th onClick={() => toggleSort("name")} label={t("inventory.colName")} />
                  <Th onClick={() => toggleSort("category")} label={t("inventory.colCategory")} />
                  <Th label={t("inventory.colSubcategory")} />
                  <Th onClick={() => toggleSort("onHand")} label={t("inventory.colOnHand")} align="right" />
                  <Th onClick={() => toggleSort("updatedAt")} label={t("inventory.colUpdated")} align="right" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ s, onHand, low }) => (
                  <tr
                    key={s.id}
                    onClick={() => router.push(`/portal/admin/inventory/${s.id}`)}
                    className="cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-paper/70"
                  >
                    <td className="px-3 py-2.5 font-mono text-[12px] text-ink">{s.sku}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-ink">{s.name}</span>
                      {!s.active && (
                        <span className="ml-2 align-middle">
                          <Badge tone="muted">{t("inventory.inactive")}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted">{categoryLabel(t, s.category)}</td>
                    <td className="px-3 py-2.5 text-muted">{s.subcategory ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="font-display font-bold text-ink">{onHand}</span>
                      {low && (
                        <span className="ml-2 align-middle">
                          <Badge tone="amber">{t("inventory.low")}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-muted">{fmtDate(s.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <Link href="/portal/admin/inventory/new" className={BTN_GHOST}>
          <Plus className="h-4 w-4" /> {t("inventory.newSku")}
        </Link>
      </div>
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
