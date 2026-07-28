// Public homeowner ACCEPT endpoint — SERVER-ONLY, no auth. POST to accept one tier of a
// shared proposal. Uses the service_role key (RLS-bypassing) via the shared server module,
// exactly like the read route. Never exposes credentials.
//
// One-way operation: a proposal can only be accepted once, and only while status = 'shared'.

import { NextResponse } from "next/server";
import { proposalAdminClient } from "@/lib/proposalService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Tier = "good" | "better" | "best";
const TIERS: Tier[] = ["good", "better", "best"];

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) return json({ error: "Not found" }, 404);

  // Parse + validate the homeowner's input.
  let payload: { tier?: unknown; name?: unknown; email?: unknown; phone?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const tier = String(payload.tier ?? "") as Tier;
  const name = String(payload.name ?? "").trim();
  const email = String(payload.email ?? "").trim();
  const phone = String(payload.phone ?? "").trim();
  if (!TIERS.includes(tier)) return json({ error: "Invalid selection." }, 400);
  if (!name || !email) return json({ error: "Name and email are required." }, 400);

  const admin = proposalAdminClient();
  if (!admin) return json({ error: "Server error" }, 500);

  // Look up the shared proposal (exact token, not archived, token not null).
  const { data: proposal, error: readErr } = await admin
    .from("proposals")
    .select("id, status, share_token, tier_good, tier_better, tier_best")
    .eq("share_token", token)
    .not("share_token", "is", null)
    .neq("status", "archived")
    .maybeSingle<{
      id: string;
      status: string;
      share_token: string | null;
      tier_good: string | null;
      tier_better: string | null;
      tier_best: string | null;
    }>();
  if (readErr) {
    console.error("[accept route] read failed:", readErr.message);
    return json({ error: "Server error" }, 500);
  }
  if (!proposal) return json({ error: "Not found" }, 404); // bad/revoked token — generic

  // Only a currently-shared proposal can be accepted (blocks re-accept / draft / archived).
  if (proposal.status !== "shared") {
    return json({ error: "This proposal is no longer open for acceptance." }, 409);
  }

  // The accepted tier must actually have a quote assigned.
  const quoteId =
    tier === "good" ? proposal.tier_good : tier === "better" ? proposal.tier_better : proposal.tier_best;
  if (!quoteId) return json({ error: "That option isn't available." }, 400);

  // Freeze it. The extra .eq('status','shared') is optimistic concurrency: if someone else
  // accepted a moment ago, 0 rows update and we return 409 instead of double-accepting.
  const { data: updated, error: updErr } = await admin
    .from("proposals")
    .update({
      accepted_tier: tier,
      accepted_quote_id: quoteId, // keeps the portal's existing tier-from-quote display working
      accepted_by: name,
      accepted_email: email,
      accepted_phone: phone || null,
      accepted_at: new Date().toISOString(),
      status: "accepted",
    })
    .eq("id", proposal.id)
    .eq("status", "shared")
    .select("accepted_tier, accepted_by")
    .maybeSingle<{ accepted_tier: Tier; accepted_by: string }>();
  if (updErr) {
    console.error("[accept route] update failed:", updErr.message);
    return json({ error: "Server error" }, 500);
  }
  if (!updated) return json({ error: "This proposal was just accepted." }, 409);

  return json({ success: true, acceptedTier: updated.accepted_tier, acceptedBy: updated.accepted_by }, 200);
}
