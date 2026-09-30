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
  /** "Inventory tracking" feature toggle, admin-set per contractor. Gates the nav item and
   *  the /portal/inventory routes. False until the Phase 2 migration runs — the `?? false`
   *  in rowToProfile means a missing column reads as "off" rather than throwing. */
  inventoryTrackingEnabled: boolean;
  /**
   * The caller's own org, from public.memberships (migration 0024).
   *
   * THIS IS NOT AN AUTHORIZATION SIGNAL. It tells the client which org it is acting in so a
   * future admin screen can say "creating this on behalf of X"; it does not decide what the
   * caller may do. Do not write `orgKind === "kitify"` as a stand-in for is_admin() — that
   * check lives in the database, in RLS, where it cannot be edited by the browser.
   *
   * Null on two paths that are both legitimate: before 0024 has been applied (the tables do
   * not exist yet), and for an account whose membership has not been created. Both read as
   * "no org known", and every write still works, because org_id carries
   * `default public.current_org_id()` and the database resolves it server-side regardless of
   * what the client believes.
   */
  orgId: string | null;
  orgKind: "kitify" | "contractor" | null;
  /**
   * The caller's role in that org, from public.memberships (0027).
   *
   * THIS IS NOT AN AUTHORIZATION SIGNAL EITHER. Like orgId above, it exists so the UI can
   * stop offering controls the database will refuse — a salesperson is shown their assigned
   * appointments instead of the org's project list, and my-customers stops filtering by
   * owner because 0034 scopes a rep's customers through their appointments instead.
   *
   * Every rule it influences is ALSO enforced in the database, in RLS and in the guards, so a
   * browser that lies about this gets a nicer-looking screen and exactly the same data.
   *
   * Null before 0027, for a membership-less account, or if the read fails.
   */
  membershipRole: MembershipRole | null;
};

export type MembershipRole = "owner" | "member" | "salesperson";

type AuthResult = { error: string | null };
type SignUpResult = AuthResult & { needsConfirmation: boolean };

type AuthContextValue = {
  user: SupabaseUser | null;
  userId: string | null; // stable uuid — replaces the old name-based identity everywhere
  profile: Profile | null;
  isAdmin: boolean; // profile.role === 'admin' — gates the admin nav + pages
  /**
   * Lifted off the profile so a page can read it without null-checking `profile` first.
   *
   * PRESENTATION ONLY. It decides which controls a page offers, never what data comes back —
   * every rule it touches is enforced again in RLS and in the guards. See the field on
   * Profile for the longer note.
   */
  membershipRole: MembershipRole | null;
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
  inventory_tracking_enabled?: boolean;
};
const rowToProfile = (r: ProfileRow, org?: OrgRef | null): Profile => ({
  id: r.id, name: r.name, email: r.email, company: r.company ?? null, phone: r.phone ?? null, territory: r.territory ?? null,
  companyLogo: r.company_logo ?? null, companyTagline: r.company_tagline ?? null, companyWebsite: r.company_website ?? null,
  role: r.role, status: r.status,
  mustChangePassword: !!r.must_change_password, profileConfirmed: !!r.profile_confirmed, firstLoginAt: r.first_login_at ?? null,
  inventoryTrackingEnabled: r.inventory_tracking_enabled ?? false,
  orgId: org?.id ?? null,
  orgKind: org?.kind ?? null,
  membershipRole: org?.role ?? null,
});

type OrgRef = { id: string; kind: "kitify" | "contractor"; role: MembershipRole | null };

const MEMBERSHIP_ROLES: MembershipRole[] = ["owner", "member", "salesperson"];
const asRole = (v: unknown): MembershipRole | null =>
  MEMBERSHIP_ROLES.includes(v as MembershipRole) ? (v as MembershipRole) : null;

/**
 * The caller's own org, read straight from memberships — no RPC.
 *
 * 0024's `memberships_select_own_org_or_admin` policy already admits a user to their own
 * org's membership rows (`org_id = current_org_id()`), so a plain select is enough and a
 * dedicated function would be a second place for the same rule to live.
 *
 * Ordered by created_at then id, matching `public.current_org_id()` exactly. If the two ever
 * disagreed, the client would name one org while the database wrote rows into another — so
 * the ordering here is load-bearing, not incidental.
 *
 * NEVER THROWS. A missing table (0024 not yet applied), a policy refusal or a network blip
 * all resolve to null, which reads as "no org known". Every write still lands correctly
 * because org_id defaults to current_org_id() server-side; the client's copy is for display.
 */
async function loadOrg(userId: string): Promise<OrgRef | null> {
  try {
    const { data, error } = await supabase
      .from("memberships")
      .select("org_id, role, orgs(id, kind)")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    // PostgREST returns an embedded one-to-one as an object, but types it as a union with an
    // array; normalise rather than trusting either shape.
    const embedded = (data as { orgs?: unknown }).orgs;
    const org = (Array.isArray(embedded) ? embedded[0] : embedded) as
      | { id?: string; kind?: string }
      | undefined;
    if (!org?.id || (org.kind !== "kitify" && org.kind !== "contractor")) return null;
    // `role` comes off the MEMBERSHIP row, not the embedded org — it is a property of the
    // person's place in that org, not of the org. An unrecognised value reads as null rather
    // than being passed through, so a future fourth role cannot be mistaken for a known one.
    return { id: org.id, kind: org.kind, role: asRole((data as { role?: unknown }).role) };
  } catch {
    return null;
  }
}

// Load the user's profile, creating it if missing. This is what keeps the profiles row
// (and therefore the owner_id foreign key) valid: a row exists for every signed-in user.
// The edge case — a signed-in auth user with no profile — is repaired here from the auth
// metadata captured at signup. NOTE: inserts succeed today only because RLS is still off.
async function ensureProfile(u: SupabaseUser, extra?: { name?: string; company?: string }): Promise<Profile | null> {
  const { data: existing, error: selErr } = await supabase.from("profiles").select("*").eq("id", u.id).maybeSingle();
  if (selErr) console.error("[auth] load profile failed:", selErr);
  if (existing) return rowToProfile(existing as ProfileRow, await loadOrg(u.id));

  const meta = (u.user_metadata ?? {}) as { name?: string; company?: string };
  // role and status are DELIBERATELY ABSENT. Migration 0023 revokes column-level INSERT on
  // both (plus inventory_tracking_enabled, invited_at and created_at) from `authenticated`,
  // so the row takes its column defaults — 'contractor' and 'active' — instead of whatever a
  // client asks for. A column privilege is checked against the columns NAMED in the
  // statement, so sending role: "contractor" here would be denied even though the value is
  // identical to the default. The values come back from the .select() below either way.
  //
  // This is what closes self-insert-as-admin: profiles_insert_self is
  // WITH CHECK (id = auth.uid()) with no column restriction, so before 0023 anyone without a
  // profile row could create their own as an admin.
  const row = {
    id: u.id,
    name: extra?.name ?? meta.name ?? (u.email ? u.email.split("@")[0] : "Partner"),
    email: u.email ?? "",
    company: extra?.company ?? meta.company ?? null,
    // Self-created (non-invited) profiles skip onboarding — only admin-created contractors
    // (inserted by the create-contractor route, as service_role) carry
    // must_change_password/profile_confirmed. Both columns stay grantable.
    must_change_password: false,
    profile_confirmed: true,
  };
  const { data: created, error: insErr } = await supabase.from("profiles").insert(row).select().single();
  if (insErr) {
    console.error("[auth] create profile failed:", insErr);
    return null;
  }
  // A just-created self-service profile has no membership yet — an admin creates one — so
  // loadOrg legitimately returns null here and orgId/orgKind read as "no org known".
  return rowToProfile(created as ProfileRow, await loadOrg(u.id));
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
    if (data) setProfile(rowToProfile(data as ProfileRow, await loadOrg(user.id)));
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, userId: user?.id ?? null, profile, isAdmin: profile?.role === "admin", membershipRole: profile?.membershipRole ?? null, loading, refreshProfile, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
