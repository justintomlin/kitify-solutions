// Public, homeowner-facing proposal page — SERVER component. Reached cold from a text-message
// link: no login, not under /portal. Data is fetched here on the server (via the existing
// /api/proposal/[token] route, which reads past RLS) and passed as props to the client
// <ProposalView>, which handles the interactive Good/Better/Best tier toggle. There are NO
// client-side Supabase calls anywhere on this route.

import { headers } from "next/headers";
import { ProposalView, type ProposalData } from "./ProposalView";
import { getAcceptanceStatus } from "@/lib/proposalService";

// headers() + no-store already force dynamic rendering; make it explicit so this route is
// never statically prerendered at build time.
export const dynamic = "force-dynamic";

// Fetch the public payload server-side from our own API route. Any failure (bad/revoked token,
// 5xx, network) resolves to null → the client renders the generic "not available" state.
async function fetchProposal(token: string): Promise<ProposalData | null> {
  try {
    const h = await headers();
    const host = h.get("host");
    if (!host) return null;
    const proto = h.get("x-forwarded-proto") ?? "http";
    const res = await fetch(`${proto}://${host}/api/proposal/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as ProposalData;
  } catch {
    return null;
  }
}

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Tier data via the read route (unchanged); acceptance state via the server-only service
  // module so a revisited link renders the frozen confirmation immediately (no toggle flash).
  const [payload, acceptance] = token
    ? await Promise.all([fetchProposal(token), getAcceptanceStatus(token)])
    : [null, null];
  return <ProposalView payload={payload} acceptance={acceptance} token={token ?? ""} />;
}
