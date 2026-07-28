"use client";

import { useLanguage } from "@/components/LanguageContext";
import type { Project, Quote, Proposal, Order, WarrantyStatus, JobRegistrationStatus } from "@/lib/store";

type Tr = (key: string, vars?: Record<string, string>) => string;
type Tone = "accent" | "amber" | "muted" | "success";

const TONE_CLASS: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent",
  amber: "bg-amber/15 text-amber",
  muted: "bg-ink/5 text-muted",
  success: "bg-success/15 text-success",
};

// Relative "updated N ago" label, translated. `nowMs` is passed in so the caller can
// tick it on an interval; numeric parts are never translated.
export function relativeUpdated(t: Tr, iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (isNaN(then)) return "";
  const min = Math.max(0, Math.floor(((nowMs || Date.now()) - then) / 60000));
  if (min < 1) return t("projects.updatedJustNow");
  if (min < 60) return t("projects.updatedMinAgo", { n: String(min) });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("projects.updatedHrAgo", { n: String(hr) });
  const day = Math.floor(hr / 24);
  return t(day === 1 ? "projects.updatedDayAgo" : "projects.updatedDaysAgo", { n: String(day) });
}

export function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

const PROJECT_STATUS: Record<Project["status"], { key: string; tone: Tone }> = {
  estimating: { key: "projects.statusEstimating", tone: "accent" },
  ordered: { key: "projects.statusOrdered", tone: "amber" },
  complete: { key: "projects.statusComplete", tone: "accent" },
  lost: { key: "projects.statusLost", tone: "muted" },
};
export function ProjectStatusChip({ status }: { status: Project["status"] }) {
  const { t } = useLanguage();
  const s = PROJECT_STATUS[status];
  return <Chip tone={s.tone}>{t(s.key)}</Chip>;
}

const REG_STATUS: Record<JobRegistrationStatus, { key: string; tone: Tone }> = {
  not_started: { key: "projects.regNotStarted", tone: "muted" },
  started: { key: "projects.regStarted", tone: "amber" },
  complete: { key: "projects.regComplete", tone: "accent" },
};
export function RegChip({ status }: { status: JobRegistrationStatus }) {
  const { t } = useLanguage();
  const s = REG_STATUS[status];
  return <Chip tone={s.tone}>{t("projects.regLabel")}: {t(s.key)}</Chip>;
}

const QUOTE_STATUS: Record<Quote["status"], { key: string; tone: Tone }> = {
  draft: { key: "projects.qStatusDraft", tone: "muted" },
  sent: { key: "projects.qStatusSent", tone: "accent" },
  accepted: { key: "projects.qStatusAccepted", tone: "accent" },
  ordered: { key: "projects.qStatusOrdered", tone: "amber" },
  archived: { key: "projects.qStatusArchived", tone: "muted" },
};
export function QuoteStatusChip({ status }: { status: Quote["status"] }) {
  const { t } = useLanguage();
  const s = QUOTE_STATUS[status];
  return <Chip tone={s.tone}>{t(s.key)}</Chip>;
}

const PROPOSAL_STATUS: Record<Proposal["status"], { key: string; tone: Tone }> = {
  draft: { key: "projects.pStatusDraft", tone: "amber" }, // amber DRAFT
  shared: { key: "projects.pStatusShared", tone: "success" }, // green SHARED
  accepted: { key: "projects.pStatusAccepted", tone: "accent" },
  ordered: { key: "projects.pStatusOrdered", tone: "accent" }, // converted to an order
  archived: { key: "projects.pStatusArchived", tone: "muted" },
};
export function ProposalStatusChip({ status }: { status: Proposal["status"] }) {
  const { t } = useLanguage();
  const s = PROPOSAL_STATUS[status];
  return <Chip tone={s.tone}>{t(s.key)}</Chip>;
}

const ORDER_STATUS: Record<Order["status"], { key: string; tone: Tone }> = {
  submitted: { key: "projects.oStatusSubmitted", tone: "accent" },
  confirmed: { key: "projects.oStatusConfirmed", tone: "accent" },
  in_production: { key: "projects.oStatusInProduction", tone: "amber" },
  ready_to_ship: { key: "projects.oStatusReadyToShip", tone: "amber" },
  in_transit: { key: "projects.oStatusInTransit", tone: "accent" },
  delivered: { key: "projects.oStatusDelivered", tone: "success" },
  completed: { key: "projects.oStatusCompleted", tone: "success" },
  cancelled: { key: "projects.oStatusCancelled", tone: "muted" },
};
export function OrderStatusChip({ status }: { status: Order["status"] }) {
  const { t } = useLanguage();
  const s = ORDER_STATUS[status];
  return <Chip tone={s.tone}>{t(s.key)}</Chip>;
}

const WARRANTY_STATUS: Record<WarrantyStatus, { key: string; tone: Tone }> = {
  unregistered: { key: "projects.wStatusUnregistered", tone: "muted" },
  registered: { key: "projects.wStatusRegistered", tone: "success" },
  claim_open: { key: "projects.wStatusClaimOpen", tone: "amber" },
  claim_resolved: { key: "projects.wStatusClaimResolved", tone: "accent" },
};
export function WarrantyStatusChip({ status }: { status: WarrantyStatus }) {
  const { t } = useLanguage();
  const s = WARRANTY_STATUS[status];
  return <Chip tone={s.tone}>{t(s.key)}</Chip>;
}
