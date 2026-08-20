"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { primaryNav, adminNav, type NavItem } from "@/lib/nav";
import { useLanguage } from "./LanguageContext";
import { useAuth } from "./AuthContext";
import { Brand } from "./Brand";
import { useSidebar } from "./SidebarContext";
import { SIDEBAR_PANEL_WIDTH } from "@/lib/sidebar-mode";

function NavLink({ item, active, label }: { item: NavItem; active: boolean; label: string }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-white/10 text-white"
          : "text-white/60 hover:bg-white/5 hover:text-white/90"
      }`}
    >
      <Icon className={`h-[18px] w-[18px] ${active ? "text-accent" : ""}`} />
      <span className="truncate">{label}</span>
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
    </Link>
  );
}

/**
 * The nav itself — branding, links, admin section, tagline. Identical in both modes; only
 * the wrapper around it changes. `onClose` is passed in collapsible mode only, and adds the
 * one extra affordance an overlay needs: a close button.
 */
function SidebarPanel({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { isAdmin, profile } = useAuth();

  // Feature-toggled items drop out of the nav entirely rather than rendering disabled — a
  // contractor without inventory tracking should not know the section exists.
  const visiblePrimaryNav = primaryNav.filter(
    (item) => !item.requiresInventoryTracking || !!profile?.inventoryTrackingEnabled,
  );

  return (
    <div className="flex h-full flex-col bg-ink text-white">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-5">
        <Brand />
        {onClose && (
          // Lives inside the panel because an open 260px panel covers the header's
          // hamburger. 44px tap target, sized for tablets.
          <button
            type="button"
            onClick={onClose}
            aria-label={t("nav.closeMenu")}
            className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visiblePrimaryNav.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={pathname === item.href || pathname.startsWith(item.href + "/")}
            label={t(`nav.${item.key}`)}
          />
        ))}

        {isAdmin && (
          <div className="pt-4">
            <div className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
              {t("nav.adminSection")}
            </div>
            {adminNav.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={pathname === item.href || pathname.startsWith(item.href + "/")}
                label={t(`nav.${item.key}`)}
              />
            ))}
          </div>
        )}
      </nav>

      <div className="border-t border-white/10 px-5 py-4 font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
        {t("brand.tagline")}
      </div>
    </div>
  );
}

/**
 * Portal navigation. Presentation follows the mode from SidebarContext:
 *
 *   fixed       — a sticky column in the layout's grid, exactly as before.
 *   collapsible — a slide-over panel plus backdrop, both fixed-position and therefore out of
 *                 flow, so the content area keeps the full viewport width.
 *
 * Closing does NOT unmount the panel: it stays in the tree translated off-screen so the
 * slide animation has something to animate. `inert` keeps that off-screen copy out of the
 * tab order and away from screen readers, so a hidden nav can't be focused.
 */
export function Sidebar() {
  const { mode, isOpen, close } = useSidebar();

  if (mode === "fixed") {
    return (
      <aside className={`sticky top-0 h-dvh ${SIDEBAR_PANEL_WIDTH}`}>
        <SidebarPanel />
      </aside>
    );
  }

  return (
    <>
      {/* Backdrop — matches the tone the portal's other overlays use. Fades rather than
          mounts, and stops swallowing clicks the moment it's transparent. */}
      <div
        aria-hidden
        onClick={close}
        className={`fixed inset-0 z-40 bg-ink/40 transition-opacity duration-200 ease-out ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        id="portal-sidebar"
        inert={!isOpen}
        className={`fixed inset-y-0 left-0 z-50 h-dvh ${SIDEBAR_PANEL_WIDTH} transition-transform duration-200 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarPanel onClose={close} />
      </aside>
    </>
  );
}
