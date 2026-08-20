"use client";

// Contractor movement entry. Thin page around the shared PartnerMovementForm — the admin
// partner view mounts the same component with a different ownerId.

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { InventoryTrackingGuard } from "@/components/InventoryTrackingGuard";
import { usePartnerInventory } from "@/components/inventory/PartnerStock";
import { PartnerMovementForm } from "@/components/inventory/PartnerMovementForm";
import { BackLink, PageHeading, EmptyCard } from "@/components/inventory/ui";
import type { SkuRef } from "@/lib/partner-inventory";

export default function NewPartnerMovementPage() {
  return (
    <InventoryTrackingGuard>
      <Suspense fallback={<EmptyCard>…</EmptyCard>}>
        <NewPartnerMovement />
      </Suspense>
    </InventoryTrackingGuard>
  );
}

function NewPartnerMovement() {
  const { t } = useLanguage();
  const { userId } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const data = usePartnerInventory(userId);

  // ?partner=<id> / ?kitify=<id> pre-selects the item, so "Add stock" from a detail page
  // lands with the row already filled in.
  const initialRef = useMemo<SkuRef | null>(() => {
    const partner = searchParams.get("partner");
    if (partner) return { source: "partner", id: partner };
    const kitify = searchParams.get("kitify");
    if (kitify) return { source: "kitify", id: kitify };
    return null;
  }, [searchParams]);

  if (data.loading || !userId) return <EmptyCard>{t("partnerInv.loading")}</EmptyCard>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <BackLink href="/portal/inventory" label={t("partnerInv.backToInventory")} />
      </div>
      <PageHeading eyebrow={t("partnerInv.addStock")} sub={t("partnerInv.addStockSub")} />

      <PartnerMovementForm
        ownerId={userId}
        skus={data.skus}
        catalog={data.catalog}
        stock={data.stock}
        labelFor={data.labelFor}
        initialRef={initialRef}
        onDone={() => router.push("/portal/inventory")}
        onCancel={() => router.push("/portal/inventory")}
      />
    </div>
  );
}
