"use client";

// Contractor inventory dashboard — THEIR stock, at THEIR locations.
//
// Gated by InventoryTrackingGuard (the per-contractor feature toggle) and, underneath that,
// by owner-scoped RLS. Nothing on this page reads Kitify's inventory_stock or
// inventory_movements; the only Kitify data present is catalog labelling for items they hold.

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Boxes, History, Tag } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { InventoryTrackingGuard } from "@/components/InventoryTrackingGuard";
import { usePartnerInventory, PartnerStockTable } from "@/components/inventory/PartnerStock";
import { StatCard, PageHeading, EmptyCard, BTN_PRIMARY, BTN_GHOST } from "@/components/inventory/ui";
import { isPartnerLowStock, refKey, rowRef, summarisePartnerMovements } from "@/lib/partner-inventory";

export default function PartnerInventoryPage() {
  return (
    <InventoryTrackingGuard>
      <PartnerInventoryDashboard />
    </InventoryTrackingGuard>
  );
}

function PartnerInventoryDashboard() {
  const { t } = useLanguage();
  const { userId } = useAuth();
  const router = useRouter();
  const data = usePartnerInventory(userId);

  const summary = useMemo(() => {
    const distinct = new Set(data.stock.map((s) => refKey(rowRef(s))));
    return {
      items: distinct.size,
      pieces: data.stock.reduce((a, s) => a + s.quantity, 0),
      low: data.stock.filter(isPartnerLowStock).length,
      movements: summarisePartnerMovements(data.recent),
    };
  }, [data.stock, data.recent]);

  if (data.loading) return <EmptyCard>{t("partnerInv.loading")}</EmptyCard>;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        eyebrow={t("partnerInv.title")}
        sub={t("partnerInv.subtitle")}
        right={
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href="/portal/inventory/skus" className={BTN_GHOST}>
              <Tag className="h-4 w-4" /> {t("partnerInv.mySkus")}
            </Link>
            <Link href="/portal/inventory/history" className={BTN_GHOST}>
              <History className="h-4 w-4" /> {t("partnerInv.history")}
            </Link>
            <Link href="/portal/inventory/movement/new" className={BTN_PRIMARY}>
              <Plus className="h-4 w-4" /> {t("partnerInv.addStock")}
            </Link>
          </div>
        }
      />

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
          value={String(summary.movements.total)}
          sub={`+${summary.movements.piecesReceived} / −${summary.movements.piecesOut}`}
        />
      </div>

      <div className="mt-5">
        <PartnerStockTable
          stock={data.stock}
          labelFor={data.labelFor}
          emptyMessage={t("partnerInv.emptyStock")}
          onRowClick={(ref) => {
            // Only a contractor's OWN SKUs have a detail page. Kitify catalog items are
            // reference-only, so their history opens filtered on the ledger instead.
            if (ref.source === "partner") router.push(`/portal/inventory/skus/${ref.id}`);
            else router.push(`/portal/inventory/history?kitify=${ref.id}`);
          }}
        />
      </div>

      {data.skus.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-line bg-paper/50 p-5 text-center">
          <Boxes className="mx-auto mb-2 h-5 w-5 text-muted" />
          <p className="text-sm text-muted">{t("partnerInv.noSkusYet")}</p>
          <Link href="/portal/inventory/skus" className={BTN_GHOST + " mt-3"}>
            <Plus className="h-4 w-4" /> {t("partnerInv.newSku")}
          </Link>
        </div>
      )}
    </div>
  );
}
