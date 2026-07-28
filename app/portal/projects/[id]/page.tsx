"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2, Plus, Share2, Link2Off, Copy, Check, CheckCircle2, PackagePlus } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import {
  getProject, listQuotes, deleteProject, deleteQuote,
  listProposals, deleteProposal, shareProposal, revokeProposal,
  listOrders, createOrderFromProposal,
  type Project, type Quote, type Proposal, type Order,
} from "@/lib/store";
import { ProjectForm } from "@/components/projects/ProjectForm";
import { ProposalForm } from "@/components/projects/ProposalForm";
import { ProjectStatusChip, RegChip, QuoteStatusChip, ProposalStatusChip, OrderStatusChip, relativeUpdated } from "@/components/projects/ui";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function ProjectDetailPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { userId } = useAuth();
  // owner_id is the stable auth uuid (references profiles.id). Portal routes require a
  // session, so this is a real uuid; "anon" is only a defensive fallback.
  const ownerId = userId ?? "anon";
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [project, setProject] = useState<Project | null | undefined>(undefined); // undefined = loading
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [editing, setEditing] = useState(false);
  const [proposalForm, setProposalForm] = useState<{ editing?: Proposal } | null>(null);
  const [origin, setOrigin] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null); // share/unshare/convert in flight
  const [nowMs, setNowMs] = useState(0);

  const loadProject = useCallback(() => { getProject(id).then((p) => setProject(p)); }, [id]);
  const loadQuotes = useCallback(() => { listQuotes({ projectId: id }).then(setQuotes); }, [id]);
  // On error, fall back to an empty list so the section still renders its header + "New
  // proposal" button (the store already logs the failure) rather than hanging on "loading".
  const loadProposals = useCallback(() => { listProposals({ projectId: id }).then(setProposals).catch(() => setProposals([])); }, [id]);
  const loadOrders = useCallback(() => { listOrders({ projectId: id }).then(setOrders).catch(() => setOrders([])); }, [id]);
  useEffect(() => { loadProject(); loadQuotes(); loadProposals(); loadOrders(); }, [loadProject, loadQuotes, loadProposals, loadOrders]);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    setNowMs(Date.now());
    const t2 = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t2);
  }, []);

  async function onDeleteProject() {
    if (typeof window !== "undefined" && !window.confirm(t("projects.confirmDelete"))) return;
    // Proposals reference quotes (tier_*), so remove them before their quotes, then the project.
    const [qs, ps] = await Promise.all([listQuotes({ projectId: id }), listProposals({ projectId: id })]);
    await Promise.all(ps.map((p) => deleteProposal(p.id)));
    await Promise.all(qs.map((q) => deleteQuote(q.id)));
    await deleteProject(id);
    router.push("/portal/projects");
  }
  async function onDeleteQuote(qid: string) {
    // A quote assigned to a proposal tier can't be deleted (FK) — guard with a clear message.
    const usedBy = (proposals ?? []).some(
      (p) => p.tierGood === qid || p.tierBetter === qid || p.tierBest === qid || p.acceptedQuoteId === qid,
    );
    if (usedBy) { if (typeof window !== "undefined") window.alert(t("projects.quoteInUseProposal")); return; }
    if (typeof window !== "undefined" && !window.confirm(t("projects.confirmDeleteQuote"))) return;
    await deleteQuote(qid);
    loadQuotes();
  }

  async function onShare(pid: string) {
    setBusyId(pid);
    try { await shareProposal(pid); } finally { setBusyId(null); }
    loadProposals();
  }
  async function onUnshare(pid: string) {
    if (typeof window !== "undefined" && !window.confirm(t("projects.confirmUnshare"))) return;
    setBusyId(pid);
    try { await revokeProposal(pid); } finally { setBusyId(null); }
    loadProposals();
  }
  async function onDeleteProposal(pid: string) {
    if (typeof window !== "undefined" && !window.confirm(t("projects.confirmDeleteProposal"))) return;
    await deleteProposal(pid);
    loadProposals();
  }
  async function onConvertToOrder(pid: string) {
    if (typeof window !== "undefined" && !window.confirm(t("projects.confirmConvert"))) return;
    setBusyId(pid);
    try {
      await createOrderFromProposal(pid);
    } catch {
      if (typeof window !== "undefined") window.alert(t("projects.convertError"));
    } finally {
      setBusyId(null);
    }
    loadProposals(); // proposal flips to 'ordered'
    loadOrders();    // the new order appears on the row
  }
  function copyLink(pid: string, link: string) {
    navigator.clipboard?.writeText(link).then(() => {
      setCopiedId(pid);
      setTimeout(() => setCopiedId((c) => (c === pid ? null : c)), 2000);
    }).catch(() => {});
  }

  const backLink = (
    <Link href="/portal/projects" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
      <ArrowLeft className="h-4 w-4" /> {t("projects.back")}
    </Link>
  );

  if (project === undefined) {
    return <div className="mx-auto max-w-3xl"><div className="rounded-2xl border border-line bg-paper/60 p-8 text-center text-sm text-muted">{t("projects.loading")}</div></div>;
  }
  if (project === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {backLink}
        <div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center text-sm text-muted">{t("projects.notFound")}</div>
      </div>
    );
  }

  const city = [project.address.city, project.address.state, project.address.zip].filter(Boolean).join(", ");
  const hasContact = !!(project.customer.phone || project.customer.email);
  const quoteName = (qid: string) => (quotes === null ? "…" : quotes.find((q) => q.id === qid)?.name ?? t("projects.quoteRemoved"));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {backLink}

      {editing ? (
        <ProjectForm ownerId={ownerId} initial={project} onSaved={() => { setEditing(false); loadProject(); }} onCancel={() => setEditing(false)} />
      ) : (
        <div className="rounded-2xl border border-line bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg font-bold">{project.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <ProjectStatusChip status={project.status} />
                <RegChip status={project.jobRegistration} />
                <span className="text-[10px] text-muted">{relativeUpdated(t, project.updatedAt, nowMs)}</span>
              </div>
            </div>
            <button onClick={() => setEditing(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium transition hover:border-accent hover:text-accent">
              <Pencil className="h-3.5 w-3.5" /> {t("projects.edit")}
            </button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("projects.customer")}</div>
              <div className="text-sm text-ink">{project.customer.name}</div>
            </div>
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("projects.contact")}</div>
              {hasContact ? (
                <div className="text-sm text-ink">
                  {project.customer.phone && <div>{project.customer.phone}</div>}
                  {project.customer.email && <div className="truncate">{project.customer.email}</div>}
                </div>
              ) : <div className="text-sm text-muted">{t("projects.noContact")}</div>}
            </div>
            <div className="sm:col-span-2">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("projects.address")}</div>
              <div className="text-sm text-ink">
                {[project.address.street, city].filter(Boolean).join(" · ") || <span className="text-muted">—</span>}
              </div>
            </div>
            {project.notes && (
              <div className="sm:col-span-2">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("projects.fieldNotes")}</div>
                <div className="whitespace-pre-wrap text-sm text-ink/80">{project.notes}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quotes */}
      <div className="rounded-2xl border border-line bg-card p-5">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("projects.quotesTitle")}</div>
        {quotes === null ? (
          <div className="text-sm text-muted">{t("projects.loading")}</div>
        ) : quotes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-paper/50 p-6 text-center text-sm text-muted">{t("projects.quotesEmpty")}</div>
        ) : (
          <div className="space-y-2">
            {quotes.map((q) => (
              <div key={q.id} className="flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-paper/70 px-4 py-3 transition hover:border-accent">
                <Link href={`/portal/configurator?quote=${q.id}`} title={t("projects.openInConfigurator")} className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{q.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
                    <QuoteStatusChip status={q.status} />
                    <span>{relativeUpdated(t, q.updatedAt, nowMs)}</span>
                  </div>
                </Link>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">{money(q.total)}</span>
                  <button onClick={() => onDeleteQuote(q.id)} title={t("projects.deleteQuote")}
                    className="rounded-md border border-line p-1.5 text-muted transition hover:border-amber hover:text-amber">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Proposals — group quotes into good/better/best and share with the customer */}
      <div className="rounded-2xl border border-line bg-card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("projects.proposalsTitle")}</span>
          {!proposalForm && (
            <button onClick={() => setProposalForm({})}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium transition hover:border-accent hover:text-accent">
              <Plus className="h-3.5 w-3.5" /> {t("projects.newProposal")}
            </button>
          )}
        </div>

        {proposalForm && (
          <div className="mb-4">
            <ProposalForm
              ownerId={ownerId} projectId={id} quotes={quotes ?? []} initial={proposalForm.editing}
              onSaved={() => { setProposalForm(null); loadProposals(); }} onCancel={() => setProposalForm(null)}
            />
          </div>
        )}

        {proposals === null ? (
          <div className="text-sm text-muted">{t("projects.loading")}</div>
        ) : proposals.length === 0 ? (
          !proposalForm && <div className="rounded-xl border border-dashed border-line bg-paper/50 p-6 text-center text-sm text-muted">{t("projects.proposalsEmpty")}</div>
        ) : (
          <div className="space-y-3">
            {proposals.map((p) => {
              const link = p.shareToken ? `${origin}/proposal/${p.shareToken}` : "";
              const tiers = ([
                ["good", t("projects.tierGoodLabel"), p.tierGood],
                ["better", t("projects.tierBetterLabel"), p.tierBetter],
                ["best", t("projects.tierBestLabel"), p.tierBest],
              ] as [string, string, string | null][]).filter(([, , qid]) => qid);
              const acceptedTier =
                p.acceptedQuoteId === p.tierGood ? t("projects.tierGoodLabel")
                : p.acceptedQuoteId === p.tierBetter ? t("projects.tierBetterLabel")
                : p.acceptedQuoteId === p.tierBest ? t("projects.tierBestLabel")
                : "—";
              const order = orders.find((o) => o.proposalId === p.id);
              // Locked = accepted or converted: the homeowner link stays live and can't be
              // unshared or deleted (the accept, and then the order, are one-way).
              const locked = p.status === "accepted" || p.status === "ordered";
              return (
                <div key={p.id} className="rounded-xl border border-line/70 bg-paper/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{p.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <ProposalStatusChip status={p.status} />
                        <span className="text-[10px] text-muted">{relativeUpdated(t, p.updatedAt, nowMs)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button onClick={() => setProposalForm({ editing: p })} title={t("projects.edit")}
                        className="rounded-md border border-line p-1.5 text-muted transition hover:border-accent hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>
                      {/* A locked (accepted/ordered) proposal is frozen (one-way) — no delete. */}
                      {!locked && (
                        <button onClick={() => onDeleteProposal(p.id)} title={t("projects.deleteProposal")}
                          className="rounded-md border border-line p-1.5 text-muted transition hover:border-amber hover:text-amber"><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  </div>

                  {/* Tier assignments */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {tiers.length === 0 ? (
                      <span className="text-xs text-muted">{t("projects.noTiersAssigned")}</span>
                    ) : tiers.map(([key, label, qid]) => (
                      <span key={key} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1 text-xs">
                        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">{label}</span>
                        <span className="max-w-[160px] truncate text-ink">{quoteName(qid!)}</span>
                      </span>
                    ))}
                  </div>

                  {/* Acceptance badge — wired now; data arrives with the accept flow */}
                  {p.acceptedQuoteId && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft/30 px-3 py-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <div className="text-xs">
                        <div className="font-semibold text-ink">{t("projects.acceptedBadge", { tier: acceptedTier })}</div>
                        {(p.acceptedBy || p.acceptedAt) && (
                          <div className="text-muted">{t("projects.acceptedMeta", { who: p.acceptedBy ?? "—", when: p.acceptedAt ? new Date(p.acceptedAt).toLocaleDateString() : "—" })}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Order — convert an accepted proposal, or show the placed order */}
                  {order ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft/20 px-3 py-2">
                      <PackagePlus className="h-4 w-4 shrink-0 text-accent" />
                      <span className="font-mono text-xs font-semibold text-ink">{order.orderNumber}</span>
                      <OrderStatusChip status={order.status} />
                    </div>
                  ) : p.status === "accepted" ? (
                    <button onClick={() => onConvertToOrder(p.id)} disabled={busyId === p.id}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white transition hover:brightness-125 disabled:opacity-50">
                      <PackagePlus className="h-3.5 w-3.5" /> {busyId === p.id ? t("projects.convertingOrder") : t("projects.convertToOrder")}
                    </button>
                  ) : null}

                  {/* Share controls */}
                  <div className="mt-3 border-t border-line/60 pt-3">
                    {p.shareToken ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input readOnly value={link} onFocus={(e) => e.target.select()}
                            className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-1.5 font-mono text-xs text-ink" />
                          <button onClick={() => copyLink(p.id, link)}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium transition hover:border-accent hover:text-accent">
                            {copiedId === p.id ? <><Check className="h-3.5 w-3.5" /> {t("projects.copied")}</> : <><Copy className="h-3.5 w-3.5" /> {t("projects.copy")}</>}
                          </button>
                        </div>
                        {/* Locked proposals stay live (the homeowner sees their confirmation)
                            and can't be unshared — the accept, then the order, are one-way. */}
                        {locked ? (
                          <p className="flex items-center gap-1.5 text-xs text-muted">
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {t("projects.acceptedLockNote")}
                          </p>
                        ) : (
                          <button onClick={() => onUnshare(p.id)} disabled={busyId === p.id}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition hover:text-amber disabled:opacity-50">
                            <Link2Off className="h-3.5 w-3.5" /> {t("projects.unshare")}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted">{t("projects.notSharedYet")}</span>
                        <button onClick={() => onShare(p.id)} disabled={busyId === p.id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                          <Share2 className="h-3.5 w-3.5" /> {t("projects.share")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className="flex justify-end">
        <button onClick={onDeleteProject}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-amber">
          <Trash2 className="h-4 w-4" /> {t("projects.deleteProject")}
        </button>
      </div>
    </div>
  );
}
