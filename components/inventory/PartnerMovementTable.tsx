"use client";

// The partner ledger, rendered. Shared by the contractor's history page, their per-SKU
// detail page, and the admin partner view.
//
// Reason labels come from the CONTRACTOR vocabulary (partnerInv.reason.*), not the admin one:
// a contractor reading their own ledger should see the words they chose from. Note that
// "Shipped" and "Used on job" both store reason='shipped', so the ledger shows the single
// stored reason — the distinction is a labelling convenience at entry time, not two states.

import { useLanguage } from "@/components/LanguageContext";
import { SourceBadge } from "./PartnerSkuPicker";
import { rowRef, type PartnerMovement, type SkuRef } from "@/lib/partner-inventory";
import { fmtDateTime } from "./ui";

export function PartnerMovementTable({
  movements,
  labelFor,
  showItem = true,
  showPerformer = true,
}: {
  movements: PartnerMovement[];
  labelFor: (ref: SkuRef) => { sku: string; name: string };
  /** Hidden on a per-SKU page, where every row is the same item. */
  showItem?: boolean;
  showPerformer?: boolean;
}) {
  const { t } = useLanguage();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            <th className="px-2 py-2">{t("partnerInv.colWhen")}</th>
            {showItem && <th className="px-2 py-2">{t("partnerInv.colItem")}</th>}
            <th className="px-2 py-2">{t("partnerInv.colReason")}</th>
            <th className="px-2 py-2 text-right">{t("partnerInv.colDelta")}</th>
            <th className="px-2 py-2">{t("partnerInv.colLocation")}</th>
            <th className="px-2 py-2">{t("partnerInv.colReference")}</th>
            <th className="px-2 py-2">{t("partnerInv.colNote")}</th>
            {showPerformer && <th className="px-2 py-2">{t("partnerInv.colBy")}</th>}
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => {
            const ref = rowRef(m);
            const label = labelFor(ref);
            return (
              <tr key={m.id} className="border-b border-line/60 last:border-0">
                <td className="whitespace-nowrap px-2 py-2.5 text-muted">{fmtDateTime(m.performedAt)}</td>
                {showItem && (
                  <td className="px-2 py-2.5">
                    <span className="flex items-center gap-2">
                      <SourceBadge source={ref.source} />
                      <span className="font-mono text-[12px] text-ink">{label.sku}</span>
                    </span>
                  </td>
                )}
                <td className="px-2 py-2.5 text-ink">{t(`partnerInv.reason.${m.reason}`)}</td>
                <td
                  className={`px-2 py-2.5 text-right font-display font-bold ${
                    m.delta > 0 ? "text-success" : "text-amber"
                  }`}
                >
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </td>
                <td className="px-2 py-2.5 text-muted">{m.location}</td>
                <td className="px-2 py-2.5 text-muted">{m.reference ?? "—"}</td>
                <td className="px-2 py-2.5 text-muted">{m.note ?? "—"}</td>
                {showPerformer && <td className="px-2 py-2.5 text-muted">{m.performedByName ?? "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
