// SERVER-ONLY helpers for the public proposal flow.
//
// ⚠️ Uses the Supabase SERVICE_ROLE key (RLS-bypassing). Import ONLY from server code —
// server components (app/proposal/[token]/page.tsx) and route handlers
// (app/api/proposal/[token]/accept/route.ts). NEVER import this into a client component.
// The key comes from SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix), so it isn't in the
// browser bundle; even if this module were imported client-side, the key would be undefined
// and the factory would return null rather than leak anything.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// A service-role client, or null when the env isn't configured (caller returns a generic error).
export function proposalAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[proposalService] Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL");
    return null;
  }
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Public acceptance state for a shared proposal. `acceptedBy` is the homeowner's own name
// shown back on the confirmation view; email/phone are intentionally NOT exposed publicly.
export type AcceptanceStatus = {
  status: string;
  acceptedTier: "good" | "better" | "best" | null;
  acceptedBy: string | null;
};

// Read just the acceptance state by share token (not archived, token not null). Returns null
// on any failure — the page falls back to the normal (pre-acceptance) view.
export async function getAcceptanceStatus(token: string): Promise<AcceptanceStatus | null> {
  const admin = proposalAdminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from("proposals")
    .select("status, accepted_tier, accepted_by")
    .eq("share_token", token)
    .not("share_token", "is", null)
    .neq("status", "archived")
    .maybeSingle<{ status: string; accepted_tier: AcceptanceStatus["acceptedTier"]; accepted_by: string | null }>();
  if (error || !data) return null;
  return { status: data.status, acceptedTier: data.accepted_tier ?? null, acceptedBy: data.accepted_by ?? null };
}
