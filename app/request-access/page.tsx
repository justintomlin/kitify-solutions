"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { LanguageToggle } from "@/components/LanguageToggle";
import { KitMark } from "@/components/Brand";

const FIELDS = [
  { key: "name", type: "text" },
  { key: "company", type: "text" },
  { key: "email", type: "email" },
  { key: "phone", type: "tel" },
  { key: "location", type: "text" },
  { key: "role", type: "text" },
  { key: "volume", type: "text" },
  { key: "heard", type: "text" },
] as const;

export default function RequestAccessPage() {
  const { t } = useLanguage();
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // No backend in the scaffold — this is where the request would be sent to
    // the admin approvals queue.
    setSubmitted(true);
  }

  return (
    <div className="min-h-dvh">
      <div className="mx-auto flex max-w-xl flex-col px-6 py-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <KitMark className="h-6 w-6 text-accent" />
            <span className="font-display text-lg font-bold">Kitify Solutions</span>
          </Link>
          <LanguageToggle />
        </div>

        {submitted ? (
          <div className="mx-auto mt-24 max-w-md text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-accent" />
            <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">
              {t("request.thanksTitle")}
            </h1>
            <p className="mt-3 text-ink/70">{t("request.thanksBody")}</p>
            <Link
              href="/"
              className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("request.back")}
            </Link>
          </div>
        ) : (
          <div className="mt-10">
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {t("request.heading")}
            </h1>
            <p className="mt-2 text-ink/70">{t("request.sub")}</p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                    {t(`request.${f.key}`)}
                  </label>
                  <input
                    type={f.type}
                    className="mt-1.5 w-full rounded-lg border border-line bg-card px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              ))}

              <button
                type="submit"
                className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
              >
                {t("request.submit")}
              </button>

              <Link
                href="/"
                className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-ink"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("request.back")}
              </Link>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
