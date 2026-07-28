"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Plus, Copy, Check, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import { supabase } from "@/lib/supabase";
import { listAllProfiles, listAllOrders, type Profile, type Order, type OrderStatus } from "@/lib/store";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const snapTotal = (o: Order) => (o.snapshot as { retailTotal?: number } | null)?.retailTotal ?? 0;

// Active = not-yet-delivered/completed/cancelled (per the CRM spec — includes in_transit).
const ACTIVE = new Set<OrderStatus>(["submitted", "confirmed", "in_production", "ready_to_ship", "in_transit"]);

export default function CrmPage() {
  return (
    <AdminGuard>
      <CrmDashboard />
    </AdminGuard>
  );
}

function CrmDashboard() {
  const { t } = useLanguage();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    Promise.all([listAllProfiles(), listAllOrders()])
      .then(([ps, os]) => { setProfiles(ps); setOrders(os); })
      .catch(() => { setProfiles([]); setOrders([]); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // Group orders by owner once, then derive per-contractor metrics.
  const byOwner = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of orders) { const a = m.get(o.ownerId) ?? []; a.push(o); m.set(o.ownerId, a); }
    return m;
  }, [orders]);

  const contractors = useMemo(() => (profiles ?? []).filter((p) => p.role === "contractor"), [profiles]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contractors
      .map((p) => {
        const os = byOwner.get(p.id) ?? [];
        const revenue = os.reduce((a, o) => a + snapTotal(o), 0);
        const active = os.filter((o) => ACTIVE.has(o.status)).length;
        const last = os.reduce((mx, o) => Math.max(mx, o.placedAt ? Date.parse(o.placedAt) : 0), 0);
        return { p, count: os.length, revenue, active, last };
      })
      .filter((r) => !q || [r.p.company ?? "", r.p.name, r.p.email].some((s) => s.toLowerCase().includes(q)))
      .sort((a, b) => b.revenue - a.revenue); // biggest customers first
  }, [contractors, byOwner, query]);

  const summary = useMemo(() => ({
    contractors: contractors.length,
    orders: orders.length,
    revenue: orders.reduce((a, o) => a + snapTotal(o), 0),
    active: orders.filter((o) => ACTIVE.has(o.status)).length,
  }), [contractors, orders]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("crm.title")}</div>
          <p className="mt-1 text-sm text-muted">{t("crm.subtitle")}</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("crm.addContractor")}
        </button>
      </div>

      {showAdd && <AddContractorModal onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); load(); }} />}

      {/* Summary cards — stack 2-up on phones, 4-up on desktop */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("crm.statContractors")} value={String(summary.contractors)} />
        <StatCard label={t("crm.statOrders")} value={String(summary.orders)} />
        <StatCard label={t("crm.statRevenue")} value={money(summary.revenue)} />
        <StatCard label={t("crm.statActive")} value={String(summary.active)} />
      </div>

      {/* Search */}
      <div className="relative mt-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("crm.searchPlaceholder")}
          className="w-full rounded-lg border border-line bg-card py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none" />
      </div>

      <div className="mt-4">
        {profiles === null ? (
          <div className="rounded-2xl border border-line bg-paper/60 p-8 text-center text-sm text-muted">{t("crm.loading")}</div>
        ) : contractors.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center text-sm text-muted">{t("crm.empty")}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center text-sm text-muted">{t("crm.noResults")}</div>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => (
              <Link key={r.p.id} href={`/portal/admin/crm/${r.p.id}`}
                className="block rounded-2xl border border-line bg-card p-4 transition hover:border-accent">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-display text-sm font-semibold text-ink">{r.p.company || r.p.name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted">{r.p.company ? r.p.name + " · " : ""}{r.p.email}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-display text-base font-bold text-ink">{money(r.revenue)}</div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t("crm.revenue")}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                  <span>{t("crm.memberSince")}: {fmtDate(r.p.createdAt)}</span>
                  <span>{t("crm.orders")}: <span className="font-semibold text-ink">{r.count}</span></span>
                  <span>{t("crm.active")}: <span className="font-semibold text-ink">{r.active}</span></span>
                  <span className="ml-auto">{t("crm.lastOrder")}: {r.last ? new Date(r.last).toLocaleDateString() : t("crm.noOrders")}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">{value}</div>
    </div>
  );
}

const MODAL_INPUT =
  "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";

function ModalField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        {label}{required && <span className="text-accent">*</span>}
      </span>
      {children}
    </label>
  );
}

// Create-contractor modal: form → server route (Bearer token) → one-time temp-password card.
function AddContractorModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [territory, setTerritory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ tempPassword: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !company.trim()) { setError(t("crm.required")); return; }
    setError("");
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { setError(t("crm.errForbidden")); setBusy(false); return; }
      const res = await fetch("/api/admin/create-contractor", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), company: company.trim(), phone: phone.trim(), territory: territory.trim() }),
      });
      if (!res.ok) {
        setError(
          res.status === 409 ? t("crm.errEmailExists")
            : res.status === 400 ? t("crm.errInvalid")
            : res.status === 401 || res.status === 403 ? t("crm.errForbidden")
            : t("crm.errGeneric"),
        );
        setBusy(false);
        return;
      }
      const json = (await res.json()) as { tempPassword: string; email: string };
      setResult({ tempPassword: json.tempPassword, email: json.email });
    } catch {
      setError(t("crm.errGeneric"));
      setBusy(false);
    }
  }

  function copyPw() {
    if (!result) return;
    navigator.clipboard?.writeText(result.tempPassword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/60 p-4 sm:items-center">
      <div className="my-auto w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-xl sm:p-7">
        {result ? (
          <div>
            <h2 className="font-display text-lg font-bold text-ink">{t("crm.createdTitle")}</h2>
            <p className="mt-0.5 text-sm text-muted">{result.email}</p>
            <div className="mt-4 rounded-xl border border-accent/40 bg-accent-soft/20 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("crm.tempPasswordLabel")}</div>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded-md bg-card px-3 py-2 font-mono text-base font-bold text-ink">{result.tempPassword}</code>
                <button onClick={copyPw}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium transition hover:border-accent hover:text-accent">
                  {copied ? <><Check className="h-3.5 w-3.5" /> {t("crm.copied")}</> : <><Copy className="h-3.5 w-3.5" /> {t("crm.copyPassword")}</>}
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">{t("crm.shareNote")}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-amber">{t("crm.mustChangeNote")}</p>
            <button onClick={onCreated}
              className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">{t("crm.done")}</button>
          </div>
        ) : (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-ink">{t("crm.newContractorTitle")}</h2>
              <button onClick={onClose} className="rounded-md p-1 text-muted transition hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <ModalField label={t("crm.fieldName")} required><input value={name} onChange={(e) => setName(e.target.value)} className={MODAL_INPUT} autoComplete="off" /></ModalField>
              <ModalField label={t("crm.fieldEmail")} required><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={MODAL_INPUT} autoComplete="off" /></ModalField>
              <ModalField label={t("crm.fieldCompany")} required><input value={company} onChange={(e) => setCompany(e.target.value)} className={MODAL_INPUT} /></ModalField>
              <ModalField label={t("crm.fieldPhone")}><input value={phone} onChange={(e) => setPhone(e.target.value)} className={MODAL_INPUT} /></ModalField>
              <ModalField label={t("crm.fieldTerritory")}><input value={territory} onChange={(e) => setTerritory(e.target.value)} placeholder={t("crm.territoryPlaceholder")} className={MODAL_INPUT} /></ModalField>
              {error && <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber-700">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={busy}
                  className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">{busy ? t("crm.creating") : t("crm.createAccount")}</button>
                <button type="button" onClick={onClose}
                  className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-muted transition hover:text-ink">{t("crm.cancel")}</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
