"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { listProjects, type Project } from "@/lib/store";
import { ProjectForm } from "@/components/projects/ProjectForm";
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

  const refresh = useCallback(() => { listProjects(ownerId).then(setProjects); }, [ownerId]);
  useEffect(() => { refresh(); }, [refresh]);
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
            return (
              <Link key={p.id} href={`/portal/projects/${p.id}`}
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
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-muted">
                  <RegChip status={p.jobRegistration} />
                  <span>{relativeUpdated(t, p.updatedAt, nowMs)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
