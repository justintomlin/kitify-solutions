"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { KitMark } from "@/components/Brand";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useLanguage } from "@/components/LanguageContext";
import { SECTIONS, scrollToAnchor } from "./anchors";

/**
 * Sticky nav for the public landing page. Deliberately not the portal Header:
 * nothing here is authenticated, so there is no user, no role and no sidebar
 * toggle — just the wordmark, the anchor links, the language switcher and the
 * one door into the portal.
 *
 * The breakpoints here are set by MEASURED width, not by habit, because two
 * things make this bar wider than it looks:
 *   - globals.css gives every button a 44px min-width below 1024px, so the
 *     three-code language switcher costs ~165px on a phone, not ~90px.
 *   - "Contractor Access" is "Acceso de contratistas" in Spanish, roughly a
 *     third wider, and the bar has to hold the longest translation.
 * So each item earns its place in the bar at the width it actually fits:
 * the switcher from sm, the CTA from md, the link row from xl. Everything
 * below its own breakpoint lives in the disclosure panel instead.
 */
export function LandingNav() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  function jump(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    scrollToAnchor(e, id);
    setOpen(false);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-ink/90 backdrop-blur-md">
      <nav
        aria-label={t("landing.nav.sections")}
        className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-8"
      >
        {/* Wordmark — no logo art yet, so the KitMark plus the name in display type. */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-white">
          <KitMark className="h-6 w-6 text-accent-soft" />
          <span className="font-display text-lg font-bold tracking-tight">Kitify Solutions</span>
        </Link>

        <div className="hidden flex-1 items-center justify-center gap-0.5 xl:flex">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => jump(e, s.id)}
              className="whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white"
            >
              {t(s.labelKey)}
            </a>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 xl:ml-0">
          <div className="hidden sm:block">
            <LanguageToggle variant="dark" />
          </div>

          <Link
            href="/login"
            className="hidden whitespace-nowrap rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-125 md:inline-flex md:items-center"
          >
            {t("landing.nav.access")}
          </Link>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="landing-menu"
            aria-label={open ? t("landing.nav.closeMenu") : t("landing.nav.openMenu")}
            className="inline-flex items-center justify-center rounded-lg border border-white/15 p-2 text-white/80 transition hover:bg-white/5 hover:text-white xl:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile / tablet disclosure. Rendered conditionally rather than hidden so
          the links are out of the tab order when the panel is closed. */}
      {open ? (
        <div id="landing-menu" className="border-t border-white/10 bg-ink px-5 py-3 sm:px-8 xl:hidden">
          <div className="mx-auto flex max-w-6xl flex-col">
            {/* Phone-only home for the switcher — from sm up it sits in the bar. */}
            <div className="mb-2 flex justify-start sm:hidden">
              <LanguageToggle variant="dark" />
            </div>

            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => jump(e, s.id)}
                className="flex items-center rounded-md px-2 py-3 text-base font-medium text-white/75 transition-colors hover:bg-white/5 hover:text-white"
              >
                {t(s.labelKey)}
              </a>
            ))}

            <Link
              href="/login"
              className="mt-2 flex items-center justify-center rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white md:hidden"
            >
              {t("landing.nav.access")}
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
