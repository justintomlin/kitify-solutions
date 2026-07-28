"use client";

// Permit Leads — admin-only. Reads leads.permits via the leads-schema client, paginated
// (API caps at 1000 rows and the table grows weekly). The portal ONLY writes follow_up,
// claimed_by, notes (the portal-owned columns) — never any pipeline column. Promotion goes
// through the PUBLIC-schema RPC promote_permit_to_crm.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Check, ArrowUpRight } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import { supabase, supabaseLeads } from "@/lib/supabase";
import { useToast, ToastView } from "@/components/Toast";

const PAGE_SIZE = 50;

// ── ASSUMED leads.permits column names — verify against the real schema if a filter or
//    field comes back empty. Only follow_up / claimed_by / notes are ever WRITTEN. ──
const COL = {
  id: "id",
  permitNumber: "permit_number",
  jurisdiction: "jurisdiction",
  dateFiled: "date_filed",
  county: "county",
  contractor: "contractor",
  contact: "contact",
  description: "description",
  siteAddress: "site_address",
  city: "city",
  valuation: "valuation",
  relevance: "lead_relevance",
  accountType: "account_type",
  matchConfidence: "match_confidence",
  followUp: "follow_up",
  claimedBy: "claimed_by",
  notes: "notes",
  crmCompanyId: "crm_company_id",
  owner: "owner",
  licenseNum: "license_num",
  sqft: "sqft",
  permitType: "permit_type",
  status: "status",
};

const RELEVANCE = ["High", "Medium", "Low", "Ignore"] as const;
const FOLLOW_UP = ["New", "Researching", "Contacted", "Quoted", "Won", "Lost", "No Fit"] as const;
const followKey = (v: string) => "leads.fu" + v.replace(/[^a-zA-Z]/g, "");

type Permit = Record<string, unknown>;
const str = (r: Permit, k: string): string => { const v = r[k]; return v == null ? "" : String(v); };
const money = (v: unknown) => { const n = v == null || v === "" ? NaN : Number(v); return isNaN(n) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); };
const fmtDate = (v: unknown) => { const s = v == null ? "" : String(v); const d = Date.parse(s); return isNaN(d) ? "—" : new Date(d).toLocaleDateString(); };
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default function LeadsPage() {
  return <AdminGuard><LeadsInner /></AdminGuard>;
}

function LeadsInner() {
  const { t } = useLanguage();
  const { toast, showToast } = useToast();

  const [relevance, setRelevance] = useState<string>("High");
  const [county, setCounty] = useState("");
  const [accountType, setAccountType] = useState("");
  const [followUp, setFollowUp] = useState("New");
  const [hasContact, setHasContact] = useState(false);
  const [promoted, setPromoted] = useState<"not" | "all" | "only">("not");
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<Permit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counties, setCounties] = useState<string[]>([]);
  const [accountTypes, setAccountTypes] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // lifecycle ('customer' | 'lead') of each linked company on the current page — batch-
  // fetched from public.companies so the row can flag existing customers vs known leads.
  const [lifecycleById, setLifecycleById] = useState<Record<string, string>>({});

  // Distinct filter values (capped at 1000 — fine for now; the list itself is paginated).
  useEffect(() => {
    (async () => {
      const { data } = await supabaseLeads.from("permits").select("county, account_type").limit(1000);
      const cs = new Set<string>(), as = new Set<string>();
      // "Trade contractor" is intentionally excluded as a selectable filter option (still
      // present in the data — reachable via the "All" account-type filter).
      for (const r of (data ?? []) as Permit[]) { const c = str(r, COL.county); if (c) cs.add(c); const a = str(r, COL.accountType); if (a && a !== "Trade contractor") as.add(a); }
      setCounties([...cs].sort()); setAccountTypes([...as].sort());
    })().catch(() => {});
  }, []);

  const fetchPage = useCallback(async () => {
    setRows(null);
    let q = supabaseLeads.from("permits").select("*", { count: "exact" });
    if (relevance !== "All") q = q.eq(COL.relevance, relevance);
    if (county) q = q.eq(COL.county, county);
    if (accountType) q = q.eq(COL.accountType, accountType);
    if (followUp !== "All") q = followUp === "New" ? q.or(`${COL.followUp}.is.null,${COL.followUp}.eq.New`) : q.eq(COL.followUp, followUp);
    if (hasContact) q = q.not(COL.contact, "is", null);
    if (promoted === "not") q = q.is(COL.crmCompanyId, null);
    else if (promoted === "only") q = q.not(COL.crmCompanyId, "is", null);
    // has-contact first, then newest filed. (Primary key is contact-nulls-last; date is the
    // tiebreak — PostgREST can't order by a raw boolean expression.)
    q = q.order(COL.contact, { ascending: true, nullsFirst: false }).order(COL.dateFiled, { ascending: false });
    const from = page * PAGE_SIZE;
    const { data, count, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) { setRows([]); setTotal(0); return; }
    const list = (data ?? []) as Permit[];
    setRows(list);
    setTotal(count ?? 0);
    // Second query (public schema) for the linked companies' lifecycle — can't cross-schema
    // join from the leads client, so batch-look-up the distinct crm_company_ids on this page.
    const ids = [...new Set(list.map((r) => r[COL.crmCompanyId]).filter((v) => v != null).map(String))];
    if (ids.length === 0) { setLifecycleById({}); return; }
    const { data: comps } = await supabase.from("companies").select("id, lifecycle").in("id", ids);
    const map: Record<string, string> = {};
    for (const c of (comps ?? []) as Record<string, unknown>[]) map[String(c.id)] = String(c.lifecycle ?? "");
    setLifecycleById(map);
  }, [relevance, county, accountType, followUp, hasContact, promoted, page]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  const resetTo = (fn: () => void) => { fn(); setPage(0); };
  const flashSaved = (key: string) => { setSavedKey(key); window.setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1200); };

  // Persist a portal-owned field, updating the local row optimistically.
  async function saveField(id: string, field: "follow_up" | "claimed_by" | "notes", value: string) {
    setRows((prev) => prev && prev.map((r) => (String(r[COL.id]) === id ? { ...r, [field]: value } : r)));
    const { error } = await supabaseLeads.from("permits").update({ [field]: value || null }).eq(COL.id, id);
    if (!error) flashSaved(`${id}:${field}`);
  }

  async function promote(row: Permit) {
    const id = str(row, COL.id);
    setBusyId(id);
    try {
      const { data, error } = await supabase.rpc("promote_permit_to_crm", { p_permit_id: Number(row[COL.id]) });
      if (error) { showToast(t("leads.promoteError")); return; }
      const name = typeof data === "string" ? data : ((data as { name?: string; company_name?: string } | null)?.name ?? (data as { company_name?: string } | null)?.company_name ?? "");
      showToast(name ? t("leads.promotedNamed", { name }) : t("leads.promoted"));
      fetchPage();
    } finally { setBusyId(null); }
  }

  // Reversible "not a fit" — writes the portal-owned follow_up column. Drops the row from
  // the current view unless the user is explicitly filtered to "No Fit".
  async function dismiss(row: Permit) {
    const id = str(row, COL.id);
    setBusyId(id);
    try {
      const { error } = await supabaseLeads.from("permits").update({ [COL.followUp]: "No Fit" }).eq(COL.id, id);
      if (error) { showToast(t("leads.dismissError")); return; }
      if (followUp === "No Fit") setRows((prev) => prev && prev.map((r) => (str(r, COL.id) === id ? { ...r, [COL.followUp]: "No Fit" } : r)));
      else { setRows((prev) => prev && prev.filter((r) => str(r, COL.id) !== id)); setTotal((n) => Math.max(0, n - 1)); }
      showToast(t("leads.dismissed"));
    } finally { setBusyId(null); }
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  const SELECT = "rounded-md border border-line bg-card px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none";

  return (
    <div className="mx-auto max-w-6xl">
      <ToastView toast={toast} />
      <div className="mb-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("leads.title")}</div>
        <p className="mt-1 text-sm text-muted">{t("leads.subtitle")}</p>
      </div>

      {/* Filter bar — stacks on phones */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-3">
        <FilterSelect label={t("leads.fRelevance")} value={relevance} onChange={(v) => resetTo(() => setRelevance(v))}
          options={[["All", t("leads.optAll")], ...RELEVANCE.map((r) => [r, t("leads.rel" + r)] as [string, string])]} cls={SELECT} />
        <FilterSelect label={t("leads.fCounty")} value={county} onChange={(v) => resetTo(() => setCounty(v))}
          options={[["", t("leads.optAll")], ...counties.map((c) => [c, c] as [string, string])]} cls={SELECT} />
        <FilterSelect label={t("leads.fAccountType")} value={accountType} onChange={(v) => resetTo(() => setAccountType(v))}
          options={[["", t("leads.optAll")], ...accountTypes.map((a) => [a, a] as [string, string])]} cls={SELECT} />
        <FilterSelect label={t("leads.fFollowUp")} value={followUp} onChange={(v) => resetTo(() => setFollowUp(v))}
          options={[["All", t("leads.optAll")], ...FOLLOW_UP.map((f) => [f, t(followKey(f))] as [string, string])]} cls={SELECT} />
        <FilterSelect label={t("leads.fPromoted")} value={promoted} onChange={(v) => resetTo(() => setPromoted(v as "not" | "all" | "only"))}
          options={[["not", t("leads.promNot")], ["all", t("leads.optAll")], ["only", t("leads.promOnly")]]} cls={SELECT} />
        <label className="ml-1 inline-flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={hasContact} onChange={(e) => resetTo(() => setHasContact(e.target.checked))} /> {t("leads.fHasContact")}
        </label>
      </div>

      {/* Count + pagination */}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
        <span>{rows === null ? t("leads.loading") : t("leads.showing", { from: String(from), to: String(to), total: String(total) })}</span>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
            className="rounded-md border border-line px-2.5 py-1 font-medium transition hover:text-ink disabled:opacity-40">{t("leads.prev")}</button>
          <button onClick={() => setPage((p) => p + 1)} disabled={to >= total}
            className="rounded-md border border-line px-2.5 py-1 font-medium transition hover:text-ink disabled:opacity-40">{t("leads.next")}</button>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {rows === null ? (
          <div className="rounded-2xl border border-line bg-paper/60 p-8 text-center text-sm text-muted">{t("leads.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center text-sm text-muted">{t("leads.empty")}</div>
        ) : (
          rows.map((r) => {
            const id = str(r, COL.id);
            const isOpen = expanded === id;
            const contractor = str(r, COL.contractor);
            const promotedId = str(r, COL.crmCompanyId);
            return (
              <div key={id} className="rounded-2xl border border-line bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-ink">{str(r, COL.permitNumber) || id}</span>
                      <span className="text-xs text-muted">{str(r, COL.jurisdiction)}</span>
                      <RelevanceChip value={str(r, COL.relevance)} t={t} />
                      {promotedId && <LinkBadge lifecycle={lifecycleById[promotedId]} t={t} />}
                      {str(r, COL.accountType) && <span className="rounded-full bg-ink/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted">{str(r, COL.accountType)}</span>}
                      {str(r, COL.matchConfidence) && <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted">{str(r, COL.matchConfidence)}</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted">{str(r, COL.contractor) || "—"}{str(r, COL.contact) ? " · " + trunc(str(r, COL.contact), 28) : ""}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {promotedId ? (
                      <Link href="/portal/admin/crm" className="inline-flex items-center gap-1 rounded-lg border border-accent/40 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent-soft/40">
                        {t("leads.viewInCrm")} <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <button onClick={() => promote(r)} disabled={!contractor || busyId === id}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                        {busyId === id ? t("leads.promoting") : t("leads.promote")}
                      </button>
                    )}
                    <button onClick={() => dismiss(r)} disabled={busyId === id || str(r, COL.followUp) === "No Fit"}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">
                      {t("leads.dismiss")}
                    </button>
                    <button onClick={() => setExpanded(isOpen ? null : id)} className="rounded-md border border-line p-1.5 text-muted transition hover:text-ink">
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Key fields */}
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4">
                  <Cell label={t("leads.cDateFiled")}>{fmtDate(r[COL.dateFiled])}</Cell>
                  <Cell label={t("leads.cCounty")}>{str(r, COL.county) || "—"}</Cell>
                  <Cell label={t("leads.cValuation")}>{money(r[COL.valuation])}</Cell>
                  <Cell label={t("leads.cAddress")}>{trunc([str(r, COL.siteAddress), str(r, COL.city)].filter(Boolean).join(", "), 40) || "—"}</Cell>
                </div>
                {str(r, COL.description) && <div className="mt-2 text-xs text-ink/80">{trunc(str(r, COL.description), 140)}</div>}

                {/* Inline-editable portal-owned fields */}
                <div className="mt-3 grid grid-cols-1 gap-2 border-t border-line/60 pt-3 sm:grid-cols-3">
                  <EditField label={t("leads.cFollowUp")} saved={savedKey === `${id}:follow_up`}>
                    <select value={str(r, COL.followUp) || "New"} onChange={(e) => saveField(id, "follow_up", e.target.value)} className={SELECT + " w-full"}>
                      {FOLLOW_UP.map((f) => <option key={f} value={f}>{t(followKey(f))}</option>)}
                    </select>
                  </EditField>
                  <EditField label={t("leads.cClaimedBy")} saved={savedKey === `${id}:claimed_by`}>
                    <input defaultValue={str(r, COL.claimedBy)} onBlur={(e) => saveField(id, "claimed_by", e.target.value)}
                      className="w-full rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none" />
                  </EditField>
                  <EditField label={t("leads.cNotes")} saved={savedKey === `${id}:notes`}>
                    <input defaultValue={str(r, COL.notes)} onBlur={(e) => saveField(id, "notes", e.target.value)} placeholder={t("leads.notesPlaceholder")}
                      className="w-full rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none" />
                  </EditField>
                </div>

                {isOpen && (
                  <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 border-t border-line/60 pt-3 text-[11px] sm:grid-cols-2">
                    <Cell label={t("leads.cContactFull")}>{str(r, COL.contact) || "—"}</Cell>
                    <Cell label={t("leads.cOwner")}>{str(r, COL.owner) || "—"}</Cell>
                    <Cell label={t("leads.cLicense")}>{str(r, COL.licenseNum) || "—"}</Cell>
                    <Cell label={t("leads.cSqft")}>{str(r, COL.sqft) || "—"}</Cell>
                    <Cell label={t("leads.cPermitType")}>{str(r, COL.permitType) || "—"}</Cell>
                    <Cell label={t("leads.cStatus")}>{str(r, COL.status) || "—"}</Cell>
                    <div className="sm:col-span-2"><Cell label={t("leads.cAddressFull")}>{[str(r, COL.siteAddress), str(r, COL.city)].filter(Boolean).join(", ") || "—"}</Cell></div>
                    <div className="sm:col-span-2"><Cell label={t("leads.cDescriptionFull")}>{str(r, COL.description) || "—"}</Cell></div>
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

function FilterSelect({ label, value, onChange, options, cls }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; cls: string }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="font-mono uppercase tracking-wide text-[10px]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function RelevanceChip({ value, t }: { value: string; t: (k: string) => string }) {
  if (!value) return null;
  const tone = value === "High" ? "bg-success/15 text-success" : value === "Medium" ? "bg-amber/15 text-amber" : value === "Ignore" ? "bg-ink/5 text-muted/50" : "bg-ink/5 text-muted";
  return <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${tone}`}>{t("leads.rel" + value)}</span>;
}

// Green "Existing Customer" when the linked company is a customer, amber "Known Lead" when
// it's still a lead. Renders nothing until the lifecycle lookup for this page resolves.
function LinkBadge({ lifecycle, t }: { lifecycle: string | undefined; t: (k: string) => string }) {
  if (lifecycle !== "customer" && lifecycle !== "lead") return null;
  const isCustomer = lifecycle === "customer";
  const tone = isCustomer ? "bg-success/15 text-success" : "bg-amber/15 text-amber";
  return <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${tone}`}>{t(isCustomer ? "leads.badgeCustomer" : "leads.badgeKnownLead")}</span>;
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><span className="font-mono text-[9px] uppercase tracking-wide text-muted">{label}</span><div className="text-ink">{children}</div></div>;
}

function EditField({ label, saved, children }: { label: string; saved: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-muted">
        {label}{saved && <Check className="h-3 w-3 text-success" />}
      </div>
      {children}
    </div>
  );
}
