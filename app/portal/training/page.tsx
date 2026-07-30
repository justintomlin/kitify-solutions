"use client";

// Kitify University — the dealer resource hub.
//
// STRUCTURE ONLY. Every accordion below renders a "coming soon" placeholder where real
// content will land: videos, spec sheets, PDFs, galleries. The admin "Content" nav item
// becomes the CMS that manages that content, so each <Soon> block marks a future injection
// point — swap the placeholder for the CMS-fetched body, keep the accordion shell.
//
// The one number on this page that is NOT a placeholder is the Delta SKU count, derived
// from lib/plumbing-catalog.ts so it stays true as the catalog changes.

import { useState } from "react";
import {
  ArrowRight, ChevronDown, ChevronUp, FileText, GraduationCap, Lock, Presentation, Wrench,
} from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { useToast, ToastView } from "@/components/Toast";
import { PLUMBING_PACKAGES } from "@/lib/plumbing-catalog";

// Every package × component × finish that resolves to a real SKU. 4 × 9 × 6 = 216 today.
const PLUMBING_SKU_COUNT = PLUMBING_PACKAGES.reduce(
  (total, pkg) =>
    total + Object.values(pkg.skus).reduce((n, byFinish) => n + Object.values(byFinish).filter(Boolean).length, 0),
  0,
);

// The six product lines, shared by the Installation and Product Specs columns.
const PRODUCT_LINES = [
  { key: "fibo", labelKey: "training.plFibo" },
  { key: "nuvo", labelKey: "training.plNuvo" },
  { key: "durato", labelKey: "training.plDurato" },
  { key: "csFactory", labelKey: "training.plCsFactory" },
  { key: "delta", labelKey: "training.plDelta" },
  { key: "showerBases", labelKey: "training.plShowerBases" },
] as const;

// Topic-based, not product-based.
const SALES_TOPICS = [
  { key: "whyPanels", titleKey: "training.salesWhyPanels", bodyKey: "training.salesWhyPanelsBody" },
  { key: "care", titleKey: "training.salesCare", bodyKey: "training.salesCareBody" },
  { key: "gallery", titleKey: "training.salesGallery", bodyKey: "training.salesGalleryBody" },
  { key: "financing", titleKey: "training.salesFinancing", bodyKey: "training.salesFinancingBody" },
  { key: "objections", titleKey: "training.salesObjections", bodyKey: "training.salesObjectionsBody" },
] as const;

const ADMIN_TOPICS = [
  { key: "decks", titleKey: "training.adminDecks", bodyKey: "training.adminDecksBody" },
  { key: "pricing", titleKey: "training.adminPricing", bodyKey: "training.adminPricingBody" },
  { key: "competitive", titleKey: "training.adminCompetitive", bodyKey: "training.adminCompetitiveBody" },
  { key: "onboarding", titleKey: "training.adminOnboarding", bodyKey: "training.adminOnboardingBody" },
] as const;

const CERT_LEVELS = [
  { key: "lvl1", titleKey: "training.lvl1Title", reqKey: "training.lvl1Req" },
  { key: "lvl2", titleKey: "training.lvl2Title", reqKey: "training.lvl2Req" },
  { key: "lvl3", titleKey: "training.lvl3Title", reqKey: "training.lvl3Req" },
] as const;

export default function TrainingPage() {
  const { t } = useLanguage();
  const { isAdmin } = useAuth();
  const { toast, showToast } = useToast();

  const sampleSoon = () => showToast(t("training.sampleSoon"));

  return (
    <div className="mx-auto max-w-6xl">
      <ToastView toast={toast} />

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-accent-soft/70 p-2.5 text-accent">
            <GraduationCap className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-ink">{t("training.title")}</h1>
            <p className="mt-0.5 text-sm text-muted">{t("training.subtitle")}</p>
          </div>
        </div>
        {/* Becomes the dealer's earned badge once certification tracking exists. */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted">
          <Lock className="h-3 w-3" /> {t("training.certBadge")}
        </span>
      </div>

      {/* Certification ladder — visual framework only, no progress tracked yet */}
      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("training.certTitle")}</div>
        <div className="grid gap-3 sm:grid-cols-3">
          {CERT_LEVELS.map((lvl, i) => (
            <div key={lvl.key} className="rounded-xl border border-dashed border-line bg-paper/50 p-4">
              <div className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-muted" />
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
                  {t("training.lvlLabel", { n: String(i + 1) })}
                </span>
              </div>
              <div className="mt-1.5 font-display text-sm font-semibold text-ink/70">{t(lvl.titleKey)}</div>
              <p className="mt-1 text-xs text-muted">{t(lvl.reqKey)}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t("training.certNote")}</p>
      </section>

      {/* Three columns — stack on phones, side by side from lg up */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Column icon={Wrench} title={t("training.colInstallTitle")} desc={t("training.colInstallDesc")}>
          {PRODUCT_LINES.map((pl) => (
            <Accordion key={pl.key} title={t(pl.labelKey)}>
              {/* CMS injection point: installation videos + guides for this product line. */}
              <Soon>{t("training.installPlaceholder", { product: t(pl.labelKey) })}</Soon>
              <SampleLink onClick={sampleSoon} />
            </Accordion>
          ))}
        </Column>

        <Column icon={FileText} title={t("training.colSpecsTitle")} desc={t("training.colSpecsDesc")}>
          {PRODUCT_LINES.map((pl) => (
            <Accordion key={pl.key} title={t(pl.labelKey)}>
              {/* CMS injection point: spec sheets, data sheets, care documents. */}
              <Soon>{t("training.specsPlaceholder", { product: t(pl.labelKey) })}</Soon>
              {/* Delta is the one line with real data behind it today. */}
              {pl.key === "delta" && (
                <p className="mt-2 rounded-lg border border-accent/30 bg-accent-soft/30 px-3 py-2 text-xs text-accent">
                  {t("training.specsDeltaNote", { n: String(PLUMBING_SKU_COUNT) })}
                </p>
              )}
              <SampleLink onClick={sampleSoon} />
            </Accordion>
          ))}
        </Column>

        <Column icon={Presentation} title={t("training.colSalesTitle")} desc={t("training.colSalesDesc")}>
          {SALES_TOPICS.map((s) => (
            <Accordion key={s.key} title={t(s.titleKey)}>
              {/* CMS injection point: sales collateral and customer handouts. */}
              <Soon>{t(s.bodyKey)}</Soon>
            </Accordion>
          ))}
        </Column>
      </div>

      {/* Internal resources — admins only, never rendered for a dealer */}
      {isAdmin && (
        <section className="mt-4 rounded-2xl border border-ink/15 bg-ink/[0.03] p-5">
          <div className="flex items-center gap-2.5">
            <span className="rounded-lg bg-ink/5 p-2 text-ink/60">
              <Lock className="h-4.5 w-4.5" />
            </span>
            <div>
              <h2 className="font-display text-base font-semibold text-ink">{t("training.adminTitle")}</h2>
              <p className="text-xs text-muted">{t("training.adminSubtitle")}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
            {ADMIN_TOPICS.map((a) => (
              <Accordion key={a.key} title={t(a.titleKey)}>
                {/* CMS injection point: internal-only sales enablement material. */}
                <Soon>{t(a.bodyKey)}</Soon>
              </Accordion>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// --------------------------------- pieces ----------------------------------
function Column({
  icon: Icon, title, desc, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-card p-5">
      <div className="flex items-center gap-2.5">
        <span className="rounded-lg bg-accent-soft/70 p-2 text-accent">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      </div>
      <p className="mt-2 text-sm text-ink/65">{desc}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Accordion({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line/60 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm font-medium text-ink transition hover:text-accent"
      >
        <span className="min-w-0">{title}</span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-muted" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted" />}
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

function Soon({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-paper/50 p-3 text-xs text-muted">{children}</div>
  );
}

function SampleLink({ onClick }: { onClick: () => void }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent transition hover:gap-1.5"
    >
      {t("training.orderSample")} <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}
