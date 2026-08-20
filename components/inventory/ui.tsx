"use client";

// Shared presentation for the admin inventory screens. Nothing here is inventory-specific
// logic — that lives in lib/inventory.ts — these are the repeated bits of chrome the four
// screens would otherwise each restate: stat cards, badges, form fields, enum labels.
//
// Admin-only surface. No contractor-facing route imports any of this.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { InventoryCategory, MovementReason } from "@/lib/inventory";

type T = (key: string, vars?: Record<string, string>) => string;

// Enum → translated label. Category values contain hyphens ("wall-panel"), which are fine
// as i18n key segments because translate() only splits on ".".
export const categoryLabel = (t: T, c: InventoryCategory) => t(`inventory.cat.${c}`);
export const reasonLabel = (t: T, r: MovementReason) => t(`inventory.reason.${r}`);
export const uomLabel = (t: T, u: string) => t(`inventory.uom.${u}`);

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : "—");
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
export const fmtCost = (cents: number | null) =>
  cents === null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// Shared control styling, matching the CRM / settings forms.
export const INPUT =
  "mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";
export const SELECT = INPUT + " appearance-none";

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        {label}
        {required && <span className="text-accent">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-muted">{hint}</span>}
    </label>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "amber" | "muted" | "accent" | "success"; children: React.ReactNode }) {
  const tones = {
    amber: "border-amber/30 bg-amber/10 text-amber",
    muted: "border-line bg-paper text-muted",
    accent: "border-accent/30 bg-accent-soft/40 text-accent",
    success: "border-success/30 bg-success/10 text-success",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

// A warning that explains but never blocks — the philosophy of this whole section. The only
// hard block in the system is a movement that would drive on-hand below zero.
export function WarnBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm leading-relaxed text-amber">
      {children}
    </div>
  );
}

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2 text-sm leading-relaxed text-ink">{children}</div>
  );
}

export function PageHeading({
  eyebrow,
  sub,
  right,
}: {
  eyebrow: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{eyebrow}</div>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-accent">
      <ArrowLeft className="h-4 w-4" /> {label}
    </Link>
  );
}

export function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_GHOST =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
