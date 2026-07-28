"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import { getProfile, listOrders, type Profile, type Order } from "@/lib/store";
import { OrderStatusChip } from "@/components/projects/ui";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const snapTotal = (o: Order) => (o.snapshot as { retailTotal?: number } | null)?.retailTotal ?? 0;
const orderProject = (o: Order) => (o.snapshot as { project?: { name?: string | null } | null } | null)?.project?.name ?? "";
const placedMs = (o: Order) => (o.placedAt ? Date.parse(o.placedAt) : 0);

export default function CrmDetailPage() {
  return (
    <AdminGuard>
      <ContractorDetail />
    </AdminGuard>
  );
}

function ContractorDetail() {
  const { t } = useLanguage();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [profile, setProfile] = useState<Profile | null | undefined>(undefined); // undefined = loading
  const [orders, setOrders] = useState<Order[]>([]);

  const load = useCallback(() => {
    // As an admin, listOrders filtered by ownerId returns that contractor's orders (RLS
    // admin-read-all lets the owner_id filter narrow to anyone).
    Promise.all([getProfile(id), listOrders({ ownerId: id })]).then(([p, os]) => { setProfile(p); setOrders(os); });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const metrics = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).getTime();
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
    const revenue = orders.reduce((a, o) => a + snapTotal(o), 0);
    const last = orders.reduce((mx, o) => Math.max(mx, placedMs(o)), 0);
    return {
      count: orders.length,
      revenue,
      avg: orders.length ? revenue / orders.length : 0,
      month: orders.filter((o) => placedMs(o) >= monthStart).length,
      quarter: orders.filter((o) => placedMs(o) >= quarterStart).length,
      year: orders.filter((o) => placedMs(o) >= yearStart).length,
      daysSince: last ? Math.floor((Date.now() - last) / 86_400_000) : null,
    };
  }, [orders]);

  // Orders-per-month for the last 12 months (inline SVG bar chart — no charting library).
  const trend = useMemo(() => {
    const now = new Date();
    const buckets: { key: string; label: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString(undefined, { month: "short" }), count: 0 });
    }
    for (const o of orders) {
      if (!o.placedAt) continue;
      const p = new Date(o.placedAt);
      const b = buckets.find((x) => x.key === `${p.getFullYear()}-${p.getMonth()}`);
      if (b) b.count++;
    }
    return { buckets, max: Math.max(1, ...buckets.map((b) => b.count)) };
  }, [orders]);

  const historySorted = useMemo(() => [...orders].sort((a, b) => placedMs(b) - placedMs(a)), [orders]);

  const backLink = (
    <Link href="/portal/admin/crm" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
      <ArrowLeft className="h-4 w-4" /> {t("crm.back")}
    </Link>
  );

  if (profile === undefined) {
    return <div className="mx-auto max-w-3xl"><div className="rounded-2xl border border-line bg-paper/60 p-8 text-center text-sm text-muted">{t("crm.loading")}</div></div>;
  }
  if (profile === null) {
    return <div className="mx-auto max-w-3xl space-y-4">{backLink}<div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center text-sm text-muted">{t("crm.notFound")}</div></div>;
  }

  const roleLabel = profile.role === "admin" ? t("crm.roleAdmin") : t("crm.roleContractor");
  const statusLabel = t(profile.status === "active" ? "crm.statusActive" : profile.status === "invited" ? "crm.statusInvited" : "crm.statusDisabled");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {backLink}

      {/* Profile */}
      <div className="rounded-2xl border border-line bg-card p-5">
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">{profile.company || profile.name}</h1>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Detail label={t("crm.lblName")}>{profile.name}</Detail>
          <Detail label={t("crm.lblEmail")}>{profile.email}</Detail>
          <Detail label={t("crm.lblCompany")}>{profile.company || "—"}</Detail>
          <Detail label={t("crm.lblRole")}>{roleLabel}</Detail>
          <Detail label={t("crm.lblStatus")}>{statusLabel}</Detail>
          <Detail label={t("crm.memberSince")}>{fmtDate(profile.createdAt)}</Detail>
        </div>
      </div>

      {/* Performance metrics */}
      <Section title={t("crm.sectionMetrics")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t("crm.statOrders")} value={String(metrics.count)} />
          <StatCard label={t("crm.statRevenue")} value={money(metrics.revenue)} />
          <StatCard label={t("crm.mAvgOrder")} value={money(metrics.avg)} />
          <StatCard label={t("crm.mDaysSince")} value={metrics.daysSince == null ? "—" : String(metrics.daysSince)} />
          <StatCard label={t("crm.mThisMonth")} value={String(metrics.month)} />
          <StatCard label={t("crm.mThisQuarter")} value={String(metrics.quarter)} />
          <StatCard label={t("crm.mThisYear")} value={String(metrics.year)} />
        </div>
      </Section>

      {/* Purchasing trend — inline SVG */}
      <Section title={t("crm.sectionTrend")} subtitle={t("crm.trendSubtitle")}>
        <svg viewBox="0 0 360 140" className="w-full" role="img" aria-label={t("crm.trendSubtitle")}>
          {trend.buckets.map((b, i) => {
            const bw = 360 / 12, x = i * bw + 5, maxH = 96;
            const h = Math.max((b.count / trend.max) * maxH, b.count > 0 ? 3 : 1);
            const y = 112 - h;
            return (
              <g key={b.key}>
                <rect x={x} y={y} width={bw - 10} height={h} rx={2} className={b.count > 0 ? "fill-accent" : "fill-line"} />
                {b.count > 0 && <text x={x + (bw - 10) / 2} y={y - 3} textAnchor="middle" className="fill-muted" fontSize={8} fontFamily="monospace">{b.count}</text>}
                <text x={x + (bw - 10) / 2} y={126} textAnchor="middle" className="fill-muted" fontSize={7.5} fontFamily="monospace">{b.label}</text>
              </g>
            );
          })}
        </svg>
      </Section>

      {/* Order history */}
      <Section title={t("crm.sectionOrders")}>
        {historySorted.length === 0 ? (
          <p className="text-sm text-muted">{t("crm.ordersEmpty")}</p>
        ) : (
          <div className="space-y-2.5">
            {historySorted.map((o) => {
              const project = orderProject(o);
              return (
                <Link key={o.id} href={`/portal/orders/${o.id}`}
                  className="block rounded-xl border border-line/70 bg-paper/70 p-4 transition hover:border-accent">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-bold text-ink">{o.orderNumber}</div>
                      <div className="mt-0.5 truncate text-xs text-muted">{o.customer.name || "—"}{project ? ` · ${project}` : ""}</div>
                    </div>
                    <OrderStatusChip status={o.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                    <span>{fmtDate(o.placedAt)}</span>
                    <span className="ml-auto text-sm font-semibold text-ink">{money(snapTotal(o))}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{title}</div>
        {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="break-words text-sm text-ink">{children}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper/60 p-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className="mt-1 font-display text-lg font-bold tracking-tight text-ink">{value}</div>
    </div>
  );
}
