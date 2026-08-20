"use client";

/**
 * HPL shower upsells — the three opt-in offers that ride alongside the BOM.
 *
 * HPL ONLY. This never renders for an SPC shower: SPC has no takeoff yet, so it has no panel
 * count to be odd and no trim quantities to insure. SPC gets its own offers when its takeoff
 * is specced.
 *
 * All three are warn-don't-block by construction — they are checkboxes, nothing is added
 * without an explicit tap, and dismissing the whole block leaves the BOM exactly as computed.
 * The odd-panel offer is the only discounted one (25%), and it fires per decor rather than
 * per shower because panels ship in 2-packs: a shower with 3 Marrakech and 4 Pure White
 * breaks a pack on the Marrakech alone.
 *
 * COPY IS A FIRST DRAFT. The panel offer in particular is emotionally loaded ("everyone makes
 * mistakes") and JT may want to workshop the exact wording — the strings live in lib/i18n.ts
 * under configurator.shower.hplUpsell.* and can be rewritten without touching this file.
 */

import { Plus, Check, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import type { HplShowerBom, HplUpsellOffer } from "@/lib/hpl-shower-takeoff";

export function HplUpsellPopup({
  bom,
  accepted,
  onToggle,
  onDismissAll,
}: {
  bom: HplShowerBom;
  accepted: string[];
  onToggle: (offerId: string) => void;
  onDismissAll: () => void;
}) {
  const { t } = useLanguage();
  const offers = bom.upsells.offers;
  if (offers.length === 0) return null;

  const isOn = (o: HplUpsellOffer) => accepted.includes(o.id);

  return (
    <div className="mt-3 rounded-xl border border-accent/30 bg-accent-soft/30 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
            {t("configurator.shower.hplUpsell.heading")}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            {t("configurator.shower.hplUpsell.sub")}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismissAll}
          aria-label={t("configurator.shower.hplUpsell.dismiss")}
          className="shrink-0 rounded-md p-1 text-muted transition hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        {offers.map((o) => {
          const on = isOn(o);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onToggle(o.id)}
              aria-pressed={on}
              className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                on ? "border-accent bg-card" : "border-line bg-card/60 hover:border-accent"
              }`}
            >
              <span
                className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                  on ? "border-accent bg-accent text-white" : "border-line"
                }`}
              >
                {on ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3 text-muted" />}
              </span>
              <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink">
                {t(o.labelKey, { ...(o.labelParams ?? {}), n: String(o.qty) })}
              </span>
              {o.discountPct > 0 && (
                <span className="shrink-0 rounded-full border border-accent/30 bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent">
                  {t("configurator.shower.hplUpsell.discount", { pct: String(o.discountPct) })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
