"use client";

/**
 * Sidebar mode — the one place that decides whether the portal nav is a fixed column or a
 * slide-over overlay, and the one place that owns the overlay's open/closed state.
 *
 * Two inputs, in priority order:
 *   1. Viewport. Below 1024px the nav is ALWAYS an overlay — tablets and phones need every
 *      pixel of width for content, whatever page they're on.
 *   2. Route. At 1024px and up, browsing/management pages keep the fixed column (users are
 *      scanning and jumping between sections) while focused-work pages collapse it.
 *
 * Consumers read `mode` and never re-derive it: Sidebar picks its own presentation, Header
 * shows the hamburger only when there's something to toggle, and the layout drops its grid
 * column. That keeps the three in lockstep — there's no way for the content area to reserve
 * a column the sidebar isn't filling.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { resolveSidebarMode, WIDE_VIEWPORT, type SidebarMode } from "@/lib/sidebar-mode";

type SidebarState = {
  mode: SidebarMode;
  /** Overlay visibility. Always false in fixed mode, where there's nothing to open. */
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarState | null>(null);

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used inside <SidebarProvider>");
  return ctx;
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Server/hydration value is `true` (desktop). The portal renders a loading spinner until
  // the client-side auth gate resolves, so the nav's first real paint always happens in the
  // browser with a true matchMedia reading — a narrow viewport can never flash the fixed
  // column, and there's no server markup for this subtree to mismatch against.
  const isWide = useMediaQuery(WIDE_VIEWPORT, true);
  const mode: SidebarMode = resolveSidebarMode(pathname, isWide);

  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  // Navigating closes the overlay. Keyed on the pathname rather than on the nav links
  // themselves so in-page links, redirects and browser back/forward all close it too.
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Widening the window (or moving to a page that gets the fixed column) must not leave a
  // stale overlay + backdrop floating over the restored sidebar.
  useEffect(() => {
    if (mode === "fixed") setIsOpen(false);
  }, [mode]);

  // Escape closes, as with any other overlay.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Rotating a tablet closes the overlay. The mode effect above already covers a rotation
  // that crosses 1024px (portrait -> landscape on an iPad), but landscape -> portrait stays
  // collapsible the whole way, so an open panel would survive into a viewport laid out for a
  // different size. Cheaper and less surprising to just dismiss it and let the user re-open.
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    // orientationchange is the reliable signal on iOS Safari; the media query covers the rest
    // (including a desktop window being reshaped).
    const mql = window.matchMedia("(orientation: portrait)");
    window.addEventListener("orientationchange", close);
    mql.addEventListener("change", close);
    return () => {
      window.removeEventListener("orientationchange", close);
      mql.removeEventListener("change", close);
    };
  }, [isOpen]);

  const value = useMemo<SidebarState>(
    // isOpen is gated on the mode so a consumer can never act on an open overlay that
    // isn't actually rendered.
    () => ({ mode, isOpen: mode === "collapsible" && isOpen, open, close, toggle }),
    [mode, isOpen, open, close, toggle],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}
