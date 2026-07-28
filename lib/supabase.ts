// Single shared Supabase browser client.
//
// Reads the public Supabase config from environment variables. The NEXT_PUBLIC_
// prefix is required for Next.js to expose these to client-side code.
//
// NOTE: nothing imports this yet — lib/store.ts still uses localStorage. Wiring
// the data layer onto Supabase is a later task. This is connection plumbing only.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Fail loudly at startup on a misconfiguration rather than surfacing a confusing
// runtime error later when the client is first used.
if (!url || !anonKey) {
  throw new Error(
    "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.local at the repo root).",
  );
}

export const supabase = createClient(url, anonKey);

// Second client bound to the `leads` schema (permit pipeline data). Same URL + anon key —
// only the schema differs. Use this ONLY for leads.permits reads/edits; everything else
// (companies, inside_leads view, promote RPC, profiles, orders, …) stays on `supabase`.
export const supabaseLeads = createClient(url, anonKey, { db: { schema: "leads" } });
