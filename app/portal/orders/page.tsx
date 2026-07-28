"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { listOrders, type Order, type OrderStatus } from "@/lib/store";
import { OrderStatusChip } from "@/components/projects/ui";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

// The snapshot is the source of truth for the retail total + project name — we never read
// back to the live quote/project.
type OrderSnapshot = { retailTotal?: number; project?: { name?: string | null } | null } | null;
const orderTotal = (o: Order) => (o.snapshot as OrderSnapshot)?.retailTotal ?? 0;
const orderProject = (o: Order) => (o.snapshot as OrderSnapshot)?.project?.name ?? "";

type Tab = "all" | "active" | "in_transit" | "delivered" | "completed";
type DeliveredWindow = 30 | 60 | 90;

const ACTIVE_STATUSES = new Set<OrderStatus>(["submitted", "confirmed", "in_production", "ready_to_ship"]);
const TABS: { key: Tab; labelKey: string; emptyKey: string }[] = [
  { key: "all", labelKey: "orders.tabAll", emptyKey: "orders.emptyAll" },
  { key: "active", labelKey: "orders.tabActive", emptyKey: "orders.emptyActive" },
  { key: "in_transit", labelKey: "orders.tabInTransit", emptyKey: "orders.emptyInTransit" },
  { key: "delivered", labelKey: "orders.tabDelivered", emptyKey: "orders.emptyDelivered" },
  { key: "completed", labelKey: "orders.tabCompleted", emptyKey: "orders.emptyCompleted" },
];

export default function OrdersPage() {
  const { t } = useLanguage();
  const { userId } = useAuth();
  const ownerId = userId ?? "anon";

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [window, setWindow] = useState<DeliveredWindow>(30);

  const load = useCallback(() => { listOrders({ ownerId }).then(setOrders).catch(() => setOrders([])); }, [ownerId]);
  useEffect(() => { load(); }, [load]);

  // How many orders sit in each tab (for the tab counts). Delivered uses the "All" count
  // (window applies only inside the delivered tab's own list).
  const counts = useMemo(() => {
    const all = orders ?? [];
    return {
      all: all.length,
      active: all.filter((o) => ACTIVE_STATUSES.has(o.status)).length,
      in_transit: all.filter((o) => o.status === "in_transit").length,
      delivered: all.filter((o) => o.status === "delivered").length,
      completed: all.filter((o) => o.status === "completed").length,
    } as Record<Tab, number>;
  }, [orders]);

  const shown = useMemo(() => {
    const all = orders ?? [];
    if (tab === "all") return all;
    if (tab === "active") return all.filter((o) => ACTIVE_STATUSES.has(o.status));
    if (tab === "in_transit") return all.filter((o) => o.status === "in_transit");
    if (tab === "completed") return all.filter((o) => o.status === "completed");
    // delivered — within the selected window (by delivered_at, falling back to placed_at)
    const cutoff = Date.now() - window * 24 * 60 * 60 * 1000;
    return all.filter((o) => {
      if (o.status !== "delivered") return false;
      const d = Date.parse(o.deliveredAt ?? o.placedAt ?? o.createdAt);
      return isNaN(d) || d >= cutoff;
    });
  }, [orders, tab, window]);

  const emptyKey = TABS.find((x) => x.key === tab)!.emptyKey;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("orders.title")}</div>
        <p className="mt-1 text-sm text-muted">{t("orders.subtitle")}</p>
      </div>

      {/* Tabs — horizontal, scrollable on phones */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-card p-1">
        {TABS.map((tb) => {
          const active = tab === tb.key;
          return (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"}`}>
              {t(tb.labelKey)}
              <span className={`rounded-full px-1.5 text-[10px] font-semibold ${active ? "bg-white/20" : "bg-ink/5 text-muted"}`}>{counts[tb.key]}</span>
            </button>
          );
        })}
      </div>

      {/* Delivered sub-filters */}
      {tab === "delivered" && (
        <div className="mt-3 flex items-center gap-1.5">
          {([30, 60, 90] as DeliveredWindow[]).map((w) => (
            <button key={w} onClick={() => setWindow(w)}
              className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${window === w ? "border-accent bg-accent-soft/50 text-accent" : "border-line text-muted hover:text-ink"}`}>
              {t(`orders.filter${w}`)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        {orders === null ? (
          <div className="rounded-2xl border border-line bg-paper/60 p-8 text-center text-sm text-muted">{t("orders.loading")}</div>
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center text-sm text-muted">{t(emptyKey)}</div>
        ) : (
          <div className="space-y-2.5">
            {shown.map((o) => {
              const project = orderProject(o);
              return (
                <Link key={o.id} href={`/portal/orders/${o.id}`}
                  className="block rounded-2xl border border-line bg-card p-4 transition hover:border-accent">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-bold text-ink">{o.orderNumber}</div>
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {o.customer.name || "—"}{project ? ` · ${project}` : ""}
                      </div>
                    </div>
                    <OrderStatusChip status={o.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                    <span>{t("orders.placed")}: {fmtDate(o.placedAt)}</span>
                    {o.estimatedDelivery && <span>{t("orders.estDelivery")}: {fmtDate(o.estimatedDelivery)}</span>}
                    <span className="ml-auto text-sm font-semibold text-ink">{money(orderTotal(o))}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
