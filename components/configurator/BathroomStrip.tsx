"use client";

/**
 * The bathroom tabs above the configurator hub.
 *
 * HIDDEN AT N=1, and that is the whole design rather than a detail. Every quote that exists
 * today is one bathroom, and a dealer doing the ordinary job must never meet a control they
 * have to reason about to do what they already do. So there is no "Bathroom 1" tab sitting
 * over a single-bathroom quote — the strip appears the moment a second bathroom exists and
 * disappears again if it is removed.
 *
 * Naming is optional in the same spirit. A bathroom starts unnamed and renders a numbered
 * placeholder; double-clicking a tab is what turns it into "Master". Clearing the field puts
 * the placeholder back rather than leaving an empty tab (see renameBathroom).
 */

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { labelForBathroom, type Bathroom } from "@/lib/bathrooms";

export function BathroomStrip({
  bathrooms,
  activeId,
  onSelect,
  onRename,
  onAdd,
  onRemoveRequest,
}: {
  bathrooms: Bathroom[];
  activeId: string;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAdd: () => void;
  /** Reports intent only. The hub owns the confirmation and the removal. */
  onRemoveRequest: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  // Enter and Escape both close the editor themselves. Set here so the blur that may follow
  // does not commit a second time — or, after Escape, commit the value that was just abandoned.
  const closedByKey = useRef(false);

  // A click anywhere else dismisses the tab menu, the same way the product hover cards close.
  useEffect(() => {
    if (!menuId) return;
    const onDown = () => setMenuId(null);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuId]);

  // Defensive: the hub already gates on this, but the rule is the component's own contract.
  if (bathrooms.length <= 1) return null;

  const startRename = (b: Bathroom) => {
    setMenuId(null);
    setDraft(b.name ?? "");
    setEditingId(b.id);
  };
  const commit = () => {
    if (editingId) onRename(editingId, draft);
    setEditingId(null);
  };
  const onEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { closedByKey.current = true; commit(); }
    // Escape abandons the edit. The name is untouched, so a mistyped rename costs nothing.
    else if (e.key === "Escape") { closedByKey.current = true; setEditingId(null); }
  };
  // Tabbing away or clicking elsewhere saves, which is what "just type over it" implies.
  const onEditBlur = () => {
    if (closedByKey.current) { closedByKey.current = false; return; }
    commit();
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t("configurator.bathroom.strip")}>
      {bathrooms.map((b, i) => {
        const active = b.id === activeId;
        const label = labelForBathroom(b, i, t);

        if (editingId === b.id) {
          return (
            <input
              key={b.id}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={onEditKeyDown}
              onBlur={onEditBlur}
              placeholder={label}
              aria-label={t("configurator.bathroom.renameLabel", { name: label })}
              className="min-h-[34px] w-[140px] rounded-lg border border-accent bg-card px-3 py-1.5 text-xs font-medium text-ink outline-none"
            />
          );
        }

        return (
          <span key={b.id} className="relative inline-flex">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(b.id)}
              onDoubleClick={() => startRename(b)}
              onContextMenu={(e) => { e.preventDefault(); onSelect(b.id); setMenuId(b.id); }}
              title={t("configurator.bathroom.renameHint")}
              className={`min-h-[34px] rounded-l-lg border-y border-l px-3 py-1.5 text-xs font-medium transition ${
                active ? "border-accent bg-accent-soft/50 text-ink" : "border-line text-muted hover:bg-ink/5"
              }`}
            >
              {label}
            </button>
            <button
              type="button"
              aria-label={t("configurator.bathroom.menuLabel", { name: label })}
              // pointerdown is stopped, not click: the document-level dismiss listener runs on
              // pointerdown, so without this the menu would close in the same gesture that opens it.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => { onSelect(b.id); setMenuId((m) => (m === b.id ? null : b.id)); }}
              className={`grid min-h-[34px] w-7 place-items-center rounded-r-lg border-y border-r transition ${
                active ? "border-accent bg-accent-soft/50 text-ink" : "border-line text-muted hover:bg-ink/5"
              }`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>

            {menuId === b.id && (
              <span
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute right-0 top-full z-20 mt-1 flex w-40 flex-col overflow-hidden rounded-lg border border-line bg-card py-1 shadow-lg"
              >
                <button type="button" onClick={() => startRename(b)}
                  className="px-3 py-2 text-left text-xs text-ink transition hover:bg-ink/5">
                  {t("configurator.bathroom.rename")}
                </button>
                <button type="button" onClick={() => { setMenuId(null); onRemoveRequest(b.id); }}
                  className="px-3 py-2 text-left text-xs text-amber transition hover:bg-amber/10">
                  {t("configurator.bathroom.remove")}
                </button>
              </span>
            )}
          </span>
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        title={t("configurator.bathroom.add")}
        aria-label={t("configurator.bathroom.add")}
        className="grid min-h-[34px] w-8 place-items-center rounded-lg border border-dashed border-line text-muted transition hover:border-accent hover:text-accent"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
