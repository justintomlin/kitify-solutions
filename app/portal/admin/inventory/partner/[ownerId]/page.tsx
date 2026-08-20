"use client";

// Admin view of ONE contractor's inventory.
//
// Reads the same data through the same helpers the contractor uses, so what an admin sees is
// what the contractor sees. Admins can also record movements on the contractor's behalf —
// the RPC takes p_owner_id, and the audit row keeps performed_by = the admin's uuid, so the
// ledger stays attributable.
//
// This is a sibling of the Phase 1 Kitify screens, not a merge into them: /portal/admin/inventory
// still shows Kitify's own stock and nothing here alters it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import { useToast, ToastView } from "@/components/Toast";
import { usePartnerInventory, PartnerStockTable } from "@/components/inventory/PartnerStock";
import { PartnerMovementForm } from "@/components/inventory/PartnerMovementForm";
import { PartnerMovementTable } from "@/components/inventory/PartnerMovementTable";
import {
  Badge,
  BackLink,
  StatCard,
  EmptyCard,
  BTN_PRIMARY,
  BTN_GHOST,
} from "@/components/inventory/ui";
import { getProfile, type Profile } from "@/lib/store";
import {
  listPartnerMovements,
  countPartnerMovements,
  isPartnerLowStock,
  refKey,
  rowRef,
  summarisePartnerMovements,
  type PartnerMovement,
  type SkuRef,
} from "@/lib/partner-inventory";

const PAGE_SIZE = 50;

export default function AdminPartnerInventoryPage() {
  return (
    <AdminGuard>
      <AdminPartnerInventory />
    </AdminGuard>
  );
}

function AdminPartnerInventory() {
  const { t } = useLanguage();
  const params = useParams<{ ownerId: string }>();
  const ownerId = params.ownerId;
  const { toast, showToast } = useToast();

  const data = usePartnerInventory(ownerId);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [movements, setMovements] = useState<PartnerMovement[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [recording, setRecording] = useState(false);
  const [initialRef, setInitialRef] = useState<SkuRef | null>(null);

  useEffect(() => {
    getProfile(ownerId)
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [ownerId]);

  const loadLedger = useCallback(() => {
    Promise.all([
      listPartnerMovements({ ownerId, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      countPartnerMovements(ownerId),
    ])
      .then(([mv, c]) => {
        setMovements(mv);
        setCount(c);
      })
      .catch(() => setMovements([]));
  }, [ownerId, page]);
  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  const summary = useMemo(() => {
    const distinct = new Set(data.stock.map((s) => refKey(rowRef(s))));
    return {
      items: distinct.size,
      pieces: data.stock.reduce((a, s) => a + s.quantity, 0),
      low: data.stock.filter(isPartnerLowStock).length,
      recent: summarisePartnerMovements(data.recent),
    };
  }, [data.stock, data.recent]);

  const labelFor = useCallback(
    (ref: SkuRef) => {
      const l = data.labelFor(ref);
      return { sku: l.sku, name: l.name };
    },
    [data],
  );

  if (profile === undefined) return <EmptyCard>{t("partnerInv.loading")}</EmptyCard>;
  if (profile === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink href="/portal/admin/inventory/partners" label={t("partnerInv.backToPartners")} />
        <div className="mt-4">
          <EmptyCard>{t("partnerInv.contractorNotFound")}</EmptyCard>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl">
      <ToastView toast={toast} />

      <div className="mb-4">
        <BackLink href="/portal/admin/inventory/partners" label={t("partnerInv.backToPartners")} />
      </div>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {t("partnerInv.adminViewEyebrow")}
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">
            {profile.company || profile.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">{profile.email}</span>
            {profile.inventoryTrackingEnabled ? (
              <Badge tone="success">{t("partnerInv.trackingOn")}</Badge>
            ) : (
              <Badge tone="muted">{t("partnerInv.trackingOff")}</Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a href={`/portal/admin/crm/${ownerId}`} className={BTN_GHOST}>
            {t("partnerInv.openCrm")}
          </a>
          {!recording && (
            <button type="button" onClick={() => setRecording(true)} className={BTN_PRIMARY}>
              {t("partnerInv.recordOnBehalf")}
            </button>
          )}
        </div>
      </div>

      {!profile.inventoryTrackingEnabled && (
        <div className="mb-4 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm leading-relaxed text-amber">
          {t("partnerInv.trackingOffNote")}
        </div>
      )}

      {data.error && (
        <div className="mb-4 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">
          {data.error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("partnerInv.statItems")} value={String(summary.items)} />
        <StatCard label={t("partnerInv.statPieces")} value={String(summary.pieces)} />
        <StatCard label={t("partnerInv.statLow")} value={String(summary.low)} />
        <StatCard
          label={t("partnerInv.statMovements30")}
          value={String(summary.recent.total)}
          sub={`+${summary.recent.piecesReceived} / −${summary.recent.piecesOut}`}
        />
      </div>

      {recording && (
        <div className="mt-5">
          <div className="mb-2 text-sm text-muted">
            {t("partnerInv.recordOnBehalfNote", { name: profile.company || profile.name })}
          </div>
          <PartnerMovementForm
            ownerId={ownerId}
            skus={data.skus}
            catalog={data.catalog}
            stock={data.stock}
            labelFor={labelFor}
            initialRef={initialRef}
            onDone={() => {
              setRecording(false);
              setInitialRef(null);
              data.reload();
              loadLedger();
              showToast(t("partnerInv.movementApplied"));
            }}
            onCancel={() => {
              setRecording(false);
              setInitialRef(null);
            }}
          />
        </div>
      )}

      <div className="mt-5">
        <PartnerStockTable
          stock={data.stock}
          labelFor={data.labelFor}
          emptyMessage={t("partnerInv.adminEmptyStock")}
          onRowClick={(ref) => {
            setInitialRef(ref);
            setRecording(true);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </div>

      <section className="mt-5 rounded-2xl border border-line bg-card p-5">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {t("partnerInv.history")} <span className="ml-1 normal-case tracking-normal">({count})</span>
        </div>
        {movements.length === 0 ? (
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
      </section>
    </div>
  );
}
