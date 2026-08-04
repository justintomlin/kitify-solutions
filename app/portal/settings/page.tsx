"use client";

// Contractor settings — company branding as the homeowner sees it on an estimate.
//
// Everything here is the contractor's own identity. Kitify never appears on a proposal, so
// these fields are the only branding a homeowner ever sees; leaving them blank degrades to
// the plain header the proposal has always had rather than falling back to ours.

import { useEffect, useRef, useState } from "react";
import { Check, Upload, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { updateProfile } from "@/lib/store";
import { supabase } from "@/lib/supabase";

const INPUT =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";

const LOGO_BUCKET = "company-logos";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export default function SettingsPage() {
  const { t } = useLanguage();
  const { profile, refreshProfile } = useAuth();

  const [company, setCompany] = useState("");
  const [tagline, setTagline] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [logo, setLogo] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Seed from the profile once it resolves. Keyed on the id so switching accounts reseeds,
  // but typing isn't clobbered by an unrelated profile refresh.
  useEffect(() => {
    if (!profile) return;
    setCompany(profile.company ?? "");
    setTagline(profile.companyTagline ?? "");
    setWebsite(profile.companyWebsite ?? "");
    setPhone(profile.phone ?? "");
    setLogo(profile.companyLogo ?? "");
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!profile) return;
    setSaving(true);
    setError("");
    try {
      await updateProfile(profile.id, {
        company: company.trim() || null,
        companyTagline: tagline.trim() || null,
        companyWebsite: website.trim() || null,
        phone: phone.trim() || null,
        companyLogo: logo.trim() || null,
      });
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError(t("settings.saveError"));
    }
    setSaving(false);
  }

  /**
   * Upload a logo to Supabase Storage, degrading to the URL field when the bucket isn't
   * there. The bucket is a manual step (see the migration file), and a contractor who hits
   * this before an admin has created it should be told what to do instead of watching an
   * upload fail silently.
   */
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after an error
    if (!file || !profile) return;
    if (!file.type.startsWith("image/")) { setError(t("settings.logoWrongType")); return; }
    if (file.size > MAX_LOGO_BYTES) { setError(t("settings.logoTooLarge")); return; }

    setUploading(true);
    setError("");
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${profile.id}/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { upsert: true });
    if (upErr) {
      // "Bucket not found" is the expected pre-setup case; anything else is a real failure.
      const missing = /bucket.*not.*found|does not exist/i.test(upErr.message);
      setError(missing ? t("settings.logoBucketMissing") : t("settings.saveError"));
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
    setLogo(data.publicUrl);
    setUploading(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-2xl border border-line bg-card px-5 py-4">
        <div className="mb-1 font-mono text-sm uppercase tracking-[0.12em] text-accent">{t("settings.title")}</div>
        <p className="text-sm leading-6 text-ink/75">{t("settings.desc")}</p>
      </div>

      <div className="rounded-2xl border border-line bg-card p-5">
        <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("settings.brandingTitle")}</div>
        <p className="mb-4 text-xs leading-relaxed text-muted">{t("settings.brandingHint")}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("settings.company")}>
            <input value={company} onChange={(e) => setCompany(e.target.value)} className={INPUT} />
          </Field>
          <Field label={t("settings.phone")}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t("settings.tagline")}>
              <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder={t("settings.taglinePlaceholder")} className={INPUT} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label={t("settings.website")}>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" className={INPUT} />
            </Field>
          </div>
        </div>

        {/* Logo: upload when storage is available, paste a URL when it isn't. */}
        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("settings.logo")}</div>
          <div className="flex flex-wrap items-center gap-3">
            {logo && (
              <span className="flex h-12 items-center rounded-lg border border-line bg-paper px-3">
                {/* Plain <img>: an arbitrary contractor-supplied URL, which next/image would
                    refuse without its host allowlisted — and any partner can set one. */}
                <img src={logo} alt="" className="h-9 w-auto max-w-[160px] object-contain" />
              </span>
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium transition hover:border-accent hover:text-accent disabled:opacity-50">
              <Upload className="h-4 w-4" /> {uploading ? t("settings.logoUploading") : t("settings.logoUpload")}
            </button>
            {logo && (
              <button type="button" onClick={() => setLogo("")}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-muted transition hover:border-amber hover:text-amber">
                <X className="h-4 w-4" /> {t("settings.logoRemove")}
              </button>
            )}
          </div>
          <div className="mt-3">
            <Field label={t("settings.logoUrl")} hint={t("settings.logoHint")}>
              <input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://" className={INPUT} />
            </Field>
          </div>
        </div>

        {error && <div className="mt-3 rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber">{error}</div>}

        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={saving || !profile}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
            {saving ? t("settings.saving") : t("settings.save")}
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm text-success">
              <Check className="h-4 w-4" /> {t("settings.saved")}
            </span>
          )}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">{t("settings.brandingNote")}</p>
      </div>

      {/* What the homeowner will see at the top of an estimate. */}
      <div className="rounded-2xl border border-line bg-card p-5">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("settings.previewTitle")}</div>
        <div className="rounded-xl border border-line bg-paper p-5">
          <div className="flex items-center gap-3">
            {logo && <img src={logo} alt="" className="h-11 w-auto max-w-[168px] object-contain" />}
            <div className="min-w-0">
              <div className="truncate font-display text-lg font-bold leading-tight text-ink">
                {company || profile?.company || profile?.name || ""}
              </div>
              {tagline && <div className="truncate text-xs text-muted">{tagline}</div>}
            </div>
          </div>
          <div className="mt-3 text-xs text-muted">
            {[phone, profile?.email, website].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
    </div>
  );
}
