import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageContext";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const body = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kitify Solutions — Partner Portal",
  description: "Training, jobs, orders, and the space configurator for Kitify partners.",
};

/**
 * Only LanguageProvider is global. Every surface needs t() and it costs nothing —
 * no network, no SDK, just localStorage.
 *
 * AuthProvider deliberately does NOT live here. It imports lib/supabase, which throws
 * on missing NEXT_PUBLIC_SUPABASE_* env vars, so mounting it globally made the public
 * pages — the landing page above all — unbuildable without database credentials and
 * shipped the Supabase SDK to visitors who never sign in. It is now mounted by the two
 * trees that actually authenticate: app/login and app/portal.
 *
 * Consequence worth knowing: calling useAuth() outside those two trees throws
 * "useAuth must be used within AuthProvider". That is the intended signal — a page
 * needing a session belongs under /portal, or needs AuthProvider added deliberately.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
