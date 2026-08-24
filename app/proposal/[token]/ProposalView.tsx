"use client";

// Client half of the public proposal page. Data is fetched server-side (page.tsx) and passed
// in as props — this component is only the interactive presentation: a Good/Better/Best tier
// toggle, a homeowner accept form, and the post-acceptance confirmation. NO auth, NO Supabase
// calls here (the accept POSTs to the server route); Kitify-absent chrome.
//
// The homeowner sees the RETAIL price only (dealer total × (1 + markup/100)); dealer cost and
// the markup percentage are never rendered.

import { useEffect, useState } from "react";
import { CheckCircle2, Printer } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { RoomPlanSVG, type RoomConfig } from "@/components/room/RoomConfigurator";
import { ShowerPreviewFromConfig, type ShowerConfig } from "@/components/shower/ShowerConfigurator";
import { VanityPreviewFromConfig, type VanityConfig } from "@/components/vanity/VanityConfigurator";
import { PlumbingPreviewFromConfig, type PlumbingConfig } from "@/components/plumbing/PlumbingConfigurator";
import { HeroPreview, hasHeroContent } from "@/components/configurator/HeroPreview";
import { quoteBathrooms, labelForBathroom, labelForTier, type Bathroom, type OptionNames } from "@/lib/bathrooms";

export type TierView = {
  room: unknown | null;
  shower: unknown | null;
  vanity: unknown | null;
  plumbing: unknown | null;
  /**
   * Present from Phase C1 onward, absent on a link served by an older deploy or read from a
   * pre-0018 database. Resolved through quoteBathrooms(), so both cases render the same —
   * which matters here more than anywhere else: homeowners hold these links already.
   */
  bathrooms?: unknown;
  dealerTotal: number;
};
/** A contractor-entered charge: labour, permits, disposal. Same across every tier. */
export type ProposalLineItem = { id: string; description: string; amount: number };

/** The contractor's own identity, frozen when the proposal was shared. */
export type ProposalBranding = {
  company: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  logo: string | null;
  tagline: string | null;
  website: string | null;
};

export type ProposalData = {
  name: string;
  markupPct: number;
  lineItems?: ProposalLineItem[];
  branding?: ProposalBranding | null;
  /**
   * What the contractor called each option. Absent on a link served by an older deploy or read
   * from a pre-0019 database, which reads as unnamed and falls back to "Option N".
   */
  optionNames?: OptionNames | null;
  tiers: { good: TierView | null; better: TierView | null; best: TierView | null };
};

type TierKey = "good" | "better" | "best";
type Acceptance = { status: string; acceptedTier: TierKey | null; acceptedBy: string | null };
type Tr = (key: string, vars?: Record<string, string>) => string;

const TIER_ORDER: TierKey[] = ["good", "better", "best"];
const INPUT =
  "w-full rounded-lg border border-line bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

const money = (n: number) =>
  Math.round(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function ProposalView({ payload, acceptance, token }: {
  payload: ProposalData | null;
  acceptance: Acceptance | null;
  token: string;
}) {
  const { t } = useLanguage();

  /**
   * What a homeowner sees on the toggle: the contractor's own name for the option, or
   * "Option 1 / 2 / 3".
   *
   * Never Good/Better/Best. That ladder is a database detail nobody chose — the columns keep
   * those names (see migration 0019) because the accept flow, the public route and every saved
   * row reference them, but it cannot describe what the three options on a real proposal
   * usually are, and it tells a homeowner that one of the things they are being offered is the
   * worst one.
   */
  const tierLabel = (k: TierKey) => labelForTier(k, payload?.optionNames ?? null, t);

  // "Better" is the pre-selected sales anchor; fall back to the first assigned tier.
  const [activeTier, setActiveTier] = useState<TierKey>(() => {
    if (payload?.tiers.better) return "better";
    if (payload?.tiers.good) return "good";
    if (payload?.tiers.best) return "best";
    return "better";
  });
  // Confirmed either from the server (revisited accepted/ordered link) or after a successful
  // POST. 'ordered' (converted to an order) is still a frozen/accepted state to the homeowner.
  const frozen = acceptance?.status === "accepted" || acceptance?.status === "ordered";
  const [confirmed, setConfirmed] = useState<{ tier: TierKey; name: string } | null>(
    frozen && acceptance?.acceptedTier
      ? { tier: acceptance.acceptedTier, name: acceptance.acceptedBy ?? "" }
      : null,
  );
  const [accepting, setAccepting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (payload?.name) document.title = payload.name;
  }, [payload]);

  const lineItems = payload?.lineItems ?? [];
  const branding = payload?.branding ?? null;

  if (!payload) {
    return (
      <Shell>
        <div className="w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-ink/5 text-xl">🔒</div>
          <h1 className="font-display text-xl font-bold tracking-tight text-ink">{t("proposal.unavailableTitle")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t("proposal.unavailableBody")}</p>
        </div>
      </Shell>
    );
  }

  // ---- Frozen confirmation view (accepted): no toggle, no accept button ----
  if (confirmed) {
    const tier = payload.tiers[confirmed.tier];
    return (
      <main className="min-h-dvh bg-paper">
        <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
          <header className="mb-7 text-center sm:mb-9">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-success">{t("proposal.confirmEyebrow")}</div>
            <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
              {t("proposal.confirmTitle", { name: confirmed.name || payload.name })}
            </h1>
            <p className="mt-2 text-muted">{t("proposal.confirmMessage", { tier: tierLabel(confirmed.tier) })}</p>
            <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">{t("proposal.confirmSubnote")}</p>
          </header>
          {tier && <TierBody tier={tier} markupPct={payload.markupPct} lineItems={lineItems} t={t} />}
        </div>
      </main>
    );
  }

  const tierMeta = TIER_ORDER.map((key) => ({ key, label: tierLabel(key) }));
  const presentKeys = TIER_ORDER.filter((k) => payload.tiers[k]);
  const activeKey: TierKey = payload.tiers[activeTier] ? activeTier : (presentKeys[0] ?? "better");

  const selectTier = (k: TierKey) => {
    setActiveTier(k);
    setAccepting(false); // switching tiers closes an open accept form
    setError("");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) { setError(t("proposal.acceptError")); return; }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/proposal/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: activeKey, name: name.trim(), email: email.trim(), phone: phone.trim() }),
      });
      if (!res.ok) { setError(t("proposal.acceptError")); setSubmitting(false); return; }
      const json = (await res.json()) as { acceptedTier?: TierKey; acceptedBy?: string };
      setConfirmed({ tier: json.acceptedTier ?? activeKey, name: json.acceptedBy ?? name.trim() });
    } catch {
      setError(t("proposal.acceptError"));
      setSubmitting(false);
    }
  }

  const activeTierData = payload.tiers[activeKey];
  const otherLabels = tierMeta.filter((m) => m.key !== activeKey && payload.tiers[m.key]).map((m) => m.label);

  return (
    <main className="min-h-dvh bg-paper">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        {/* Header — the contractor's proposal, no Kitify chrome */}
        <header className="mb-7 sm:mb-9">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <BrandingHead branding={branding} />
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">{t("proposal.eyebrow")}</div>
              <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
                {payload.name}
              </h1>
            </div>
            <PrintButton t={t} />
          </div>
        </header>

        {presentKeys.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-card/60 p-8 text-center sm:p-12">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-xl">✨</div>
            <h2 className="font-display text-lg font-semibold text-ink">{t("proposal.comingSoonTitle")}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{t("proposal.comingSoonBody")}</p>
          </div>
        ) : (
          <>
            {/* Tier toggle — full-width segments, large tap targets, mobile-first */}
            <div className="no-print grid grid-cols-3 gap-1.5 rounded-xl border border-line bg-card p-1.5 shadow-sm">
              {tierMeta.map(({ key, label }) => {
                const active = key === activeKey;
                const present = !!payload.tiers[key];
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!present}
                    aria-pressed={active}
                    onClick={() => present && selectTier(key)}
                    className={`rounded-lg px-2 py-3 text-sm font-semibold tracking-tight transition sm:text-base ${
                      active
                        ? "bg-accent text-white shadow-sm"
                        : present
                          ? "border border-line bg-paper text-ink hover:border-accent/50 hover:text-accent"
                          : "cursor-not-allowed border border-transparent bg-ink/[0.03] text-muted/40"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Selected tier — remounts on change (key) so the fade replays */}
            <div key={activeKey} style={{ animation: "fadeIn 220ms ease-out" }} className="mt-5">
              {activeTierData && <TierBody tier={activeTierData} markupPct={payload.markupPct} lineItems={lineItems} t={t} />}
            </div>

            <BrandingFoot branding={branding} t={t} />

            {/* Gentle comparison nudge */}
            {otherLabels.length > 0 && (
              <p className="no-print mt-6 text-center text-xs leading-relaxed text-muted">
                {t("proposal.compareHint", { tier: tierLabel(activeKey), others: otherLabels.join(t("proposal.orSeparator")) })}
              </p>
            )}

            {/* Accept — button, then inline form */}
            {!accepting ? (
              <button
                type="button"
                onClick={() => setAccepting(true)}
                className="no-print mt-6 w-full rounded-xl bg-accent px-5 py-4 text-base font-semibold text-white shadow-sm transition hover:brightness-110"
              >
                {t("proposal.acceptButton")}
              </button>
            ) : (
              <form onSubmit={submit} className="no-print mt-6 rounded-2xl border border-accent/40 bg-accent-soft/20 p-5 sm:p-6">
                <div className="font-display text-lg font-semibold text-ink">
                  {t("proposal.acceptHeading", { tier: tierLabel(activeKey) })}
                </div>
                <div className="mt-4 space-y-3">
                  <Field label={t("proposal.nameLabel")} required>
                    <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" className={INPUT} />
                  </Field>
                  <Field label={t("proposal.emailLabel")} required>
                    <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className={INPUT} />
                  </Field>
                  <Field label={t("proposal.phoneLabel")}>
                    <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" className={INPUT} />
                  </Field>
                </div>
                {error && (
                  <p className="mt-3 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber-700">{error}</p>
                )}
                <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {submitting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                    {submitting ? t("proposal.submitting") : t("proposal.confirmAccept")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAccepting(false); setError(""); }}
                    disabled={submitting}
                    className="w-full rounded-lg border border-line px-5 py-3 text-sm font-medium text-muted transition hover:text-ink disabled:opacity-60 sm:w-auto"
                  >
                    {t("proposal.cancel")}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}

// Price header (retail only) + room plan + product previews for one tier. Shared by the
// toggle view and the confirmation view.
function TierBody({ tier, markupPct, lineItems, t }: {
  tier: TierView; markupPct: number; lineItems: ProposalLineItem[]; t: Tr;
}) {
  const retail = tier.dealerTotal * (1 + (markupPct || 0) / 100);
  const extras = lineItems.reduce((n, li) => n + li.amount, 0);
  // The headline figure is what the homeowner will actually be billed. Showing the product
  // subtotal there and burying labour further down would quote a number nobody pays.
  const grandTotal = retail + extras;
  // Both shapes resolve here: a pre-C1 payload has no `bathrooms` and synthesises one from
  // its four flat slots, which is what keeps a link a homeowner is already holding correct.
  const baths = quoteBathrooms(tier);
  const multi = baths.length > 1;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className="border-b border-line px-5 py-6 text-center sm:px-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{t("proposal.priceLabel")}</div>
        <div className="mt-1 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">{money(grandTotal)}</div>
        {extras > 0 && (
          <div className="mt-1.5 text-xs text-muted">
            {t("proposal.totalBreakdown", { products: money(retail), extras: money(extras) })}
          </div>
        )}
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        {/* ONE bathroom renders exactly what it always did: no heading, no grouping, nothing
            to tell a homeowner their estimate covers "bathroom 1 of 1". Two or more get a
            named block each, in the order the contractor built them. */}
        {multi
          ? baths.map((b, i) => (
              <div key={b.id} className="space-y-5">
                <h2 className="bathroom-heading border-b border-line pb-2 font-display text-lg font-semibold tracking-tight text-ink">
                  {labelForBathroom(b, i, t)}
                </h2>
                <BathroomBody bathroom={b} t={t} />
              </div>
            ))
          : <BathroomBody bathroom={baths[0]} t={t} />}

        {/* Labour & extras. Listed after the products because they are what the contractor
            adds on top of them, and itemised rather than folded into one number so the
            homeowner can see what they are paying for. */}
        {lineItems.length > 0 && (
          <div className="rounded-xl border border-line bg-paper/60 p-4 sm:p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{t("proposal.extrasTitle")}</div>
            <dl className="mt-3 space-y-2">
              {lineItems.map((li) => (
                <div key={li.id} className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm text-ink">{li.description}</dt>
                  <dd className="shrink-0 text-sm font-medium text-ink">{money(li.amount)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-line pt-3">
              <span className="text-sm font-semibold text-ink">{t("proposal.grandTotal")}</span>
              <span className="font-display text-lg font-bold text-ink">{money(grandTotal)}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * One bathroom: the picture, the plan, the products. Returns a Fragment rather than a wrapper,
 * so a single-bathroom estimate renders byte-for-byte what it rendered before bathrooms
 * existed — no extra element, no extra spacing. Homeowners are holding these links already.
 */
function BathroomBody({ bathroom, t }: { bathroom: Bathroom; t: Tr }) {
  const room = bathroom.room as RoomConfig | null;
  const shower = bathroom.shower as ShowerConfig | null;
  const vanity = bathroom.vanity as VanityConfig | null;
  const plumbing = bathroom.plumbing as PlumbingConfig | null;
  const hasProducts = !!(shower || vanity || plumbing);
  return (
    <>
      {/* The bathroom itself, above the plan. A homeowner reads a picture of the room long
          before they read a dimensioned floor plan, so it leads. Rendered live from the
          quote's own configs — see HeroPreview for why nothing is snapshotted — and skipped
          entirely when the quote has no materials to show, rather than presenting a generic
          grey bathroom as if it were theirs. */}
      {hasHeroContent({ room, shower, vanity, plumbing }) && (
        <div className="hero-print">
          <HeroPreview room={room} shower={shower} vanity={vanity} plumbing={plumbing}
            caption={t("configurator.hero.preview")} />
        </div>
      )}
      {room?.selections && (
        <div className="mx-auto w-full max-w-[560px]">
          <RoomPlanSVG state={room.selections} interactive={false} showClearances={false} />
        </div>
      )}
      {hasProducts && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {shower && (
            <PreviewCard label={t("configurator.showerTitle")}>
              <ShowerPreviewFromConfig config={shower} />
            </PreviewCard>
          )}
          {vanity && (
            <PreviewCard label={t("configurator.vanityTitle")}>
              <VanityPreviewFromConfig config={vanity} />
            </PreviewCard>
          )}
          {plumbing && (
            <PreviewCard label={t("configurator.plumbingTitle")}>
              {/* showHeroPhoto: same reason as the order snapshot — no product grid here to
                  carry the faucet, so the schematic hero reads as a missing image next to
                  the real accessory photos. */}
              <PlumbingPreviewFromConfig config={plumbing} showHeroPhoto />
            </PreviewCard>
          )}
        </div>
      )}
    </>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        {label}
        {required && <span className="text-accent">*</span>}
      </span>
      {children}
    </label>
  );
}

function PreviewCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-paper/50 p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="overflow-hidden rounded-lg">{children}</div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh items-center justify-center bg-paper px-6">{children}</main>;
}

// ------------------------------ branding ----------------------------------
// The contractor's identity, read from the snapshot frozen onto the proposal at share time.
// Everything degrades: a proposal shared before branding existed, or by a contractor who
// never filled the fields in, renders exactly the header it always did.

function BrandingHead({ branding }: { branding: ProposalBranding | null }) {
  if (!branding || !(branding.company || branding.logo)) return null;
  return (
    <div className="mb-5 flex items-center gap-3">
      {/* Plain <img>: the logo is an arbitrary contractor-supplied URL, which next/image
          would refuse without its host in remotePatterns — and the whole point is that any
          partner can set one. */}
      {branding.logo && (
        <img src={branding.logo} alt={branding.company ?? ""} className="h-11 w-auto max-w-[168px] object-contain" />
      )}
      <div className="min-w-0">
        {branding.company && (
          <div className="truncate font-display text-lg font-bold leading-tight text-ink">{branding.company}</div>
        )}
        {branding.tagline && <div className="truncate text-xs text-muted">{branding.tagline}</div>}
      </div>
    </div>
  );
}

function BrandingFoot({ branding, t }: { branding: ProposalBranding | null; t: Tr }) {
  if (!branding || !branding.company) return null;
  const contact = [branding.phone, branding.email, branding.website].filter(Boolean) as string[];
  return (
    <footer className="mt-8 border-t border-line pt-5 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        {t("proposal.preparedBy", { company: branding.company })}
      </div>
      {branding.name && <div className="mt-1 text-sm text-ink">{branding.name}</div>}
      {contact.length > 0 && (
        <div className="mt-1 text-xs text-muted">{contact.join(" · ")}</div>
      )}
      {/* Printed-on date. Rendered client-side only: a server-rendered date would be the
          server's clock and, worse, would mismatch the client on hydration. */}
      <div className="mt-2 hidden text-[10px] text-muted print:block">
        {t("proposal.printedOn", { date: new Date().toLocaleDateString() })}
      </div>
    </footer>
  );
}

/**
 * Print / save-as-PDF. No PDF library involved: every browser's print dialog can already
 * write a PDF, and the print stylesheet in globals.css is what turns this page into a
 * document — tier toggle and accept button dropped, backgrounds and shadows off.
 */
function PrintButton({ t }: { t: Tr }) {
  return (
    <div className="no-print shrink-0 text-right">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-2 text-sm font-medium text-muted transition hover:border-accent hover:text-accent"
      >
        <Printer className="h-4 w-4" /> {t("proposal.print")}
      </button>
      <div className="mt-1 max-w-[150px] text-[10px] leading-tight text-muted">{t("proposal.printHint")}</div>
    </div>
  );
}
