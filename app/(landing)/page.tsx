"use client";

import Link from "next/link";
import {
  Boxes,
  ChevronDown,
  ClipboardList,
  CircleCheckBig,
  FileText,
  GraduationCap,
  Grid2x2,
  PencilRuler,
  Presentation,
  Quote,
  Rows3,
  Ruler,
  ShowerHead,
  SlidersHorizontal,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { scrollToAnchor } from "@/components/landing/anchors";

/* ===========================================================================
   Public landing page — "/" (route group app/(landing)).
   The front door for contractors who have not signed in. One scrolling
   document; the nav bar's links are anchors into the sections below, whose ids
   come from components/landing/anchors.ts.

   Every string is an i18n key. The only literals here are proper nouns
   (partner and product names, the placeholder testimonial names) and the
   founders' initials.
   =========================================================================== */

/** Card chrome, repeated across four grids. */
const CARD =
  "rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/20";

/** Section id → the scroll offset that clears the 64px sticky nav. */
const SECTION = "scroll-mt-24 px-5 py-20 sm:px-8 sm:py-28";

function SectionHead({
  eyebrow,
  heading,
  sub,
  center = false,
}: {
  eyebrow: string;
  heading: string;
  sub?: string;
  center?: boolean;
}) {
  return (
    <div className={`max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-soft">{eyebrow}</p>
      <h2 className="mt-3 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
        {heading}
      </h2>
      {sub ? <p className="mt-4 text-base leading-relaxed text-white/60">{sub}</p> : null}
    </div>
  );
}

/**
 * Decorative bathroom plan, in place of a stock photo. It is the "Drawn" half
 * of the tagline made literal — the same thing a dealer produces in the
 * configurator — and being line art it stays crisp at any size and adds no
 * image weight to the page.
 */
function FloorPlanSketch({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 340" fill="none" aria-hidden className={className}>
      <defs>
        <pattern id="kf-plan-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="currentColor" opacity="0.3" />
        </pattern>
      </defs>
      <rect width="420" height="340" fill="url(#kf-plan-grid)" />

      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {/* Overall dimension line across the top */}
        <g opacity="0.45" strokeWidth="1.25">
          <path d="M32 16h356" />
          <path d="M32 10v12M388 10v12" />
        </g>

        {/* Room */}
        <rect x="32" y="34" width="356" height="272" rx="3" strokeWidth="2.5" opacity="0.85" />

        {/* Door + swing, bottom left */}
        <g opacity="0.5" strokeWidth="1.5">
          <path d="M32 236v70" strokeWidth="3" stroke="var(--color-ink)" />
          <path d="M32 236l52 8" />
          <path d="M32 306a70 70 0 0 0 52-62" strokeDasharray="4 5" />
        </g>

        {/* Shower — square base with a centre drain */}
        <g strokeWidth="2" opacity="0.8">
          <rect x="54" y="56" width="128" height="128" rx="2" />
          <rect x="64" y="66" width="108" height="108" rx="2" opacity="0.4" />
          <circle cx="118" cy="120" r="7" />
          <path d="M118 66v37M118 137v37M64 120h37M135 120h37" opacity="0.35" strokeDasharray="3 6" />
        </g>

        {/* Vanity — cabinet run with two basins */}
        <g strokeWidth="2" opacity="0.8">
          <rect x="230" y="56" width="138" height="66" rx="2" />
          <ellipse cx="264" cy="89" rx="18" ry="14" />
          <ellipse cx="334" cy="89" rx="18" ry="14" />
          <path d="M299 56v66" opacity="0.35" />
        </g>

        {/* Toilet — sits clear of the door swing to the left of it */}
        <g strokeWidth="2" opacity="0.7">
          <rect x="128" y="226" width="48" height="20" rx="2" />
          <ellipse cx="152" cy="270" rx="21" ry="26" />
        </g>

        {/* Flooring field — 12x24 tile run */}
        <g strokeWidth="1.25" opacity="0.4">
          <rect x="212" y="200" width="156" height="96" rx="2" />
          <path d="M212 232h156M212 264h156M290 200v32M251 232v32M329 232v32M290 264v32" />
        </g>
      </g>
    </svg>
  );
}

export default function LandingPage() {
  const { t } = useLanguage();

  const steps: { icon: LucideIcon; n: string; title: string; body: string }[] = [
    { icon: PencilRuler, n: "01", title: t("landing.how.drawTitle"), body: t("landing.how.drawBody") },
    { icon: Truck, n: "02", title: t("landing.how.deliverTitle"), body: t("landing.how.deliverBody") },
    { icon: CircleCheckBig, n: "03", title: t("landing.how.doneTitle"), body: t("landing.how.doneBody") },
  ];

  const kit: { icon: LucideIcon; title: string; body: string }[] = [
    { icon: Rows3, title: t("landing.kit.panelsTitle"), body: t("landing.kit.panelsBody") },
    { icon: ShowerHead, title: t("landing.kit.baseTitle"), body: t("landing.kit.baseBody") },
    { icon: Boxes, title: t("landing.kit.vanityTitle"), body: t("landing.kit.vanityBody") },
    { icon: Wrench, title: t("landing.kit.plumbingTitle"), body: t("landing.kit.plumbingBody") },
    { icon: Grid2x2, title: t("landing.kit.flooringTitle"), body: t("landing.kit.flooringBody") },
    { icon: Ruler, title: t("landing.kit.wallBaseTitle"), body: t("landing.kit.wallBaseBody") },
  ];

  // Supplier names are proper nouns and stay untranslated; what they supply does not.
  const partners = [
    { name: "CS Factory", role: t("landing.partners.csRole"), note: t("landing.partners.csNote") },
    { name: "Delta Faucet", role: t("landing.partners.deltaRole"), note: t("landing.partners.deltaNote") },
    { name: "Vista Tile", role: t("landing.partners.vistaRole"), note: t("landing.partners.vistaNote") },
    { name: "Nature Panel / ThermaGlass", role: t("landing.partners.panelRole"), note: t("landing.partners.panelNote") },
  ];

  const platform: { icon: LucideIcon; title: string; body: string }[] = [
    { icon: SlidersHorizontal, title: t("landing.platform.configuratorTitle"), body: t("landing.platform.configuratorBody") },
    { icon: Users, title: t("landing.platform.crmTitle"), body: t("landing.platform.crmBody") },
    { icon: GraduationCap, title: t("landing.platform.trainingTitle"), body: t("landing.platform.trainingBody") },
    { icon: Presentation, title: t("landing.platform.salesTitle"), body: t("landing.platform.salesBody") },
    { icon: ClipboardList, title: t("landing.platform.jobsTitle"), body: t("landing.platform.jobsBody") },
    { icon: FileText, title: t("landing.platform.proposalsTitle"), body: t("landing.platform.proposalsBody") },
  ];

  /* PLACEHOLDER TESTIMONIALS — swap wholesale for real partner quotes.
     The names are invented stand-ins (and proper nouns, hence not in i18n);
     the quotes and company names live under landing.testimonials.*. */
  const testimonials = [
    { name: "Buck Nasty", company: t("landing.testimonials.c1"), quote: t("landing.testimonials.q1") },
    { name: "Sally Sheetrock", company: t("landing.testimonials.c2"), quote: t("landing.testimonials.q2") },
    { name: "Hank the Tank", company: t("landing.testimonials.c3"), quote: t("landing.testimonials.q3") },
  ];

  const faqs = [1, 2, 3, 4, 5, 6].map((i) => ({
    q: t(`landing.faq.q${i}`),
    a: t(`landing.faq.a${i}`),
  }));

  return (
    <>
      {/* ==================== HERO ==================== */}
      <section className="relative overflow-hidden bg-ink px-5 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24">
        {/* Ambient teal wash behind the plan sketch */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 top-0 h-[38rem] w-[38rem] rounded-full bg-accent/20 blur-3xl"
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-accent-soft">
              {t("landing.hero.eyebrow")}
            </p>
            <h1 className="mt-5 font-display text-[2.75rem] font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              {t("landing.hero.headline")}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/65">
              {t("landing.hero.sub")}
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-lg bg-accent px-6 py-3.5 text-sm font-semibold text-white transition hover:brightness-125"
              >
                {t("landing.hero.ctaPrimary")}
              </Link>
              <a
                href="#how"
                onClick={(e) => scrollToAnchor(e, "how")}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 px-6 py-3.5 text-sm font-semibold text-white/85 transition hover:border-white/40 hover:text-white"
              >
                {t("landing.hero.ctaSecondary")}
                <ChevronDown className="h-4 w-4" aria-hidden />
              </a>
            </div>

            {/* The tagline decomposed — the three words, in order, as a spine for the page. */}
            <div className="mt-12 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/10 pt-6">
              {steps.map((s) => (
                <div key={s.n} className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-accent-soft/60">{s.n}</span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">
                    {s.title}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <FloorPlanSketch className="mx-auto w-full max-w-lg text-accent-soft" />
        </div>
      </section>

      {/* ==================== HOW IT WORKS ==================== */}
      <section id="how" className={`${SECTION} bg-ink-soft`}>
        <div className="mx-auto max-w-6xl">
          <SectionHead
            eyebrow={t("landing.how.eyebrow")}
            heading={t("landing.how.heading")}
            sub={t("landing.how.sub")}
          />

          <ol className="mt-14 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.n} className={CARD}>
                <div className="flex items-center justify-between">
                  <s.icon className="h-7 w-7 text-accent-soft" aria-hidden />
                  <span aria-hidden className="font-display text-4xl font-bold text-white/10">
                    {s.n}
                  </span>
                </div>
                <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-accent-soft/70">
                  {t("landing.how.step", { n: String(i + 1) })}
                </p>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-white/60">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ==================== WHAT'S IN A KIT ==================== */}
      <section id="kit" className={`${SECTION} bg-ink`}>
        <div className="mx-auto max-w-6xl">
          <SectionHead
            eyebrow={t("landing.kit.eyebrow")}
            heading={t("landing.kit.heading")}
            sub={t("landing.kit.sub")}
          />

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {kit.map((k) => (
              <article key={k.title} className={CARD}>
                {/* PLACEHOLDER IMAGE FRAME — replace this block with real product
                    photography (next/image, same 4:3 box) when shots are ready. */}
                <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-accent/20 to-transparent">
                  <k.icon className="h-10 w-10 text-accent-soft/80" aria-hidden />
                </div>
                <h3 className="mt-5 font-display text-lg font-bold tracking-tight">{k.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{k.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== PARTNERS ==================== */}
      <section id="partners" className={`${SECTION} bg-ink-soft`}>
        <div className="mx-auto max-w-6xl">
          <SectionHead
            eyebrow={t("landing.partners.eyebrow")}
            heading={t("landing.partners.heading")}
            sub={t("landing.partners.sub")}
          />

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {partners.map((p) => (
              <article key={p.name} className={`${CARD} flex flex-col`}>
                {/* PLACEHOLDER LOGO AREA — drop the supplier's mark in here at the
                    same height once we have permission and assets. */}
                <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.02]">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
                    {t("landing.partners.logoPlaceholder")}
                  </span>
                </div>
                <h3 className="mt-5 font-display text-lg font-bold tracking-tight">{p.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/65">{p.role}</p>
                <p className="mt-auto pt-3 font-mono text-[11px] leading-relaxed text-white/55">
                  {p.note}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== PLATFORM ==================== */}
      <section id="platform" className={`${SECTION} bg-ink`}>
        <div className="mx-auto max-w-6xl">
          <SectionHead
            eyebrow={t("landing.platform.eyebrow")}
            heading={t("landing.platform.heading")}
            sub={t("landing.platform.sub")}
          />

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {platform.map((f) => (
              <article key={f.title} className={CARD}>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/20">
                  <f.icon className="h-5 w-5 text-accent-soft" aria-hidden />
                </div>
                <h3 className="mt-5 font-display text-lg font-bold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== TESTIMONIALS (PLACEHOLDER CONTENT) ==================== */}
      <section className={`${SECTION} bg-ink-soft`}>
        <div className="mx-auto max-w-6xl">
          <SectionHead
            eyebrow={t("landing.testimonials.eyebrow")}
            heading={t("landing.testimonials.heading")}
            center
          />

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {testimonials.map((r) => (
              <figure key={r.name} className={`${CARD} flex flex-col`}>
                <Quote className="h-6 w-6 shrink-0 text-accent-soft/50" aria-hidden />
                <blockquote className="mt-4 text-[0.95rem] leading-relaxed text-white/75">
                  {r.quote}
                </blockquote>
                <figcaption className="mt-6 border-t border-white/10 pt-4">
                  <div className="font-display text-sm font-bold">{r.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
                    {r.company}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>

          <p className="mt-8 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-white/30">
            {t("landing.testimonials.note")}
          </p>
        </div>
      </section>

      {/* ==================== ABOUT ==================== */}
      <section id="about" className={`${SECTION} bg-ink`}>
        <div className="mx-auto max-w-3xl text-center">
          <SectionHead
            eyebrow={t("landing.about.eyebrow")}
            heading={t("landing.about.heading")}
            center
          />
          <p className="mt-8 text-base leading-relaxed text-white/65">{t("landing.about.p1")}</p>
          <p className="mt-5 text-base leading-relaxed text-white/65">{t("landing.about.p2")}</p>

          {/* PLACEHOLDER HEADSHOTS — initials until we have photographs. */}
          <div className="mt-12">
            <div className="flex items-center justify-center gap-5">
              {["JT", "DH"].map((initials) => (
                <div
                  key={initials}
                  aria-hidden
                  className="flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] font-display text-xl font-bold tracking-tight text-accent-soft"
                >
                  {initials}
                </div>
              ))}
            </div>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-white/35">
              {t("landing.about.founders")}
            </p>
          </div>
        </div>
      </section>

      {/* ==================== FAQ ==================== */}
      <section id="faq" className={`${SECTION} bg-ink-soft`}>
        <div className="mx-auto max-w-3xl">
          <SectionHead eyebrow={t("landing.faq.eyebrow")} heading={t("landing.faq.heading")} center />

          {/* Native <details> — an accordion with keyboard support and no JS. */}
          <div className="mt-12 divide-y divide-white/10 border-y border-white/10">
            {faqs.map((f) => (
              <details key={f.q} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left font-display text-lg font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown
                    aria-hidden
                    className="h-5 w-5 shrink-0 text-accent-soft transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="pb-6 pr-9 text-sm leading-relaxed text-white/60">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
