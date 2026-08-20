"use client";

// The contractor's OWN SKU catalog. Deliberately does not list Kitify's catalog — that is
// reference data they reach through the picker, not something they curate.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { InventoryTrackingGuard } from "@/components/InventoryTrackingGuard";
import { PartnerSkuForm } from "@/components/inventory/PartnerSkuForm";
import {
  Badge,
  BackLink,
  PageHeading,
  EmptyCard,
  categoryLabel,
  fmtDate,
  BTN_PRIMARY,
  BTN_GHOST,
} from "@/components/inventory/ui";
import { listPartnerSkus, type PartnerSku } from "@/lib/partner-inventory";

export default function PartnerSkusPage() {
  return (
    <InventoryTrackingGuard>
      <PartnerSkus />
    </InventoryTrackingGuard>
  );
}

function PartnerSkus() {
  const { t } = useLanguage();
  const { userId } = useAuth();
  const router = useRouter();

  const [skus, setSkus] = useState<PartnerSku[] | null>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    if (!userId) return;
    listPartnerSkus(userId)
      .then(setSkus)
      .catch(() => setSkus([]));
  }, [userId]);
  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (skus ?? [])
      .filter((s) => (showInactive ? true : s.active))
      .filter((s) => !q || s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [skus, query, showInactive]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <BackLink href="/portal/inventory" label={t("partnerInv.backToInventory")} />
      </div>
      <PageHeading
        eyebrow={t("partnerInv.mySkus")}
        sub={t("partnerInv.mySkusSub")}
        right={
          !adding && (
            <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>
              <Plus className="h-4 w-4" /> {t("partnerInv.newSku")}
            </button>
          )
        }
      />

      {adding && userId && (
        <div className="mb-5 rounded-2xl border border-line bg-card p-5">
          <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {t("partnerInv.newSku")}
          </div>
          <PartnerSkuForm
            ownerId={userId}
            onSaved={(s) => {
              setAdding(false);
              router.push(`/portal/inventory/skus/${s.id}`);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("partnerInv.searchPlaceholder")}
          className="w-full rounded-lg border border-line bg-card py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </div>
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
          className="accent-accent"
        />
        {t("partnerInv.showInactive")}
      </label>

      {skus === null ? (
        <EmptyCard>{t("partnerInv.loading")}</EmptyCard>
      ) : skus.length === 0 ? (
        <EmptyCard>{t("partnerInv.emptySkus")}</EmptyCard>
      ) : rows.length === 0 ? (
        <EmptyCard>{t("partnerInv.noResults")}</EmptyCard>
      ) : (
        <div className="space-y-2.5">
          {rows.map((s) => (
            <Link
              key={s.id}
              href={`/portal/inventory/skus/${s.id}`}
              className="block rounded-2xl border border-line bg-card p-4 transition hover:border-accent"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-[12px] text-muted">{s.sku}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="font-display text-sm font-semibold text-ink">{s.name}</span>
                    {!s.active && <Badge tone="muted">{t("partnerInv.inactive")}</Badge>}
                  </div>
                </div>
                <div className="shrink-0 text-right text-[11px] text-muted">
                  <div>{categoryLabel(t, s.category)}</div>
                  <div>{fmtDate(s.updatedAt)}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-5">
        <Link href="/portal/inventory/movement/new" className={BTN_GHOST}>
          {t("partnerInv.addStock")}
        </Link>
      </div>
    </div>
  );
}
