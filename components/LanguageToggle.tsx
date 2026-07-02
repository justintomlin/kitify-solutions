"use client";

import { Languages } from "lucide-react";
import { useLanguage } from "./LanguageContext";

export function LanguageToggle({ variant = "light" }: { variant?: "light" | "dark" }) {
  const { toggle, t, lang } = useLanguage();
  const base =
    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-xs font-medium transition-colors";
  const styles =
    variant === "dark"
      ? "border-white/20 text-white/80 hover:bg-white/10"
      : "border-line text-ink/70 hover:bg-ink/5";
  return (
    <button
      type="button"
      onClick={toggle}
      className={`${base} ${styles}`}
      aria-label={t("lang.label")}
      title={t("lang.label")}
    >
      <Languages className="h-3.5 w-3.5" />
      <span>{lang === "en" ? "ES" : "EN"}</span>
    </button>
  );
}
