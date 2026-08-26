"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { listProjects, listProposals, listOrders, deleteProject, type Project } from "@/lib/store";
import { undeletableProjectIds, canDeleteProject } from "@/lib/project-deletable";
import { ProjectForm } from "@/components/projects/ProjectForm";
import { ConfirmDialog } from "@/components/configurator/ConfirmDialog";
import { ProjectStatusChip, RegChip, relativeUpdated } from "@/components/projects/ui";

export default function ProjectsPage() {
  const { t } = useLanguage();
  const { userId } = useAuth();
  // owner_id is the stable auth uuid (references profiles.id). Portal routes require a
  // session, so this is a real uuid; "anon" is only a defensive fallback.
  const ownerId = userId ?? "anon";

  const [projects, setProjects] = useState<Project[] | null>(null); // null = loading
  const [formOpen, setFormOpen] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  /**
   * Project ids that must never be offered a delete. NULL while loading, which reads as
   * "nothing is deletable yet" — see canDeleteProject for why that is the safe default.
   *
   * Loaded as two owner-scoped list calls rather than a join: listProjects returns a Project,
   * which carries nothing about proposals or orders, and both list functions already exist and
   * are already owner-filtered. Two extra reads on a page that loads once.
   */
  const [blocked, setBlocked] = useState<Set<string> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const refresh = useCallback(() => {
    listProjects(ownerId).then(setProjects);
    // Deliberately not Promise.all with the above: the list should paint as soon as it can,
    // and the delete controls appearing a moment later is better than a slower first render.
    Promise.all([listProposals({ ownerId }), listOrders({ ownerId })])
      .then(([ps, os]) => setBlocked(undeletableProjectIds(ps, os)))
      // A guard that failed to load must not be read as "everything is deletable". An empty
      // set would do exactly that, so the failure keeps it null and the controls stay hidden.
      .catch(() => setBlocked(null));
  }, [ownerId]);
  useEffect(() => { refresh(); }, [refresh]);

  /**
   * Hard delete. quotes and proposals cascade at the database (see lib/project-deletable), so
   * this is ONE statement and either the whole project goes or none of it does — unlike the
   * detail page's multi-step delete, which can leave a project stripped of its proposals when
   * a later step is refused.
   *
   * There is no soft delete: projects has no deleted_at column, and adding one is a migration
   * this change does not need. Everything reachable here is pre-acceptance working material.
   */
  async function confirmDelete() {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    setDeleteError("");
    // Optimistic: the row goes now, and comes back if the database refuses.
    setProjects((prev) => (prev ? prev.filter((x) => x.id !== target.id) : prev));
    try {
      await deleteProject(target.id);
    } catch {
      setDeleteError(t("projects.deleteFailed", { name: target.name }));
      refresh();
    }
  }
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("projects.title")}</div>
          <p className="mt-1 text-sm text-muted">{t("projects.desc")}</p>
        </div>
        {!formOpen && (
          <button onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
            <Plus className="h-4 w-4" /> {t("projects.newProject")}
          </button>
        )}
      </div>

      {formOpen && (
        <div className="mb-6">
          <ProjectForm ownerId={ownerId} onSaved={() => { setFormOpen(false); refresh(); }} onCancel={() => setFormOpen(false)} />
        </div>
      )}

      {/* A refused delete. Warn-don't-block: the row is already back, this says why. */}
      {deleteError && (
        <div className="mb-4 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">{deleteError}</div>
      )}

      {projects === null ? (
        <div className="rounded-2xl border border-line bg-paper/60 p-8 text-center text-sm text-muted">{t("projects.loading")}</div>
      ) : projects.length === 0 ? (
        !formOpen && (
          <div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center">
            <p className="text-sm text-muted">{t("projects.empty")}</p>
            <p className="mt-1 text-xs text-muted">{t("projects.emptyHint")}</p>
            <button onClick={() => setFormOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
              <Plus className="h-4 w-4" /> {t("projects.newProject")}
            </button>
          </div>
        )
      ) : (
        <div className="space-y-2.5">
          {projects.map((p) => {
            const cityState = [p.address.city, p.address.state].filter(Boolean).join(", ");
            const deletable = canDeleteProject(p.id, blocked);
            return (
              // The trash sits BESIDE the Link, not inside it: a button nested in an anchor is
              // invalid markup, and the click would navigate to the project on its way out.
              <div key={p.id} className="relative">
                <Link href={`/portal/projects/${p.id}`}
                  className="block rounded-2xl border border-line bg-card p-4 transition hover:border-accent">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-display text-sm font-semibold">{p.name}</div>
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {p.customer.name}{cityState ? ` · ${cityState}` : ""}
                      </div>
                    </div>
                    <ProjectStatusChip status={p.status} />
                  </div>
                  {/* pr-10 keeps the meta line clear of the trash target when it wraps. */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 pr-10 text-[10px] text-muted">
                    <RegChip status={p.jobRegistration} />
                    <span>{relativeUpdated(t, p.updatedAt, nowMs)}</span>
                  </div>
                </Link>
                {/* HIDDEN, not disabled, on a project that cannot be deleted. A greyed-out bin
                    on an accepted job invites a click and then explains why it was refused;
                    absence says the same thing without the detour. */}
                {deletable && (
                  <button
                    type="button"
                    onClick={() => { setDeleteError(""); setPendingDelete(p); }}
                    aria-label={t("projects.deleteProjectNamed", { name: p.name })}
                    title={t("projects.deleteProject")}
                    className="absolute bottom-2.5 right-2.5 z-10 grid h-9 w-9 place-items-center rounded-lg border border-line bg-card text-muted transition hover:border-amber hover:text-amber"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Mandatory confirmation, naming the project. Reuses the dialog the bathroom remove
          uses — cancel takes focus, Escape closes, and the destructive button is amber. */}
      {pendingDelete && (
        <ConfirmDialog
          title={t("projects.confirmDeleteTitle", { name: pendingDelete.name })}
          body={t("projects.confirmDeleteBody")}
          confirmLabel={t("projects.confirmDeleteAction")}
          cancelLabel={t("projects.cancel")}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
