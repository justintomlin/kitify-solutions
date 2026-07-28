"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageContext";
import { saveProject, type Project } from "@/lib/store";

const INPUT =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        {label}
        {error && <span className="text-amber">· {error}</span>}
      </span>
      {children}
    </label>
  );
}

const trimOpt = (v: string) => { const s = v.trim(); return s ? s : undefined; };

// Shared create/edit form. Pass `initial` to edit (its id is threaded to saveProject
// for an update); omit it to create. Only the two required fields are validated.
export function ProjectForm({ ownerId, initial, onSaved, onCancel }: {
  ownerId: string;
  initial?: Project;
  onSaved: (p: Project) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(initial?.name ?? "");
  const [customerName, setCustomerName] = useState(initial?.customer.name ?? "");
  const [phone, setPhone] = useState(initial?.customer.phone ?? "");
  const [email, setEmail] = useState(initial?.customer.email ?? "");
  const [street, setStreet] = useState(initial?.address.street ?? "");
  const [city, setCity] = useState(initial?.address.city ?? "");
  const [stateField, setStateField] = useState(initial?.address.state ?? "");
  const [zip, setZip] = useState(initial?.address.zip ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<{ name?: boolean; customer?: boolean }>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = { name: !name.trim(), customer: !customerName.trim() };
    if (errs.name || errs.customer) { setErrors(errs); return; }
    setErrors({});
    setSaving(true);
    const saved = await saveProject({
      id: initial?.id,
      ownerId,
      name: name.trim(),
      customer: { name: customerName.trim(), phone: trimOpt(phone), email: trimOpt(email) },
      address: { street: trimOpt(street), city: trimOpt(city), state: trimOpt(stateField), zip: trimOpt(zip) },
      status: initial?.status ?? "estimating",
      jobRegistration: initial?.jobRegistration ?? "not_started",
      notes: trimOpt(notes),
    });
    setSaving(false);
    onSaved(saved);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
        {initial ? t("projects.editTitle") : t("projects.newTitle")}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t("projects.fieldName")} required error={errors.name ? t("projects.required") : undefined}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("projects.namePlaceholder")} className={INPUT} />
          </Field>
        </div>
        <Field label={t("projects.fieldCustomerName")} required error={errors.customer ? t("projects.required") : undefined}>
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("projects.fieldPhone")}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("projects.fieldEmail")}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("projects.fieldStreet")}>
          <input value={street} onChange={(e) => setStreet(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("projects.fieldCity")}>
          <input value={city} onChange={(e) => setCity(e.target.value)} className={INPUT} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("projects.fieldState")}>
            <input value={stateField} onChange={(e) => setStateField(e.target.value)} className={INPUT} />
          </Field>
          <Field label={t("projects.fieldZip")}>
            <input value={zip} onChange={(e) => setZip(e.target.value)} className={INPUT} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t("projects.fieldNotes")}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={INPUT} />
          </Field>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button type="submit" disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
          {saving ? t("projects.saving") : t("projects.save")}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted transition hover:text-ink">
          {t("projects.cancel")}
        </button>
      </div>
    </form>
  );
}
