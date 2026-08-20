"use client";

// The contractor's full ledger, newest first, with CSV export. Optionally filtered to one
// item via ?partner=<id> or ?kitify=<id> — which is how a Kitify catalog row on the dashboard
// opens its history, since Kitify items have no editable detail page.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { InventoryTrackingGuard } from "@/components/InventoryTrackingGuard";
import { useToast, ToastView } from "@/components/Toast";
import { usePartnerInventory } from "@/components/inventory/PartnerStock";
import { PartnerMovementTable } from "@/components/inventory/PartnerMovementTable";
import { SourceBadge } from "@/components/inventory/PartnerSkuPicker";
import { BackLink, PageHeading, EmptyCard, BTN_GHOST } from "@/components/inventory/ui";
import {
  listPartnerMovements,
  countPartnerMovements,
  partnerMovementsToCsv,
  downloadCsv,
  type PartnerMovement,
  type SkuRef,
} from "@/lib/partner-inventory";

const PAGE_SIZE = 50;

export default function PartnerHistoryPage() {
  return (
    <InventoryTrackingGuard>
      <Suspense fallback={<EmptyCard>…</EmptyCard>}>
        <PartnerHistory />
      </Suspense>
    </InventoryTrackingGuard>
  );
}

function PartnerHistory() {
  const { t } = useLanguage();
  const { userId } = useAuth();
  const searchParams = useSearchParams();
  const { toast, showToast } = useToast();
  const data = usePartnerInventory(userId);

  const filterRef = useMemo<SkuRef | undefined>(() => {
    const partner = searchParams.get("partner");
    if (partner) return { source: "partner", id: partner };
    const kitify = searchParams.get("kitify");
    if (kitify) return { source: "kitify", id: kitify };
    return undefined;
  }, [searchParams]);

  const [movements, setMovements] = useState<PartnerMovement[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [filterRef]);

  const load = useCallback(() => {
    if (!userId) return;
    Promise.all([
      listPartnerMovements({ ownerId: userId, ref: filterRef, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      countPartnerMovements(userId, filterRef),
    ])
      .then(([mv, c]) => {
        setMovements(mv);
        setCount(c);
      })
      .catch(() => setMovements([]));
  }, [userId, filterRef, page]);
  useEffect(() => {
    load();
  }, [load]);

  const labelFor = useCallback(
    (ref: SkuRef) => {
      const l = data.labelFor(ref);
      return { sku: l.sku, name: l.name };
    },
    [data],
  );

  async function exportCsv() {
    if (!userId) return;
    const all = await listPartnerMovements({ ownerId: userId, ref: filterRef });
    const name = filterRef ? `${labelFor(filterRef).sku}-movements.csv` : "my-inventory-movements.csv";
    downloadCsv(name, partnerMovementsToCsv(all, labelFor));
    showToast(t("partnerInv.exported"));
  }

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const filterLabel = filterRef ? labelFor(filterRef) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <ToastView toast={toast} />

      <div className="mb-4">
        <BackLink href="/portal/inventory" label={t("partnerInv.backToInventory")} />
      </div>
      <PageHeading
        eyebrow={t("partnerInv.history")}
        sub={t("partnerInv.historySub")}
        right={
          <button type="button" onClick={exportCsv} disabled={count === 0} className={BTN_GHOST}>
            <Download className="h-4 w-4" /> {t("partnerInv.exportCsv")}
          </button>
        }
      />

      {filterRef && filterLabel && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm">
          <SourceBadge source={filterRef.source} />
          <span className="font-mono text-[12px] text-ink">{filterLabel.sku}</span>
          <span className="text-muted">— {filterLabel.name}</span>
          <a href="/portal/inventory/history" className="ml-auto text-xs text-muted transition hover:text-accent">
            {t("partnerInv.clearFilter")}
          </a>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-card p-5">
        {data.loading ? (
          <p className="text-sm text-muted">{t("partnerInv.loading")}</p>
        ) : movements.length === 0 ? (
          <p className="text-sm text-muted">{t("partnerInv.noMovements")}</p>
        ) : (
          <>
            <PartnerMovementTable movements={movements} labelFor={labelFor} />
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
      </div>
    </div>
  );
}
