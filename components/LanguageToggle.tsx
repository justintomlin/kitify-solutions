"use client";

import { Languages } from "lucide-react";
import { LANGS, useLanguage } from "./LanguageContext";
import type { Lang } from "@/lib/i18n";

/**
 * The language switcher. A two-language toggle could say "the other one" and be understood;
 * with three, cycling through them blind is a guessing game, so this is a segmented control
 * that shows every language at once and switches straight to the one you press.
 *
 * The codes are ISO 639-1, not translated strings — "EN" is EN in every language. The titles
 * are endonyms, each written in its own language, which is how a language picker is read: a
 * Russian speaker looking for their language is looking for "Русский", not for "Russian".
 */
const NATIVE: Record<Lang, string> = {
  en: "English",
  es: "Español",
  ru: "Русский",
};

export function LanguageToggle({ variant = "light" }: { variant?: "light" | "dark" }) {
  const { lang, setLang, t } = useLanguage();
  const dark = variant === "dark";
  return (
    <div
      role="group"
      aria-label={t("lang.label")}
      className={`inline-flex items-center gap-0.5 rounded-md border p-0.5 ${
        dark ? "border-white/20" : "border-line"
      }`}
    >
      <Languages className={`mx-1 h-3.5 w-3.5 shrink-0 ${dark ? "text-white/60" : "text-ink/50"}`} aria-hidden />
      {LANGS.map((l) => {
        const active = l === lang;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            // aria-pressed rather than a radio group: this is three toggle buttons that
            // happen to be mutually exclusive, and pressing one is an action, not a form value.
            aria-pressed={active}
            title={NATIVE[l]}
            lang={l}
            className={`rounded px-1.5 py-1 font-mono text-xs font-medium transition-colors ${
              active
                ? dark
                  ? "bg-white/20 text-white"
                  : "bg-ink text-paper"
                : dark
                  ? "text-white/70 hover:bg-white/10"
                  : "text-ink/60 hover:bg-ink/5"
            }`}
          >
            {l.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
