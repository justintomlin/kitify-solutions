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

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // Restore saved language on first load.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (saved === "en" || saved === "es") setLangState(saved);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const toggle = useCallback(() => setLang(lang === "en" ? "es" : "en"), [lang, setLang]);

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
