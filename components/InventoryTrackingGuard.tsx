"use client";

// Page-level gate for the contractor inventory routes (/portal/inventory/*). Deliberately
// mirrors AdminGuard: spinner while the session resolves, an access-denied card otherwise.
//
// "Inventory tracking" is a per-contractor feature toggle an admin sets from the CRM, so a
// contractor without it gets the same treatment as someone reaching for an admin page — the
// nav item is hidden and a typed URL lands here. RLS is the real boundary underneath; this
// is the courteous front door.

import { useAuth } from "@/components/AuthContext";
import { useLanguage } from "@/components/LanguageContext";
import { PackageSearch } from "lucide-react";

export function InventoryTrackingGuard({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
      </div>
    );
  }

  if (!profile?.inventoryTrackingEnabled) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-md items-center">
        <div className="w-full rounded-2xl border border-line bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-amber/15 text-amber">
            <PackageSearch className="h-5 w-5" />
          </div>
          <h1 className="font-display text-xl font-bold tracking-tight text-ink">
            {t("partnerInv.deniedTitle")}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t("partnerInv.deniedBody")}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
