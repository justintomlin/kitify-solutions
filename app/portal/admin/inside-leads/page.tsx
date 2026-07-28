"use client";

// Inside Leads + Customers — admin-only. Inside Leads reads the PUBLIC inside_leads view
// (companies with lifecycle='lead' + their promoted-permit aggregates). Customers reads
// public.companies where lifecycle='customer'. Inline edits and Convert write to
// public.companies. Linked permits (on expand) come from the leads-schema client.

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Check, UserCheck } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import { supabase, supabaseLeads } from "@/lib/supabase";
import { useToast, ToastView } from "@/components/Toast";

// Status labels are shared with the leads page (leads.fu*).
const STATUS = ["New", "Researching", "Contacted", "Quoted", "Won", "Lost", "No Fit"] as const;
const followKey = (v: string) => "leads.fu" + v.replace(/[^a-zA-Z]/g, "");

// ── ASSUMED public.inside_leads / public.companies column names — verify if a field is empty.
//    Only status / assigned_to / notes / email / address are WRITTEN (to companies). ──
const C = {
  id: "id", name: "name", phone: "phone", email: "email", address: "address",
  accountType: "account_type", status: "status", assignedTo: "assigned_to", notes: "notes",
  permitCount: "permit_count", totalValuation: "total_valuation", latestPermitDate: "latest_permit_date", source: "source",
};
const P = { id: "id", permitNumber: "permit_number", dateFiled: "date_filed", description: "description", valuation: "valuation", crmCompanyId: "crm_company_id" };

type Row = Record<string, unknown>;
const str = (r: Row, k: string): string => { const v = r[k]; return v == null ? "" : String(v); };
const money = (v: unknown) => { const n = v == null || v === "" ? NaN : Number(v); return isNaN(n) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); };
const fmtDate = (v: unknown) => { const s = v == null ? "" : String(v); const d = Date.parse(s); return isNaN(d) ? "—" : new Date(d).toLocaleDateString(); };

export default function InsideLeadsPage() {
  return <AdminGuard><InsideLeadsInner /></AdminGuard>;
}

function InsideLeadsInner() {
  const { t } = useLanguage();
  const { toast, showToast } = useToast();
  const [tab, setTab] = useState<"leads" | "customers">("leads");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [permitsByCompany, setPermitsByCompany] = useState<Record<string, Row[]>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    const q = tab === "leads"
      ? supabase.from("inside_leads").select("*")
      : supabase.from("companies").select("*").eq("lifecycle", "customer");
    q.then(({ data, error }) => {
      if (error) { setRows([]); return; }
      const list = (data ?? []) as Row[];
      list.sort((a, b) => str(a, C.name).localeCompare(str(b, C.name)));
      setRows(list);
    });
  }, [tab]);
  useEffect(() => { load(); setExpanded(null); }, [load]);

  const flashSaved = (key: string) => { setSavedKey(key); window.setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1200); };

  // Inline edits always write to public.companies by id (never the view).
  async function saveCompany(id: string, field: "status" | "assigned_to" | "notes" | "email" | "address", value: string) {
    setRows((prev) => prev && prev.map((r) => (str(r, C.id) === id ? { ...r, [field]: value } : r)));
    const { error } = await supabase.from("companies").update({ [field]: value || null }).eq("id", id);
    if (!error) flashSaved(`${id}:${field}`);
  }

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!permitsByCompany[id]) {
      const { data } = await supabaseLeads.from("permits").select("*").eq(P.crmCompanyId, id);
      setPermitsByCompany((m) => ({ ...m, [id]: (data ?? []) as Row[] }));
    }
  }

  async function convert(id: string) {
    setBusyId(id);
    try {
      const { error } = await supabase.from("companies").update({ lifecycle: "customer", converted_at: new Date().toISOString() }).eq("id", id);
      if (error) { showToast(t("insideLeads.convertError")); return; }
      showToast(t("insideLeads.converted"));
      load(); // row leaves the inside_leads view (lifecycle changed)
    } finally { setBusyId(null); }
  }

  const SELECT = "rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none";
  const INPUT = "w-full rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none";

  return (
    <div className="mx-auto max-w-5xl">
      <ToastView toast={toast} />
      <div className="mb-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("insideLeads.title")}</div>
        <p className="mt-1 text-sm text-muted">{t("insideLeads.subtitle")}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-line bg-card p-1">
        {(["leads", "customers"] as const).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === tb ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"}`}>
            {t(tb === "leads" ? "insideLeads.tabLeads" : "insideLeads.tabCustomers")}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-2.5">
        {rows === null ? (
          <div className="rounded-2xl border border-line bg-paper/60 p-8 text-center text-sm text-muted">{t("insideLeads.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center text-sm text-muted">{t(tab === "leads" ? "insideLeads.emptyLeads" : "insideLeads.emptyCustomers")}</div>
        ) : (
          rows.map((r) => {
            const id = str(r, C.id);
            const isOpen = expanded === id;
            const permits = permitsByCompany[id] ?? [];
            return (
              <div key={id} className="rounded-2xl border border-line bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-sm font-semibold text-ink">{str(r, C.name) || "—"}</span>
                      {str(r, C.accountType) && <span className="rounded-full bg-ink/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted">{str(r, C.accountType)}</span>}
                      {str(r, C.source) && <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted">{str(r, C.source)}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{str(r, C.phone) || t("insideLeads.noPhone")}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {tab === "leads" && (
                      <button onClick={() => convert(id)} disabled={busyId === id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40">
                        <UserCheck className="h-3.5 w-3.5" /> {busyId === id ? t("insideLeads.converting") : t("insideLeads.convert")}
                      </button>
                    )}
                    <button onClick={() => toggleExpand(id)} className="rounded-md border border-line p-1.5 text-muted transition hover:text-ink">
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Aggregates (present on the inside_leads view) */}
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4">
                  <Cell label={t("insideLeads.cPermits")}>{str(r, C.permitCount) || String(permits.length || "—")}</Cell>
                  <Cell label={t("insideLeads.cValuation")}>{money(r[C.totalValuation])}</Cell>
                  <Cell label={t("insideLeads.cLatest")}>{fmtDate(r[C.latestPermitDate])}</Cell>
                  <Cell label={t("insideLeads.cAssigned")}>{str(r, C.assignedTo) || "—"}</Cell>
                </div>

                {/* Inline-editable company fields (write to public.companies) */}
                <div className="mt-3 grid grid-cols-1 gap-2 border-t border-line/60 pt-3 sm:grid-cols-2">
                  <Edit label={t("insideLeads.cStatus")} saved={savedKey === `${id}:status`}>
                    <select value={str(r, C.status) || "New"} onChange={(e) => saveCompany(id, "status", e.target.value)} className={SELECT + " w-full"}>
                      {STATUS.map((s) => <option key={s} value={s}>{t(followKey(s))}</option>)}
                    </select>
                  </Edit>
                  <Edit label={t("insideLeads.cAssigned")} saved={savedKey === `${id}:assigned_to`}>
                    <input defaultValue={str(r, C.assignedTo)} onBlur={(e) => saveCompany(id, "assigned_to", e.target.value)} className={INPUT} />
                  </Edit>
                  <Edit label={t("insideLeads.cEmail")} saved={savedKey === `${id}:email`}>
                    <input defaultValue={str(r, C.email)} onBlur={(e) => saveCompany(id, "email", e.target.value)} className={INPUT} />
                  </Edit>
                  <Edit label={t("insideLeads.cAddress")} saved={savedKey === `${id}:address`}>
                    <input defaultValue={str(r, C.address)} onBlur={(e) => saveCompany(id, "address", e.target.value)} className={INPUT} />
                  </Edit>
                  <div className="sm:col-span-2">
                    <Edit label={t("insideLeads.cNotes")} saved={savedKey === `${id}:notes`}>
                      <input defaultValue={str(r, C.notes)} onBlur={(e) => saveCompany(id, "notes", e.target.value)} placeholder={t("insideLeads.notesPlaceholder")} className={INPUT} />
                    </Edit>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-3 border-t border-line/60 pt-3">
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("insideLeads.linkedPermits")}</div>
                    {permits.length === 0 ? (
                      <p className="text-xs text-muted">{t("insideLeads.noPermits")}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {permits.map((p) => (
                          <div key={str(p, P.id)} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-line/70 bg-paper/60 px-3 py-2 text-[11px]">
                            <span className="font-mono font-semibold text-ink">{str(p, P.permitNumber) || str(p, P.id)}</span>
                            <span className="text-muted">{fmtDate(p[P.dateFiled])}</span>
                            <span className="min-w-0 flex-1 truncate text-ink/80">{str(p, P.description)}</span>
                            <span className="font-semibold text-ink">{money(p[P.valuation])}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><span className="font-mono text-[9px] uppercase tracking-wide text-muted">{label}</span><div className="text-ink">{children}</div></div>;
}

function Edit({ label, saved, children }: { label: string; saved: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-muted">
        {label}{saved && <Check className="h-3 w-3 text-success" />}
      </div>
      {children}
    </div>
  );
}
