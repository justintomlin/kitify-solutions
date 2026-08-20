"use client";

// Cross-contractor index: every contractor with Inventory tracking switched on, with a
// summary tile each. Reached from the "Partner inventory" tab on the Phase 1 dashboard.
//
// Kitify's own inventory is NOT summarised here and partner data is NOT merged into
// /portal/admin/inventory — the two remain separate views of separate tables.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import {
  BackLink,
  PageHeading,
  StatCard,
  EmptyCard,
  Badge,
  fmtDate,
} from "@/components/inventory/ui";
import { listAllProfiles, type Profile } from "@/lib/store";
import {
  listAllPartnerStock,
  latestMovementByOwner,
  isPartnerLowStock,
  refKey,
  rowRef,
  type PartnerStockRow,
} from "@/lib/partner-inventory";

export default function AdminPartnersInventoryPage() {
  return (
    <AdminGuard>
      <AdminPartnersInventory />
    </AdminGuard>
  );
}

function AdminPartnersInventory() {
  const { t } = useLanguage();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [stock, setStock] = useState<PartnerStockRow[]>([]);
  const [latest, setLatest] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");

  const load = useCallback(() => {
    Promise.all([listAllProfiles(), listAllPartnerStock(), latestMovementByOwner()])
      .then(([ps, st, lm]) => {
        setProfiles(ps);
        setStock(st);
        setLatest(lm);
        setError("");
      })
      .catch((e: unknown) => {
        setProfiles([]);
        setError(e instanceof Error ? e.message : t("partnerInv.errLoad"));
      });
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  const byOwner = useMemo(() => {
    const m = new Map<string, PartnerStockRow[]>();
    for (const s of stock) {
      const a = m.get(s.ownerId) ?? [];
      a.push(s);
      m.set(s.ownerId, a);
    }
    return m;
  }, [stock]);

  const enabled = useMemo(
    () => (profiles ?? []).filter((p) => p.inventoryTrackingEnabled),
    [profiles],
  );

  const rows = useMemo(
    () =>
      enabled
        .map((p) => {
          const rows = byOwner.get(p.id) ?? [];
          return {
            p,
            items: new Set(rows.map((r) => refKey(rowRef(r)))).size,
            pieces: rows.reduce((a, r) => a + r.quantity, 0),
            low: rows.filter(isPartnerLowStock).length,
            last: latest.get(p.id) ?? null,
          };
        })
        .sort((a, b) => b.pieces - a.pieces),
    [enabled, byOwner, latest],
  );

  const totals = useMemo(
    () => ({
      contractors: enabled.length,
      items: new Set(stock.map((s) => `${s.ownerId}:${refKey(rowRef(s))}`)).size,
      pieces: stock.reduce((a, s) => a + s.quantity, 0),
      low: stock.filter(isPartnerLowStock).length,
    }),
    [enabled, stock],
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <BackLink href="/portal/admin/inventory" label={t("partnerInv.backToKitifyInventory")} />
      </div>
      <PageHeading eyebrow={t("partnerInv.partnersTitle")} sub={t("partnerInv.partnersSub")} />

      {error && (
        <div className="mb-4 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("partnerInv.statContractors")} value={String(totals.contractors)} />
        <StatCard label={t("partnerInv.statItems")} value={String(totals.items)} />
        <StatCard label={t("partnerInv.statPieces")} value={String(totals.pieces)} />
        <StatCard label={t("partnerInv.statLow")} value={String(totals.low)} />
      </div>

      <div className="mt-5">
        {profiles === null ? (
          <EmptyCard>{t("partnerInv.loading")}</EmptyCard>
        ) : rows.length === 0 ? (
          <EmptyCard>
            <Users className="mx-auto mb-2 h-5 w-5 text-muted" />
            {t("partnerInv.noPartnersEnabled")}
          </EmptyCard>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => (
              <Link
                key={r.p.id}
                href={`/portal/admin/inventory/partner/${r.p.id}`}
                className="block rounded-2xl border border-line bg-card p-4 transition hover:border-accent"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-display text-sm font-semibold text-ink">
                      {r.p.company || r.p.name}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">{r.p.email}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-display text-base font-bold text-ink">{r.pieces}</div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                      {t("partnerInv.statPieces")}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                  <span>
                    {t("partnerInv.statItems")}: <span className="font-semibold text-ink">{r.items}</span>
                  </span>
                  {r.low > 0 && <Badge tone="amber">{t("partnerInv.nLow", { n: String(r.low) })}</Badge>}
                  <span className="ml-auto">
                    {t("partnerInv.lastMovement")}: {r.last ? fmtDate(r.last) : t("partnerInv.never")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
