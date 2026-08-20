"use client";

// Create a new ops SKU. Static segment, so it takes precedence over the [skuId] route.

import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import { SkuForm } from "@/components/inventory/SkuForm";
import { BackLink, PageHeading } from "@/components/inventory/ui";

export default function NewSkuPage() {
  return (
    <AdminGuard>
      <NewSku />
    </AdminGuard>
  );
}

function NewSku() {
  const { t } = useLanguage();
  const router = useRouter();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <BackLink href="/portal/admin/inventory" label={t("inventory.backToInventory")} />
      </div>
      <PageHeading eyebrow={t("inventory.newSku")} sub={t("inventory.newSkuSub")} />
      <div className="rounded-2xl border border-line bg-card p-5">
        <SkuForm
          onSaved={(s) => router.push(`/portal/admin/inventory/${s.id}`)}
          onCancel={() => router.push("/portal/admin/inventory")}
        />
      </div>
    </div>
  );
}
