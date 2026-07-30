"use client";

// My Customers — the contractor's own homeowner book. Distinct from the admin CRM at
// /portal/admin/crm, which tracks contractors; this tracks the people they install for.
//
// Most rows arrive on their own: saving a project with a customer email auto-creates the
// matching customer (see linkProjectCustomer in lib/store.ts). "+ Add Customer" covers the
// rest. Everything on this page is scoped to the signed-in user — an admin viewing it sees
// their own customers, not the network's.
//
// Projects, orders and claims are all loaded once for the owner and linked client-side:
// a customer owns a project when the project carries their email (case-insensitively) or
// was the project that introduced them, and owns an order when that order's project is theirs.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronUp, Plus, Search, Trash2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { useToast, ToastView } from "@/components/Toast";
import {
  deleteContractorCustomer, listClaims, listContractorCustomers, listOrders, listProjects,
  saveContractorCustomer,
  type Claim, type ContractorCustomer, type CustomerAddress, type Order, type Project,
} from "@/lib/store";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const addrLine = (a: CustomerAddress | null) =>
  a ? [a.street, [a.city, a.state, a.zip].filter(Boolean).join(", ")].filter(Boolean).join(" · ") : "";

// Claims still in play — anything not yet approved/denied/resolved.
const OPEN_CLAIM = new Set(["submitted", "under_review"]);

const INPUT = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";
const BTN = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_GHOST = "inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink disabled:opacity-50";

// The editable shape shared by the add form and the expanded edit panel.
type Draft = {
  name: string; email: string; phone: string;
  street: string; city: string; state: string; zip: string; notes: string;
};
const emptyDraft = (): Draft => ({ name: "", email: "", phone: "", street: "", city: "", state: "", zip: "", notes: "" });
const draftFrom = (c: ContractorCustomer): Draft => ({
  name: c.name, email: c.email ?? "", phone: c.phone ?? "",
  street: c.address?.street ?? "", city: c.address?.city ?? "", state: c.address?.state ?? "", zip: c.address?.zip ?? "",
  notes: c.notes ?? "",
});
const trimOpt = (v: string) => { const s = v.trim(); return s ? s : null; };
function draftAddress(d: Draft): CustomerAddress | null {
  const a: CustomerAddress = {};
  if (d.street.trim()) a.street = d.street.trim();
  if (d.city.trim()) a.city = d.city.trim();
  if (d.state.trim()) a.state = d.state.trim();
  if (d.zip.trim()) a.zip = d.zip.trim();
  return Object.keys(a).length ? a : null;
}

export default function MyCustomersPage() {
  const { t } = useLanguage();
  const { userId } = useAuth();
  const { toast, showToast } = useToast();

  const [customers, setCustomers] = useState<ContractorCustomer[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [failed, setFailed] = useState(false);

  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!userId) return;
    setFailed(false);
    listContractorCustomers(userId).then(setCustomers).catch(() => { setCustomers([]); setFailed(true); });
    // Supporting data for the expanded panels — a failure here just means thinner detail.
    listProjects(userId).then(setProjects).catch(() => setProjects([]));
    listOrders({ ownerId: userId }).then(setOrders).catch(() => setOrders([]));
    listClaims().then(setClaims).catch(() => setClaims([]));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  // project id → its orders, so a customer's orders resolve through their projects.
  const ordersByProject = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of orders) { const a = m.get(o.projectId) ?? []; a.push(o); m.set(o.projectId, a); }
    return m;
  }, [orders]);

  const claimsByOrder = useMemo(() => {
    const m = new Map<string, Claim[]>();
    for (const c of claims) { const a = m.get(c.orderId) ?? []; a.push(c); m.set(c.orderId, a); }
    return m;
  }, [claims]);

  // Everything a customer owns, resolved once per render.
  const linkOf = useCallback((c: ContractorCustomer) => {
    const email = norm(c.email);
    const ps = projects.filter((p) => (email && norm(p.customer.email) === email) || (c.projectId && p.id === c.projectId));
    const os = ps.flatMap((p) => ordersByProject.get(p.id) ?? []);
    const registered = os.filter((o) => o.warrantyStatus === "registered").length;
    const openClaims = os.flatMap((o) => claimsByOrder.get(o.id) ?? []).filter((cl) => OPEN_CLAIM.has(cl.status)).length;
    return { projects: ps, orders: os, registered, openClaims };
  }, [projects, ordersByProject, claimsByOrder]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = customers ?? [];
    if (!q) return list;
    return list.filter((c) => [c.name, c.email ?? "", c.phone ?? ""].some((s) => s.toLowerCase().includes(q)));
  }, [customers, query]);

  async function create(d: Draft) {
    if (!userId) return;
    await saveContractorCustomer({
      ownerId: userId,
      name: d.name.trim(),
      email: trimOpt(d.email),
      phone: trimOpt(d.phone),
      address: draftAddress(d),
      notes: trimOpt(d.notes),
      source: "manual",
    });
    setAdding(false);
    showToast(t("customers.added"));
    load();
  }

  async function update(c: ContractorCustomer, d: Draft) {
    await saveContractorCustomer({
      id: c.id,
      ownerId: c.ownerId,
      name: d.name.trim(),
      email: trimOpt(d.email),
      phone: trimOpt(d.phone),
      address: draftAddress(d),
      notes: trimOpt(d.notes),
      source: c.source,
      projectId: c.projectId,
    });
    showToast(t("customers.saved"));
    load();
  }

  async function remove(c: ContractorCustomer) {
    await deleteContractorCustomer(c.id);
    setExpanded(null);
    showToast(t("customers.deleted"));
    load();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <ToastView toast={toast} />

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("customers.title")}</div>
          <p className="mt-1 text-sm text-muted">{t("customers.subtitle")}</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className={BTN}>
            <Plus className="h-4 w-4" /> {t("customers.add")}
          </button>
        )}
      </div>

      {adding && <AddForm onCancel={() => setAdding(false)} onSave={create} />}

      {/* Search */}
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={t("customers.searchPlaceholder")} className={INPUT + " pl-9"} />
      </div>

      <div className="mt-4 space-y-2.5">
        {customers === null ? (
          <Panel>{t("customers.loading")}</Panel>
        ) : failed ? (
          <Panel>{t("customers.error")}</Panel>
        ) : customers.length === 0 ? (
          <EmptyPanel>{t("customers.empty")}</EmptyPanel>
        ) : shown.length === 0 ? (
          <EmptyPanel>{t("customers.noResults")}</EmptyPanel>
        ) : (
          shown.map((c) => (
            <CustomerCard
              key={c.id}
              customer={c}
              link={linkOf(c)}
              open={expanded === c.id}
              onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
              onSave={(d) => update(c, d)}
              onDelete={() => remove(c)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ------------------------------- customer card -------------------------------
type Links = { projects: Project[]; orders: Order[]; registered: number; openClaims: number };

function CustomerCard({
  customer, link, open, onToggle, onSave, onDelete,
}: {
  customer: ContractorCustomer;
  link: Links;
  open: boolean;
  onToggle: () => void;
  onSave: (d: Draft) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(customer));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  // Re-seed the editable copy whenever the row changes underneath (e.g. after a reload).
  useEffect(() => { setDraft(draftFrom(customer)); }, [customer]);

  const recent = link.projects[0] ?? null; // listProjects is updated_at DESC
  const notes = customer.notes ?? "";
  const notesLong = notes.length > 120;

  async function save() {
    if (!draft.name.trim()) { setError(t("customers.errName")); return; }
    setBusy(true);
    setError("");
    try { await onSave(draft); } catch { setError(t("customers.errSave")); } finally { setBusy(false); }
  }

  async function doDelete() {
    setBusy(true);
    setError("");
    try { await onDelete(); } catch { setError(t("customers.errSave")); setBusy(false); }
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-semibold text-ink">{customer.name}</span>
            {customer.source === "project" && (
              <span className="rounded-full bg-ink/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted">
                {t("customers.fromProject")}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">
            {[customer.email, customer.phone].filter(Boolean).join(" · ") || t("customers.noContact")}
          </div>
          {addrLine(customer.address) && <div className="mt-0.5 truncate text-xs text-muted">{addrLine(customer.address)}</div>}
        </div>
        <button onClick={onToggle} aria-label={t("customers.toggle")}
          className="shrink-0 rounded-md border border-line p-1.5 text-muted transition hover:text-ink">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>{t("customers.projectCount", { n: String(link.projects.length) })}</span>
        {recent && <span>{t("customers.mostRecent")}: {recent.name} · {fmtDate(recent.updatedAt)}</span>}
      </div>

      {notes && (
        <p className="mt-2 text-xs text-ink/70">
          {notesOpen || !notesLong ? notes : notes.slice(0, 120) + "…"}
          {notesLong && (
            <button onClick={() => setNotesOpen((v) => !v)} className="ml-1.5 font-semibold text-accent">
              {t(notesOpen ? "customers.notesLess" : "customers.notesMore")}
            </button>
          )}
        </p>
      )}

      {open && (
        <div className="mt-4 space-y-4 border-t border-line/60 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("customers.fName")}>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={INPUT} />
            </Field>
            <Field label={t("customers.fEmail")}>
              <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={INPUT} />
            </Field>
            <Field label={t("customers.fPhone")}>
              <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={INPUT} />
            </Field>
            <Field label={t("customers.fStreet")}>
              <input value={draft.street} onChange={(e) => setDraft({ ...draft, street: e.target.value })} className={INPUT} />
            </Field>
            <Field label={t("customers.fCity")}>
              <input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} className={INPUT} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("customers.fState")}>
                <input value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} className={INPUT} />
              </Field>
              <Field label={t("customers.fZip")}>
                <input value={draft.zip} onChange={(e) => setDraft({ ...draft, zip: e.target.value })} className={INPUT} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label={t("customers.fNotes")}>
                <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={3} className={INPUT} />
              </Field>
            </div>
          </div>

          {error && <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">{error}</p>}

          {confirmDelete ? (
            <div className="space-y-3 rounded-xl border border-amber/40 bg-amber/10 p-4">
              <p className="text-sm font-medium text-amber">{t("customers.deleteConfirm")}</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={doDelete} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                  <Trash2 className="h-4 w-4" /> {t("customers.deleteYes")}
                </button>
                <button onClick={() => setConfirmDelete(false)} disabled={busy} className={BTN_GHOST}>{t("customers.keep")}</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button onClick={save} disabled={busy} className={BTN}>{busy ? t("customers.saving") : t("customers.save")}</button>
              <button onClick={() => setConfirmDelete(true)} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber/40 px-3 py-2 text-sm font-medium text-amber transition hover:bg-amber/10 disabled:opacity-50">
                <Trash2 className="h-4 w-4" /> {t("customers.delete")}
              </button>
            </div>
          )}

          {/* Linked work */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("customers.linkedProjects")}</div>
              {link.projects.length === 0 ? (
                <p className="text-xs text-muted">{t("customers.noProjects")}</p>
              ) : (
                <div className="space-y-1">
                  {link.projects.map((p) => (
                    <Link key={p.id} href={`/portal/projects/${p.id}`}
                      className="flex items-center gap-1.5 text-xs text-accent transition hover:gap-2">
                      <span className="min-w-0 truncate">{p.name}</span>
                      <ArrowRight className="h-3 w-3 shrink-0" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("customers.linkedOrders")}</div>
              {link.orders.length === 0 ? (
                <p className="text-xs text-muted">{t("customers.noOrders")}</p>
              ) : (
                <div className="space-y-1">
                  {link.orders.map((o) => (
                    <Link key={o.id} href={`/portal/orders/${o.id}`}
                      className="flex items-center gap-1.5 font-mono text-xs text-accent transition hover:gap-2">
                      <span className="min-w-0 truncate">{o.orderNumber}</span>
                      <ArrowRight className="h-3 w-3 shrink-0" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("customers.warrantySummary")}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>{t("customers.warrantyRegistered", { n: String(link.registered) })}</span>
              <span className={link.openClaims > 0 ? "font-semibold text-amber" : ""}>
                {t("customers.openClaims", { n: String(link.openClaims) })}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------- add form --------------------------------
function AddForm({ onSave, onCancel }: { onSave: (d: Draft) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) { setError(t("customers.errName")); return; }
    setBusy(true);
    setError("");
    try { await onSave(draft); } catch { setError(t("customers.errSave")); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">{t("customers.addTitle")}</div>
        <button type="button" onClick={onCancel} disabled={busy} aria-label={t("customers.cancel")}
          className="rounded-md border border-line p-1.5 text-muted transition hover:text-ink disabled:opacity-50">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("customers.fName")}>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={INPUT} />
        </Field>
        <Field label={t("customers.fEmail")}>
          <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={INPUT} />
        </Field>
        <Field label={t("customers.fPhone")}>
          <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={INPUT} />
        </Field>
        <Field label={t("customers.fStreet")}>
          <input value={draft.street} onChange={(e) => setDraft({ ...draft, street: e.target.value })} className={INPUT} />
        </Field>
        <Field label={t("customers.fCity")}>
          <input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} className={INPUT} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("customers.fState")}>
            <input value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} className={INPUT} />
          </Field>
          <Field label={t("customers.fZip")}>
            <input value={draft.zip} onChange={(e) => setDraft({ ...draft, zip: e.target.value })} className={INPUT} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t("customers.fNotes")}>
            <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={3} className={INPUT} />
          </Field>
        </div>
      </div>

      {error && <p className="mt-3 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className={BTN}>{busy ? t("customers.saving") : t("customers.save")}</button>
        <button type="button" onClick={onCancel} disabled={busy} className={BTN_GHOST}>{t("customers.cancel")}</button>
      </div>
    </form>
  );
}

// --------------------------------- pieces ----------------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</span>
      {children}
    </label>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-line bg-paper/60 p-8 text-center text-sm text-muted">{children}</div>;
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center text-sm text-muted">{children}</div>;
}
