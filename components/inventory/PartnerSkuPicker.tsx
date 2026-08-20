"use client";

// Dual-source SKU picker for partner inventory. The contractor's own catalog is the primary
// experience, with Kitify's reference catalog available behind an opt-in toggle.
//
// WHAT THIS DELIBERATELY DOES NOT SHOW: any quantity. Not the contractor's, and above all
// not Kitify's — the KitifyCatalogSku type has no quantity field, listKitifyCatalog() selects
// no quantity column, and RLS would refuse one anyway. If you are tempted to add an
// "in stock" hint to the Kitify rows here, that is the exact thing three layers are built to
// prevent. Contractor rows show identity only too, for consistency.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import type { KitifyCatalogSku, PartnerSku, SkuRef } from "@/lib/partner-inventory";
import { INPUT } from "./ui";

export type PickerOption = {
  ref: SkuRef;
  sku: string;
  name: string;
  dimensions: string | null;
};

/** Flatten both catalogs into one option list, tagged by source. */
export function buildOptions(mine: PartnerSku[], kitify: KitifyCatalogSku[]) {
  return {
    mine: mine
      .filter((s) => s.active)
      .map<PickerOption>((s) => ({
        ref: { source: "partner", id: s.id },
        sku: s.sku,
        name: s.name,
        dimensions: s.dimensionsNote,
      })),
    kitify: kitify.map<PickerOption>((s) => ({
      ref: { source: "kitify", id: s.id },
      sku: s.sku,
      name: s.name,
      dimensions: s.dimensionsNote,
    })),
  };
}

export function SourceBadge({ source }: { source: SkuRef["source"] }) {
  const { t } = useLanguage();
  const isKitify = source === "kitify";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
        isKitify ? "border-accent/30 bg-accent-soft/40 text-accent" : "border-line bg-paper text-muted"
      }`}
    >
      {isKitify ? t("partnerInv.sourceKitify") : t("partnerInv.sourceMine")}
    </span>
  );
}

export function PartnerSkuPicker({
  mine,
  kitify,
  value,
  onChange,
}: {
  mine: PartnerSku[];
  kitify: KitifyCatalogSku[];
  value: SkuRef | null;
  onChange: (ref: SkuRef | null) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // Kitify's catalog is opt-in: a contractor's own list is the day-to-day case, and
  // defaulting it off keeps their short list from being buried under Kitify's.
  const [includeKitify, setIncludeKitify] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => buildOptions(mine, kitify), [mine, kitify]);
  const all = useMemo(
    () => [...options.mine, ...(includeKitify ? options.kitify : [])],
    [options, includeKitify],
  );

  const selected = useMemo(
    () => (value ? all.find((o) => o.ref.source === value.source && o.ref.id === value.id) ?? null : null),
    [all, value],
  );

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((o) => !q || o.sku.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [all, query]);

  // A selected Kitify item stays visible even if the toggle is flipped back off, so the
  // choice cannot silently vanish from under the form.
  const selectedFallback = useMemo(() => {
    if (selected || !value) return null;
    const pool = [...options.mine, ...options.kitify];
    return pool.find((o) => o.ref.source === value.source && o.ref.id === value.id) ?? null;
  }, [selected, value, options]);

  const shown = selected ?? selectedFallback;

  if (shown) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
        <SourceBadge source={shown.ref.source} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          <span className="font-mono text-[12px]">{shown.sku}</span>
          <span className="text-muted"> — {shown.name}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQuery("");
          }}
          aria-label={t("partnerInv.clear")}
          className="shrink-0 rounded-md p-0.5 text-muted transition hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          {t("partnerInv.pickerSources")}
        </span>
        <span className="inline-flex overflow-hidden rounded-md border border-line">
          <span className="bg-ink px-2 py-1 text-[11px] font-medium text-white">{t("partnerInv.sourceMine")}</span>
          <button
            type="button"
            onClick={() => setIncludeKitify((v) => !v)}
            aria-pressed={includeKitify}
            className={`px-2 py-1 text-[11px] font-medium transition ${
              includeKitify ? "bg-accent text-white" : "bg-card text-muted hover:text-accent"
            }`}
          >
            {includeKitify ? "✓ " : "+ "}
            {t("partnerInv.sourceKitify")}
          </button>
        </span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t("partnerInv.skuSearchPlaceholder")}
          className={INPUT + " mt-0 pl-9"}
          autoComplete="off"
        />
      </div>

      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-card shadow-lg">
          {matches.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted">
              {options.mine.length === 0 && !includeKitify
                ? t("partnerInv.pickerEmptyMine")
                : t("partnerInv.noResults")}
            </div>
          ) : (
            matches.map((o) => (
              <button
                key={`${o.ref.source}:${o.ref.id}`}
                type="button"
                onClick={() => {
                  onChange(o.ref);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-paper"
              >
                <SourceBadge source={o.ref.source} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono text-[12px] text-ink">{o.sku}</span>
                  <span className="text-muted"> — {o.name}</span>
                  {o.dimensions && <span className="text-muted"> · {o.dimensions}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
