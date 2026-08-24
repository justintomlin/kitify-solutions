// Public homeowner read for a shared proposal — SERVER-ONLY.
//
// ⚠️ This route uses the Supabase SERVICE_ROLE key, which bypasses Row Level Security.
// It must NEVER be imported by a client component, and the key must never appear in a
// response. The key is read from SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix, so
// Next.js keeps it server-side). The service client is created inside the handler and is
// not exported, so nothing else in the app can reach it.
//
// It returns a deliberately minimal payload: proposal name, markup %, the contractor's own
// branding and line items, and per tier the configurator config objects + the dealer total.
// It never returns owner_id, project_id, quote ids, customer PII, or any other proposal's
// data. Note that the dealer total is still the only money figure crossing this boundary -
// the retail price is computed client-side from it and the markup, exactly as before.

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
// From lib/bathrooms, which is import-free: nothing server-only, and nothing that would drag
// the browser Supabase client into a route that must never see it.
import { toOptionNames } from "@/lib/bathrooms";
import { freightForQuote, resolveFreight } from "@/lib/freight";

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
  custom_line_items: { id: string; description: string; amount: number }[] | null;
  contractor_branding: Record<string, string | null> | null;
  // Added by 0019. Absent on a pre-migration read, which reads as unnamed.
  option_names?: unknown;
  // Added by 0020. Absent, or null, reads as "use the computed estimate".
  freight_override?: number | string | null;
};
type QuoteRow = {
  id: string;
  room: unknown | null;
  shower: unknown | null;
  vanity: unknown | null;
  plumbing: unknown | null;
  bathrooms?: unknown;   // absent on a pre-0018 database — see the column fallback below
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
  // Two column sets: the full one, and the pre-migration fallback. Selecting a column that
  // does not exist is a hard 400 from PostgREST, so a public page that homeowners already
  // hold links to would go dark the moment this deployed ahead of the SQL.
  const BASE_COLUMNS = "name, markup_pct, status, share_token, tier_good, tier_better, tier_best";
  const FULL_COLUMNS = `${BASE_COLUMNS}, custom_line_items, contractor_branding, option_names, freight_override`;

  const readProposal = (columns: string) =>
    admin
      .from("proposals")
      .select(columns)
      .eq("share_token", token)
      .neq("status", "archived")
      .not("share_token", "is", null)
      .maybeSingle<ProposalRow>();

  // option_names joins the full set rather than getting a fallback of its own: one retry is
  // enough, and losing the contractor's option names on a pre-migration database is exactly
  // what "unnamed" means — the labels fall back to Option 1 / 2 / 3 and the page still works.
  let { data: proposal, error: pErr } = await readProposal(FULL_COLUMNS);
  if (pErr && (pErr.code === "42703" || pErr.code === "PGRST204" || /column .* does not exist/i.test(pErr.message))) {
    console.warn("[proposal route] proposal-enhancement columns missing - run docs/migrations/2026-08-04-proposal-enhancements.sql and supabase/migrations/0019_proposal_option_names.sql");
    ({ data: proposal, error: pErr } = await readProposal(BASE_COLUMNS));
  }

  if (pErr) {
    console.error("[proposal route] proposal lookup failed:", pErr.message);
    return serverError();
  }
  if (!proposal) return notFound();

  // Fetch the tier quotes (only those set) in one query, then map back per tier.
  const tierIds = [proposal.tier_good, proposal.tier_better, proposal.tier_best].filter(
    (id): id is string => !!id,
  );
  // Same two-column-set dance as the proposal read above, for the same reason: selecting a
  // column that does not exist is a hard 400 from PostgREST, so deploying this ahead of
  // migration 0018 would dark every share link a homeowner already holds.
  const QUOTE_BASE_COLUMNS = "id, room, shower, vanity, plumbing, total";
  const QUOTE_FULL_COLUMNS = `${QUOTE_BASE_COLUMNS}, bathrooms`;

  const quotesById = new Map<string, QuoteRow>();
  if (tierIds.length) {
    const readQuotes = (columns: string) =>
      admin.from("quotes").select(columns).in("id", tierIds);

    let { data: quotes, error: qErr } = await readQuotes(QUOTE_FULL_COLUMNS);
    if (qErr && (qErr.code === "42703" || qErr.code === "PGRST204" || /column .* does not exist/i.test(qErr.message))) {
      console.warn("[proposal route] quotes.bathrooms missing - run supabase/migrations/0018_quotes_bathrooms.sql");
      ({ data: quotes, error: qErr } = await readQuotes(QUOTE_BASE_COLUMNS));
    }
    if (qErr) {
      console.error("[proposal route] tier quotes lookup failed:", qErr.message);
      return serverError();
    }
    for (const q of (quotes ?? []) as unknown as QuoteRow[]) quotesById.set(q.id, q);
  }

  // Per-tier public view: config objects + dealer total only. No quote id leaks out.
  //
  // Both shapes go out. The flat slots keep a homeowner on a cached older bundle rendering
  // correctly, and `bathrooms` is what the current client resolves through. Undefined rather
  // than null when the column is absent, so the client's accessor falls back to the flat
  // slots instead of treating an empty array as "no bathrooms".
  // Freight is the one figure here that is NOT marked up, so it crosses as a finished dollar
  // amount rather than as an input the client multiplies. Computed per option from that
  // option's own bathroom count, then overridden by the proposal's single dealer figure if one
  // is set. `computed` rides along only so the homeowner's page never has to guess — it is not
  // rendered to them; the dealer's estimate-vs-override gap is a dealer concern.
  const freightOverride =
    proposal.freight_override == null || proposal.freight_override === "" ? null : Number(proposal.freight_override);

  const tierView = (id: string | null) => {
    if (!id) return null;
    const q = quotesById.get(id);
    if (!q) return null;
    const freight = resolveFreight(freightForQuote(q), freightOverride);
    return {
      room: q.room ?? null,
      shower: q.shower ?? null,
      vanity: q.vanity ?? null,
      plumbing: q.plumbing ?? null,
      bathrooms: q.bathrooms ?? undefined,
      dealerTotal: Number(q.total),
      // Null when this option ships nothing that needs a truck — a vanity-only option — in
      // which case the homeowner sees no freight line at all.
      freight: freight ? freight.amount : null,
    };
  };

  // Line items are contractor-authored retail charges the homeowner is being asked to pay, so
  // they go out as-is. Amounts are coerced because JSONB numerics can arrive as strings, and a
  // string here would silently concatenate into the grand total.
  const lineItems = Array.isArray(proposal.custom_line_items)
    ? proposal.custom_line_items
        .filter((li) => li && typeof li.description === "string")
        .map((li) => ({ id: String(li.id ?? ""), description: li.description, amount: Number(li.amount) || 0 }))
    : [];

  // Branding is the frozen snapshot taken at share time. It is contractor contact detail the
  // homeowner is meant to have - it is on the estimate precisely so they can get in touch -
  // and carries nothing about the dealer relationship or Kitify.
  const b = proposal.contractor_branding;
  const branding = b
    ? {
        company: b.company ?? null,
        name: b.name ?? null,
        email: b.email ?? null,
        phone: b.phone ?? null,
        logo: b.logo ?? null,
        tagline: b.tagline ?? null,
        website: b.website ?? null,
      }
    : null;

  // The contractor's names for the three options. Labels only — nothing about the tier
  // columns, the quote ids or the dealer relationship crosses this boundary, exactly as before.
  const optionNames = toOptionNames(proposal.option_names);

  const body = {
    name: proposal.name,
    markupPct: Number(proposal.markup_pct),
    lineItems,
    branding,
    optionNames,
    tiers: {
      good: tierView(proposal.tier_good),
      better: tierView(proposal.tier_better),
      best: tierView(proposal.tier_best),
    },
  };

  // no-store: a proposal can be revoked at any time, so never cache the public response.
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
