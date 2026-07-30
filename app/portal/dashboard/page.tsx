"use client";

// Role-split dashboard. A contractor sees their own projects / orders / quotes; an admin
// sees the network roll-up, the order pipeline, and the two leads pipelines. Every card
// fetches independently and carries its own loading / error state, so one failing query
// never blanks the page.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Building2, FileSearch, FolderKanban, Megaphone,
  Package, Star, Users, Wand2, Network,
} from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { supabase, supabaseLeads } from "@/lib/supabase";
import {
  listAllOrders, listAllProfiles, listContractorCustomers, listOrders, listProjects, listQuotes,
  type ContractorCustomer, type Order, type OrderStatus, type Profile, type Project, type Quote,
} from "@/lib/store";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
// The snapshot is the source of truth for an order's retail value (same rule as the orders hub).
const snapTotal = (o: Order) => (o.snapshot as { retailTotal?: number } | null)?.retailTotal ?? 0;
// listContractorCustomers comes back updated_at DESC; "most recently added" is a
// created_at question, so pick the newest by that instead. Callers guard against empty.
const newest = (list: ContractorCustomer[]) =>
  list.reduce((a, b) => (Date.parse(b.createdAt) > Date.parse(a.createdAt) ? b : a));

// Active = placed but not yet delivered / completed / cancelled.
const ACTIVE_STATUSES: OrderStatus[] = ["submitted", "confirmed", "in_production", "ready_to_ship", "in_transit"];
const ACTIVE = new Set<OrderStatus>(ACTIVE_STATUSES);
// Pipeline rows reuse the order-status labels already defined for the project/order chips.
const STATUS_KEY: Record<OrderStatus, string> = {
  submitted: "projects.oStatusSubmitted",
  confirmed: "projects.oStatusConfirmed",
  in_production: "projects.oStatusInProduction",
  ready_to_ship: "projects.oStatusReadyToShip",
  in_transit: "projects.oStatusInTransit",
  delivered: "projects.oStatusDelivered",
  completed: "projects.oStatusCompleted",
  cancelled: "projects.oStatusCancelled",
};

// ------------------------------- load state -------------------------------
type Load<T> = { s: "loading" } | { s: "err" } | { s: "ok"; v: T };
const LOADING = { s: "loading" } as const;
const ERR = { s: "err" } as const;
const ok = <T,>(v: T): Load<T> => ({ s: "ok", v });

// Collapse two loads into one: error wins, then loading, then the combined value.
function both<A, B, R>(a: Load<A>, b: Load<B>, combine: (a: A, b: B) => R): Load<R> {
  if (a.s === "err" || b.s === "err") return ERR;
  if (a.s === "loading" || b.s === "loading") return LOADING;
  return ok(combine(a.v, b.v));
}

// --------------------------------- page -----------------------------------
export default function DashboardPage() {
  const { t } = useLanguage();
  const { userId, isAdmin } = useAuth();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("dashboard.title")}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {isAdmin ? <AdminCards /> : <ContractorCards ownerId={userId} />}
      </div>
    </div>
  );
}

// ----------------------------- contractor view -----------------------------
function ContractorCards({ ownerId }: { ownerId: string | null }) {
  const { t } = useLanguage();
  const [projects, setProjects] = useState<Load<Project[]>>(LOADING);
  const [orders, setOrders] = useState<Load<Order[]>>(LOADING);
  const [quotes, setQuotes] = useState<Load<Quote[]>>(LOADING);
  const [customers, setCustomers] = useState<Load<ContractorCustomer[]>>(LOADING);

  useEffect(() => {
    if (!ownerId) return;
    listProjects(ownerId).then((v) => setProjects(ok(v))).catch(() => setProjects(ERR));
    listOrders({ ownerId }).then((v) => setOrders(ok(v))).catch(() => setOrders(ERR));
    listQuotes({ ownerId }).then((v) => setQuotes(ok(v))).catch(() => setQuotes(ERR));
    listContractorCustomers(ownerId).then((v) => setCustomers(ok(v))).catch(() => setCustomers(ERR));
  }, [ownerId]);

  return (
    <>
      {/* Projects */}
      <Card icon={FolderKanban} title={t("dashboard.cProjectsTitle")} href="/portal/projects" linkLabel={t("dashboard.cProjectsLink")}>
        <Body load={projects}>
          {(list) => (
            <>
              <Stat value={String(list.length)} label={t("dashboard.cProjectsCount")} />
              {list.length === 0 ? (
                <Note>{t("dashboard.cProjectsEmpty")}</Note>
              ) : (
                <Detail label={t("dashboard.cProjectsRecent")} value={list[0].name} meta={fmtDate(list[0].updatedAt)} />
              )}
            </>
          )}
        </Body>
      </Card>

      {/* Orders */}
      <Card icon={Package} title={t("dashboard.cOrdersTitle")} href="/portal/orders" linkLabel={t("dashboard.cOrdersLink")}>
        <Body load={orders}>
          {(list) => {
            const active = list.filter((o) => ACTIVE.has(o.status));
            const value = active.reduce((a, o) => a + snapTotal(o), 0);
            return (
              <>
                <Stat value={String(active.length)} label={t("dashboard.cOrdersActive")} />
                {active.length === 0 ? (
                  <Note>{t("dashboard.cOrdersEmpty")}</Note>
                ) : (
                  <Detail label={t("dashboard.cOrdersValue")} value={money(value)} />
                )}
              </>
            );
          }}
        </Body>
      </Card>

      {/* Quotes */}
      <Card icon={Wand2} title={t("dashboard.cQuotesTitle")} href="/portal/configurator" linkLabel={t("dashboard.cQuotesLink")}>
        <Body load={quotes}>
          {(list) => {
            const drafts = list.filter((q) => q.status === "draft");
            return (
              <>
                <Stat value={String(drafts.length)} label={t("dashboard.cQuotesDrafts")} />
                {drafts.length === 0 ? (
                  <Note>{t("dashboard.cQuotesEmpty")}</Note>
                ) : (
                  <Detail label={t("dashboard.cQuotesRecent")} value={drafts[0].name} meta={money(drafts[0].total)} />
                )}
              </>
            );
          }}
        </Body>
      </Card>

      {/* Customers */}
      <Card icon={Users} title={t("dashboard.cCustomersTitle")} href="/portal/my-customers" linkLabel={t("dashboard.cCustomersLink")}>
        <Body load={customers}>
          {(list) => (
            <>
              <Stat value={String(list.length)} label={t("dashboard.cCustomersCount")} />
              {list.length === 0 ? (
                <Note>{t("dashboard.cCustomersEmpty")}</Note>
              ) : (
                <Detail label={t("dashboard.cCustomersRecent")} value={newest(list).name} meta={fmtDate(newest(list).createdAt)} />
              )}
            </>
          )}
        </Body>
      </Card>

      <UpdatesCard span />
    </>
  );
}

// ------------------------------- admin view --------------------------------
type LeadStats = { newPermits: number; highUnworked: number };
type InsideStats = { leads: number; latestPromotion: string | null };

function AdminCards() {
  const { t } = useLanguage();
  const [profiles, setProfiles] = useState<Load<Profile[]>>(LOADING);
  const [orders, setOrders] = useState<Load<Order[]>>(LOADING);
  const [leads, setLeads] = useState<Load<LeadStats>>(LOADING);
  const [inside, setInside] = useState<Load<InsideStats>>(LOADING);

  useEffect(() => {
    listAllProfiles().then((v) => setProfiles(ok(v))).catch(() => setProfiles(ERR));
    listAllOrders().then((v) => setOrders(ok(v))).catch(() => setOrders(ERR));
    fetchLeadStats().then((v) => setLeads(ok(v))).catch(() => setLeads(ERR));
    fetchInsideStats().then((v) => setInside(ok(v))).catch(() => setInside(ERR));
  }, []);

  // The network roll-up needs both feeds; the pipeline card only needs orders.
  const network = both(profiles, orders, (ps, os) => ({
    contractors: ps.filter((p) => p.role === "contractor").length,
    orders: os.length,
    revenue: os.reduce((a, o) => a + snapTotal(o), 0),
  }));

  return (
    <>
      {/* Network overview */}
      <Card icon={Network} title={t("dashboard.aNetworkTitle")} href="/portal/admin/crm" linkLabel={t("dashboard.aNetworkLink")}>
        <Body load={network}>
          {(n) => (
            <>
              <Stat value={String(n.contractors)} label={t("dashboard.aNetworkContractors")} />
              <div className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
                <Detail label={t("dashboard.aNetworkOrders")} value={String(n.orders)} />
                <Detail label={t("dashboard.aNetworkRevenue")} value={money(n.revenue)} />
              </div>
            </>
          )}
        </Body>
      </Card>

      {/* Order pipeline */}
      <Card icon={Package} title={t("dashboard.aPipelineTitle")} href="/portal/orders" linkLabel={t("dashboard.aPipelineLink")}>
        <Body load={orders}>
          {(list) => {
            const rows = ACTIVE_STATUSES.map((status) => {
              const os = list.filter((o) => o.status === status);
              return { status, count: os.length, value: os.reduce((a, o) => a + snapTotal(o), 0) };
            });
            if (rows.every((r) => r.count === 0)) return <Note>{t("dashboard.aPipelineEmpty")}</Note>;
            return (
              <div className="space-y-1.5">
                {rows.map((r) => (
                  <div key={r.status} className="flex items-baseline gap-3 text-xs">
                    <span className="min-w-0 flex-1 truncate text-muted">{t(STATUS_KEY[r.status])}</span>
                    <span className="font-display text-sm font-semibold text-accent">{r.count}</span>
                    <span className="w-20 text-right font-medium text-ink">{r.count ? money(r.value) : t("dashboard.none")}</span>
                  </div>
                ))}
              </div>
            );
          }}
        </Body>
      </Card>

      {/* Permit leads */}
      <Card icon={FileSearch} title={t("dashboard.aLeadsTitle")} href="/portal/admin/leads" linkLabel={t("dashboard.aLeadsLink")}>
        <Body load={leads}>
          {(s) => (
            <>
              <Stat value={String(s.newPermits)} label={t("dashboard.aLeadsNew")} />
              <div className="mt-3 border-t border-line/60 pt-3">
                <Detail label={t("dashboard.aLeadsHigh")} value={String(s.highUnworked)} />
              </div>
            </>
          )}
        </Body>
      </Card>

      {/* Inside leads */}
      <Card icon={Building2} title={t("dashboard.aInsideTitle")} href="/portal/admin/inside-leads" linkLabel={t("dashboard.aInsideLink")}>
        <Body load={inside}>
          {(s) => (
            <>
              <Stat value={String(s.leads)} label={t("dashboard.aInsideActive")} />
              <div className="mt-3 border-t border-line/60 pt-3">
                <Detail label={t("dashboard.aInsideLatest")} value={fmtDate(s.latestPromotion)} />
              </div>
            </>
          )}
        </Body>
      </Card>

      {/* Featured installs — will pull from approved completion photos */}
      <Card icon={Star} title={t("dashboard.aFeaturedTitle")} soon>
        <p className="text-sm font-medium text-ink/70">{t("dashboard.aFeaturedSoon")}</p>
        <Note>{t("dashboard.aFeaturedDesc")}</Note>
      </Card>

      <UpdatesCard />
    </>
  );
}

// ------------------------------ leads queries ------------------------------
// leads.permits is owned by the ingest pipeline and isn't described by this repo's
// migrations, so the "added recently" column is discovered at runtime: created_at first,
// then week_pulled. Whichever query PostgREST accepts wins; if neither does, the card
// shows "Unable to load" rather than a wrong number.
async function countNewPermits(since: Date): Promise<number> {
  const attempts: [string, string][] = [
    ["created_at", since.toISOString()],
    ["week_pulled", since.toISOString().slice(0, 10)],
  ];
  for (const [col, value] of attempts) {
    const { count, error } = await supabaseLeads
      .from("permits")
      .select("id", { count: "exact", head: true })
      .gte(col, value);
    if (!error) return count ?? 0;
  }
  throw new Error("dashboard: no usable recency column on leads.permits");
}

// Unworked = follow_up still New (or never set) — same rule the leads page filters by.
async function countHighUnworked(): Promise<number> {
  const { count, error } = await supabaseLeads
    .from("permits")
    .select("id", { count: "exact", head: true })
    .eq("lead_relevance", "High")
    .or("follow_up.is.null,follow_up.eq.New");
  if (error) throw error;
  return count ?? 0;
}

async function fetchLeadStats(): Promise<LeadStats> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [newPermits, highUnworked] = await Promise.all([countNewPermits(since), countHighUnworked()]);
  return { newPermits, highUnworked };
}

async function fetchInsideStats(): Promise<InsideStats> {
  const { count, error } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .eq("lifecycle", "lead");
  if (error) throw error;
  // Promotion time lives on the permit that created or linked the company (set by
  // promote_permit_to_crm / auto_link_permits_to_companies).
  const { data } = await supabaseLeads
    .from("permits")
    .select("promoted_at")
    .not("promoted_at", "is", null)
    .order("promoted_at", { ascending: false })
    .limit(1);
  const latest = (data?.[0] as { promoted_at?: string | null } | undefined)?.promoted_at ?? null;
  return { leads: count ?? 0, latestPromotion: latest };
}

// --------------------------------- pieces ----------------------------------
function Card({
  icon: Icon, title, href, linkLabel, soon = false, span = false, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  href?: string;
  linkLabel?: string;
  soon?: boolean;
  span?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div
      className={`flex flex-col rounded-2xl p-5 ${
        soon ? "border border-dashed border-line/70 bg-card/60" : "border border-line bg-card"
      } ${span ? "md:col-span-2" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        <span className={`rounded-lg p-2 ${soon ? "bg-ink/5 text-muted" : "bg-accent-soft/70 text-accent"}`}>
          <Icon className="h-4.5 w-4.5" />
        </span>
        <h3 className={`font-display text-base font-semibold ${soon ? "text-ink/60" : ""}`}>{title}</h3>
        {soon && (
          <span className="ml-auto rounded-full bg-ink/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted">
            {t("dashboard.soon")}
          </span>
        )}
      </div>

      <div className="mt-4 flex-1">{children}</div>

      {href && linkLabel && (
        <Link
          href={href}
          className="mt-4 inline-flex items-center gap-1 self-start text-xs font-semibold text-accent transition hover:gap-1.5"
        >
          {linkLabel} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

// Renders the card body for whichever state the fetch is in.
function Body<T>({ load, children }: { load: Load<T>; children: (v: T) => React.ReactNode }) {
  const { t } = useLanguage();
  if (load.s === "loading") {
    return (
      <div className="animate-pulse space-y-2.5" aria-label={t("dashboard.loading")}>
        <div className="h-8 w-20 rounded-md bg-line" />
        <div className="h-3 w-32 rounded bg-line/70" />
      </div>
    );
  }
  if (load.s === "err") return <p className="text-sm text-muted">{t("dashboard.error")}</p>;
  return <>{children(load.v)}</>;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-display text-3xl font-semibold leading-none text-accent">{value}</div>
      <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
    </div>
  );
}

function Detail({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-ink">
        {value}
        {meta && <span className="ml-1.5 font-normal text-muted">{meta}</span>}
      </span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs text-muted">{children}</p>;
}

// Merged "From Kitify" + "Product updates" — a single feed, CMS-driven later.
function UpdatesCard({ span = false }: { span?: boolean }) {
  const { t } = useLanguage();
  return (
    <Card icon={Megaphone} title={t("dashboard.updatesTitle")} span={span}>
      <p className="text-sm text-ink/70">{t("dashboard.updatesWelcome")}</p>
    </Card>
  );
}
