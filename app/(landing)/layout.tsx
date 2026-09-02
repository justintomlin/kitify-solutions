import type { Metadata } from "next";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";

/**
 * Layout for the public marketing site at "/".
 *
 * A route group rather than a folder so the landing page keeps the root URL
 * while getting its own chrome. It deliberately shares nothing with
 * app/portal/layout.tsx — no auth guard, no sidebar, no header — because the
 * whole point of this surface is that a contractor who has never signed in can
 * read it. The providers (language, auth, toasts) still come from the root
 * layout above, which is what lets the language switcher work here.
 */
export const metadata: Metadata = {
  title: "Kitify Solutions — Drawn, Delivered, Done.",
  description:
    "Complete bathroom renovation kits for contractors: configured in the dealer portal, shipped as one order, guaranteed to fit.",
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    // bg-ink on the wrapper, not just on the sections: <body> is paper-coloured
    // for the portal, and without this it shows through on overscroll.
    <div className="min-h-dvh bg-ink text-white">
      <LandingNav />
      <main>{children}</main>
      <LandingFooter />
    </div>
  );
}
