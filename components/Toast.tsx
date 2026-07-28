"use client";

import { useCallback, useState } from "react";

// Minimal transient toast — a fixed bottom-center pill that auto-dismisses. Shared by the
// admin leads / inside-leads pages for save + action confirmations.
export function useToast(ms = 2500) {
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), ms);
  }, [ms]);
  return { toast, showToast };
}

export function ToastView({ toast }: { toast: string | null }) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div className="rounded-full border border-line bg-ink px-4 py-2 text-sm font-medium text-white shadow-lg">{toast}</div>
    </div>
  );
}
