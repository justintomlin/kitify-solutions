"use client";

// Searchable SKU selector. A plain <select> is unusable once the ops catalog grows past a
// screenful, so this is a filter-as-you-type combobox over the already-loaded SKU list —
// no extra queries, matching on both the SKU code and the human name.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import type { InventorySku } from "@/lib/inventory";
import { INPUT } from "./ui";

export function SkuPicker({
  skus,
  value,
  onChange,
  placeholder,
}: {
  skus: InventorySku[];
  value: string;
  onChange: (skuId: string) => void;
  placeholder?: string;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => skus.find((s) => s.id === value) ?? null, [skus, value]);

  // Close on outside click — the list is absolutely positioned, so it would otherwise sit
  // over the rest of the form until something else stole focus.
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
    return skus
      .filter((s) => s.active)
      .filter((s) => !q || s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [skus, query]);

  if (selected) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          <span className="font-mono text-[12px]">{selected.sku}</span>
          <span className="text-muted"> — {selected.name}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onChange("");
            setQuery("");
          }}
          aria-label={t("inventory.clear")}
          className="shrink-0 rounded-md p-0.5 text-muted transition hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? t("inventory.skuSearchPlaceholder")}
        className={INPUT + " pl-9"}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-card shadow-lg">
          {matches.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted">{t("inventory.noResults")}</div>
          ) : (
            matches.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onChange(s.id);
                  setOpen(false);
                  setQuery("");
                }}
                className="block w-full px-3 py-2 text-left text-sm transition hover:bg-paper"
              >
                <span className="font-mono text-[12px] text-ink">{s.sku}</span>
                <span className="text-muted"> — {s.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
