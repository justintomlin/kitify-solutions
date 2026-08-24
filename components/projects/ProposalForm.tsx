"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { saveProposal, labelForTier, toOptionNames, type Proposal, type ProposalLineItem, type Quote } from "@/lib/store";
import type { OptionTier } from "@/lib/bathrooms";
import { freightForQuote, resolveFreight } from "@/lib/freight";

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

/**
 * Group up to three of a project's saved quotes into a proposal. Options are optional (a
 * proposal can carry just two). Editing preserves an existing share link and any acceptance,
 * because saveProposal never touches those columns.
 *
 * The three slots are stored as tier_good / tier_better / tier_best and are called Option 1 /
 * 2 / 3 everywhere a person can see them. The columns keep their names — the accept flow, the
 * public route, the order path and every saved row reference them, and renaming them would be
 * a large and entirely cosmetic migration — but the ladder itself was never the contractor's
 * idea of what they are offering. "SPC package" and "HPL package" are not better and worse,
 * and a two-option proposal has no "best". So each option can be named, and an unnamed one
 * numbers itself.
 */
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
  // Held as raw strings while editing, like the line-item amounts, and normalised once on
  // submit — so clearing a field and tabbing away means "go back to the number", not "".
  const [optionNames, setOptionNames] = useState<Record<OptionTier, string>>(() => ({
    good: initial?.optionNames?.good ?? "",
    better: initial?.optionNames?.better ?? "",
    best: initial?.optionNames?.best ?? "",
  }));
  // Amounts are held as strings while editing so a half-typed "12." or a cleared field stays
  // exactly as typed; they are parsed once on submit.
  const [lineItems, setLineItems] = useState<{ id: string; description: string; amount: string }[]>(
    () => (initial?.customLineItems ?? []).map((li) => ({ id: li.id, description: li.description, amount: String(li.amount) })),
  );
  // Held as a raw string, like markup and the line-item amounts. Empty means "use the computed
  // estimate"; "0" is a real answer meaning charge no freight, which is why this cannot be
  // normalised with a truthiness check on submit.
  const [freightOverride, setFreightOverride] = useState(
    initial?.freightOverride == null ? "" : String(initial.freightOverride),
  );
  const [nameError, setNameError] = useState(false);
  const [saving, setSaving] = useState(false);

  // The current names, in the shape labelForTier reads. Live, so the heading above each
  // column becomes the dealer's own wording as they type it.
  const namesNow = toOptionNames(optionNames);
  const optionLabel = (tier: OptionTier) => labelForTier(tier, namesNow, t);
  /** The numbered placeholder, i.e. what this option is called while it has no name. */
  const optionFallback = (tier: OptionTier) => labelForTier(tier, null, t);

  const optionColumn = (tier: OptionTier, value: string, onChange: (v: string) => void) => (
    <Field label={optionLabel(tier)}>
      <input
        value={optionNames[tier]}
        onChange={(e) => setOptionNames((prev) => ({ ...prev, [tier]: e.target.value }))}
        placeholder={optionFallback(tier)}
        aria-label={t("projects.optionNameLabel", { option: optionFallback(tier) })}
        className={`${INPUT} mb-2`}
      />
      <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} aria-label={optionLabel(tier)}>
        <option value="">{t("projects.tierNone")}</option>
        {quotes.map((q) => (
          <option key={q.id} value={q.id}>{q.name}</option>
        ))}
      </select>
    </Field>
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

  // ---- freight -------------------------------------------------------------
  // Computed PER OPTION from that option's own quote, because an option that drops the second
  // bathroom genuinely ships on a smaller truck. The override, when set, replaces all of them:
  // it is a fact about this job's logistics, and the three options ship to one address.
  const parsedOverride = freightOverride.trim() === "" ? null : Number(freightOverride);
  const overrideValid = parsedOverride == null || Number.isFinite(parsedOverride);
  const freightRows = ([
    ["good", tierGood], ["better", tierBetter], ["best", tierBest],
  ] as [OptionTier, string][])
    .filter(([, qid]) => qid)
    .map(([tier, qid]) => {
      const q = quotes.find((x) => x.id === qid);
      const computed = q ? freightForQuote(q) : null;
      return { tier, computed, resolved: resolveFreight(computed, overrideValid ? parsedOverride : null) };
    });

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
      // An unparseable entry saves as null rather than NaN — warn-don't-block: the field shows
      // a note, the proposal still saves, and it falls back to the computed estimate.
      freightOverride: overrideValid ? parsedOverride : null,
      // toOptionNames trims and collapses an all-blank set to null, so clearing every field
      // saves "unnamed" rather than three empty strings.
      optionNames: namesNow,
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
          {optionColumn("good", tierGood, setTierGood)}
          {optionColumn("better", tierBetter, setTierBetter)}
          {optionColumn("best", tierBest, setTierBest)}
        </div>
        <p className="text-xs text-muted">{t("projects.optionNamesHint")}</p>

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

        {/* Freight. Computed from bathroom count, shown per option, and overridable — a dealer
            who has phoned a carrier holds a better number than the table does. Rendered only
            when at least one option actually ships something on a truck, or when an override
            is already set, so a vanity-only proposal never sees a delivery charge it does not
            have. */}
        {(freightRows.some((r) => r.resolved) || freightOverride.trim() !== "") && (
          <div className="mt-2 border-t border-line pt-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("projects.freightTitle")}</span>
            <p className="mt-1 text-xs text-muted">{t("projects.freightHint")}</p>

            <dl className="mt-3 space-y-1">
              {freightRows.map((r) => (
                <div key={r.tier} className="flex items-baseline justify-between gap-3 text-xs">
                  <dt className="min-w-0 truncate text-muted">{optionLabel(r.tier)}</dt>
                  <dd className="shrink-0 font-medium text-ink">
                    {r.resolved ? money(r.resolved.amount) : t("projects.freightNone")}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-3 sm:max-w-[180px]">
              <Field label={t("projects.freightOverrideLabel")}>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">$</span>
                  <input
                    type="number" inputMode="decimal" min={0} step="0.01"
                    value={freightOverride}
                    onChange={(e) => setFreightOverride(e.target.value)}
                    placeholder={t("projects.freightOverridePlaceholder")}
                    className={`${INPUT} pl-6`}
                  />
                </div>
              </Field>
            </div>

            {/* Warn-don't-block: the override is honoured whatever it says, and the estimate it
                replaced is stated rather than quietly discarded — including when it disagrees
                by a lot, which is exactly when a dealer wants to see both numbers. */}
            {parsedOverride != null && overrideValid && (
              <p className="mt-2 rounded-md border border-amber/30 bg-amber/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber">
                {freightRows.some((r) => r.computed != null)
                  ? t("projects.freightOverrideNote", {
                      computed: freightRows
                        .filter((r) => r.computed != null)
                        .map((r) => money(r.computed as number))
                        .filter((v, i, a) => a.indexOf(v) === i)
                        .join(" / "),
                    })
                  : t("projects.freightOverrideNoEstimate")}
              </p>
            )}
            {!overrideValid && (
              <p className="mt-2 rounded-md border border-amber/30 bg-amber/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber">
                {t("projects.freightOverrideInvalid")}
              </p>
            )}
          </div>
        )}

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
