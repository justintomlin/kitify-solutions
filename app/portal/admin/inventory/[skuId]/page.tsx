"use client";

// SKU detail — the editable record, per-location stock with inline adjust / move, and the
// movement history that IS this SKU's historical record (CSV-exportable, all time).
//
// Phase 3+ hook: cross-SKU historical reporting UI is deliberately out of scope for v1.
// inventory_movements holds the complete history; admins pull custom cuts in the Supabase
// SQL editor until that UI is built.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Download, X, ArrowLeftRight, SlidersHorizontal, Check } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import { useToast, ToastView } from "@/components/Toast";
import { SkuForm } from "@/components/inventory/SkuForm";
import {
  getSku,
  listSkus,
  listStock,
  listStockForSku,
  listLocations,
  listMovements,
  countMovementsForSku,
  lastMovementByLocation,
  setReorderThreshold,
  applyMovements,
  moveBetweenLocations,
  movementsToCsv,
  downloadCsv,
  isLowStock,
  isSampleKit,
  kitBuildable,
  onHandBySku,
  NegativeStockError,
  MOVEMENT_REASONS,
  REASON_SIGN,
  type InventorySku,
  type StockRow,
  type InventoryLocation,
  type Movement,
  type MovementReason,
} from "@/lib/inventory";
import {
  Badge,
  EmptyCard,
  Field,
  BackLink,
  WarnBanner,
  categoryLabel,
  reasonLabel,
  fmtDateTime,
  INPUT,
  SELECT,
  BTN_PRIMARY,
  BTN_GHOST,
} from "@/components/inventory/ui";

const PAGE_SIZE = 50;

export default function SkuDetailPage() {
  return (
    <AdminGuard>
      <SkuDetail />
    </AdminGuard>
  );
}

function SkuDetail() {
  const { t } = useLanguage();
  const router = useRouter();
  const params = useParams<{ skuId: string }>();
  const skuId = params.skuId;
  const { toast, showToast } = useToast();

  const [sku, setSku] = useState<InventorySku | null | undefined>(undefined); // undefined = loading
  const [stock, setStock] = useState<StockRow[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [lastMoved, setLastMoved] = useState<Map<string, string>>(new Map());
  const [movements, setMovements] = useState<Movement[]>([]);
  const [movementCount, setMovementCount] = useState(0);
  const [page, setPage] = useState(0);

  // Only loaded for kits, to show how many complete kits the child stock could build.
  const [allSkus, setAllSkus] = useState<InventorySku[]>([]);
  const [allOnHand, setAllOnHand] = useState<Map<string, number>>(new Map());

  const [adjustFor, setAdjustFor] = useState<StockRow | null>(null);
  const [moveFor, setMoveFor] = useState<StockRow | null>(null);

  const locationName = useCallback(
    (id: string) => locations.find((l) => l.id === id)?.name ?? id,
    [locations],
  );

  const loadCore = useCallback(async () => {
    const [s, st, lo, count] = await Promise.all([
      getSku(skuId),
      listStockForSku(skuId),
      listLocations(),
      countMovementsForSku(skuId),
    ]);
    setSku(s);
    setStock(st);
    setLocations(lo);
    setMovementCount(count);
    setLastMoved(await lastMovementByLocation(skuId, st.map((r) => r.locationId)));
  }, [skuId]);

  useEffect(() => {
    loadCore().catch(() => setSku(null));
  }, [loadCore]);

  useEffect(() => {
    listMovements({ skuId, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setMovements)
      .catch(() => setMovements([]));
  }, [skuId, page]);

  // Kit build math needs every sample SKU's on-hand, not just this one's.
  useEffect(() => {
    if (!sku || !isSampleKit(sku)) return;
    Promise.all([listSkus(), listStock()])
      .then(([all, everyStockRow]) => {
        setAllSkus(all);
        setAllOnHand(onHandBySku(everyStockRow));
      })
      .catch(() => {});
  }, [sku]);

  const refresh = useCallback(() => {
    loadCore().catch(() => {});
    listMovements({ skuId, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setMovements)
      .catch(() => {});
  }, [loadCore, skuId, page]);

  const totalOnHand = useMemo(() => stock.reduce((a, r) => a + r.quantity, 0), [stock]);
  const anyLow = useMemo(() => stock.some(isLowStock), [stock]);

  async function exportCsv() {
    if (!sku) return;
    const all = await listMovements({ skuId });
    const names = new Map(locations.map((l) => [l.id, l.name]));
    downloadCsv(`${sku.sku}-movements.csv`, movementsToCsv(all, names, sku.sku));
    showToast(t("inventory.exported"));
  }

  if (sku === undefined) return <EmptyCard>{t("inventory.loading")}</EmptyCard>;
  if (sku === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink href="/portal/admin/inventory" label={t("inventory.backToInventory")} />
        <div className="mt-4">
          <EmptyCard>{t("inventory.notFound")}</EmptyCard>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(movementCount / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-4xl">
      <ToastView toast={toast} />

      <div className="mb-4">
        <BackLink href="/portal/admin/inventory" label={t("inventory.backToInventory")} />
      </div>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[12px] text-muted">{sku.sku}</div>
          <h1 className="mt-0.5 font-display text-2xl font-bold tracking-tight text-ink">{sku.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="accent">{categoryLabel(t, sku.category)}</Badge>
            {sku.subcategory && <Badge tone="muted">{sku.subcategory}</Badge>}
            {sku.isSample && <Badge tone="muted">{t("inventory.sample")}</Badge>}
            {!sku.active && <Badge tone="muted">{t("inventory.inactive")}</Badge>}
            {anyLow && <Badge tone="amber">{t("inventory.low")}</Badge>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-3xl font-bold tracking-tight text-ink">{totalOnHand}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t("inventory.onHandTotal")}</div>
          {isSampleKit(sku) && allSkus.length > 0 && (
            <div className="mt-1 text-[11px] text-muted">
              {t("inventory.kitBuildable", { n: String(kitBuildable(sku, allOnHand)) })}
            </div>
          )}
        </div>
      </div>

      {/* Editable record */}
      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("inventory.record")}</div>
        <SkuForm
          key={sku.updatedAt}
          existing={sku}
          onSaved={(s) => {
            setSku(s);
            showToast(t("inventory.saved"));
          }}
        />
      </section>

      {/* Per-location stock */}
      <section className="mt-5 rounded-2xl border border-line bg-card p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("inventory.byLocation")}</div>
          <button
            type="button"
            onClick={() => router.push(`/portal/admin/inventory/movement/new?sku=${sku.id}`)}
            className={BTN_GHOST}
          >
            {t("inventory.newMovement")}
          </button>
        </div>

        {stock.length === 0 ? (
          <p className="text-sm text-muted">{t("inventory.noStockRows")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  <th className="px-2 py-2">{t("inventory.colLocation")}</th>
                  <th className="px-2 py-2 text-right">{t("inventory.colQuantity")}</th>
                  <th className="px-2 py-2 text-right">{t("inventory.colThreshold")}</th>
                  <th className="px-2 py-2 text-right">{t("inventory.colLastMovement")}</th>
                  <th className="px-2 py-2 text-right">{t("inventory.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((row) => (
                  <tr key={row.id} className="border-b border-line/60 last:border-0">
                    <td className="px-2 py-2.5 text-ink">{locationName(row.locationId)}</td>
                    <td className="px-2 py-2.5 text-right">
                      <span className="font-display font-bold text-ink">{row.quantity}</span>
                      {isLowStock(row) && (
                        <span className="ml-2 align-middle">
                          <Badge tone="amber">{t("inventory.low")}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <ThresholdCell
                        row={row}
                        onSaved={(v) => {
                          setStock((cur) => cur.map((r) => (r.id === row.id ? { ...r, reorderThreshold: v } : r)));
                          showToast(t("inventory.saved"));
                        }}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-right text-muted">{fmtDateTime(lastMoved.get(row.locationId))}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setAdjustFor(row)}
                          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
                        >
                          <SlidersHorizontal className="h-3 w-3" /> {t("inventory.adjust")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setMoveFor(row)}
                          disabled={locations.filter((l) => l.active).length < 2}
                          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ArrowLeftRight className="h-3 w-3" /> {t("inventory.move")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Movement history */}
      <section className="mt-5 rounded-2xl border border-line bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {t("inventory.history")}{" "}
            <span className="ml-1 normal-case tracking-normal">({movementCount})</span>
          </div>
          <button type="button" onClick={exportCsv} disabled={movementCount === 0} className={BTN_GHOST}>
            <Download className="h-4 w-4" /> {t("inventory.exportCsv")}
          </button>
        </div>

        {movements.length === 0 ? (
          <p className="text-sm text-muted">{t("inventory.noMovements")}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                    <th className="px-2 py-2">{t("inventory.colWhen")}</th>
                    <th className="px-2 py-2">{t("inventory.colReason")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.colDelta")}</th>
                    <th className="px-2 py-2">{t("inventory.colLocation")}</th>
                    <th className="px-2 py-2">{t("inventory.colReference")}</th>
                    <th className="px-2 py-2">{t("inventory.colNote")}</th>
                    <th className="px-2 py-2">{t("inventory.colBy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-b border-line/60 last:border-0">
                      <td className="whitespace-nowrap px-2 py-2.5 text-muted">{fmtDateTime(m.performedAt)}</td>
                      <td className="px-2 py-2.5 text-ink">{reasonLabel(t, m.reason)}</td>
                      <td
                        className={`px-2 py-2.5 text-right font-display font-bold ${
                          m.delta > 0 ? "text-success" : "text-amber"
                        }`}
                      >
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </td>
                      <td className="px-2 py-2.5 text-muted">{locationName(m.locationId)}</td>
                      <td className="px-2 py-2.5 text-muted">{m.reference ?? "—"}</td>
                      <td className="px-2 py-2.5 text-muted">{m.note ?? "—"}</td>
                      <td className="px-2 py-2.5 text-muted">{m.performedByName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-sm text-muted">
                <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className={BTN_GHOST}>
                  {t("inventory.prev")}
                </button>
                <span>{t("inventory.pageOf", { page: String(page + 1), total: String(totalPages) })}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className={BTN_GHOST}
                >
                  {t("inventory.next")}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {adjustFor && (
        <AdjustModal
          skuId={sku.id}
          row={adjustFor}
          locationName={locationName(adjustFor.locationId)}
          onClose={() => setAdjustFor(null)}
          onDone={() => {
            setAdjustFor(null);
            refresh();
            showToast(t("inventory.movementApplied"));
          }}
        />
      )}

      {moveFor && (
        <MoveModal
          skuId={sku.id}
          row={moveFor}
          locations={locations.filter((l) => l.active)}
          locationName={locationName}
          onClose={() => setMoveFor(null)}
          onDone={() => {
            setMoveFor(null);
            refresh();
            showToast(t("inventory.movementApplied"));
          }}
        />
      )}
    </div>
  );
}

// Inline reorder-threshold editor. Blank clears the threshold (no low-stock alerting).
function ThresholdCell({ row, onSaved }: { row: StockRow; onSaved: (v: number | null) => void }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.reorderThreshold != null ? String(row.reorderThreshold) : "");
  const [busy, setBusy] = useState(false);

  async function save() {
    const trimmed = value.trim();
    const n = trimmed === "" ? null : Math.max(0, Math.floor(Number(trimmed)));
    if (trimmed !== "" && !Number.isFinite(n)) return;
    setBusy(true);
    try {
      await setReorderThreshold(row.skuId, row.locationId, n);
      onSaved(n);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-md px-2 py-0.5 text-muted transition hover:text-accent"
        title={t("inventory.thresholdHint")}
      >
        {row.reorderThreshold ?? "—"}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="numeric"
        autoFocus
        className={INPUT + " mt-0 w-16 py-1 text-center"}
      />
      <button type="button" onClick={save} disabled={busy} className="rounded-md p-1 text-accent transition hover:brightness-110">
        <Check className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => setEditing(false)} className="rounded-md p-1 text-muted transition hover:text-ink">
        <X className="h-4 w-4" />
      </button>
    </span>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/60 p-4 sm:items-center">
      <div className="my-auto w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted transition hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AdjustModal({
  skuId,
  row,
  locationName,
  onClose,
  onDone,
}: {
  skuId: string;
  row: StockRow;
  locationName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<MovementReason>("adjustment");
  const [qty, setQty] = useState("1");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sign = REASON_SIGN[reason];
  const n = Math.trunc(Number(qty)) || 0;
  const effective = sign === 0 ? n : sign * Math.abs(n);
  const projected = row.quantity + effective;
  const crossesThreshold =
    row.reorderThreshold !== null && projected <= row.reorderThreshold && row.quantity > row.reorderThreshold;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (n === 0) {
      setError(t("inventory.errZeroQty"));
      return;
    }
    setError("");
    setBusy(true);
    try {
      await applyMovements([
        { skuId, locationId: row.locationId, reason, qty: sign === 0 ? n : Math.abs(n), reference, note },
      ]);
      onDone();
    } catch (err) {
      setError(err instanceof NegativeStockError ? t("inventory.errNegative") : t("inventory.errSave"));
      setBusy(false);
    }
  }

  return (
    <ModalShell title={t("inventory.adjustAt", { location: locationName })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t("inventory.fieldReason")}>
          <select value={reason} onChange={(e) => setReason(e.target.value as MovementReason)} className={SELECT}>
            {MOVEMENT_REASONS.map((r) => (
              <option key={r} value={r}>
                {reasonLabel(t, r)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={sign === 0 ? t("inventory.fieldSignedQty") : t("inventory.fieldQty")}
          hint={sign === 0 ? t("inventory.hintSignedQty") : undefined}
        >
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className={INPUT} />
        </Field>
        <Field label={t("inventory.fieldReference")}>
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("inventory.fieldNote")}>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
        </Field>

        <p className="text-sm text-muted">
          {t("inventory.projected", { from: String(row.quantity), to: String(projected) })}
        </p>
        {projected < 0 && <WarnBanner>{t("inventory.errNegative")}</WarnBanner>}
        {crossesThreshold && projected >= 0 && (
          <WarnBanner>{t("inventory.warnThreshold", { threshold: String(row.reorderThreshold) })}</WarnBanner>
        )}
        {error && <WarnBanner>{error}</WarnBanner>}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={busy} className={BTN_PRIMARY + " flex-1"}>
            {busy ? t("inventory.applying") : t("inventory.apply")}
          </button>
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            {t("inventory.cancel")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function MoveModal({
  skuId,
  row,
  locations,
  locationName,
  onClose,
  onDone,
}: {
  skuId: string;
  row: StockRow;
  locations: InventoryLocation[];
  locationName: (id: string) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const targets = locations.filter((l) => l.id !== row.locationId);
  const [to, setTo] = useState(targets[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const n = Math.abs(Math.trunc(Number(qty)) || 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!to || n === 0) {
      setError(t("inventory.errZeroQty"));
      return;
    }
    setError("");
    setBusy(true);
    try {
      await moveBetweenLocations({
        skuId,
        fromLocationId: row.locationId,
        toLocationId: to,
        qty: n,
        fromName: locationName(row.locationId),
        toName: locationName(to),
        note,
      });
      onDone();
    } catch (err) {
      setError(err instanceof NegativeStockError ? t("inventory.errNegative") : t("inventory.errSave"));
      setBusy(false);
    }
  }

  return (
    <ModalShell title={t("inventory.moveTitle")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">
          {t("inventory.moveFrom", { location: locationName(row.locationId), qty: String(row.quantity) })}
        </p>
        <Field label={t("inventory.fieldMoveTo")} required>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={SELECT}>
            {targets.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("inventory.fieldQty")}>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className={INPUT} />
        </Field>
        <Field label={t("inventory.fieldNote")}>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
        </Field>

        {n > row.quantity && <WarnBanner>{t("inventory.errNegative")}</WarnBanner>}
        {error && <WarnBanner>{error}</WarnBanner>}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={busy} className={BTN_PRIMARY + " flex-1"}>
            {busy ? t("inventory.applying") : t("inventory.move")}
          </button>
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            {t("inventory.cancel")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
