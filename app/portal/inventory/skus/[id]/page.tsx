"use client";

// A contractor's own SKU: editable record, their stock across locations, and this item's
// ledger with CSV export.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Download, Check, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { InventoryTrackingGuard } from "@/components/InventoryTrackingGuard";
import { useToast, ToastView } from "@/components/Toast";
import { PartnerSkuForm } from "@/components/inventory/PartnerSkuForm";
import { PartnerMovementTable } from "@/components/inventory/PartnerMovementTable";
import {
  getPartnerSku,
  listPartnerStockForRef,
  listPartnerMovements,
  countPartnerMovements,
  setPartnerReorderThreshold,
  partnerMovementsToCsv,
  isPartnerLowStock,
  downloadCsv,
  type PartnerSku,
  type PartnerStockRow,
  type PartnerMovement,
  type SkuRef,
} from "@/lib/partner-inventory";
import {
  Badge,
  BackLink,
  EmptyCard,
  categoryLabel,
  fmtDateTime,
  INPUT,
  BTN_GHOST,
} from "@/components/inventory/ui";

const PAGE_SIZE = 50;

export default function PartnerSkuDetailPage() {
  return (
    <InventoryTrackingGuard>
      <PartnerSkuDetail />
    </InventoryTrackingGuard>
  );
}

function PartnerSkuDetail() {
  const { t } = useLanguage();
  const { userId } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast, showToast } = useToast();

  const [sku, setSku] = useState<PartnerSku | null | undefined>(undefined);
  const [stock, setStock] = useState<PartnerStockRow[]>([]);
  const [movements, setMovements] = useState<PartnerMovement[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);

  const ref = useMemo<SkuRef>(() => ({ source: "partner", id: params.id }), [params.id]);

  const loadCore = useCallback(async () => {
    if (!userId) return;
    const [s, st, c] = await Promise.all([
      getPartnerSku(params.id),
      listPartnerStockForRef(userId, ref),
      countPartnerMovements(userId, ref),
    ]);
    setSku(s);
    setStock(st);
    setCount(c);
  }, [userId, params.id, ref]);

  useEffect(() => {
    loadCore().catch(() => setSku(null));
  }, [loadCore]);

  useEffect(() => {
    if (!userId) return;
    listPartnerMovements({ ownerId: userId, ref, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then(setMovements)
      .catch(() => setMovements([]));
  }, [userId, ref, page]);

  const totalOnHand = useMemo(() => stock.reduce((a, r) => a + r.quantity, 0), [stock]);

  const labelFor = useCallback(
    () => ({ sku: sku?.sku ?? "—", name: sku?.name ?? "" }),
    [sku],
  );

  async function exportCsv() {
    if (!userId || !sku) return;
    const all = await listPartnerMovements({ ownerId: userId, ref });
    downloadCsv(`${sku.sku}-movements.csv`, partnerMovementsToCsv(all, labelFor));
    showToast(t("partnerInv.exported"));
  }

  if (sku === undefined) return <EmptyCard>{t("partnerInv.loading")}</EmptyCard>;
  if (sku === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink href="/portal/inventory/skus" label={t("partnerInv.backToSkus")} />
        <div className="mt-4">
          <EmptyCard>{t("partnerInv.notFound")}</EmptyCard>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-4xl">
      <ToastView toast={toast} />

      <div className="mb-4">
        <BackLink href="/portal/inventory/skus" label={t("partnerInv.backToSkus")} />
      </div>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[12px] text-muted">{sku.sku}</div>
          <h1 className="mt-0.5 font-display text-2xl font-bold tracking-tight text-ink">{sku.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="accent">{categoryLabel(t, sku.category)}</Badge>
            {sku.subcategory && <Badge tone="muted">{sku.subcategory}</Badge>}
            {!sku.active && <Badge tone="muted">{t("partnerInv.inactive")}</Badge>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-3xl font-bold tracking-tight text-ink">{totalOnHand}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
            {t("partnerInv.onHandTotal")}
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {t("partnerInv.record")}
        </div>
        {userId && (
          <PartnerSkuForm
            key={sku.updatedAt}
            ownerId={userId}
            existing={sku}
            onSaved={(s) => {
              setSku(s);
              showToast(t("partnerInv.saved"));
            }}
          />
        )}
      </section>

      <section className="mt-5 rounded-2xl border border-line bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {t("partnerInv.byLocation")}
          </div>
          <button
            type="button"
            onClick={() => router.push(`/portal/inventory/movement/new?partner=${sku.id}`)}
            className={BTN_GHOST}
          >
            {t("partnerInv.addStock")}
          </button>
        </div>

        {stock.length === 0 ? (
          <p className="text-sm text-muted">{t("partnerInv.noStockRows")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  <th className="px-2 py-2">{t("partnerInv.colLocation")}</th>
                  <th className="px-2 py-2 text-right">{t("partnerInv.colQuantity")}</th>
                  <th className="px-2 py-2 text-right">{t("partnerInv.colThreshold")}</th>
                  <th className="px-2 py-2 text-right">{t("partnerInv.colUpdated")}</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((row) => (
                  <tr key={row.id} className="border-b border-line/60 last:border-0">
                    <td className="px-2 py-2.5 text-ink">{row.location}</td>
                    <td className="px-2 py-2.5 text-right">
                      <span className="font-display font-bold text-ink">{row.quantity}</span>
                      {isPartnerLowStock(row) && (
                        <span className="ml-2 align-middle">
                          <Badge tone="amber">{t("partnerInv.low")}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <ThresholdCell
                        row={row}
                        onSaved={(v) => {
                          setStock((cur) => cur.map((r) => (r.id === row.id ? { ...r, reorderThreshold: v } : r)));
                          showToast(t("partnerInv.saved"));
                        }}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-right text-muted">{fmtDateTime(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-5 rounded-2xl border border-line bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {t("partnerInv.history")} <span className="ml-1 normal-case tracking-normal">({count})</span>
          </div>
          <button type="button" onClick={exportCsv} disabled={count === 0} className={BTN_GHOST}>
            <Download className="h-4 w-4" /> {t("partnerInv.exportCsv")}
          </button>
        </div>

        {movements.length === 0 ? (
          <p className="text-sm text-muted">{t("partnerInv.noMovements")}</p>
        ) : (
          <>
            <PartnerMovementTable movements={movements} labelFor={labelFor} showItem={false} />
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-sm text-muted">
                <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className={BTN_GHOST}>
                  {t("partnerInv.prev")}
                </button>
                <span>{t("partnerInv.pageOf", { page: String(page + 1), total: String(totalPages) })}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className={BTN_GHOST}
                >
                  {t("partnerInv.next")}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function ThresholdCell({ row, onSaved }: { row: PartnerStockRow; onSaved: (v: number | null) => void }) {
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
      await setPartnerReorderThreshold(row.id, n);
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
        title={t("partnerInv.thresholdHint")}
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
