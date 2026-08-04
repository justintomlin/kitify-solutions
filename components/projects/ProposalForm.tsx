"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { saveProposal, type Proposal, type ProposalLineItem, type Quote } from "@/lib/store";

const INPUT =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// crypto.randomUUID isn't available on every browser this portal targets (and not at all over
// plain http on some), so the id falls back to a random string. It only has to be unique
// within one proposal's line items, which this comfortably is.
function newLineItemId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `li-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
  // Amounts are held as strings while editing so a half-typed "12." or a cleared field stays
  // exactly as typed; they are parsed once on submit.
  const [lineItems, setLineItems] = useState<{ id: string; description: string; amount: string }[]>(
    () => (initial?.customLineItems ?? []).map((li) => ({ id: li.id, description: li.description, amount: String(li.amount) })),
  );
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

  const addLineItem = () =>
    setLineItems((prev) => [...prev, { id: newLineItemId(), description: "", amount: "" }]);
  const patchLineItem = (id: string, patch: Partial<{ description: string; amount: string }>) =>
    setLineItems((prev) => prev.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  const removeLineItem = (id: string) => setLineItems((prev) => prev.filter((li) => li.id !== id));

  // Blank rows are dropped rather than saved: an "+ Add" click the contractor thought better
  // of should not become an empty line on the homeowner's estimate.
  const cleanLineItems = (): ProposalLineItem[] =>
    lineItems
      .map((li) => ({ id: li.id, description: li.description.trim(), amount: Number(li.amount) }))
      .filter((li) => li.description !== "" && Number.isFinite(li.amount) && li.amount !== 0);

  const lineItemsTotal = cleanLineItems().reduce((n, li) => n + li.amount, 0);

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
      customLineItems: cleanLineItems(),
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
                inputMode="decimal"
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

        {/* Labour & extras. One set for the whole proposal, not per tier — demolition and
            permits cost the same whichever package the homeowner picks, and duplicating them
            across three tiers would only create three chances to disagree. */}
        <div className="mt-2 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("projects.lineItemsTitle")}</span>
            <button type="button" onClick={addLineItem}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium transition hover:border-accent hover:text-accent">
              <Plus className="h-3.5 w-3.5" /> {t("projects.lineItemAdd")}
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">{t("projects.lineItemsHint")}</p>

          {lineItems.length > 0 && (
            <div className="mt-3 space-y-2">
              {lineItems.map((li) => (
                <div key={li.id} className="flex items-start gap-2">
                  <input
                    value={li.description}
                    onChange={(e) => patchLineItem(li.id, { description: e.target.value })}
                    placeholder={t("projects.lineItemDescPlaceholder")}
                    aria-label={t("projects.lineItemDesc")}
                    className={`${INPUT} min-w-0 flex-1`}
                  />
                  <div className="relative w-[132px] shrink-0">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">$</span>
                    <input
                      type="number" inputMode="decimal" min={0} step="0.01"
                      value={li.amount}
                      onChange={(e) => patchLineItem(li.id, { amount: e.target.value })}
                      placeholder="0.00"
                      aria-label={t("projects.lineItemAmount")}
                      className={`${INPUT} pl-6`}
                    />
                  </div>
                  <button type="button" onClick={() => removeLineItem(li.id)}
                    aria-label={t("projects.lineItemRemove")} title={t("projects.lineItemRemove")}
                    className="mt-0.5 shrink-0 rounded-md border border-line p-2 text-muted transition hover:border-amber hover:text-amber">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex justify-end pr-[52px] text-xs">
                <span className="text-muted">{t("projects.lineItemsTotal")}&nbsp;</span>
                <span className="font-semibold text-ink">{money(lineItemsTotal)}</span>
              </div>
            </div>
          )}
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
