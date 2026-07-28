// Public homeowner read for a shared proposal — SERVER-ONLY.
//
// ⚠️ This route uses the Supabase SERVICE_ROLE key, which bypasses Row Level Security.
// It must NEVER be imported by a client component, and the key must never appear in a
// response. The key is read from SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix, so
// Next.js keeps it server-side). The service client is created inside the handler and is
// not exported, so nothing else in the app can reach it.
//
// It returns a deliberately minimal payload: proposal name, markup %, and per tier the
// configurator config objects + the dealer total. It never returns owner_id, project_id,
// quote ids, customer PII, or any other proposal's data.

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Force a dynamic, Node.js server execution (never statically prerendered, never edge) so
// the service_role key stays on the server.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shapes we read (a subset of the columns). Kept local — not shared with client code.
type ProposalRow = {
  name: string;
  markup_pct: number | string;
  status: string;
  share_token: string | null;
  tier_good: string | null;
  tier_better: string | null;
  tier_best: string | null;
};
type QuoteRow = {
  id: string;
  room: unknown | null;
  shower: unknown | null;
  vanity: unknown | null;
  plumbing: unknown | null;
  total: number | string;
};

// Generic responses — a bad OR revoked token both return the same 404 so we never leak
// whether a token ever existed.
const notFound = () =>
  NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
const serverError = () =>
  NextResponse.json({ error: "Server error" }, { status: 500, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) return notFound();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    // Misconfiguration (e.g. key not pasted yet). Log server-side, stay generic to the client.
    console.error("[proposal route] Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL");
    return serverError();
  }

  // Service-role client: RLS-bypassing, server-only. No session persistence on the server.
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Look up the shared proposal: exact token, not archived, token not null (a revoked
  // proposal has share_token = NULL and can never match).
  const { data: proposal, error: pErr } = await admin
    .from("proposals")
    .select("name, markup_pct, status, share_token, tier_good, tier_better, tier_best")
    .eq("share_token", token)
    .neq("status", "archived")
    .not("share_token", "is", null)
    .maybeSingle<ProposalRow>();

  if (pErr) {
    console.error("[proposal route] proposal lookup failed:", pErr.message);
    return serverError();
  }
  if (!proposal) return notFound();

  // Fetch the tier quotes (only those set) in one query, then map back per tier.
  const tierIds = [proposal.tier_good, proposal.tier_better, proposal.tier_best].filter(
    (id): id is string => !!id,
  );
  const quotesById = new Map<string, QuoteRow>();
  if (tierIds.length) {
    const { data: quotes, error: qErr } = await admin
      .from("quotes")
      .select("id, room, shower, vanity, plumbing, total")
      .in("id", tierIds);
    if (qErr) {
      console.error("[proposal route] tier quotes lookup failed:", qErr.message);
      return serverError();
    }
    for (const q of (quotes ?? []) as QuoteRow[]) quotesById.set(q.id, q);
  }

  // Per-tier public view: config objects + dealer total only. No quote id leaks out.
  const tierView = (id: string | null) => {
    if (!id) return null;
    const q = quotesById.get(id);
    if (!q) return null;
    return {
      room: q.room ?? null,
      shower: q.shower ?? null,
      vanity: q.vanity ?? null,
      plumbing: q.plumbing ?? null,
      dealerTotal: Number(q.total),
    };
  };

  const body = {
    name: proposal.name,
    markupPct: Number(proposal.markup_pct),
    tiers: {
      good: tierView(proposal.tier_good),
      better: tierView(proposal.tier_better),
      best: tierView(proposal.tier_best),
    },
  };

  // no-store: a proposal can be revoked at any time, so never cache the public response.
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
