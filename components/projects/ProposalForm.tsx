"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageContext";
import { saveProposal, type Proposal, type Quote } from "@/lib/store";

const INPUT =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        {label}
        {required && <span className="text-muted/70">*</span>}
        {error && <span className="text-amber">· {error}</span>}
      </span>
      {children}
    </label>
  );
}

// Group up to three of a project's saved quotes into a good/better/best proposal. Tiers are
// optional (a proposal can carry just two). Editing preserves an existing share link and any
// acceptance, because saveProposal never touches those columns.
export function ProposalForm({ ownerId, projectId, quotes, initial, onSaved, onCancel }: {
  ownerId: string;
  projectId: string;
  quotes: Quote[];
  initial?: Proposal;
  onSaved: (p: Proposal) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(initial?.name ?? "");
  const [tierGood, setTierGood] = useState(initial?.tierGood ?? "");
  const [tierBetter, setTierBetter] = useState(initial?.tierBetter ?? "");
  const [tierBest, setTierBest] = useState(initial?.tierBest ?? "");
  const [markup, setMarkup] = useState(String(initial?.markupPct ?? 0));
  const [nameError, setNameError] = useState(false);
  const [saving, setSaving] = useState(false);

  const tierSelect = (value: string, onChange: (v: string) => void, key: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} aria-label={key}>
      <option value="">{t("projects.tierNone")}</option>
      {quotes.map((q) => (
        <option key={q.id} value={q.id}>{q.name}</option>
      ))}
    </select>
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setNameError(true); return; }
    setNameError(false);
    setSaving(true);
    const parsedMarkup = Number(markup);
    const saved = await saveProposal({
      id: initial?.id,
      ownerId,
      projectId,
      name: name.trim(),
      markupPct: Number.isFinite(parsedMarkup) ? Math.max(0, parsedMarkup) : 0,
      tierGood: tierGood || null,
      tierBetter: tierBetter || null,
      tierBest: tierBest || null,
      status: initial?.status ?? "draft", // keep an existing status (e.g. 'shared') on edit
    });
    setSaving(false);
    onSaved(saved);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
        {initial ? t("projects.editProposalTitle") : t("projects.newProposalTitle")}
      </div>

      <div className="grid gap-3">
        <Field label={t("projects.proposalName")} required error={nameError ? t("projects.required") : undefined}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("projects.proposalNamePlaceholder")} className={INPUT} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("projects.tierGoodLabel")}>{tierSelect(tierGood, setTierGood, "good")}</Field>
          <Field label={t("projects.tierBetterLabel")}>{tierSelect(tierBetter, setTierBetter, "better")}</Field>
          <Field label={t("projects.tierBestLabel")}>{tierSelect(tierBest, setTierBest, "best")}</Field>
        </div>

        <div className="sm:max-w-[180px]">
          <Field label={t("projects.markupLabel")}>
            <div className="relative">
              <input
                type="number"
                min={0}
                step="1"
                value={markup}
                onChange={(e) => setMarkup(e.target.value)}
                className={`${INPUT} pr-7`}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">%</span>
            </div>
          </Field>
        </div>
        <p className="text-xs text-muted">{t("projects.markupHint")}</p>
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
