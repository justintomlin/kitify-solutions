"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// The profile row backing an authenticated user (public.profiles). `role` drives the
// admin nav/label; `id` IS the auth user's uuid, which is what owner_id references.
export type Role = "contractor" | "admin";
export type Profile = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  territory: string | null;
  /** Company branding shown on shared proposals. Null until the branding migration runs. */
  companyLogo: string | null;
  companyTagline: string | null;
  companyWebsite: string | null;
  role: Role;
  status: "active" | "invited" | "disabled";
  mustChangePassword: boolean; // admin-created accounts must set a permanent password first
  profileConfirmed: boolean; // contractor must confirm their info on first login
  firstLoginAt: string | null;
};

type AuthResult = { error: string | null };
type SignUpResult = AuthResult & { needsConfirmation: boolean };

type AuthContextValue = {
  user: SupabaseUser | null;
  userId: string | null; // stable uuid — replaces the old name-based identity everywhere
  profile: Profile | null;
  isAdmin: boolean; // profile.role === 'admin' — gates the admin nav + pages
  loading: boolean; // true while the initial session is resolving (avoid logged-out flash)
  refreshProfile: () => Promise<void>; // re-read the profile (used by the onboarding gate)
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, name: string, company: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type ProfileRow = {
  id: string; name: string; email: string; company: string | null; phone: string | null; territory: string | null;
  company_logo?: string | null; company_tagline?: string | null; company_website?: string | null;
  role: Role; status: Profile["status"];
  must_change_password?: boolean; profile_confirmed?: boolean; first_login_at?: string | null;
};
const rowToProfile = (r: ProfileRow): Profile => ({
  id: r.id, name: r.name, email: r.email, company: r.company ?? null, phone: r.phone ?? null, territory: r.territory ?? null,
  companyLogo: r.company_logo ?? null, companyTagline: r.company_tagline ?? null, companyWebsite: r.company_website ?? null,
  role: r.role, status: r.status,
  mustChangePassword: !!r.must_change_password, profileConfirmed: !!r.profile_confirmed, firstLoginAt: r.first_login_at ?? null,
});

// Load the user's profile, creating it if missing. This is what keeps the profiles row
// (and therefore the owner_id foreign key) valid: a row exists for every signed-in user.
// The edge case — a signed-in auth user with no profile — is repaired here from the auth
// metadata captured at signup. NOTE: inserts succeed today only because RLS is still off.
async function ensureProfile(u: SupabaseUser, extra?: { name?: string; company?: string }): Promise<Profile | null> {
  const { data: existing, error: selErr } = await supabase.from("profiles").select("*").eq("id", u.id).maybeSingle();
  if (selErr) console.error("[auth] load profile failed:", selErr);
  if (existing) return rowToProfile(existing as ProfileRow);

  const meta = (u.user_metadata ?? {}) as { name?: string; company?: string };
  const row = {
    id: u.id,
    name: extra?.name ?? meta.name ?? (u.email ? u.email.split("@")[0] : "Partner"),
    email: u.email ?? "",
    company: extra?.company ?? meta.company ?? null,
    role: "contractor" as Role,
    status: "active" as const,
    // Self-created (non-invited) profiles skip onboarding — only admin-created contractors
    // (inserted by the create-contractor route) carry must_change_password/profile_confirmed.
    must_change_password: false,
    profile_confirmed: true,
  };
  const { data: created, error: insErr } = await supabase.from("profiles").insert(row).select().single();
  if (insErr) {
    console.error("[auth] create profile failed:", insErr);
    return null;
  }
  return rowToProfile(created as ProfileRow);
}

// Map raw Supabase auth messages to stable keys the UI can localise; empty string means
// "no specific mapping — show the raw message".
function authErrorKey(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "login.errSignIn";
  if (m.includes("already registered") || m.includes("already been registered")) return "login.errEmailTaken";
  return "";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // Dedupe profile resolution across repeated events for the same user (e.g. INITIAL_SESSION
  // followed by TOKEN_REFRESHED) so we don't re-query / risk a duplicate insert.
  const lastUidRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const apply = async (u: SupabaseUser | null) => {
      if (!active) return;
      setUser(u);
      if (!u) {
        lastUidRef.current = null;
        setProfile(null);
        setLoading(false);
        return;
      }
      if (lastUidRef.current === u.id) {
        setLoading(false); // same user, profile already loaded (token refresh)
        return;
      }
      lastUidRef.current = u.id;
      const p = await ensureProfile(u);
      if (!active) return;
      setProfile(p);
      setLoading(false);
    };

    // onAuthStateChange fires an initial event (INITIAL_SESSION) with the persisted session,
    // then again on every sign-in / sign-out / token refresh — one stream keeps us in sync.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void apply(session?.user ?? null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: authErrorKey(error.message) || error.message };
    return { error: null }; // onAuthStateChange loads the user + profile
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, name: string, company: string): Promise<SignUpResult> => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, company } }, // stashed so the profile can be created later too
      });
      if (error) return { error: authErrorKey(error.message) || error.message, needsConfirmation: false };
      // Create the matching profile row now (works even before email confirmation while RLS
      // is off), so owner_id has something real to reference immediately.
      if (data.user) {
        const p = await ensureProfile(data.user, { name, company });
        if (p && data.session) {
          lastUidRef.current = data.user.id;
          setProfile(p);
        }
      }
      // No session ⇒ email confirmation is required before the user can sign in.
      return { error: null, needsConfirmation: !data.session };
    },
    [],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut(); // apply() clears user/profile on the SIGNED_OUT event
  }, []);

  // Re-read the current user's profile — used by the onboarding gate after it flips the
  // must_change_password / profile_confirmed flags, so the gate advances without a reload.
  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (data) setProfile(rowToProfile(data as ProfileRow));
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, userId: user?.id ?? null, profile, isAdmin: profile?.role === "admin", loading, refreshProfile, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
