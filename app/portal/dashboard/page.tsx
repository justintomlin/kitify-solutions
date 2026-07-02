"use client";

import { Newspaper, Package, Star, Users, Truck } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";

function ModuleCard({
  icon: Icon,
  title,
  desc,
  span = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  span?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div
      className={`rounded-2xl border border-line bg-card p-5 ${
        span ? "md:col-span-2" : ""
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className="rounded-lg bg-accent-soft/70 p-2 text-accent">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <h3 className="font-display text-base font-semibold">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-ink/65">{desc}</p>
      <div className="mt-4 flex items-center justify-center rounded-xl border border-dashed border-line bg-paper/50 py-8 text-sm text-muted">
        {t("dashboard.empty")}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useLanguage();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          {t("dashboard.title")}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ModuleCard
          icon={Newspaper}
          title={t("dashboard.blogTitle")}
          desc={t("dashboard.blogDesc")}
        />
        <ModuleCard
          icon={Package}
          title={t("dashboard.productTitle")}
          desc={t("dashboard.productDesc")}
        />
        <ModuleCard
          icon={Star}
          title={t("dashboard.featuredTitle")}
          desc={t("dashboard.featuredDesc")}
          span
        />
        <ModuleCard
          icon={Users}
          title={t("dashboard.leadsTitle")}
          desc={t("dashboard.leadsDesc")}
        />
        <ModuleCard
          icon={Truck}
          title={t("dashboard.ordersTitle")}
          desc={t("dashboard.ordersDesc")}
        />
      </div>
    </div>
  );
}
