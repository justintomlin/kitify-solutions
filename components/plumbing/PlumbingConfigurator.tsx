"use client";

/**
 * Kitify — Delta Plumbing Configurator (reusable module).
 *
 * Follows the vanity/shower module conventions: a sticky preview + price panel on the
 * left, stepped selections on the right, a shared Step component, i18n via t(), and
 * price lines as { key, params, amount } translated at render (never stored English).
 *
 * Every order SKU is READ from lib/plumbing-catalog via plumbingSku() — never derived
 * from a string rule. One finish governs the faucet, bathing trim and all accessories,
 * so changing it re-resolves every SKU together.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { RotateCcw, Minus, Plus } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import {
  PLUMBING_PACKAGES, PLUMBING_FINISHES, PLUMBING_PRICES, ROUGH_IN_VALVE, ACCESSORY_KEYS, WASTE_OVERFLOW, plumbingSku,
  type PlumbingFinishId, type PlumbingComponentKey,
} from "@/lib/plumbing-catalog";

// Price-line display text is resolved at render (never stored) so a quote saved in one
// language reads correctly when reopened in another. See lib/i18n.ts.
type Tr = (key: string, vars?: Record<string, string>) => string;
const priceLineText = (t: Tr, l: PriceLine): string => t(l.key, l.params);
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export type FaucetType = "faucet1cc" | "faucet8cc";
export type BathTrimType = "showerTrim" | "tubShowerTrim";
export type RoughInType = "standard" | "withStops";

// A price line carries a dictionary key + interpolation params rather than a finished
// string, so it renders in the viewer's current language, not the language it was built in.
export type PriceLine = { key: string; params?: Record<string, string>; amount: number };

// Resolved order SKUs, read via plumbingSku(), so a saved quote can flow to an order later.
// Trim/valve carry a quantity (2 under dual shower). Waste & overflow has no SKU yet — it
// records the finish it follows and a null sku so it can never be silently ordered.
export type PlumbingOrderSkus = {
  faucet?: string;
  bathTrim?: string;
  bathTrimQty: number;
  roughInValve: string;
  roughInValveQty: number;
  wasteOverflow?: { sku: string | null; finish?: PlumbingFinishId };
  accessories: Partial<Record<PlumbingComponentKey, string>>;
};

export type PlumbingSelections = {
  packageId?: string;
  finishId?: PlumbingFinishId;
  faucetType?: FaucetType;
  faucetQty: 1 | 2;
  bathTrim?: BathTrimType;
  roughIn: RoughInType;
  dualShower: boolean;    // shower only: second head = second trim + second valve
  wasteOverflow: boolean; // tub only: matching waste & overflow (SKU pending)
  accessories: Partial<Record<PlumbingComponentKey, number>>; // ACCESSORY_KEYS only, qty >= 0
  order?: PlumbingOrderSkus; // resolved on emit
};

export type PlumbingMedia = { swatchHex?: string };
export type PlumbingConfig = {
  selections: PlumbingSelections;
  media?: PlumbingMedia;
  price: { total: number; lines: PriceLine[] };
  isComplete: boolean;
  label: string;
};

const initial: PlumbingSelections = { faucetQty: 1, roughIn: "standard", dualShower: false, wasteOverflow: false, accessories: {} };

// ------------------------------ Engine ------------------------------------
const pkgById = (id?: string) => PLUMBING_PACKAGES.find((p) => p.id === id);
const finishById = (id?: PlumbingFinishId) => PLUMBING_FINISHES.find((f) => f.id === id);
const faucetCode = (ft?: FaucetType) => (ft === "faucet8cc" ? "8cc" : ft === "faucet1cc" ? "1cc" : "");

// Dual shower applies only to a shower-only trim; waste & overflow only to a tub/shower
// trim. Gate both on the trim so a stale flag can never mis-apply after a fixture switch.
const dualActive = (s: PlumbingSelections) => s.dualShower && s.bathTrim === "showerTrim";
const wasteActive = (s: PlumbingSelections) => s.wasteOverflow && s.bathTrim === "tubShowerTrim";

// Resolve every order SKU from the catalog for the current package + finish. Always via
// plumbingSku() — the catalog is the only place a SKU string lives.
export function resolveOrderSkus(s: PlumbingSelections): PlumbingOrderSkus {
  const pkg = s.packageId, f = s.finishId;
  const accessories: Partial<Record<PlumbingComponentKey, string>> = {};
  if (pkg && f) {
    for (const k of ACCESSORY_KEYS) {
      if ((s.accessories[k] ?? 0) > 0) { const sku = plumbingSku(pkg, k, f); if (sku) accessories[k] = sku; }
    }
  }
  const dual = dualActive(s);
  return {
    faucet: pkg && f && s.faucetType ? plumbingSku(pkg, s.faucetType, f) : undefined,
    bathTrim: pkg && f && s.bathTrim ? plumbingSku(pkg, s.bathTrim, f) : undefined,
    bathTrimQty: dual ? 2 : 1,
    roughInValve: ROUGH_IN_VALVE[s.roughIn].sku,
    roughInValveQty: dual ? 2 : 1,
    // Waste & overflow follows the tub/shower trim's finish; sku stays null until sourced.
    wasteOverflow: wasteActive(s) ? { sku: WASTE_OVERFLOW.sku, finish: f } : undefined,
    accessories,
  };
}

export function computePlumbingPrice(s: PlumbingSelections): { total: number; lines: PriceLine[] } {
  const lines: PriceLine[] = [];
  const dual = dualActive(s);
  if (s.faucetType) lines.push({ key: "configurator.plumbing.priceLine.faucet", params: { kind: faucetCode(s.faucetType), qty: String(s.faucetQty) }, amount: PLUMBING_PRICES[s.faucetType] * s.faucetQty });
  if (s.bathTrim) {
    const qty = dual ? 2 : 1;
    lines.push({ key: dual ? "configurator.plumbing.priceLine.showerTrimDual" : `configurator.plumbing.priceLine.${s.bathTrim}`, amount: PLUMBING_PRICES[s.bathTrim] * qty });
  }
  // Every configured set needs the universal rough-in valve — doubled under dual shower.
  if (s.packageId && s.finishId) {
    const base = s.roughIn === "withStops" ? "roughInStops" : "roughInStandard";
    const qty = dual ? 2 : 1;
    lines.push({ key: `configurator.plumbing.priceLine.${base}${dual ? "Dual" : ""}`, amount: ROUGH_IN_VALVE[s.roughIn].price * qty });
  }
  if (wasteActive(s)) lines.push({ key: "configurator.plumbing.priceLine.wasteOverflow", amount: WASTE_OVERFLOW.price });
  for (const k of ACCESSORY_KEYS) {
    const qty = s.accessories[k] ?? 0;
    if (qty > 0) lines.push({ key: `configurator.plumbing.priceLine.${k}`, params: { qty: String(qty) }, amount: PLUMBING_PRICES[k] * qty });
  }
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return { total, lines };
}

export function isComplete(s: PlumbingSelections): boolean {
  return !!(s.packageId && s.finishId && s.faucetType && s.bathTrim);
}

function buildLabel(s: PlumbingSelections, t: Tr): string {
  const pkg = pkgById(s.packageId);
  if (!pkg) return t("configurator.plumbing.newPlumbing");
  const parts = [pkg.name];
  const finish = finishById(s.finishId);
  if (finish) parts.push(finish.name);
  if (s.faucetType) parts.push(`${faucetCode(s.faucetType)} ${t("configurator.plumbing.faucetWord")}`);
  if (s.bathTrim) {
    const short = t(s.bathTrim === "tubShowerTrim" ? "configurator.plumbing.trimTubShort" : "configurator.plumbing.trimShowerShort");
    parts.push(dualActive(s) ? `${short} ×2` : short);
  }
  if (wasteActive(s)) parts.push(t("configurator.plumbing.wasteShort"));
  return parts.join(" · ");
}

// Faucet drilling in the vanity top → the required faucet component.
const faucetForDrilling = (d: "1cc" | "8cc"): FaucetType => (d === "8cc" ? "faucet8cc" : "faucet1cc");

export function PlumbingConfigurator({
  mode = "dealer",
  onComplete,
  onChange,
  lockedDrilling,
  lockedBathKind,
  initialFaucetQty,
  primaryLabel,
}: {
  mode?: "dealer" | "customer";
  onComplete?: (config: PlumbingConfig) => void;
  onChange?: (config: PlumbingConfig) => void;
  // When the vanity specifies a drilling, the faucet TYPE is fixed to it (physical
  // constraint) — read-only, live-synced. Absent (standalone page) → user picks freely.
  lockedDrilling?: "1cc" | "8cc";
  // When the shower slot specifies a fixture, the bathing TRIM is fixed to it (a tub needs
  // tub/shower trim for the diverter; a base needs shower-only) — read-only, live-synced.
  // Absent (standalone page) → user picks freely.
  lockedBathKind?: "shower" | "tub";
  // Seeded from the hub's shared state: vanity sink count → faucet quantity.
  initialFaucetQty?: number;               // 1 or 2
  primaryLabel?: string;
}) {
  const { t } = useLanguage();
  // Seed faucet qty + bathing trim from shared state at mount. Faucet type is fixed when a
  // drilling is locked; bathing trim is fixed when a bathing kind is locked.
  const [s, setS] = useState<PlumbingSelections>(() => ({
    ...initial,
    faucetType: lockedDrilling ? faucetForDrilling(lockedDrilling) : undefined,
    faucetQty: initialFaucetQty === 2 ? 2 : 1,
    bathTrim: lockedBathKind === "tub" ? "tubShowerTrim" : lockedBathKind === "shower" ? "showerTrim" : undefined,
  }));
  // Once the user touches a seeded field, stop adopting shared-state changes for it.
  const qtyTouched = useRef(false);

  const price = useMemo(() => computePlumbingPrice(s), [s]);
  const complete = isComplete(s);
  const set = (patch: Partial<PlumbingSelections>) => setS((prev) => ({ ...prev, ...patch }));

  // Adopt shared-state changes while mounted, unless the user has overridden that field.
  useEffect(() => {
    if (initialFaucetQty == null || qtyTouched.current) return;
    const q: 1 | 2 = initialFaucetQty === 2 ? 2 : 1;
    setS((prev) => (prev.faucetQty === q ? prev : { ...prev, faucetQty: q }));
  }, [initialFaucetQty]);
  // Locked bathing kind always wins — the trim follows the shower slot, even mid-session.
  useEffect(() => {
    if (lockedBathKind == null) return;
    const bt: BathTrimType = lockedBathKind === "tub" ? "tubShowerTrim" : "showerTrim";
    setS((prev) => (prev.bathTrim === bt ? prev : { ...prev, bathTrim: bt }));
  }, [lockedBathKind]);
  // Locked drilling always wins — the faucet type follows the vanity top, even mid-session.
  useEffect(() => {
    if (lockedDrilling == null) return;
    const ft = faucetForDrilling(lockedDrilling);
    setS((prev) => (prev.faucetType === ft ? prev : { ...prev, faucetType: ft }));
  }, [lockedDrilling]);

  const buildConfig = useCallback((): PlumbingConfig => ({
    selections: { ...s, order: resolveOrderSkus(s) },
    media: { swatchHex: finishById(s.finishId)?.hex },
    price,
    isComplete: complete,
    label: buildLabel(s, t),
  }), [s, price, complete, t]);

  // Emit onChange on every committed change, exactly like the other modules.
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  useEffect(() => { onChangeRef.current?.(buildConfig()); }, [buildConfig]);

  const setFaucetQty = (q: number) => { qtyTouched.current = true; setS((prev) => ({ ...prev, faucetQty: (q < 1 ? 1 : q > 2 ? 2 : q) as 1 | 2 })); };
  const chooseTrim = (bt: BathTrimType) => set({ bathTrim: bt });
  const stepAcc = (k: PlumbingComponentKey, d: number) => setS((prev) => ({ ...prev, accessories: { ...prev.accessories, [k]: Math.max(0, (prev.accessories[k] ?? 0) + d) } }));

  function startOver() { qtyTouched.current = false; setS(initial); }
  function addToQuote() { if (complete) onComplete?.(buildConfig()); }

  const finishHex = finishById(s.finishId)?.hex ?? "#c9ccd1";

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="lg:sticky lg:top-5 lg:self-start">
        <div className="overflow-hidden rounded-2xl border border-line bg-card">
          <PlumbingPreview finishHex={finishHex} faucetType={s.faucetType} accessories={s.accessories} />
          <div className="border-t border-line p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{mode === "dealer" ? t("configurator.dealerPrice") : t("configurator.estimate")}</span>
              <span className="font-display text-2xl font-bold">{money(price.total)}</span>
            </div>
            <div className="mb-2 rounded-md bg-amber/10 px-2 py-1 text-[10px] font-medium text-amber">{t("configurator.placeholderPricing")}</div>
            <div className="space-y-1">
              {price.lines.map((l, i) => (
                <div key={i} className="flex justify-between text-xs text-muted"><span>{priceLineText(t, l)}</span><span>{money(l.amount)}</span></div>
              ))}
              {price.lines.length === 0 && <div className="text-xs text-muted">{t("configurator.plumbing.pickPackageFirst")}</div>}
            </div>
            <button onClick={addToQuote} disabled={!complete}
              className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
              {complete ? (primaryLabel ?? t("configurator.addToQuote")) : t("configurator.finishToAdd")}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <Step n={1} title={t("configurator.plumbing.stepPackage")}>
          <div className="grid gap-2 sm:grid-cols-2">
            {PLUMBING_PACKAGES.map((p) => (
              <button key={p.id} onClick={() => set({ packageId: p.id })}
                className={`rounded-xl border p-3 text-left transition ${s.packageId === p.id ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                <div className="font-display text-sm font-semibold">{p.name}</div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{p.lane} · {p.family}</div>
              </button>
            ))}
          </div>
        </Step>

        {s.packageId && (
          <Step n={2} title={t("configurator.plumbing.stepFinish")}>
            <div className="flex flex-wrap gap-2">
              {PLUMBING_FINISHES.map((f) => (
                <button key={f.id} onClick={() => set({ finishId: f.id })} title={f.name}
                  className={`h-9 w-9 rounded-full border-2 transition ${s.finishId === f.id ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-ink/30"}`}
                  style={{ background: f.hex }} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">{s.finishId ? finishById(s.finishId)?.name : t("configurator.plumbing.finishNote")}</p>
          </Step>
        )}

        {s.packageId && s.finishId && (
          <>
            <Step n={3} title={t("configurator.plumbing.stepFaucet")}>
              {lockedDrilling ? (
                <div className="rounded-xl border border-line bg-paper/60 px-4 py-3">
                  <div className="text-sm font-semibold">{s.faucetType === "faucet8cc" ? "8cc" : "1cc"} · {t(s.faucetType === "faucet8cc" ? "configurator.plumbing.faucetWidespread" : "configurator.plumbing.faucetSingle")}</div>
                  <div className="mt-0.5 text-xs text-muted">{t("configurator.plumbing.fromVanityTop")}</div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {([["faucet1cc", "configurator.plumbing.faucetSingle"], ["faucet8cc", "configurator.plumbing.faucetWidespread"]] as [FaucetType, string][]).map(([ft, lk]) => (
                    <button key={ft} onClick={() => set({ faucetType: ft })}
                      className={`rounded-xl border px-3 py-3 text-left transition ${s.faucetType === ft ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                      <div className="text-sm font-semibold">{ft === "faucet1cc" ? "1cc" : "8cc"}</div>
                      <div className="text-xs text-muted">{t(lk)}</div>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between rounded-lg border border-line p-2.5">
                <span className="text-sm font-medium">{t("configurator.plumbing.qtyLabel")}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setFaucetQty(s.faucetQty - 1)} disabled={s.faucetQty <= 1} className="rounded-md border border-line p-1 hover:bg-ink/5 disabled:opacity-35"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="w-5 text-center text-sm font-semibold">{s.faucetQty}</span>
                  <button onClick={() => setFaucetQty(s.faucetQty + 1)} disabled={s.faucetQty >= 2} className="rounded-md border border-line p-1 hover:bg-ink/5 disabled:opacity-35"><Plus className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </Step>

            <Step n={4} title={t("configurator.plumbing.stepBathing")}>
              {lockedBathKind ? (
                <div className="rounded-xl border border-line bg-paper/60 px-4 py-3">
                  <div className="text-sm font-semibold">{t(s.bathTrim === "tubShowerTrim" ? "configurator.plumbing.trimTub" : "configurator.plumbing.trimShower")}</div>
                  <div className="mt-0.5 text-xs text-muted">{t("configurator.plumbing.fromShowerSelection")}</div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {([["showerTrim", "configurator.plumbing.trimShower"], ["tubShowerTrim", "configurator.plumbing.trimTub"]] as [BathTrimType, string][]).map(([bt, lk]) => (
                    <button key={bt} onClick={() => chooseTrim(bt)}
                      className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${s.bathTrim === bt ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                      {t(lk)}
                    </button>
                  ))}
                </div>
              )}

              {/* Dual shower — shower-only trim; hidden entirely for a tub. */}
              {s.bathTrim === "showerTrim" && (
                <div className="mt-3 rounded-lg border border-line p-2.5">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={s.dualShower} onChange={(e) => set({ dualShower: e.target.checked })} />
                    <span className="font-medium">{t("configurator.plumbing.dualShower")}</span>
                  </label>
                  <p className="mt-1 text-[11px] text-muted">{t("configurator.plumbing.dualShowerNote")}</p>
                </div>
              )}

              {/* Waste & overflow — tub/shower trim only; hidden entirely for a shower. */}
              {s.bathTrim === "tubShowerTrim" && (
                <div className="mt-3 rounded-lg border border-line p-2.5">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={s.wasteOverflow} onChange={(e) => set({ wasteOverflow: e.target.checked })} />
                    <span className="font-medium">{t("configurator.plumbing.wasteOverflow")}</span>
                  </label>
                  {s.wasteOverflow && <p className="mt-1 text-[11px] font-medium text-amber">{t("configurator.plumbing.skuPending")}</p>}
                </div>
              )}

              <div className="mt-3">
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{t("configurator.plumbing.roughInLabel")}</div>
                <div className="flex flex-wrap gap-2">
                  {([["standard", "configurator.plumbing.roughInStandard"], ["withStops", "configurator.plumbing.roughInStops"]] as [RoughInType, string][]).map(([ri, lk]) => (
                    <button key={ri} onClick={() => set({ roughIn: ri })}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${s.roughIn === ri ? "border-accent bg-accent-soft/50" : "border-line hover:bg-ink/5"}`}>
                      {t(lk)}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted">{s.bathTrim === "showerTrim" && s.dualShower ? t("configurator.plumbing.valveNoteDual") : t("configurator.plumbing.valveNote")}</p>
              </div>
            </Step>

            <Step n={5} title={t("configurator.plumbing.stepAccessories")} hint={t("configurator.plumbing.optional")}>
              <div className="space-y-2.5">
                {ACCESSORY_KEYS.map((k) => (
                  <div key={k} className="flex items-center justify-between rounded-lg border border-line p-2.5">
                    <span className="text-sm font-medium">{t(`configurator.plumbing.acc.${k}`)}</span>
                    <QtyStepper qty={s.accessories[k] ?? 0} onStep={(d) => stepAcc(k, d)} />
                  </div>
                ))}
              </div>
            </Step>
          </>
        )}

        {s.packageId && (
          <button onClick={startOver} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink">
            <RotateCcw className="h-3.5 w-3.5" /> {t("configurator.startOver")}
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------ UI bits -----------------------------------
function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink font-mono text-[10px] text-white">{n}</span>
        <h3 className="font-display text-sm font-semibold">{title}</h3>
        {hint && <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-accent">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function QtyStepper({ qty, onStep }: { qty: number; onStep: (d: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onStep(-1)} className="rounded-md border border-line p-1 hover:bg-ink/5"><Minus className="h-3.5 w-3.5" /></button>
      <span className="w-5 text-center text-sm font-semibold">{qty}</span>
      <button onClick={() => onStep(1)} className="rounded-md border border-line p-1 hover:bg-ink/5"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

// --------------------------- Live preview ---------------------------------
// Schematic faucet in the chosen finish, plus a glyph per selected accessory. The <defs>
// gradient id is namespaced with useId(): the hub mounts a second copy of this preview
// (the product tile) alongside the configurator's, and duplicate ids make url(#…) resolve
// to the wrong element, dropping the sheen.
function PlumbingPreview({ finishHex, faucetType, accessories }: {
  finishHex: string; faucetType?: FaucetType; accessories: Partial<Record<PlumbingComponentKey, number>>;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const sheenId = `plmSheen-${uid}`;
  const metal = finishHex;
  const present = ACCESSORY_KEYS.filter((k) => (accessories[k] ?? 0) > 0);
  const spout = "M150 150 L150 96 Q150 78 168 78 L188 79";

  return (
    <svg viewBox="0 0 320 210" className="block w-full bg-paper/40">
      <defs>
        <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.28" />
        </linearGradient>
      </defs>

      {/* deck / counter line */}
      <rect x="30" y="150" width="260" height="10" rx="3" fill="#00000010" />

      {faucetType ? (
        <g>
          {/* spout */}
          <path d={spout} fill="none" stroke={metal} strokeWidth="10" strokeLinecap="round" />
          <circle cx="188" cy="80" r="6" fill={metal} />
          {/* base plate */}
          <rect x="140" y="145" width="20" height="8" rx="2" fill={metal} />
          {faucetType === "faucet8cc" ? (
            <>
              {/* two widespread handles */}
              <g><rect x="104" y="130" width="8" height="22" rx="3" fill={metal} /><rect x="97" y="145" width="22" height="8" rx="2" fill={metal} /></g>
              <g><rect x="208" y="130" width="8" height="22" rx="3" fill={metal} /><rect x="201" y="145" width="22" height="8" rx="2" fill={metal} /></g>
            </>
          ) : (
            /* single lever on the body */
            <rect x="158" y="90" width="28" height="6" rx="3" fill={metal} />
          )}
          {/* sheen overlay */}
          <path d={spout} fill="none" stroke={`url(#${sheenId})`} strokeWidth="10" strokeLinecap="round" opacity="0.55" />
        </g>
      ) : (
        <text x="160" y="96" textAnchor="middle" fontFamily="monospace" fontSize="11" fill="#8a8a84">—</text>
      )}

      {/* accessory glyph row */}
      {present.map((k, i) => (
        <AccessoryGlyph key={k} kind={k} x={40 + i * 54} y={182} color={metal} />
      ))}
    </svg>
  );
}

function AccessoryGlyph({ kind, x, y, color }: { kind: PlumbingComponentKey; x: number; y: number; color: string }) {
  switch (kind) {
    case "towelBar18":
    case "towelBar24": {
      const w = kind === "towelBar24" ? 44 : 34;
      return <g><rect x={x} y={y} width={w} height="4" rx="2" fill={color} /><rect x={x} y={y - 4} width="4" height="11" rx="1" fill={color} /><rect x={x + w - 4} y={y - 4} width="4" height="11" rx="1" fill={color} /></g>;
    }
    case "tpHolder":
      return <g><rect x={x} y={y - 4} width="4" height="12" rx="1" fill={color} /><rect x={x} y={y - 4} width="22" height="4" rx="2" fill={color} /><circle cx={x + 20} cy={y + 4} r="6" fill="none" stroke={color} strokeWidth="3" /></g>;
    case "towelRing":
      return <g><rect x={x + 8} y={y - 6} width="4" height="6" rx="1" fill={color} /><circle cx={x + 10} cy={y + 6} r="8" fill="none" stroke={color} strokeWidth="3" /></g>;
    case "robeHook":
      return <g><rect x={x + 6} y={y - 6} width="8" height="6" rx="2" fill={color} /><path d={`M${x + 10} ${y} Q${x + 10} ${y + 10} ${x + 2} ${y + 9}`} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" /></g>;
    default:
      return null;
  }
}

/**
 * Read-only wrapper: renders the exact same PlumbingPreview as the configurator, driven
 * by an emitted config. Same single-source-of-truth rule as the other modules — no drawing
 * logic is duplicated, only the small config → preview-props mapping. Inert (pointer-events
 * disabled) so it never intercepts clicks.
 */
export function PlumbingPreviewFromConfig({ config, className }: { config: PlumbingConfig; className?: string }) {
  const s = config.selections;
  const finishHex = finishById(s.finishId)?.hex ?? "#c9ccd1";
  return (
    <div className={className} style={{ pointerEvents: "none" }}>
      <PlumbingPreview finishHex={finishHex} faucetType={s.faucetType} accessories={s.accessories} />
    </div>
  );
}
