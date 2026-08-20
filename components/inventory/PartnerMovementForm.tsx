"use client";

// The partner movement form — one implementation, used by the contractor at
// /portal/inventory/movement/new and by an admin recording on a contractor's behalf from
// /portal/admin/inventory/partner/[ownerId].
//
// One reason, one location and one reference across the batch; SKU + quantity per row, so a
// single row is a single movement and several rows are a bulk receive or a multi-item job
// pull. All rows commit together or none do — the RPC is one transaction.
//
// The user always types a POSITIVE quantity; the reason decides the sign, and it decides it
// in the database. 'Adjustment' is the one bidirectional reason and accepts a signed number.

import { useCallback, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { PartnerSkuPicker } from "./PartnerSkuPicker";
import {
  applyPartnerMovements,
  partnerReasonSign,
  isPartnerLowStock,
  refKey,
  rowRef,
  PartnerNegativeStockError,
  PARTNER_REASONS,
  type PartnerSku,
  type KitifyCatalogSku,
  type PartnerStockRow,
  type PartnerMovementInput,
  type PartnerReasonChoice,
  type SkuRef,
} from "@/lib/partner-inventory";
import { Field, WarnBanner, INPUT, SELECT, BTN_PRIMARY, BTN_GHOST } from "./ui";

type Row = { ref: SkuRef | null; qty: string };

export function PartnerMovementForm({
  ownerId,
  skus,
  catalog,
  stock,
  labelFor,
  onDone,
  onCancel,
  initialRef,
}: {
  ownerId: string;
  skus: PartnerSku[];
  catalog: KitifyCatalogSku[];
  stock: PartnerStockRow[];
  labelFor: (ref: SkuRef) => { sku: string; name: string };
  onDone: () => void;
  onCancel?: () => void;
  initialRef?: SkuRef | null;
}) {
  const { t } = useLanguage();

  const [reason, setReason] = useState<PartnerReasonChoice>("received");
  const [location, setLocation] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([{ ref: initialRef ?? null, qty: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sign = partnerReasonSign(reason);

  // Locations the contractor has actually used, for the datalist. Free text stays free text —
  // this is a convenience, not a constraint.
  const knownLocations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of stock) {
      const k = s.location.trim().toLowerCase();
      if (!seen.has(k)) seen.set(k, s.location.trim());
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [stock]);

  const effectiveLocation = location.trim() || "Main";

  // The stock row for a ref at the location being typed — matched case-insensitively, the
  // same way the database folds "Truck" and "truck" into one place.
  const stockAt = useCallback(
    (ref: SkuRef) =>
      stock.find(
        (s) =>
          refKey(rowRef(s)) === refKey(ref) &&
          s.location.trim().toLowerCase() === effectiveLocation.toLowerCase(),
      ) ?? null,
    [stock, effectiveLocation],
  );

  // Project the batch as a whole: two rows for the same item at the same location must be
  // checked against their combined effect, or pulling 3 + 3 out of 5 passes twice and then
  // fails inside the transaction.
  const projections = useMemo(() => {
    const totals = new Map<string, { ref: SkuRef; delta: number }>();
    for (const r of rows) {
      if (!r.ref) continue;
      const n = Math.trunc(Number(r.qty)) || 0;
      if (n === 0) continue;
      const delta = sign === 0 ? n : sign * Math.abs(n);
      const k = refKey(r.ref);
      const cur = totals.get(k);
      totals.set(k, { ref: r.ref, delta: (cur?.delta ?? 0) + delta });
    }
    return Array.from(totals.values()).map(({ ref, delta }) => {
      const row = stockAt(ref);
      const from = row?.quantity ?? 0;
      const to = from + delta;
      const threshold = row?.reorderThreshold ?? null;
      return {
        ref,
        from,
        to,
        delta,
        negative: to < 0,
        crossesThreshold: threshold !== null && to <= threshold && from > threshold,
        threshold,
        alreadyLow: row ? isPartnerLowStock(row) : false,
      };
    });
  }, [rows, sign, stockAt]);

  const blocking = projections.filter((p) => p.negative);
  const warnings = projections.filter((p) => !p.negative && p.crossesThreshold);
  const filledRows = rows.filter((r) => r.ref && (Math.trunc(Number(r.qty)) || 0) !== 0);
  const canSubmit = filledRows.length > 0 && blocking.length === 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setBusy(true);
    const batch: PartnerMovementInput[] = filledRows.map((r) => ({
      ref: r.ref!,
      location: effectiveLocation,
      reason,
      qty: Math.trunc(Number(r.qty)),
      reference: reference || null,
      note: note || null,
    }));
    try {
      await applyPartnerMovements(ownerId, batch);
      onDone();
    } catch (err) {
      setError(err instanceof PartnerNegativeStockError ? t("partnerInv.errNegative") : t("partnerInv.errSave"));
      setBusy(false);
    }
  }

  const refLabel = t(`partnerInv.refLabel.${reason}`);
  const qtyLabel = sign === 0 ? t("partnerInv.fieldSignedQty") : t(`partnerInv.qtyLabel.${reason}`);

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("partnerInv.fieldReason")} required>
          <select value={reason} onChange={(e) => setReason(e.target.value as PartnerReasonChoice)} className={SELECT}>
            {PARTNER_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`partnerInv.reason.${r}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("partnerInv.fieldLocation")} hint={t("partnerInv.hintLocation")}>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            list="partner-inventory-locations"
            placeholder="Main"
            className={INPUT}
            autoComplete="off"
          />
          <datalist id="partner-inventory-locations">
            {knownLocations.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={refLabel}>
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("partnerInv.fieldNote")}>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("partnerInv.items")}</div>

        {rows.map((row, i) => {
          const proj = row.ref ? projections.find((p) => refKey(p.ref) === refKey(row.ref!)) : null;
          return (
            <div key={i} className="rounded-xl border border-line bg-paper/40 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <PartnerSkuPicker
                    mine={skus}
                    kitify={catalog}
                    value={row.ref}
                    onChange={(ref) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ref } : r)))}
                  />
                </div>
                <input
                  value={row.qty}
                  onChange={(e) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)))}
                  inputMode="numeric"
                  placeholder={qtyLabel}
                  aria-label={qtyLabel}
                  className={INPUT + " mt-0 w-24 shrink-0 text-center"}
                />
                <button
                  type="button"
                  onClick={() =>
                    setRows((cur) => (cur.length === 1 ? [{ ref: null, qty: "" }] : cur.filter((_, j) => j !== i)))
                  }
                  aria-label={t("partnerInv.remove")}
                  className="mt-1 shrink-0 rounded-md p-2 text-muted transition hover:text-amber"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {row.ref && proj && (
                <div className="mt-1.5 pl-1 text-[11px] text-muted">
                  {effectiveLocation} · {t("partnerInv.projected", { from: String(proj.from), to: String(proj.to) })}
                </div>
              )}
            </div>
          );
        })}

        <button type="button" onClick={() => setRows((cur) => [...cur, { ref: null, qty: "" }])} className={BTN_GHOST}>
          <Plus className="h-4 w-4" /> {t("partnerInv.addRow")}
        </button>
        <p className="text-[11px] leading-relaxed text-muted">{t("partnerInv.atomicHint")}</p>
      </div>

      {/* The one hard block. */}
      {blocking.length > 0 && (
        <WarnBanner>
          {t("partnerInv.errNegativeRows", {
            items: blocking.map((b) => `${labelFor(b.ref).sku} (${b.from})`).join(", "),
          })}
        </WarnBanner>
      )}

      {/* Warn, don't block. */}
      {warnings.length > 0 && (
        <WarnBanner>
          {t("partnerInv.warnThresholdRows", {
            items: warnings.map((w) => `${labelFor(w.ref).sku} → ${w.to} ≤ ${w.threshold}`).join(", "),
          })}
        </WarnBanner>
      )}

      {error && <WarnBanner>{error}</WarnBanner>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={!canSubmit} className={BTN_PRIMARY}>
          {busy ? t("partnerInv.applying") : t("partnerInv.applyN", { n: String(filledRows.length) })}
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
