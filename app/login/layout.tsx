"use client";

import { AuthProvider } from "@/components/AuthContext";

/**
 * The sign-in / sign-up form is the one public route that needs a session, so it mounts
 * AuthProvider for itself rather than inheriting it from the root layout — see the note
 * in app/layout.tsx for why auth is no longer global.
 *
 * The page is a child here, not this component, so it is inside the provider and useAuth()
 * resolves normally.
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
