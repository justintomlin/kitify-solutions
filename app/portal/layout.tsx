"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthContext";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { OnboardingGate } from "@/components/OnboardingGate";
import { SidebarProvider, useSidebar } from "@/components/SidebarContext";
import { SIDEBAR_GRID_COLS } from "@/lib/sidebar-mode";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Guard: portal routes require a session. Bounce to the login screen once the session
  // has resolved and there's no user. The loading state prevents a logged-out flicker.
  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
      </div>
    );
  }

  return (
    // OnboardingGate blocks the entire portal (chrome included) until an admin-created
    // contractor sets a permanent password and confirms their info.
    <OnboardingGate>
      <SidebarProvider>
        <PortalShell>{children}</PortalShell>
      </SidebarProvider>
    </OnboardingGate>
  );
}

/**
 * The portal chrome. Split out of PortalLayout because it has to be INSIDE SidebarProvider
 * to read the mode — which decides the one thing the layout owns: whether a sidebar column
 * is reserved at all.
 *
 * In collapsible mode the sidebar renders fixed-position (out of flow), so dropping the grid
 * here is what gives focused-work pages the full viewport width.
 */
function PortalShell({ children }: { children: React.ReactNode }) {
  const { mode } = useSidebar();

  return (
    <div className={`min-h-dvh ${mode === "fixed" ? `grid ${SIDEBAR_GRID_COLS}` : ""}`}>
      <Sidebar />

      <div className="flex min-h-dvh flex-col">
        <Header />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-10">{children}</main>
      </div>
    </div>
  );
}
