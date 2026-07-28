"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthContext";
import { useLanguage } from "@/components/LanguageContext";
import { LanguageToggle } from "@/components/LanguageToggle";
import { KitMark } from "@/components/Brand";

type Mode = "signin" | "signup";

const FIELD =
  "mt-1.5 w-full rounded-lg border border-line bg-card px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";
const FIELD_LABEL = "font-mono text-[11px] uppercase tracking-[0.12em] text-muted";

export default function LoginPage() {
  const { t } = useLanguage();
  const { user, loading, signIn, signUp } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in → skip the login page. Wait for the session to resolve first so we
  // don't flash the form to an authenticated user.
  useEffect(() => {
    if (!loading && user) router.replace("/portal/dashboard");
  }, [loading, user, router]);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
  }

  // Auth errors come back either as an i18n key ("login.err*") or a raw Supabase message.
  const showError = error ? (error.startsWith("login.") ? t(error) : error) : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: err } = await signIn(email.trim(), password);
        if (err) { setError(err); return; }
        router.replace("/portal/dashboard"); // (the user effect also covers this)
      } else {
        const { error: err, needsConfirmation } = await signUp(email.trim(), password, name.trim(), company.trim());
        if (err) { setError(err); return; }
        if (needsConfirmation) {
          setNotice(t("login.checkEmail"));
          setMode("signin");
        } else {
          router.replace("/portal/dashboard");
        }
      }
    } catch {
      setError(t("login.errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";

  // While the initial session resolves (or once we know a user exists and are redirecting),
  // show a spinner instead of the form to avoid a flash.
  if (loading || user) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
      </div>
    );
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
            {isSignup ? t("login.signUpHeading") : t("login.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{isSignup ? t("login.signUpSub") : t("login.sub")}</p>

          {/* Mode toggle */}
          <div className="mt-6 grid grid-cols-2 gap-1 rounded-lg border border-line bg-paper p-1">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${!isSignup ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {t("login.signIn")}
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${isSignup ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {t("login.createAccount")}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {isSignup && (
              <>
                <div>
                  <label className={FIELD_LABEL}>{t("login.name")}</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={FIELD} autoComplete="name" />
                </div>
                <div>
                  <label className={FIELD_LABEL}>{t("login.company")}</label>
                  <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} className={FIELD} autoComplete="organization" />
                </div>
              </>
            )}

            <div>
              <label className={FIELD_LABEL}>{t("login.email")}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={FIELD} autoComplete="email" />
            </div>

            <div>
              <label className={FIELD_LABEL}>{t("login.password")}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={FIELD}
                autoComplete={isSignup ? "new-password" : "current-password"}
              />
            </div>

            {showError ? (
              <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber-700">{showError}</p>
            ) : null}
            {notice ? (
              <p className="rounded-md border border-accent/30 bg-accent-soft/30 px-3 py-2 text-sm text-ink">{notice}</p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? isSignup ? t("login.creating") : t("login.signingIn")
                : isSignup ? t("login.createAccount") : t("login.signIn")}
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
