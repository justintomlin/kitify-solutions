"use client";

import { useLanguage } from "./LanguageContext";

export function PagePlaceholder({
  titleKey,
  descKey,
  pointsKey,
  icon: Icon,
}: {
  titleKey: string;
  descKey: string;
  pointsKey?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const { t, tList } = useLanguage();
  const points = pointsKey ? tList(pointsKey) : [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
          {t("status.inDevelopment")}
        </span>
      </div>

      <div className="flex items-start gap-4">
        {Icon && (
          <div className="mt-1 hidden rounded-xl border border-line bg-accent-soft/60 p-3 text-accent sm:block">
            <Icon className="h-6 w-6" />
          </div>
        )}
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">{t(titleKey)}</h1>
          <p className="mt-2 text-ink/70">{t(descKey)}</p>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-line bg-card p-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          {t("status.whatsComing")}
        </div>
        <ul className="mt-4 space-y-3">
          {points.map((p, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-ink/80">
              <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-accent" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted">{t("status.placeholder")}</p>
      </div>
    </div>
  );
}
