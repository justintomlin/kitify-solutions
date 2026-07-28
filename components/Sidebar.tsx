"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { primaryNav, adminNav, type NavItem } from "@/lib/nav";
import { useLanguage } from "./LanguageContext";
import { useAuth } from "./AuthContext";
import { Brand } from "./Brand";

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

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { isAdmin } = useAuth();

  return (
    <div className="flex h-full flex-col bg-ink text-white">
      <div className="border-b border-white/10 px-5 py-5">
        <Brand />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" onClick={onNavigate}>
        {primaryNav.map((item) => (
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
