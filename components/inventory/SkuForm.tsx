"use client";

// The SKU record editor, shared by /portal/admin/inventory/new and the SKU detail page.
// Admin-only; mounted inside an AdminGuard by both callers.

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import {
  saveSku,
  listSkus,
  canBeKitChild,
  CATEGORIES,
  UOMS,
  type InventorySku,
  type InventorySkuInput,
  type InventoryCategory,
  type SampleKitItem,
  type Uom,
} from "@/lib/inventory";
import { Field, INPUT, SELECT, BTN_PRIMARY, BTN_GHOST, categoryLabel, uomLabel, WarnBanner } from "./ui";

// Dollars in the form, cents in the database — money never round-trips through a float.
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

export function SkuForm({
  existing,
  onSaved,
  onCancel,
}: {
  existing?: InventorySku;
  onSaved: (s: InventorySku) => void;
  onCancel?: () => void;
}) {
  const { t } = useLanguage();

  const [sku, setSku] = useState(existing?.sku ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState<InventoryCategory>(existing?.category ?? "wall-panel");
  const [subcategory, setSubcategory] = useState(existing?.subcategory ?? "");
  const [uom, setUom] = useState<Uom>(existing?.uom ?? "each");
  const [cost, setCost] = useState(centsToDollars(existing?.defaultCostCents ?? null));
  const [weight, setWeight] = useState(existing?.defaultShipWeightG != null ? String(existing.defaultShipWeightG) : "");
  const [dimensions, setDimensions] = useState(existing?.dimensionsNote ?? "");
  const [isSample, setIsSample] = useState(existing?.isSample ?? false);
  const [active, setActive] = useState(existing?.active ?? true);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [contents, setContents] = useState<SampleKitItem[]>(existing?.sampleKitContents ?? []);

  const [allSkus, setAllSkus] = useState<InventorySku[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const showKitEditor = isSample && category === "sample-kit";

  // Kit children must themselves be sample SKUs, and kits do not nest.
  useEffect(() => {
    if (!showKitEditor) return;
    listSkus()
      .then(setAllSkus)
      .catch(() => setAllSkus([]));
  }, [showKitEditor]);

  const childOptions = useMemo(
    () => allSkus.filter((s) => canBeKitChild(s) && s.id !== existing?.id),
    [allSkus, existing?.id],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !name.trim()) {
      setError(t("inventory.errRequired"));
      return;
    }
    setError("");
    setBusy(true);
    const input: InventorySkuInput = {
      id: existing?.id,
      sku,
      name,
      category,
      subcategory,
      uom,
      defaultCostCents: dollarsToCents(cost),
      defaultShipWeightG: toIntOrNull(weight),
      dimensionsNote: dimensions,
      isSample,
      // Contents are meaningful for kits only — clear them if the SKU stops being one, so a
      // recategorised SKU cannot carry a stale parts list.
      sampleKitContents: showKitEditor ? contents.filter((c) => c.skuId) : null,
      active,
      notes,
    };
    try {
      const saved = await saveSku(input);
      onSaved(saved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // 23505 = unique_violation on inventory_skus.sku
      setError(/duplicate key|23505/i.test(msg) ? t("inventory.errDuplicateSku") : t("inventory.errSave"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("inventory.fieldSku")} required hint={t("inventory.hintSku")}>
          <input value={sku} onChange={(e) => setSku(e.target.value)} className={INPUT} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label={t("inventory.fieldName")} required>
          <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("inventory.fieldCategory")} required>
          <select value={category} onChange={(e) => setCategory(e.target.value as InventoryCategory)} className={SELECT}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(t, c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("inventory.fieldSubcategory")} hint={t("inventory.hintSubcategory")}>
          <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("inventory.fieldUom")}>
          <select value={uom} onChange={(e) => setUom(e.target.value as Uom)} className={SELECT}>
            {UOMS.map((u) => (
              <option key={u} value={u}>
                {uomLabel(t, u)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("inventory.fieldDimensions")} hint={t("inventory.hintDimensions")}>
          <input value={dimensions} onChange={(e) => setDimensions(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("inventory.fieldCost")} hint={t("inventory.hintCost")}>
          <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className={INPUT} placeholder="0.00" />
        </Field>
        <Field label={t("inventory.fieldWeight")}>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" className={INPUT} />
        </Field>
      </div>

      <Field label={t("inventory.fieldNotes")}>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={INPUT} />
      </Field>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={isSample} onChange={(e) => setIsSample(e.target.checked)} className="accent-accent" />
          {t("inventory.fieldIsSample")}
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-accent" />
          {t("inventory.fieldActive")}
        </label>
      </div>

      {showKitEditor && (
        <div className="rounded-xl border border-line bg-paper/50 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("inventory.kitContents")}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{t("inventory.kitContentsHint")}</p>

          {childOptions.length === 0 ? (
            <div className="mt-3">
              <WarnBanner>{t("inventory.kitNoChildren")}</WarnBanner>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {contents.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={c.skuId}
                    onChange={(e) =>
                      setContents((cur) => cur.map((x, j) => (j === i ? { ...x, skuId: e.target.value } : x)))
                    }
                    className={SELECT + " mt-0 flex-1"}
                  >
                    <option value="">{t("inventory.kitPickSku")}</option>
                    {childOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.sku} — {o.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={String(c.qty)}
                    onChange={(e) =>
                      setContents((cur) =>
                        cur.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)),
                      )
                    }
                    inputMode="numeric"
                    className={INPUT + " mt-0 w-20 text-center"}
                    aria-label={t("inventory.kitQty")}
                  />
                  <button
                    type="button"
                    onClick={() => setContents((cur) => cur.filter((_, j) => j !== i))}
                    className="rounded-md p-2 text-muted transition hover:text-amber"
                    aria-label={t("inventory.remove")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setContents((cur) => [...cur, { skuId: "", qty: 1 }])}
                className={BTN_GHOST + " mt-1"}
              >
                <Plus className="h-4 w-4" /> {t("inventory.kitAddItem")}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <WarnBanner>{error}</WarnBanner>}

      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>
          {busy ? t("inventory.saving") : t("inventory.save")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={BTN_GHOST}>
            {t("inventory.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
