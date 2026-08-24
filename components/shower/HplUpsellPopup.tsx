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

import { Minus, Plus, Check, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import type { HplShowerBom, HplUpsellOffer } from "@/lib/hpl-shower-takeoff";
import { HPL_TOOL_OFFERS, type HplToolPick } from "@/lib/hpl-tools";

export function HplUpsellPopup({
  bom,
  accepted,
  onToggle,
  onDismissAll,
  tools,
  onToolQty,
}: {
  bom: HplShowerBom;
  accepted: string[];
  onToggle: (offerId: string) => void;
  onDismissAll: () => void;
  /** Tools and replenishment the dealer has taken, with quantities. */
  tools: HplToolPick[];
  onToolQty: (skuCode: string, qty: number) => void;
}) {
  const { t } = useLanguage();
  const offers = bom.upsells.offers;
  // The tools block stands on its own: a shower with an even panel count and no trim fires no
  // upsell offers at all, and the dealer still needs to be asked about tools.
  if (offers.length === 0 && HPL_TOOL_OFFERS.length === 0) return null;

  const isOn = (o: HplUpsellOffer) => accepted.includes(o.id);
  const qtyOf = (skuCode: string) => tools.find((x) => x.skuCode === skuCode)?.qty ?? 0;

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
        {/* The three computed offers, unchanged. */}
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

      {/* Tools & replenishment. Below a divider inside the same block rather than as a second
          panel: two adjacent accent cards in a 380px sticky column read as clutter, and this is
          the same conversation — "here is what else you might want before you order". Every row
          starts at zero; the block adds nothing until a dealer presses +. */}
      <div className="mt-3 border-t border-accent/20 pt-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
          {t("configurator.shower.hplTools.heading")}
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{t("configurator.shower.hplTools.sub")}</p>

        <div className="mt-2 space-y-1.5">
          {HPL_TOOL_OFFERS.map((o) => {
            const qty = qtyOf(o.skuCode);
            return (
              <div
                key={o.skuCode}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition ${
                  qty > 0 ? "border-accent bg-card" : "border-line bg-card/60"
                }`}
              >
                <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink">{t(o.labelKey)}</span>
                {/* A stepper, not a checkbox: a dealer restocking wants three sealant tubes,
                    and a tool is still a one-tap add because zero → 1 is the first press. */}
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onToolQty(o.skuCode, qty - 1)}
                    disabled={qty === 0}
                    aria-label={t("configurator.shower.hplTools.less", { item: t(o.labelKey) })}
                    className="grid h-6 w-6 place-items-center rounded border border-line text-muted transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-5 text-center font-mono text-[11px] tabular-nums text-ink">{qty}</span>
                  <button
                    type="button"
                    onClick={() => onToolQty(o.skuCode, qty + 1)}
                    aria-label={t("configurator.shower.hplTools.more", { item: t(o.labelKey) })}
                    className="grid h-6 w-6 place-items-center rounded border border-line text-muted transition hover:border-accent hover:text-accent"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
