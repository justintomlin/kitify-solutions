"use client";

/**
 * Demo host for the RoomConfigurator module — app/room/page.tsx.
 * Mirrors app/vanity/page.tsx: mounts the configurator, logs the emitted config.
 */

import { useState } from "react";
import { RoomConfigurator, type RoomConfig } from "@/components/room/RoomConfigurator";
import { Check } from "lucide-react";

export default function RoomDemoPage() {
  const [added, setAdded] = useState<RoomConfig[]>([]);

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
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Room configurator</div>
          <h1 className="font-display text-lg font-bold leading-tight">Draw the space</h1>
        </div>
      </header>

      <div className="mx-auto max-w-6xl p-5">
        <RoomConfigurator
          mode="dealer"
          onComplete={(cfg) => { console.log("RoomConfig emitted:", cfg); setAdded((prev) => [...prev, cfg]); }}
        />

        {added.length > 0 && (
          <div className="mt-6 rounded-2xl border border-line bg-card p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Added to quote (onComplete output)</div>
            <div className="space-y-2">
              {added.map((cfg, i) => (
                <div key={i} className="flex items-center justify-between gap-3 border-b border-line pb-2 text-sm last:border-0">
                  <span className="flex items-center gap-2"><Check className="h-4 w-4 text-accent" /> {cfg.label}</span>
                  <span className="font-mono text-xs text-muted">{cfg.clearanceIssues.length ? `${cfg.clearanceIssues.length} clearance note(s)` : "clear"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
