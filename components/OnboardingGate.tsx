"use client";

// First-login onboarding for admin-created contractors. Runs inside the portal shell (after
// auth). Blocks the whole portal until the contractor (1) sets a permanent password if their
// account was created with a temporary one, then (2) confirms their profile info. Neither
// overlay can be dismissed. Existing / self-created accounts skip both (flags are false/true).

import { useState } from "react";
import { useAuth, type Profile } from "@/components/AuthContext";
import { useLanguage } from "@/components/LanguageContext";
import { supabase } from "@/lib/supabase";
import { updateProfile } from "@/lib/store";

const INPUT =
  "mt-1.5 w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60";
const LABEL = "font-mono text-[11px] uppercase tracking-[0.12em] text-muted";

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { profile, userId, refreshProfile } = useAuth();

  if (!profile || !userId) return <>{children}</>; // not loaded / no profile → nothing to gate
  if (profile.mustChangePassword) return <PasswordStep profile={profile} onDone={refreshProfile} />;
  if (!profile.profileConfirmed) return <ConfirmStep profile={profile} onDone={refreshProfile} />;
  return <>{children}</>;
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/60 p-4 sm:items-center">
      <div className="my-auto w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-xl sm:p-7">{children}</div>
    </div>
  );
}

function PasswordStep({ profile, onDone }: { profile: Profile; onDone: () => Promise<void> }) {
  const { t } = useLanguage();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setError(t("onboarding.pwTooShort")); return; }
    if (pw !== confirm) { setError(t("onboarding.pwMismatch")); return; }
    setError("");
    setBusy(true);
    try {
      const { error: pwErr } = await supabase.auth.updateUser({ password: pw });
      if (pwErr) { setError(pwErr.message); setBusy(false); return; }
      await updateProfile(profile.id, { mustChangePassword: false, firstLoginAt: profile.firstLoginAt ?? new Date().toISOString() });
      await onDone();
    } catch {
      setError(t("onboarding.error"));
      setBusy(false);
    }
  }

  return (
    <Overlay>
      <h1 className="font-display text-xl font-bold tracking-tight text-ink">{t("onboarding.pwTitle")}</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{t("onboarding.pwSub")}</p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block">
          <span className={LABEL}>{t("onboarding.newPassword")}</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" className={INPUT} required />
        </label>
        <label className="block">
          <span className={LABEL}>{t("onboarding.confirmPassword")}</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={INPUT} required />
        </label>
        {error && <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber-700">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? t("onboarding.saving") : t("onboarding.setPassword")}
        </button>
      </form>
    </Overlay>
  );
}

function ConfirmStep({ profile, onDone }: { profile: Profile; onDone: () => Promise<void> }) {
  const { t } = useLanguage();
  const [name, setName] = useState(profile.name);
  const [company, setCompany] = useState(profile.company ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [territory, setTerritory] = useState(profile.territory ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError(t("onboarding.nameRequired")); return; }
    setError("");
    setBusy(true);
    try {
      await updateProfile(profile.id, {
        name: name.trim(),
        company: company.trim() || null,
        phone: phone.trim() || null,
        territory: territory.trim() || null,
        profileConfirmed: true,
        firstLoginAt: profile.firstLoginAt ?? new Date().toISOString(),
      });
      await onDone();
    } catch {
      setError(t("onboarding.error"));
      setBusy(false);
    }
  }

  return (
    <Overlay>
      <h1 className="font-display text-xl font-bold tracking-tight text-ink">{t("onboarding.confirmTitle")}</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{t("onboarding.confirmSub")}</p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block">
          <span className={LABEL}>{t("onboarding.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} required />
        </label>
        <label className="block">
          <span className={LABEL}>{t("onboarding.email")}</span>
          <input value={profile.email} disabled className={INPUT} />
        </label>
        <label className="block">
          <span className={LABEL}>{t("onboarding.company")}</span>
          <input value={company} onChange={(e) => setCompany(e.target.value)} className={INPUT} />
        </label>
        <label className="block">
          <span className={LABEL}>{t("onboarding.phone")}</span>
          <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} />
        </label>
        <label className="block">
          <span className={LABEL}>{t("onboarding.territory")}</span>
          <input value={territory} onChange={(e) => setTerritory(e.target.value)} className={INPUT} />
        </label>
        {error && <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber-700">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? t("onboarding.saving") : t("onboarding.confirmSave")}
        </button>
      </form>
    </Overlay>
  );
}
