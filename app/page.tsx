"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthContext";
import { useLanguage } from "@/components/LanguageContext";
import { LanguageToggle } from "@/components/LanguageToggle";
import { KitMark } from "@/components/Brand";

const DEMO_ADMIN_USERNAME = "solutiondemo";
const DEMO_ADMIN_PASSWORD = "kitifysolutions2026";

export default function LoginPage() {
  const { t } = useLanguage();
  const { user, ready, login } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // If already signed in, skip the login page.
  useEffect(() => {
    if (ready && user) router.replace("/portal/dashboard");
  }, [ready, user, router]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const normalizedUsername = username.trim().toLowerCase();
    const normalizedPassword = password.trim();

    if (normalizedUsername !== DEMO_ADMIN_USERNAME || normalizedPassword !== DEMO_ADMIN_PASSWORD) {
      setError(t("login.invalidCredentials"));
      return;
    }

    setError("");
    login("Admin", "admin");
    router.push("/portal/dashboard");
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel — the hero: tagline + module-grid motif */}
      <div className="relative hidden overflow-hidden bg-ink px-12 py-14 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5">
          <KitMark className="h-7 w-7 text-accent" />
          <span className="font-display text-xl font-bold tracking-tight">Kitify Solutions</span>
          <span className="ml-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
            {t("brand.portal")}
          </span>
        </div>

        <div className="my-auto max-w-md">
          <div className="mb-5 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
            Partner Network
          </div>
          <h1 className="font-display text-4xl font-bold leading-[1.1] tracking-tight">
            {t("brand.tagline")}
          </h1>
          <p className="mt-5 text-white/55">{t("login.sub")}</p>
        </div>

        {/* Ambient module grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -bottom-16 grid grid-cols-4 gap-3 opacity-[0.12]"
        >
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="h-14 w-14 rounded-md border border-white/40" />
          ))}
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 lg:hidden">
            <KitMark className="h-6 w-6 text-accent" />
            <span className="font-display text-lg font-bold">Kitify Solutions</span>
          </div>
          <div className="ml-auto">
            <LanguageToggle />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            {t("login.heading")}
          </h2>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div>
              <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                {t("login.username")}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-line bg-card px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                autoComplete="username"
              />
            </div>

            <div>
              <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                {t("login.password")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-line bg-card px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                autoComplete="current-password"
              />
            </div>

            {error ? (
              <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber-700">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              {t("login.signIn")}
            </button>
          </form>

          <div className="mt-8 border-t border-line pt-5 text-sm text-muted">
            {t("login.noAccount")}{" "}
            <Link href="/request-access" className="font-medium text-accent hover:underline">
              {t("login.requestAccess")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
