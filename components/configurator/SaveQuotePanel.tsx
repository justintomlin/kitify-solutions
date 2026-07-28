"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageContext";
import { listProjects, listQuotes, saveQuote, type Project, type Quote } from "@/lib/store";
import { ProjectForm } from "@/components/projects/ProjectForm";

const NEW = "__new__";
const INPUT =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";
const LABEL = "mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-muted";

// Inline panel for saving the hub's current quote into a project. It always CREATES a
// new quote (updating an existing one in place is a separate, direct action in the hub).
// Choosing "New project…" reveals the shared ProjectForm inline; on save the new project
// is auto-selected. The quote name defaults to "Quote N" based on how many the selected
// project already has, unless the contractor overrides it.
export function SaveQuotePanel({
  ownerId,
  initialProjectId,
  quoteInput,
  onSaved,
  onCancel,
}: {
  ownerId: string;
  initialProjectId?: string;
  quoteInput: { room: unknown; shower: unknown; vanity: unknown; plumbing: unknown; total: number };
  onSaved: (quote: Quote, projectName: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>(initialProjectId ?? "");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the contractor's projects; default the selection.
  useEffect(() => {
    let cancelled = false;
    listProjects(ownerId).then((ps) => {
      if (cancelled) return;
      setProjects(ps);
      setSelectedId((cur) => cur || (initialProjectId ?? (ps.length ? ps[0].id : NEW)));
    });
    return () => { cancelled = true; };
  }, [ownerId, initialProjectId]);

  // Default the quote name to "Quote N" for the selected project, until the user edits it.
  useEffect(() => {
    if (!selectedId || selectedId === NEW || nameEdited) return;
    let cancelled = false;
    listQuotes({ projectId: selectedId }).then((qs) => {
      if (!cancelled && !nameEdited) setName(t("configurator.quoteNameDefault", { n: String(qs.length + 1) }));
    });
    return () => { cancelled = true; };
  }, [selectedId, nameEdited, t]);

  const creating = selectedId === NEW;

  async function save() {
    if (!selectedId || creating) { setError(t("configurator.selectProjectFirst")); return; }
    setError(null);
    setSaving(true);
    const finalName = name.trim() || t("configurator.quoteNameDefault", { n: "1" });
    const saved = await saveQuote({
      projectId: selectedId,
      ownerId,
      name: finalName,
      room: quoteInput.room,
      shower: quoteInput.shower,
      vanity: quoteInput.vanity,
      plumbing: quoteInput.plumbing,
      total: quoteInput.total,
      status: "draft",
    });
    setSaving(false);
    onSaved(saved, projects?.find((p) => p.id === selectedId)?.name ?? "");
  }

  return (
    <div className="rounded-2xl border border-accent/40 bg-accent-soft/20 p-4">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">{t("configurator.saveQuoteTitle")}</div>

      <label className="block">
        <span className={LABEL}>{t("configurator.projectField")}</span>
        <select
          value={selectedId}
          onChange={(e) => { setSelectedId(e.target.value); setError(null); }}
          className={INPUT}
          disabled={projects === null}
        >
          {projects === null ? (
            <option>{t("configurator.loading")}</option>
          ) : (
            <>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value={NEW}>{t("configurator.newProjectOption")}</option>
            </>
          )}
        </select>
      </label>

      {creating ? (
        <div className="mt-3">
          <ProjectForm
            ownerId={ownerId}
            onSaved={(p) => {
              setProjects((prev) => [p, ...(prev ?? [])]);
              setSelectedId(p.id);
              setNameEdited(false);
            }}
            onCancel={() => setSelectedId(projects && projects.length ? projects[0].id : "")}
          />
        </div>
      ) : (
        <>
          <label className="mt-3 block">
            <span className={LABEL}>{t("configurator.quoteNameField")}</span>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setNameEdited(true); }}
              className={INPUT}
            />
          </label>

          {error && <div className="mt-2 text-xs text-amber">{error}</div>}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? t("configurator.savingQuote") : t("configurator.saveQuoteAction")}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted transition hover:text-ink"
            >
              {t("configurator.cancel")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
