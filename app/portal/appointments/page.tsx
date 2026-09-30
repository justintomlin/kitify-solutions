"use client";

/**
 * Appointments — the first screen in this portal with two faces.
 *
 * An owner or member sees every visit in the org and can book one. A salesperson sees only
 * the visits assigned to them, soonest first, and cannot book. That split is NOT enforced
 * here: appointments_select_org (0027) decides what comes back and appointments_insert_org
 * decides who may write. This page reads `membershipRole` only to avoid offering a rep a form
 * the database would refuse — the same reason the proposal Edit button is hidden on an
 * accepted proposal rather than left to fail.
 *
 * Deliberately plain. A list, a form, a date picker. No calendar widget, no drag and drop —
 * this is the screen that becomes the sales app's home, and it earns that by being the
 * shortest path to "where am I going next", not by being clever.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, User, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import {
  listAppointments, saveAppointment, deleteAppointment, listOrgMembers, listContractorCustomers,
  type Appointment, type AppointmentStatus, type ContractorCustomer, type OrgMember,
} from "@/lib/store";
import { dbErrorKey } from "@/lib/db-errors";

const INPUT =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";
const LABEL = "mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-muted";
const BTN =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50";

const STATUS_KEY: Record<AppointmentStatus, string> = {
  scheduled: "appointments.stScheduled",
  confirmed: "appointments.stConfirmed",
  completed: "appointments.stCompleted",
  cancelled: "appointments.stCancelled",
  no_show: "appointments.stNoShow",
};

// A datetime-local input wants "YYYY-MM-DDTHH:mm" in LOCAL time; the column is timestamptz.
// Round-tripping through Date keeps the two in step without pulling in a date library.
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

export default function AppointmentsPage() {
  const { t } = useLanguage();
  const { userId, membershipRole } = useAuth();

  // Treated as a rep only on an explicit 'salesperson'. A null role — pre-0027 data, a
  // membership-less account, a failed read — falls through to the fuller screen, whose
  // queries RLS will narrow anyway. Failing towards "show the form and let the database
  // refuse it" beats failing towards "hide everything and show nothing".
  const isRep = membershipRole === "salesperson";

  const [rows, setRows] = useState<Appointment[] | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [customers, setCustomers] = useState<ContractorCustomer[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    // No owner filter. RLS decides — see listAppointments.
    listAppointments().then(setRows).catch((e) => { setRows([]); setError(t(dbErrorKey(e))); });
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Only the booking screen needs these, and a rep is refused both reads anyway.
  useEffect(() => {
    if (isRep) return;
    listOrgMembers().then(setMembers).catch(() => setMembers([]));
    listContractorCustomers().then(setCustomers).catch(() => setCustomers([]));
  }, [isRep]);

  const nameOf = useMemo(() => {
    const byId = new Map(members.map((m) => [m.userId, m.name]));
    return (id: string | null) => (id ? byId.get(id) ?? t("appointments.someone") : t("appointments.unassigned"));
  }, [members, t]);

  const customerOf = useMemo(() => {
    const byId = new Map(customers.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? byId.get(id) ?? "—" : "—");
  }, [customers]);

  async function create(input: Parameters<typeof saveAppointment>[0]) {
    setError("");
    try {
      await saveAppointment({ ...input, createdByUserId: userId ?? null });
      setAdding(false);
    } catch (e) {
      setError(t(dbErrorKey(e)));
    }
    load();
  }

  async function remove(id: string) {
    if (typeof window !== "undefined" && !window.confirm(t("appointments.confirmDelete"))) return;
    setError("");
    try { await deleteAppointment(id); } catch (e) { setError(t(dbErrorKey(e))); }
    load();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {t("appointments.title")}
          </div>
          <p className="mt-1 text-sm text-muted">
            {isRep ? t("appointments.subtitleRep") : t("appointments.subtitleOffice")}
          </p>
        </div>
        {!isRep && !adding && (
          <button onClick={() => setAdding(true)} className={BTN}>
            <Plus className="h-4 w-4" /> {t("appointments.book")}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber" role="alert">
          {error}
        </div>
      )}

      {adding && !isRep && (
        <BookForm
          members={members}
          customers={customers}
          onCancel={() => setAdding(false)}
          onSave={create}
        />
      )}

      <div className="mt-4 space-y-2">
        {rows === null ? (
          <div className="rounded-xl border border-line bg-card p-6 text-sm text-muted">{t("appointments.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-line bg-card p-6 text-sm text-muted">
            {isRep ? t("appointments.emptyRep") : t("appointments.emptyOffice")}
          </div>
        ) : (
          rows.map((a) => (
            <div key={a.id} className="rounded-xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <CalendarClock className="h-4 w-4 shrink-0 text-accent" />
                    {fmtWhen(a.scheduledAt)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]">
                      {t(STATUS_KEY[a.status])}
                    </span>
                    {!isRep && (
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" /> {nameOf(a.assignedToUserId)}
                      </span>
                    )}
                    {!isRep && a.customerId && <span>{customerOf(a.customerId)}</span>}
                  </div>
                  {a.address && (
                    <div className="mt-1 text-xs text-muted">
                      {[a.address.street, a.address.city, a.address.state, a.address.zip].filter(Boolean).join(", ")}
                    </div>
                  )}
                  {a.notes && <div className="mt-2 whitespace-pre-wrap text-sm text-ink">{a.notes}</div>}
                </div>
                {!isRep && (
                  <button
                    onClick={() => remove(a.id)}
                    title={t("appointments.delete")}
                    className="rounded-md border border-line p-1.5 text-muted transition hover:border-amber hover:text-amber"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The booking form. Office-facing only — a salesperson never sees it, and
// appointments_insert_org would refuse them if they did.
// ---------------------------------------------------------------------------
function BookForm({ members, customers, onCancel, onSave }: {
  members: OrgMember[];
  customers: ContractorCustomer[];
  onCancel: () => void;
  onSave: (input: {
    assignedToUserId: string | null; customerId: string | null; scheduledAt: string; notes: string | null;
  }) => void;
}) {
  const { t } = useLanguage();
  // Defaults to tomorrow morning rather than now: a visit booked for the moment you are
  // typing is never what anyone meant.
  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return toLocalInput(d.toISOString());
  });
  const [assignee, setAssignee] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!when) return;
    setSaving(true);
    onSave({
      assignedToUserId: assignee || null,
      customerId: customerId || null,
      // datetime-local gives local wall time with no zone; Date resolves it against the
      // browser's zone and toISOString hands the column a real instant.
      scheduledAt: new Date(when).toISOString(),
      notes: notes.trim() || null,
    });
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-accent/40 bg-accent-soft/20 p-4">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
        {t("appointments.bookTitle")}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>{t("appointments.fieldWhen")}</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={INPUT} required />
        </label>

        <label className="block">
          <span className={LABEL}>{t("appointments.fieldAssignee")}</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={INPUT}>
            <option value="">{t("appointments.unassigned")}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className={LABEL}>{t("appointments.fieldCustomer")}</span>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={INPUT}>
            <option value="">{t("appointments.noCustomer")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className={LABEL}>{t("appointments.fieldNotes")}</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={INPUT} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={saving} className={BTN}>
          {saving ? t("appointments.saving") : t("appointments.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted transition hover:text-ink"
        >
          {t("appointments.cancel")}
        </button>
      </div>
    </form>
  );
}
