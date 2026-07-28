"use client";

// Reusable page-level gate for admin-only routes. Shows a spinner while the session
// resolves, an "access denied" card for non-admins, and the content only for admins.
// (The portal layout already guarantees a signed-in user; this adds the admin check.)

import { useAuth } from "@/components/AuthContext";
import { useLanguage } from "@/components/LanguageContext";
import { ShieldAlert } from "lucide-react";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-md items-center">
        <div className="w-full rounded-2xl border border-line bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-amber/15 text-amber">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h1 className="font-display text-xl font-bold tracking-tight text-ink">{t("admin.deniedTitle")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t("admin.deniedBody")}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
