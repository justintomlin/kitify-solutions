"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { type Lang, translate, translateList } from "@/lib/i18n";

type LanguageContextValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: string, vars?: Record<string, string>) => string;
  tList: (key: string) => string[];
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "kitify_lang";

// The languages the portal ships, in the order the switcher shows them. Exported so the
// switcher renders exactly what the dictionary holds rather than a hand-kept second list.
export const LANGS = ["en", "es", "ru"] as const;

const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // Restore saved language on first load. Anything unrecognised — a language that has since
  // been removed, or a hand-edited value — falls back to English rather than being trusted.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (isLang(saved)) setLangState(saved);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, l);
  }, []);

  // Kept for callers that just want "the next one". With three languages it cycles rather
  // than flips; the switcher itself uses setLang, so nothing depends on the order.
  const toggle = useCallback(() => {
    const i = LANGS.indexOf(lang);
    setLang(LANGS[(i + 1) % LANGS.length]);
  }, [lang, setLang]);

  const t = useCallback(
    (key: string, vars?: Record<string, string>) => translate(lang, key, vars),
    [lang]
  );

  const tList = useCallback((key: string) => translateList(lang, key), [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggle, t, tList }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
