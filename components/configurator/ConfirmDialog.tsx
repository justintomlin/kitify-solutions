"use client";

import { useEffect, useRef } from "react";

/**
 * A modal confirmation for a destructive action.
 *
 * window.confirm() is what the hub uses for "clear the whole quote", and it is fine there:
 * one sentence, no name to get wrong. Removing a bathroom is not that — the dealer needs to
 * read WHICH bathroom is about to go and what goes with it, and a native dialog cannot carry
 * a translated, dealer-supplied name alongside a warning without becoming a wall of text.
 *
 * Chrome mirrors the quote sheet in the hub (same overlay, same next-frame fade-in, same
 * Escape handling), so the two read as the same product rather than as two dialog systems.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Cancel is focused on open, not confirm: this dialog only ever guards a deletion, and the
  // key a dealer reaches for reflexively must not be the one that destroys their work.
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div aria-hidden onClick={onCancel} className="absolute inset-0 bg-ink/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-sm rounded-2xl border border-line bg-card p-5 shadow-2xl"
      >
        <div className="font-display text-base font-semibold text-ink">{title}</div>
        <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[44px] w-full rounded-lg bg-amber px-4 text-sm font-semibold text-white transition hover:brightness-110 sm:w-auto"
          >
            {confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="min-h-[44px] w-full rounded-lg border border-line px-4 text-sm font-medium text-muted transition hover:text-ink sm:w-auto"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
