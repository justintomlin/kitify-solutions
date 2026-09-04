"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronDown,
  ClipboardList,
  CircleCheckBig,
  FileText,
  GraduationCap,
  PencilRuler,
  Presentation,
  Quote,
  SlidersHorizontal,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useMediaQuery } from "@/lib/useMediaQuery";
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

/* ---------------------------------------------------------------------------
   Hero slideshow

   Four slides — three portal screenshots, then a short clip — crossfading on a
   loop with no controls. The stills and the video are all ~2:1, so they share
   one frame; the frame sits inside a box with the same aspect ratio the plan
   sketch it replaced had (420x340), which is what keeps the hero from resizing
   when the slides change or before the first image decodes.
   --------------------------------------------------------------------------- */

const HERO_STILLS = [
  "/hero-slideshow/still-1.png",
  "/hero-slideshow/still-2.png",
  "/hero-slideshow/still-3.png",
];
const HERO_VIDEO = "/hero-slideshow/hero-still-video.mp4";
/** The video is the last slide; the sequence wraps from it back to still 1. */
const HERO_VIDEO_INDEX = HERO_STILLS.length;
const HERO_SLIDE_COUNT = HERO_STILLS.length + 1;

/** How long each still holds before advancing. */
const HERO_STILL_MS = 3500;
/**
 * Safety net for the video slide. Normally `onEnded` advances it (the clip runs
 * ~3.2s), but if the browser blocks autoplay or the decode fails, `ended` never
 * fires and the carousel would stall on a black frame forever. This advances
 * anyway, comfortably after the clip should have finished.
 */
const HERO_VIDEO_MAX_MS = 8000;

function HeroSlideshow({
  alts,
  videoLabel,
  reducedMotion,
}: {
  alts: string[];
  videoLabel: string;
  reducedMotion: boolean;
}) {
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const showingVideo = index === HERO_VIDEO_INDEX;

  const advance = () => setIndex((i) => (i + 1) % HERO_SLIDE_COUNT);

  // The clock. Stills get a fixed hold; the video gets its fallback ceiling.
  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setTimeout(
      () => setIndex((i) => (i + 1) % HERO_SLIDE_COUNT),
      showingVideo ? HERO_VIDEO_MAX_MS : HERO_STILL_MS,
    );
    return () => window.clearTimeout(id);
  }, [index, showingVideo, reducedMotion]);

  // Play only on the video's turn, and rewind on the way out so the loop always
  // replays the clip from the top rather than resuming its last frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || reducedMotion) return;
    if (showingVideo) {
      v.currentTime = 0;
      // Autoplay can still be refused; the fallback timer above covers that.
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [showingVideo, reducedMotion]);

  return (
    // Outer box: the plan sketch's footprint, so the hero grid is unchanged.
    <div className="mx-auto grid aspect-[420/340] w-full max-w-lg place-items-center">
      {/* Inner frame: the screenshots' own 1915x942 ratio, so object-cover crops nothing. */}
      <div className="relative aspect-[1915/942] w-full overflow-hidden rounded-xl border border-white/10 bg-ink-soft shadow-2xl shadow-black/40">
        {HERO_STILLS.map((src, i) => (
          <Image
            key={src}
            src={src}
            alt={alts[i] ?? ""}
            fill
            sizes="(min-width: 1024px) 32rem, 100vw"
            // Slide 1 is above the fold and is what a reduced-motion visitor sees.
            priority={i === 0}
            className={`object-cover transition-opacity duration-300 ${
              index === i ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}

        {/* Skipped entirely under reduced motion — nothing to play, nothing to fetch. */}
        {reducedMotion ? null : (
          <video
            ref={videoRef}
            src={HERO_VIDEO}
            aria-label={videoLabel}
            muted
            playsInline
            preload="metadata"
            onEnded={advance}
            onError={advance}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              showingVideo ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   How-it-works card

   Default state is the plain card. When it becomes active — hover on a pointer
   device, tap on a touch one — its clip fades in behind the copy and the icon
   fades out. The clip covers the whole card rather than the 28px icon slot:
   the brief asked for the icon area to swap, but a video that size reads as
   noise, and growing the slot would change how the card looks at rest, which
   the brief also ruled out. A full-bleed layer does both — the resting card is
   untouched and the clip is actually watchable.
   --------------------------------------------------------------------------- */

function StepCard({
  icon: Icon,
  video,
  n,
  stepLabel,
  title,
  body,
  active,
  reducedMotion,
  onActivate,
  onDeactivate,
  canHover,
}: {
  icon: LucideIcon;
  video: string;
  n: string;
  stepLabel: string;
  title: string;
  body: string;
  active: boolean;
  reducedMotion: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  canHover: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playing = active && !reducedMotion;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      void v.play().catch(() => {});
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [playing]);

  return (
    <li
      className={`${CARD} relative overflow-hidden`}
      // Same split as the partner cards: mouseenter on a touchscreen makes the
      // first tap open and the click that follows immediately close again.
      onMouseEnter={canHover ? onActivate : undefined}
      onMouseLeave={canHover ? onDeactivate : undefined}
      onClick={canHover ? undefined : active ? onDeactivate : onActivate}
    >
      {reducedMotion ? null : (
        <>
          <video
            ref={videoRef}
            src={video}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              playing ? "opacity-100" : "opacity-0"
            }`}
          />
          {/* Scrim — the copy stays readable over whatever frame is on screen. All three
              clips are screen recordings of a light UI, so this has to be heavy; at 75% the
              body text washed out against the white configurator behind it. */}
          <div
            aria-hidden
            className={`absolute inset-0 bg-ink/85 transition-opacity duration-300 ${
              playing ? "opacity-100" : "opacity-0"
            }`}
          />
        </>
      )}

      <div className="relative">
        <div className="flex items-center justify-between">
          <Icon
            className={`h-7 w-7 text-accent-soft transition-opacity duration-300 ${
              playing ? "opacity-0" : "opacity-100"
            }`}
            aria-hidden
          />
          <span aria-hidden className="font-display text-4xl font-bold text-white/10">
            {n}
          </span>
        </div>
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-accent-soft/70">
          {stepLabel}
        </p>
        <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">{title}</h3>
        {/* The body copy lifts while the clip runs: even under the scrim, a bright frame
            behind it eats enough contrast that white/60 stops being comfortable. */}
        <p
          className={`mt-3 text-sm leading-relaxed transition-colors duration-300 ${
            playing ? "text-white/85" : "text-white/60"
          }`}
        >
          {body}
        </p>
      </div>
    </li>
  );
}

export default function LandingPage() {
  const { t } = useLanguage();

  /* Partner "why we chose them" reveal.
     There is no existing rollover card in the app to copy, so this is the pattern: one
     open card at a time, opened by hover on pointer devices and by tap on touch ones.
     `(hover: hover)` is what separates them — attaching mouseenter on a touchscreen makes
     the first tap open the card and the click that follows immediately close it again.
     serverValue true so the pre-hydration HTML reads as the pointer case; useSyncExternalStore
     gives the real answer on the first client render. */
  const canHover = useMediaQuery("(hover: hover)", true);
  const [openPartner, setOpenPartner] = useState<string | null>(null);
  const closePartner = (key: string) => setOpenPartner((cur) => (cur === key ? null : cur));

  /* Anyone who has asked their OS to calm animations down gets the page as it was before the
     media landed: a single still in the hero, icons on the step cards, no clips at all.
     serverValue false so the server markup is the animated case, which is the common one. */
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", false);

  // Same one-at-a-time pattern as the partner cards above.
  const [openStep, setOpenStep] = useState<string | null>(null);

  const steps: { icon: LucideIcon; video: string; n: string; title: string; body: string }[] = [
    { icon: PencilRuler, video: "/three-steps/draw.mp4", n: "01", title: t("landing.how.drawTitle"), body: t("landing.how.drawBody") },
    { icon: Truck, video: "/three-steps/deliver.mp4", n: "02", title: t("landing.how.deliverTitle"), body: t("landing.how.deliverBody") },
    { icon: CircleCheckBig, video: "/three-steps/done.mp4", n: "03", title: t("landing.how.doneTitle"), body: t("landing.how.doneBody") },
  ];

  /* Six line items — flooring and wall base ship and install together, so they read as one
     card. Flooring stays unbranded in the copy (it is a white-box product); `position` is
     what keeps the crop honest, since these are portrait and square plates going into a 4:3
     box. Delta's is pinned to the top because its wordmark sits in the top-left corner and a
     centred crop would slice through it. */
  const kit: { image: string; position: string; title: string; body: string; alt: string }[] = [
    { image: "/whats-in-the-kit/nature-panel.png", position: "object-center", title: t("landing.kit.naturePanelTitle"), body: t("landing.kit.naturePanelBody"), alt: t("landing.kit.naturePanelAlt") },
    { image: "/whats-in-the-kit/nuvo-spc.png", position: "object-center", title: t("landing.kit.nuvoTitle"), body: t("landing.kit.nuvoBody"), alt: t("landing.kit.nuvoAlt") },
    { image: "/whats-in-the-kit/therma-glass.png", position: "object-center", title: t("landing.kit.thermaGlassTitle"), body: t("landing.kit.thermaGlassBody"), alt: t("landing.kit.thermaGlassAlt") },
    { image: "/whats-in-the-kit/cs-factory.png", position: "object-center", title: t("landing.kit.csTitle"), body: t("landing.kit.csBody"), alt: t("landing.kit.csAlt") },
    { image: "/whats-in-the-kit/delta-plumbing.png", position: "object-top", title: t("landing.kit.deltaTitle"), body: t("landing.kit.deltaBody"), alt: t("landing.kit.deltaAlt") },
    { image: "/whats-in-the-kit/flooring-base.png", position: "object-center", title: t("landing.kit.flooringTitle"), body: t("landing.kit.flooringBody"), alt: t("landing.kit.flooringAlt") },
  ];

  /* Supplier names are proper nouns and stay untranslated; what they supply and why we
     picked them do not. `w`/`h` are each file's INTRINSIC pixel size (the SVG's viewBox),
     which is what next/image needs to reserve the right box before the file loads — the
     rendered height is capped by CSS, and `w-auto` keeps the aspect ratio.
     Every logo sits on a white plate: the art in all six is dark (the NuVo vector is solid
     black, and the three JPEGs carry their own white background), so a dark card would
     swallow them. */
  const partners = [
    { key: "naturePanel", name: "Nature Panel", logo: "/partner_brands/nature_panel_logo.png", w: 447, h: 447,
      role: t("landing.partners.naturePanelRole"), why: t("landing.partners.naturePanelWhy") },
    // The only SVG in the set, so the only one that skips the image optimizer — Next refuses
    // to process SVG unless `dangerouslyAllowSVG` is on, and a 15 KB vector gains nothing by it.
    { key: "nuvo", name: "NuVo", logo: "/partner_brands/nuvo-logo.svg", w: 3125, h: 800, vector: true,
      role: t("landing.partners.nuvoRole"), why: t("landing.partners.nuvoWhy") },
    // therma_glass.jpg is a 900x900 canvas whose wordmark fills 8% of it; scaled to fit a
    // logo row that renders illegibly small. -trim.png is the same art cropped to its bounds.
    { key: "thermaGlass", name: "ThermaGlass", logo: "/partner_brands/therma_glass-trim.png", w: 771, h: 130,
      role: t("landing.partners.thermaGlassRole"), why: t("landing.partners.thermaGlassWhy") },
    { key: "cs", name: "CS Factory", logo: "/partner_brands/csfactory_logo.jpeg", w: 1280, h: 680,
      role: t("landing.partners.csRole"), why: t("landing.partners.csWhy") },
    // delta_logo.png is a JPEG despite the .png name (harmless — the optimizer sniffs the real
    // format) but it also has a transparency CHECKERBOARD baked into its pixels, from a
    // screenshot of a transparent original. -trim.png flattens that to white and crops the
    // 79% empty canvas. Replace both with a clean vendor file when one is available.
    { key: "delta", name: "Delta Faucet", logo: "/partner_brands/delta_logo-trim.png", w: 320, h: 86,
      role: t("landing.partners.deltaRole"), why: t("landing.partners.deltaWhy") },
    { key: "durato", name: "Durato", logo: "/partner_brands/durato-logo.png", w: 3300, h: 772,
      role: t("landing.partners.duratoRole"), why: t("landing.partners.duratoWhy") },
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

          <HeroSlideshow
            alts={[t("landing.hero.slide1Alt"), t("landing.hero.slide2Alt"), t("landing.hero.slide3Alt")]}
            videoLabel={t("landing.hero.videoLabel")}
            reducedMotion={reducedMotion}
          />
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
              <StepCard
                key={s.n}
                icon={s.icon}
                video={s.video}
                n={s.n}
                stepLabel={t("landing.how.step", { n: String(i + 1) })}
                title={s.title}
                body={s.body}
                active={openStep === s.n}
                reducedMotion={reducedMotion}
                canHover={canHover}
                onActivate={() => setOpenStep(s.n)}
                onDeactivate={() => setOpenStep((cur) => (cur === s.n ? null : cur))}
              />
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
                <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-white/10 bg-ink-soft">
                  <Image
                    src={k.image}
                    alt={k.alt}
                    fill
                    sizes="(min-width: 1024px) 22rem, (min-width: 640px) 45vw, 90vw"
                    className={`object-cover ${k.position}`}
                  />
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

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {partners.map((p) => {
              const open = openPartner === p.key;
              return (
                <article
                  key={p.key}
                  className={`${CARD} relative flex min-h-[19rem] flex-col p-0`}
                  onMouseEnter={canHover ? () => setOpenPartner(p.key) : undefined}
                  onMouseLeave={canHover ? () => closePartner(p.key) : undefined}
                >
                  {/* The whole card is the control, so a tap anywhere on it reveals the blurb
                      and it reaches the keyboard as one stop rather than six. */}
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`partner-why-${p.key}`}
                    onClick={() => setOpenPartner((cur) => (cur === p.key ? null : p.key))}
                    onFocus={() => setOpenPartner(p.key)}
                    onBlur={() => closePartner(p.key)}
                    className="flex flex-1 flex-col items-start p-6 text-left"
                  >
                    <div className="flex h-24 w-full items-center justify-center rounded-lg bg-white p-4">
                      {/* Bounded by the plate on BOTH axes rather than by a fixed height:
                          these six logos run from square (447x447) to 4:1 (3300x772), and
                          capping height alone shrinks the square ones to a thumbnail.
                          width/height:auto is what next/image asks for when CSS resizes it. */}
                      <Image
                        src={p.logo}
                        alt={p.name}
                        width={p.w}
                        height={p.h}
                        unoptimized={p.vector}
                        style={{ width: "auto", height: "auto" }}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                    <h3 className="mt-5 font-display text-lg font-bold tracking-tight">{p.name}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-white/65">{p.role}</p>
                    <span className="mt-auto pt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-accent-soft/70">
                      {canHover ? t("landing.partners.whyHint") : t("landing.partners.whyHintTouch")}
                    </span>
                  </button>

                  {open ? (
                    <div
                      id={`partner-why-${p.key}`}
                      // Covers the card rather than floating beside it: a popover anchored to
                      // the bottom row of a six-card grid would open off the bottom of the
                      // viewport, and this needs no collision handling to stay on screen.
                      className="absolute inset-0 z-10 flex animate-[fadeIn_140ms_ease-out] flex-col rounded-2xl border border-accent/40 bg-ink/95 p-6 backdrop-blur-sm"
                    >
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent-soft">
                        {t("landing.partners.whyLabel")}
                      </p>
                      <p className="mt-3 overflow-y-auto text-sm leading-relaxed text-white/80">
                        {p.why}
                      </p>
                      {!canHover ? (
                        <button
                          type="button"
                          onClick={() => setOpenPartner(null)}
                          className="mt-auto flex items-center gap-1.5 self-start pt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-white/50"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                          {t("landing.partners.close")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
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
