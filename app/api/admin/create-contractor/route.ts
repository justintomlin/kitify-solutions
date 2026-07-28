// Admin-only: create a contractor account with a temporary password. SERVER-ONLY.
//
// Uses the SERVICE_ROLE key (RLS-bypassing, Admin Auth API) to create the auth user +
// profile. The caller must present their own Supabase access token (Authorization: Bearer),
// which we validate server-side and confirm maps to an admin profile — we never trust a
// client-sent "I'm an admin" claim. The temp password is returned exactly once and is never
// stored or logged.

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { randomInt } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Human-readable temp password: 12 chars, guaranteed at least one upper/lower/digit, no
// ambiguous characters (0/O, 1/l/I).
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const ALL = UPPER + LOWER + DIGIT;
function tempPassword(): string {
  const pick = (s: string) => s[randomInt(s.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT)];
  while (chars.length < 12) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

export async function POST(request: Request) {
  // 1. Caller's access token
  const authz = request.headers.get("authorization") ?? "";
  const token = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  if (!token) return json({ error: "Unauthorized" }, 401);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[create-contractor] Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL");
    return json({ error: "Server error" }, 500);
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 2. Verify the caller is a real, authenticated admin (never trust the client).
  const { data: userData, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
  const { data: caller, error: cErr } = await admin
    .from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (cErr) { console.error("[create-contractor] caller lookup failed:", cErr.message); return json({ error: "Server error" }, 500); }
  if (!caller || caller.role !== "admin") return json({ error: "Forbidden" }, 403);

  // 3. Validate input
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const company = String(body.company ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const territory = String(body.territory ?? "").trim();
  if (!name || !email || !company) return json({ error: "Name, email, and company are required." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);

  // 4. Temp password + create the auth user (email pre-confirmed — the admin is vouching).
  const password = tempPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr || !created?.user) {
    const msg = (createErr?.message ?? "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return json({ error: "A user with that email already exists." }, 409);
    }
    console.error("[create-contractor] createUser failed:", createErr?.message);
    return json({ error: "Couldn't create the account." }, 500);
  }
  const newUserId = created.user.id;

  // 5. Create the profile row (must_change_password + profile_confirmed drive onboarding).
  const { error: insErr } = await admin.from("profiles").insert({
    id: newUserId,
    name, email, company,
    phone: phone || null,
    territory: territory || null,
    role: "contractor",
    status: "active",
    must_change_password: true,
    profile_confirmed: false,
    invited_at: new Date().toISOString(),
  });
  if (insErr) {
    console.error("[create-contractor] profile insert failed:", insErr.message);
    await admin.auth.admin.deleteUser(newUserId).catch(() => {}); // roll back the orphan auth user
    return json({ error: "Couldn't create the contractor profile." }, 500);
  }

  // 6. Return the temp password ONCE — never stored, never logged, never sent again.
  return json({ success: true, tempPassword: password, userId: newUserId, email }, 200);
}
