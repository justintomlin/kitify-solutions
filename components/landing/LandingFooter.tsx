"use client";

import Link from "next/link";
import { Mail } from "lucide-react";
import { KitMark } from "@/components/Brand";
import { useLanguage } from "@/components/LanguageContext";
import { SECTIONS, scrollToAnchor } from "./anchors";

// PLACEHOLDER: no mailbox is live on kitifysolutions.com yet. Swap this for the
// real inbox once the domain's mail is set up.
const CONTACT_EMAIL = "hello@kitifysolutions.com";

export function LandingFooter() {
  const { t } = useLanguage();

  return (
    <footer className="border-t border-white/10 bg-ink px-5 py-14 text-white sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <KitMark className="h-6 w-6 text-accent-soft" />
            <span className="font-display text-lg font-bold tracking-tight">Kitify Solutions</span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/55">
            {t("landing.footer.blurb")}
          </p>
        </div>

        <div>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            {t("landing.footer.explore")}
          </h2>
          <ul className="mt-4 space-y-2">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => scrollToAnchor(e, s.id)}
                  className="text-sm text-white/65 transition-colors hover:text-white"
                >
                  {t(s.labelKey)}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            {t("landing.footer.contact")}
          </h2>
          <ul className="mt-4 space-y-3">
            <li>
              <Link
                href="/login"
                className="inline-flex items-center text-sm font-semibold text-accent-soft transition-colors hover:text-white"
              >
                {t("landing.nav.access")}
              </Link>
            </li>
            <li>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="inline-flex items-center gap-2 text-sm text-white/65 transition-colors hover:text-white"
              >
                <Mail className="h-4 w-4 shrink-0" aria-hidden />
                {CONTACT_EMAIL}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-12 flex max-w-6xl flex-col gap-2 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-white/40">{t("landing.footer.rights")}</p>
        {/* The portal's own tagline, kept verbatim so the two surfaces sign off the same way. */}
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent-soft/70">
          {t("brand.tagline")}
        </p>
      </div>
    </footer>
  );
}
