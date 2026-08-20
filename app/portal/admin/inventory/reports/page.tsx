"use client";

// Inventory reporting. READ-ONLY — this screen writes nothing, anywhere.
//
// Three panels over the Phase 1 tables, fetched once and computed three ways (see
// lib/inventory-reports.ts). No view, no new schema: at this catalog size, three queries and
// client-side aggregation beat the deploy surface of a database view.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ArrowUpDown, PackageX } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import {
  listSkus,
  listStock,
  listAllMovementsSince,
  lastMovementBySku,
  downloadCsv,
  type InventorySku,
  type StockRow,
  type Movement,
} from "@/lib/inventory";
import {
  rollupByCategory,
  velocityBySku,
  staleStock,
  panelToCsv,
  windowStartIso,
  REPORT_WINDOWS,
  STALE_DAYS,
  type ReportWindow,
  type VelocityRow,
  type StaleRow,
} from "@/lib/inventory-reports";
import {
  Badge,
  BackLink,
  PageHeading,
  EmptyCard,
  WarnBanner,
  StatCard,
  categoryLabel,
  fmtDate,
  BTN_GHOST,
} from "@/components/inventory/ui";

export default function InventoryReportsPage() {
  return (
    <AdminGuard>
      <InventoryReports />
    </AdminGuard>
  );
}

type VelocitySort = "net" | "in" | "out" | "sku" | "onHand";

function InventoryReports() {
  const { t } = useLanguage();
  const router = useRouter();

  const [windowDays, setWindowDays] = useState<ReportWindow>(30);
  const [skus, setSkus] = useState<InventorySku[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [lastMoved, setLastMoved] = useState<Map<string, string>>(new Map());
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [velocitySort, setVelocitySort] = useState<{ key: VelocitySort; dir: "asc" | "desc" }>({
    key: "net",
    dir: "desc",
  });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      listSkus(),
      listStock(),
      listAllMovementsSince(windowStartIso(windowDays)),
      lastMovementBySku(),
    ])
      .then(([sk, st, mv, lm]) => {
        setSkus(sk);
        setStock(st);
        setMovements(mv.movements);
        setTruncated(mv.truncated);
        setLastMoved(lm);
        setError("");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t("invReports.errLoad")))
      .finally(() => setLoading(false));
  }, [windowDays, t]);
  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => rollupByCategory(skus, stock), [skus, stock]);
  const velocityAll = useMemo(() => velocityBySku(skus, stock, movements), [skus, stock, movements]);
  const stale = useMemo(() => staleStock(skus, stock, lastMoved), [skus, stock, lastMoved]);

  const velocity = useMemo(() => {
    const dir = velocitySort.dir === "asc" ? 1 : -1;
    return [...velocityAll].sort((a, b) => {
      switch (velocitySort.key) {
        case "in":
          return (a.in - b.in) * dir;
        case "out":
          return (a.out - b.out) * dir;
        case "onHand":
          return (a.onHand - b.onHand) * dir;
        case "sku":
          return a.sku.localeCompare(b.sku) * dir;
        default:
          return (Math.abs(a.net) - Math.abs(b.net)) * dir;
      }
    });
  }, [velocityAll, velocitySort]);

  function toggleVelocitySort(key: VelocitySort) {
    setVelocitySort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  const totals = useMemo(
    () => ({
      onHand: stock.reduce((a, s) => a + s.quantity, 0),
      moved: movements.length,
      stale: stale.length,
      stalePieces: stale.reduce((a, s) => a + s.onHand, 0),
    }),
    [stock, movements, stale],
  );

  if (loading) return <EmptyCard>{t("invReports.loading")}</EmptyCard>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <BackLink href="/portal/admin/inventory" label={t("inventory.backToInventory")} />
      </div>
      <PageHeading
        eyebrow={t("invReports.title")}
        sub={t("invReports.subtitle")}
        right={
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {t("invReports.window")}
            </span>
            <span className="inline-flex overflow-hidden rounded-lg border border-line">
              {REPORT_WINDOWS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setWindowDays(d)}
                  className={`px-3 py-1.5 text-xs font-medium transition ${
                    windowDays === d ? "bg-ink text-white" : "bg-card text-muted hover:text-accent"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </span>
          </div>
        }
      />

      {error && <div className="mb-4"><WarnBanner>{error}</WarnBanner></div>}
      {truncated && (
        <div className="mb-4">
          <WarnBanner>{t("invReports.truncated")}</WarnBanner>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("invReports.statOnHand")} value={String(totals.onHand)} />
        <StatCard label={t("invReports.statMoved")} value={String(totals.moved)} sub={t("invReports.inWindow", { n: String(windowDays) })} />
        <StatCard label={t("invReports.statStale")} value={String(totals.stale)} />
        <StatCard label={t("invReports.statStalePieces")} value={String(totals.stalePieces)} />
      </div>

      {/* ---------------------------------------------------------------- 1 */}
      <Panel
        title={t("invReports.panelCategory")}
        subtitle={t("invReports.panelCategorySub")}
        onExport={() =>
          downloadCsv(
            "inventory-by-category.csv",
            panelToCsv(categories, [
              { header: "category", value: (r) => r.category },
              { header: "skus", value: (r) => r.skus },
              { header: "on_hand", value: (r) => r.onHand },
              { header: "low_stock", value: (r) => r.lowStock },
            ]),
          )
        }
        empty={categories.length === 0 ? t("invReports.emptyCategory") : null}
      >
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              <th className="px-3 py-2">{t("inventory.colCategory")}</th>
              <th className="px-3 py-2 text-right">{t("invReports.colSkus")}</th>
              <th className="px-3 py-2 text-right">{t("inventory.colOnHand")}</th>
              <th className="px-3 py-2 text-right">{t("invReports.colLow")}</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr
                key={c.category}
                onClick={() => router.push(`/portal/admin/inventory?category=${encodeURIComponent(c.category)}`)}
                className="cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-paper/70"
              >
                <td className="px-3 py-2.5 text-ink">{categoryLabel(t, c.category)}</td>
                <td className="px-3 py-2.5 text-right text-muted">{c.skus}</td>
                <td className="px-3 py-2.5 text-right font-display font-bold text-ink">{c.onHand}</td>
                <td className="px-3 py-2.5 text-right">
                  {c.lowStock > 0 ? <Badge tone="amber">{c.lowStock}</Badge> : <span className="text-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* ---------------------------------------------------------------- 2 */}
      <Panel
        title={t("invReports.panelVelocity", { n: String(windowDays) })}
        subtitle={t("invReports.panelVelocitySub")}
        onExport={() =>
          downloadCsv(
            `inventory-velocity-${windowDays}d.csv`,
            panelToCsv<VelocityRow>(velocity, [
              { header: "sku", value: (r) => r.sku },
              { header: "name", value: (r) => r.name },
              { header: "category", value: (r) => r.category },
              { header: "pieces_in", value: (r) => r.in },
              { header: "pieces_out", value: (r) => r.out },
              { header: "net", value: (r) => r.net },
              { header: "movements", value: (r) => r.movements },
              { header: "on_hand", value: (r) => r.onHand },
            ]),
          )
        }
        empty={velocity.length === 0 ? t("invReports.emptyVelocity", { n: String(windowDays) }) : null}
      >
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <Th label={t("inventory.colSku")} onClick={() => toggleVelocitySort("sku")} />
              <Th label={t("inventory.colName")} />
              <Th label={t("invReports.colIn")} onClick={() => toggleVelocitySort("in")} align="right" />
              <Th label={t("invReports.colOut")} onClick={() => toggleVelocitySort("out")} align="right" />
              <Th label={t("invReports.colNet")} onClick={() => toggleVelocitySort("net")} align="right" />
              <Th label={t("inventory.colOnHand")} onClick={() => toggleVelocitySort("onHand")} align="right" />
            </tr>
          </thead>
          <tbody>
            {velocity.map((r) => (
              <tr
                key={r.skuId}
                onClick={() => router.push(`/portal/admin/inventory/${r.skuId}`)}
                className="cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-paper/70"
              >
                <td className="px-3 py-2.5 font-mono text-[12px] text-ink">{r.sku}</td>
                <td className="px-3 py-2.5 text-ink">{r.name}</td>
                <td className="px-3 py-2.5 text-right text-success">{r.in > 0 ? `+${r.in}` : "—"}</td>
                <td className="px-3 py-2.5 text-right text-amber">{r.out > 0 ? `−${r.out}` : "—"}</td>
                <td
                  className={`px-3 py-2.5 text-right font-display font-bold ${
                    r.net > 0 ? "text-success" : r.net < 0 ? "text-amber" : "text-muted"
                  }`}
                >
                  {r.net > 0 ? `+${r.net}` : r.net}
                </td>
                <td className="px-3 py-2.5 text-right text-muted">{r.onHand}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* ---------------------------------------------------------------- 3 */}
      <Panel
        title={t("invReports.panelStale")}
        subtitle={t("invReports.panelStaleSub", { days: String(STALE_DAYS) })}
        onExport={() =>
          downloadCsv(
            "inventory-stale-stock.csv",
            panelToCsv<StaleRow>(stale, [
              { header: "sku", value: (r) => r.sku },
              { header: "name", value: (r) => r.name },
              { header: "category", value: (r) => r.category },
              { header: "on_hand", value: (r) => r.onHand },
              { header: "last_moved_at", value: (r) => r.lastMovedAt },
              { header: "days_since", value: (r) => r.daysSince },
              { header: "active", value: (r) => String(r.active) },
            ]),
          )
        }
        empty={stale.length === 0 ? t("invReports.emptyStale") : null}
      >
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              <th className="px-3 py-2">{t("inventory.colSku")}</th>
              <th className="px-3 py-2">{t("inventory.colName")}</th>
              <th className="px-3 py-2 text-right">{t("inventory.colOnHand")}</th>
              <th className="px-3 py-2 text-right">{t("invReports.colLastMoved")}</th>
              <th className="px-3 py-2 text-right">{t("invReports.colIdle")}</th>
            </tr>
          </thead>
          <tbody>
            {stale.map((r) => (
              <tr
                key={r.skuId}
                onClick={() => router.push(`/portal/admin/inventory/${r.skuId}`)}
                className="cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-paper/70"
              >
                <td className="px-3 py-2.5 font-mono text-[12px] text-ink">{r.sku}</td>
                <td className="px-3 py-2.5">
                  <span className="text-ink">{r.name}</span>
                  {!r.active && (
                    <span className="ml-2 align-middle">
                      <Badge tone="muted">{t("inventory.inactive")}</Badge>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-display font-bold text-ink">{r.onHand}</td>
                <td className="px-3 py-2.5 text-right text-muted">
                  {r.lastMovedAt ? fmtDate(r.lastMovedAt) : t("invReports.neverMoved")}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {r.daysSince === null ? (
                    <Badge tone="amber">{t("invReports.neverMoved")}</Badge>
                  ) : (
                    <span className="text-muted">{t("invReports.nDays", { n: String(r.daysSince) })}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  onExport,
  empty,
  children,
}: {
  title: string;
  subtitle: string;
  onExport: () => void;
  empty: string | null;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <section className="mt-5 rounded-2xl border border-line bg-card p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{title}</div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</p>
        </div>
        <button type="button" onClick={onExport} disabled={!!empty} className={BTN_GHOST}>
          <Download className="h-4 w-4" /> {t("invReports.export")}
        </button>
      </div>
      {empty ? (
        <p className="flex items-center gap-2 py-4 text-sm text-muted">
          <PackageX className="h-4 w-4" /> {empty}
        </p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  );
}

function Th({ label, onClick, align = "left" }: { label: string; onClick?: () => void; align?: "left" | "right" }) {
  const base = `px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted ${
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
