"use client";

// Receive / adjust / ship — the one form behind every stock change.
//
// Two modes share the same submit path (applyMovements → the apply_inventory_movements RPC,
// one transaction for the whole batch):
//   • Movement   — one row, or many rows for a bulk receive / multi-item shipment. One
//                  reason, location, reference and note across the batch; SKU + qty per row.
//   • Sample kit — pick a kit, confirm which pieces go in the box, and the form expands to
//                  one sample_sent movement per included piece under a shared reference.
//
// The admin always types a POSITIVE quantity; the reason decides the sign, and it decides it
// in the database (see the RPC), not here. 'adjustment' is the one bidirectional reason, so
// it — and only it — accepts a signed number.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import { SkuPicker } from "@/components/inventory/SkuPicker";
import {
  listSkus,
  listStock,
  listLocations,
  applyMovements,
  isSampleKit,
  canBeKitChild,
  NegativeStockError,
  MOVEMENT_REASONS,
  REASON_SIGN,
  type InventorySku,
  type StockRow,
  type InventoryLocation,
  type MovementReason,
  type MovementInput,
} from "@/lib/inventory";
import {
  Field,
  BackLink,
  PageHeading,
  WarnBanner,
  EmptyCard,
  reasonLabel,
  INPUT,
  SELECT,
  BTN_PRIMARY,
  BTN_GHOST,
} from "@/components/inventory/ui";

type Row = { skuId: string; qty: string };
type Mode = "movement" | "kit";

export default function NewMovementPage() {
  return (
    <AdminGuard>
      <Suspense fallback={<EmptyCard>…</EmptyCard>}>
        <NewMovement />
      </Suspense>
    </AdminGuard>
  );
}

function NewMovement() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillSku = searchParams.get("sku") ?? "";

  const [skus, setSkus] = useState<InventorySku[] | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);

  const [mode, setMode] = useState<Mode>("movement");
  const [reason, setReason] = useState<MovementReason>("received");
  const [locationId, setLocationId] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([{ skuId: prefillSku, qty: "" }]);

  const [kitId, setKitId] = useState("");
  const [kitRows, setKitRows] = useState<Row[]>([]);
  const [kitTouched, setKitTouched] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([listSkus(), listStock(), listLocations()])
      .then(([sk, st, lo]) => {
        setSkus(sk);
        setStock(st);
        setLocations(lo);
        const active = lo.filter((l) => l.active);
        setLocationId((cur) => cur || active[0]?.id || lo[0]?.id || "");
      })
      .catch((e: unknown) => {
        setSkus([]);
        setError(e instanceof Error ? e.message : t("inventory.errLoad"));
      });
  }, [t]);

  const activeLocations = useMemo(() => locations.filter((l) => l.active), [locations]);
  const kits = useMemo(() => (skus ?? []).filter((s) => s.active && isSampleKit(s)), [skus]);
  const selectedKit = useMemo(() => kits.find((k) => k.id === kitId) ?? null, [kits, kitId]);

  // Selecting a kit seeds the row list from its declared contents — a default the admin can
  // edit, because what actually goes in the box is not always what the kit declares.
  useEffect(() => {
    if (!selectedKit) return;
    setKitRows((selectedKit.sampleKitContents ?? []).map((c) => ({ skuId: c.skuId, qty: String(c.qty) })));
    setKitTouched(false);
  }, [selectedKit]);

  const activeRows = mode === "kit" ? kitRows : rows;
  const setActiveRows = mode === "kit" ? setKitRows : setRows;
  const effectiveReason: MovementReason = mode === "kit" ? "sample_sent" : reason;
  const sign = REASON_SIGN[effectiveReason];

  const onHandAt = useCallback(
    (skuId: string) => stock.find((s) => s.skuId === skuId && s.locationId === locationId)?.quantity ?? 0,
    [stock, locationId],
  );
  const thresholdAt = useCallback(
    (skuId: string) => stock.find((s) => s.skuId === skuId && s.locationId === locationId)?.reorderThreshold ?? null,
    [stock, locationId],
  );
  const skuCode = useCallback((id: string) => (skus ?? []).find((s) => s.id === id)?.sku ?? id, [skus]);

  // Project the whole batch, not each row in isolation: two rows for the same SKU at the
  // same location must be checked against their combined effect, or shipping 3 + 3 out of 5
  // would look fine twice and then fail in the transaction.
  const projections = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of activeRows) {
      if (!r.skuId) continue;
      const n = Math.trunc(Number(r.qty)) || 0;
      if (n === 0) continue;
      const delta = sign === 0 ? n : sign * Math.abs(n);
      totals.set(r.skuId, (totals.get(r.skuId) ?? 0) + delta);
    }
    return Array.from(totals.entries()).map(([skuId, delta]) => {
      const from = onHandAt(skuId);
      const threshold = thresholdAt(skuId);
      const to = from + delta;
      return {
        skuId,
        from,
        to,
        delta,
        negative: to < 0,
        crossesThreshold: threshold !== null && to <= threshold && from > threshold,
        threshold,
      };
    });
  }, [activeRows, sign, onHandAt, thresholdAt]);

  const blocking = projections.filter((p) => p.negative);
  const warnings = projections.filter((p) => !p.negative && p.crossesThreshold);

  const filledRows = activeRows.filter((r) => r.skuId && (Math.trunc(Number(r.qty)) || 0) !== 0);
  const canSubmit = !!locationId && filledRows.length > 0 && blocking.length === 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setBusy(true);
    const batch: MovementInput[] = filledRows.map((r) => ({
      skuId: r.skuId,
      locationId,
      reason: effectiveReason,
      qty: Math.trunc(Number(r.qty)),
      reference: reference || null,
      note: note || null,
    }));
    try {
      await applyMovements(batch);
      router.push("/portal/admin/inventory");
    } catch (err) {
      setError(err instanceof NegativeStockError ? t("inventory.errNegative") : t("inventory.errSave"));
      setBusy(false);
    }
  }

  if (skus === null) return <EmptyCard>{t("inventory.loading")}</EmptyCard>;

  const refLabel = t(`inventory.refLabel.${effectiveReason}`);
  const qtyLabel = sign === 0 ? t("inventory.fieldSignedQty") : t(`inventory.qtyLabel.${effectiveReason}`);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <BackLink href="/portal/admin/inventory" label={t("inventory.backToInventory")} />
      </div>
      <PageHeading eyebrow={t("inventory.newMovement")} sub={t("inventory.newMovementSub")} />

      {/* Mode */}
      <div className="mb-4 flex gap-2">
        {(["movement", "kit"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              mode === m ? "bg-ink text-white" : "border border-line text-muted hover:border-accent hover:text-accent"
            }`}
          >
            {m === "movement" ? t("inventory.tabMovement") : t("inventory.tabSampleKit")}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-card p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {mode === "movement" ? (
            <Field label={t("inventory.fieldReason")} required>
              <select value={reason} onChange={(e) => setReason(e.target.value as MovementReason)} className={SELECT}>
                {MOVEMENT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {reasonLabel(t, r)}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label={t("inventory.fieldKit")} required>
              <select value={kitId} onChange={(e) => setKitId(e.target.value)} className={SELECT}>
                <option value="">{t("inventory.pickKit")}</option>
                {kits.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.sku} — {k.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label={t("inventory.fieldLocation")} required>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={SELECT}>
              {activeLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={refLabel}>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={INPUT} />
          </Field>
          <Field label={t("inventory.fieldNote")}>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
          </Field>
        </div>

        {mode === "kit" && !selectedKit ? (
          <p className="text-sm text-muted">
            {kits.length === 0 ? t("inventory.noKits") : t("inventory.pickKitFirst")}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {mode === "kit" ? t("inventory.kitItems") : t("inventory.items")}
            </div>
            {mode === "kit" && selectedKit && !kitTouched && kitRows.length > 0 && (
              <p className="text-[11px] leading-relaxed text-muted">{t("inventory.kitDefaultsHint")}</p>
            )}

            {activeRows.map((row, i) => {
              const proj = projections.find((p) => p.skuId === row.skuId);
              return (
                <div key={i} className="rounded-xl border border-line bg-paper/40 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <SkuPicker
                        skus={mode === "kit" ? (skus ?? []).filter(canBeKitChild) : skus ?? []}
                        value={row.skuId}
                        onChange={(id) => {
                          setActiveRows((cur) => cur.map((r, j) => (j === i ? { ...r, skuId: id } : r)));
                          if (mode === "kit") setKitTouched(true);
                        }}
                      />
                    </div>
                    <input
                      value={row.qty}
                      onChange={(e) => {
                        setActiveRows((cur) => cur.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)));
                        if (mode === "kit") setKitTouched(true);
                      }}
                      inputMode="numeric"
                      placeholder={qtyLabel}
                      aria-label={qtyLabel}
                      className={INPUT + " mt-0 w-24 shrink-0 text-center"}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setActiveRows((cur) => (cur.length === 1 ? [{ skuId: "", qty: "" }] : cur.filter((_, j) => j !== i)));
                        if (mode === "kit") setKitTouched(true);
                      }}
                      aria-label={t("inventory.remove")}
                      className="mt-1 shrink-0 rounded-md p-2 text-muted transition hover:text-amber"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {row.skuId && proj && (
                    <div className="mt-1.5 pl-1 text-[11px] text-muted">
                      {t("inventory.projected", { from: String(proj.from), to: String(proj.to) })}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => {
                setActiveRows((cur) => [...cur, { skuId: "", qty: "" }]);
                if (mode === "kit") setKitTouched(true);
              }}
              className={BTN_GHOST}
            >
              <Plus className="h-4 w-4" /> {t("inventory.addRow")}
            </button>
            <p className="text-[11px] leading-relaxed text-muted">{t("inventory.atomicHint")}</p>
          </div>
        )}

        {/* Hard block — the only one in the system. */}
        {blocking.length > 0 && (
          <WarnBanner>
            {t("inventory.errNegativeRows", {
              skus: blocking.map((b) => `${skuCode(b.skuId)} (${b.from})`).join(", "),
            })}
          </WarnBanner>
        )}

        {/* Warn, don't block. */}
        {warnings.length > 0 && (
          <WarnBanner>
            {t("inventory.warnThresholdRows", {
              skus: warnings.map((w) => `${skuCode(w.skuId)} → ${w.to} ≤ ${w.threshold}`).join(", "),
            })}
          </WarnBanner>
        )}

        {error && <WarnBanner>{error}</WarnBanner>}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={!canSubmit} className={BTN_PRIMARY}>
            {busy
              ? t("inventory.applying")
              : t("inventory.applyN", { n: String(filledRows.length) })}
          </button>
          <button type="button" onClick={() => router.push("/portal/admin/inventory")} className={BTN_GHOST}>
            {t("inventory.cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
