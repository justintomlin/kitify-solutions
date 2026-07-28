"use client";

/**
 * Demo host for the PlumbingConfigurator module — app/plumbing/page.tsx.
 * Shows the module contract in action: mode in, PlumbingConfig out. In production the
 * same component mounts inside the portal hub, and onComplete feeds the BOM/quote.
 */

import { useState } from "react";
import { PlumbingConfigurator, type PlumbingConfig } from "@/components/plumbing/PlumbingConfigurator";
import { Check } from "lucide-react";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function PlumbingDemoPage() {
  const [added, setAdded] = useState<PlumbingConfig[]>([]);

  return (
    <div className="min-h-dvh bg-paper">
      <header className="flex items-center gap-3 border-b border-line bg-card px-5 py-4">
        <svg className="h-6 w-6" viewBox="0 0 24 24">
          <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="#0e6e6e" />
          <rect x="13.5" y="1.5" width="9" height="9" rx="1.5" fill="none" stroke="#0e6e6e" strokeWidth="1.75" />
          <rect x="1.5" y="13.5" width="9" height="9" rx="1.5" fill="none" stroke="#0e6e6e" strokeWidth="1.75" />
          <rect x="13.5" y="13.5" width="9" height="9" rx="1.5" fill="none" stroke="#0e6e6e" strokeWidth="1.75" />
        </svg>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Delta Plumbing</div>
          <h1 className="font-display text-lg font-bold leading-tight">Configure plumbing fixtures</h1>
        </div>
      </header>

      <div className="mx-auto max-w-6xl p-5">
        <PlumbingConfigurator
          mode="dealer"
          onComplete={(cfg) => setAdded((prev) => [...prev, cfg])}
        />

        {added.length > 0 && (
          <div className="mt-6 rounded-2xl border border-line bg-card p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Added to quote (onComplete output)</div>
            <div className="space-y-2">
              {added.map((cfg, i) => (
                <div key={i} className="flex items-center justify-between gap-3 border-b border-line pb-2 text-sm last:border-0">
                  <span className="flex items-center gap-2"><Check className="h-4 w-4 text-accent" /> {cfg.label}</span>
                  <span className="font-medium">{money(cfg.price.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
