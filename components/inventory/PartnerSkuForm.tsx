"use client";

// A contractor's own SKU record editor. Same field set as the admin SkuForm minus everything
// sample-related — contractors don't run a sample programme, so is_sample and kit contents
// would be dead controls on every row.

import { useState } from "react";
import { useLanguage } from "@/components/LanguageContext";
import {
  savePartnerSku,
  CATEGORIES,
  UOMS,
  type PartnerSku,
  type PartnerSkuInput,
  type InventoryCategory,
  type Uom,
} from "@/lib/partner-inventory";
import { Field, INPUT, SELECT, BTN_PRIMARY, BTN_GHOST, categoryLabel, uomLabel, WarnBanner } from "./ui";

const centsToDollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
function dollarsToCents(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
function toIntOrNull(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function PartnerSkuForm({
  ownerId,
  existing,
  onSaved,
  onCancel,
}: {
  ownerId: string;
  existing?: PartnerSku;
  onSaved: (s: PartnerSku) => void;
  onCancel?: () => void;
}) {
  const { t } = useLanguage();

  const [sku, setSku] = useState(existing?.sku ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState<InventoryCategory>(existing?.category ?? "install-part");
  const [subcategory, setSubcategory] = useState(existing?.subcategory ?? "");
  const [uom, setUom] = useState<Uom>(existing?.uom ?? "each");
  const [cost, setCost] = useState(centsToDollars(existing?.defaultCostCents ?? null));
  const [weight, setWeight] = useState(existing?.defaultShipWeightG != null ? String(existing.defaultShipWeightG) : "");
  const [dimensions, setDimensions] = useState(existing?.dimensionsNote ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [active, setActive] = useState(existing?.active ?? true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !name.trim()) {
      setError(t("partnerInv.errRequired"));
      return;
    }
    setError("");
    setBusy(true);
    const input: PartnerSkuInput = {
      id: existing?.id,
      ownerId,
      sku,
      name,
      category,
      subcategory,
      uom,
      defaultCostCents: dollarsToCents(cost),
      defaultShipWeightG: toIntOrNull(weight),
      dimensionsNote: dimensions,
      notes,
      active,
    };
    try {
      onSaved(await savePartnerSku(input));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // 23505 = unique_violation on (owner_id, sku) — scoped per contractor, so this only
      // ever means "you already have a SKU with this code", never a clash with Kitify's.
      setError(/duplicate key|23505/i.test(msg) ? t("partnerInv.errDuplicateSku") : t("partnerInv.errSave"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("partnerInv.fieldSku")} required hint={t("partnerInv.hintSku")}>
          <input value={sku} onChange={(e) => setSku(e.target.value)} className={INPUT} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label={t("partnerInv.fieldName")} required>
          <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("partnerInv.fieldCategory")}>
          <select value={category} onChange={(e) => setCategory(e.target.value as InventoryCategory)} className={SELECT}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(t, c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("partnerInv.fieldSubcategory")}>
          <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("partnerInv.fieldUom")}>
          <select value={uom} onChange={(e) => setUom(e.target.value as Uom)} className={SELECT}>
            {UOMS.map((u) => (
              <option key={u} value={u}>
                {uomLabel(t, u)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("partnerInv.fieldDimensions")} hint={t("partnerInv.hintDimensions")}>
          <input value={dimensions} onChange={(e) => setDimensions(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("partnerInv.fieldCost")} hint={t("partnerInv.hintCost")}>
          <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className={INPUT} placeholder="0.00" />
        </Field>
        <Field label={t("partnerInv.fieldWeight")}>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" className={INPUT} />
        </Field>
      </div>

      <Field label={t("partnerInv.fieldNotes")}>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={INPUT} />
      </Field>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-accent" />
        {t("partnerInv.fieldActive")}
      </label>

      {error && <WarnBanner>{error}</WarnBanner>}

      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>
          {busy ? t("partnerInv.saving") : t("partnerInv.save")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={BTN_GHOST}>
            {t("partnerInv.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
