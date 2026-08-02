"use client";

import { useRouter } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { useAuth } from "./AuthContext";
import { useLanguage } from "./LanguageContext";
import { LanguageToggle } from "./LanguageToggle";
import { useSidebar } from "./SidebarContext";

export function Header() {
  const { user, profile, signOut } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const { mode, isOpen, toggle } = useSidebar();

  const isAdmin = profile?.role === "admin";
  const roleLabel = isAdmin ? t("header.roleAdmin") : t("header.roleUser");
  const displayName = profile?.name ?? user?.email ?? "";

  async function handleLogout() {
    await signOut();
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-card/90 px-4 backdrop-blur md:px-6">
      {/* Only rendered when there's a collapsed nav to reveal. The header is sticky, so this
          stays reachable while the page scrolls without needing to leave the flow — a truly
          fixed button would sit on top of the welcome text. 44px tap target for tablets. */}
      {mode === "collapsible" && (
        <button
          type="button"
          onClick={toggle}
          aria-label={isOpen ? t("nav.closeMenu") : t("nav.openMenu")}
          aria-expanded={isOpen}
          aria-controls="portal-sidebar"
          className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink/70 transition-colors hover:bg-ink/5"
        >
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      )}

      <div className="min-w-0">
        <div className="truncate font-display text-base font-semibold">
          {t("header.welcome", { name: displayName })}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-ink/60 sm:inline-flex">
          <span className={`h-1.5 w-1.5 rounded-full ${isAdmin ? "bg-amber" : "bg-accent"}`} />
          {roleLabel}
        </span>
        <LanguageToggle />
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:bg-ink/5"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("header.logout")}</span>
        </button>
      </div>
    </header>
  );
}
