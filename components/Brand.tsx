"use client";

import { useLanguage } from "./LanguageContext";

// The mark is a 2x2 module grid with one filled cell — a "kit" assembled from
// parts. It's the one recurring signature element across the portal.
export function KitMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="currentColor" />
      <rect x="13.5" y="1.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <rect x="1.5" y="13.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <rect x="13.5" y="13.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

export function Brand({ subdued = false }: { subdued?: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-2.5">
      <KitMark className={`h-6 w-6 ${subdued ? "text-accent" : "text-accent"}`} />
      <div className="leading-none">
        <div className="font-display text-lg font-bold tracking-tight">
          {t("brand.name")}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          {t("brand.portal")}
        </div>
      </div>
    </div>
  );
}
