// Data layer for projects and quotes — backed by Supabase.
//
// Every exported function is async and keeps the exact same signature it had under
// the previous localStorage implementation, so no caller changes. The app keeps its
// camelCase / nested object shapes (Project, Quote); the mapping helpers below convert
// to and from the flat snake_case columns of the `projects` / `quotes` tables (see
// supabase/migrations/0001_initial_schema.sql).
//
// ownerId / owner_id: ownerId is now the Supabase auth user's uuid (see components/
// AuthContext.tsx), and signing up / signing in guarantees a matching public.profiles row.
// So owner_id (uuid NOT NULL REFERENCES profiles(id)) resolves and saves succeed. The store
// is unaware of auth — callers pass the uuid — so it stays a pure data layer.
//
// NOTE: RLS is still OFF on these tables, so this client can currently read/write ANY row,
// not just the signed-in user's. Scoping is enforced only by the ownerId filters here until
// the RLS migration lands (the next task).

import { supabase } from "@/lib/supabase";
import type { PostgrestError } from "@supabase/supabase-js";
import { quoteBathrooms, quoteFlatSlots, toBathrooms, type Bathroom } from "./bathrooms.ts";

export type JobRegistrationStatus = "not_started" | "started" | "complete";

export type Project = {
  id: string;
  ownerId: string;
  name: string; // e.g. "Smith — Master Bath"
  customer: { name: string; phone?: string; email?: string };
  address: { street?: string; city?: string; state?: string; zip?: string };
  status: "estimating" | "ordered" | "complete" | "lost";
  jobRegistration: JobRegistrationStatus; // starts automatically, completed later
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type Quote = {
  id: string;
  projectId: string;
  ownerId: string;
  name: string; // e.g. "Option A — Solid Surface"
  room: unknown | null;
  shower: unknown | null;
  vanity: unknown | null;
  plumbing: unknown | null;
  /**
   * Null on every row written before Phase C1, and on every one-bathroom quote written
   * after it — those dual-write both shapes so a UI rollback stays readable. Only a
   * genuinely multi-bathroom quote carries this alone.
   *
   * Do not read this directly. Go through `quoteBathrooms()`, which resolves both shapes.
   */
  bathrooms: Bathroom[] | null;
  total: number;
  status: "draft" | "sent" | "accepted" | "ordered" | "archived";
  createdAt: string;
  updatedAt: string;
};

// The Bathroom seam lives in lib/bathrooms.ts — pure and import-free, so it is unit-testable
// without a Supabase client (lib/supabase throws at module load without env vars). Re-exported
// here so callers can keep importing everything quote-shaped from one place.
export { quoteBathrooms, isMultiBathroom, bathroomSlots, DEFAULT_BATHROOM_ID, type Bathroom } from "./bathrooms.ts";

// The save inputs: everything except the server-managed id / timestamps, with an
// optional id (present ⇒ update, absent ⇒ insert). Unchanged from the previous API.
type ProjectInput = Omit<Project, "id" | "createdAt" | "updatedAt"> & { id?: string };
// `bathrooms` is optional on the way in: a caller that only knows the four flat slots (which
// is every caller today) keeps working untouched, and quoteToRow derives the array from them.
type QuoteInput =
  Omit<Quote, "id" | "createdAt" | "updatedAt" | "bathrooms">
  & { id?: string; bathrooms?: Bathroom[] | null };

/** One contractor-entered charge on a proposal - labour, permits, disposal, extras. */
export type ProposalLineItem = { id: string; description: string; amount: number };

/**
 * The contractor's identity as it appeared when the proposal was shared.
 *
 * Snapshotted rather than read live from the profile, because a proposal is a document the
 * homeowner may open months later: if the contractor renames the company or changes their
 * phone number afterwards, the estimate they were sent must still say what it said.
 */
export type ContractorBranding = {
  company: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  logo: string | null;
  tagline: string | null;
  website: string | null;
};

export type Proposal = {
  id: string;
  ownerId: string;
  projectId: string;
  name: string;
  shareToken: string | null; // null = not shared / revoked (never publicly resolvable)
  markupPct: number;
  tierGood: string | null; // quote ids — each tier is optional
  tierBetter: string | null;
  tierBest: string | null;
  acceptedQuoteId: string | null; // set by the accept flow
  acceptedTier: "good" | "better" | "best" | null;
  acceptedBy: string | null;
  acceptedEmail: string | null;
  acceptedPhone: string | null;
  acceptedAt: string | null;
  // 'ordered' = converted to an order (still resolvable publicly — not 'archived').
  status: "draft" | "shared" | "accepted" | "ordered" | "archived";
  /** Labour and extras. Not tier-specific - demolition costs the same whichever vanity wins. */
  customLineItems: ProposalLineItem[];
  /** Frozen at share time; null on proposals shared before branding existed. */
  contractorBranding: ContractorBranding | null;
  /** When the contractor last sent the link to the homeowner, for the "sent" indicator. */
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// Save input covers only the contractor-editable fields. share_token and the accepted_*
// fields are managed by shareProposal / revokeProposal and the accept flow — never written
// here — so an edit can't clobber a live link or an acceptance.
type ProposalInput = Pick<
  Proposal,
  "ownerId" | "projectId" | "name" | "markupPct" | "tierGood" | "tierBetter" | "tierBest" | "status"
> & { id?: string; customLineItems?: ProposalLineItem[] };

// ------------------------------ error handling ----------------------------
// Surface failures loudly instead of returning them as empty data — a Supabase
// error during testing should look like an error, not like an empty table.
function fail(context: string, error: PostgrestError | null): never {
  console.error(`[store] ${context} failed:`, error);
  throw new Error(`store: ${context} failed — ${error?.message ?? "unknown error"}`);
}

// -------------------------------- mapping ---------------------------------
// Row shapes as they come back from Supabase (flat, snake_case). `total` is a
// numeric column, which PostgREST may serialise as a string; rowToQuote coerces it.
type ProjectRow = {
  id: string;
  owner_id: string;
  name: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  status: Project["status"];
  job_registration: JobRegistrationStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type QuoteRow = {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  room: unknown | null;
  shower: unknown | null;
  vanity: unknown | null;
  plumbing: unknown | null;
  // Absent entirely on a pre-0018 database: quote reads use select("*"), so the column
  // simply does not come back rather than erroring. rowToQuote treats that as null.
  bathrooms?: unknown;
  total: number | string;
  status: Quote["status"];
  created_at: string;
  updated_at: string;
};

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    customer: { name: r.customer_name, phone: r.customer_phone ?? undefined, email: r.customer_email ?? undefined },
    address: {
      street: r.address_street ?? undefined,
      city: r.address_city ?? undefined,
      state: r.address_state ?? undefined,
      zip: r.address_zip ?? undefined,
    },
    status: r.status,
    jobRegistration: r.job_registration,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Writable columns for insert/update. id and timestamps are server-managed and never
// written here (created_at defaults, updated_at is refreshed by a trigger).
function projectToRow(p: ProjectInput) {
  return {
    owner_id: p.ownerId,
    name: p.name,
    customer_name: p.customer.name,
    customer_phone: p.customer.phone ?? null,
    customer_email: p.customer.email ?? null,
    address_street: p.address.street ?? null,
    address_city: p.address.city ?? null,
    address_state: p.address.state ?? null,
    address_zip: p.address.zip ?? null,
    status: p.status,
    job_registration: p.jobRegistration,
    notes: p.notes ?? null,
  };
}

function rowToQuote(r: QuoteRow): Quote {
  return {
    id: r.id,
    projectId: r.project_id,
    ownerId: r.owner_id,
    name: r.name,
    room: r.room ?? null,
    shower: r.shower ?? null,
    vanity: r.vanity ?? null,
    plumbing: r.plumbing ?? null,
    bathrooms: toBathrooms(r.bathrooms),
    total: Number(r.total), // numeric may arrive as a string — normalise to number
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * The four config objects are jsonb — passed through as-is (null when absent).
 *
 * DUAL-WRITE: a one-bathroom quote writes BOTH shapes. The flat columns stay the source of
 * truth for anything that hasn't been taught about bathrooms — including a rolled-back
 * deployment — while `bathrooms` carries the same content forward. Only a genuinely
 * multi-bathroom quote writes `bathrooms` alone, because there is no honest way to flatten
 * two bathrooms into four singular columns and a partial write there would be worse than none.
 */
function quoteToRow(q: QuoteInput) {
  return {
    project_id: q.projectId,
    owner_id: q.ownerId,
    name: q.name,
    ...quoteFlatSlots(q),        // the legacy half of the dual-write
    // …and the new half. quoteBathrooms() is total, so a caller that passed only the four
    // flat slots — which is every caller today — still writes a real one-element array.
    // Saving is therefore the per-row migration path: a legacy quote gains its `bathrooms`
    // the next time it is touched, and nothing has to sweep the table.
    bathrooms: quoteBathrooms(q),
    total: q.total,
    status: q.status,
  };
}

type ProposalRow = {
  id: string;
  owner_id: string;
  project_id: string;
  name: string;
  share_token: string | null;
  markup_pct: number | string; // numeric — may arrive as a string
  tier_good: string | null;
  tier_better: string | null;
  tier_best: string | null;
  accepted_quote_id: string | null;
  accepted_tier: Proposal["acceptedTier"];
  accepted_by: string | null;
  accepted_email: string | null;
  accepted_phone: string | null;
  accepted_at: string | null;
  status: Proposal["status"];
  // Optional in the type as well as the table: these three columns arrive with the migration
  // in docs/migrations, and every read below tolerates their absence.
  custom_line_items?: ProposalLineItem[] | null;
  contractor_branding?: ContractorBranding | null;
  last_sent_at?: string | null;
  created_at: string;
  updated_at: string;
};

function rowToProposal(r: ProposalRow): Proposal {
  return {
    id: r.id,
    ownerId: r.owner_id,
    projectId: r.project_id,
    name: r.name,
    shareToken: r.share_token ?? null,
    markupPct: Number(r.markup_pct),
    tierGood: r.tier_good ?? null,
    tierBetter: r.tier_better ?? null,
    tierBest: r.tier_best ?? null,
    acceptedQuoteId: r.accepted_quote_id ?? null,
    acceptedTier: r.accepted_tier ?? null,
    acceptedBy: r.accepted_by ?? null,
    acceptedEmail: r.accepted_email ?? null,
    acceptedPhone: r.accepted_phone ?? null,
    acceptedAt: r.accepted_at ?? null,
    status: r.status,
    // Defaulted rather than assumed: a row read before the migration has neither column.
    customLineItems: Array.isArray(r.custom_line_items) ? r.custom_line_items : [],
    contractorBranding: r.contractor_branding ?? null,
    lastSentAt: r.last_sent_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Columns added by the proposal-enhancements migration.
 *
 * Writes that touch them go through `writeProposal`, which retries without them when the
 * migration has not been run yet. Without that, deploying this code ahead of the SQL would
 * take out proposal saving entirely - a working feature broken by an unrelated one.
 */
const MIGRATED_PROPOSAL_COLUMNS = ["custom_line_items", "contractor_branding", "last_sent_at"];

function isMissingColumn(error: PostgrestError | null): boolean {
  if (!error) return false;
  // 42703 is the Postgres undefined_column code; PGRST204 is PostgREST's schema-cache miss.
  return error.code === "42703" || error.code === "PGRST204" ||
    /column .* does not exist|could not find the .* column/i.test(error.message ?? "");
}

/**
 * Run a proposal write, falling back to the pre-migration column set when the new ones are
 * absent. Warns once so the omission is visible rather than silent.
 */
async function writeProposal(
  context: string,
  row: Record<string, unknown>,
  run: (row: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<Proposal> {
  let { data, error } = await run(row);
  if (error && isMissingColumn(error)) {
    const reduced = { ...row };
    for (const c of MIGRATED_PROPOSAL_COLUMNS) delete reduced[c];
    console.warn(`[store] ${context}: proposal-enhancement columns missing - run docs/migrations/2026-08-04-proposal-enhancements.sql. Saving without them.`);
    ({ data, error } = await run(reduced));
  }
  if (error) fail(context, error);
  if (!data) fail(context, null);
  return rowToProposal(data as ProposalRow);
}

// Only the editable columns — never share_token or accepted_* (see ProposalInput).
function proposalToRow(p: ProposalInput) {
  return {
    owner_id: p.ownerId,
    project_id: p.projectId,
    name: p.name,
    markup_pct: p.markupPct,
    tier_good: p.tierGood,
    tier_better: p.tierBetter,
    tier_best: p.tierBest,
    status: p.status,
    custom_line_items: p.customLineItems ?? [],
  };
}

// -------------------------------- projects --------------------------------
export async function listProjects(ownerId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) fail("listProjects", error);
  return (data ?? []).map(rowToProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) fail("getProject", error);
  return data ? rowToProject(data) : null;
}

export async function saveProject(p: ProjectInput): Promise<Project> {
  if (p.id) {
    // Update: the caller-supplied fields overwrite the row (jobRegistration included).
    const { data, error } = await supabase
      .from("projects")
      .update(projectToRow(p))
      .eq("id", p.id)
      .select()
      .single();
    if (error) fail("saveProject (update)", error);
    if (!data) fail("saveProject (update)", null);
    const updated = rowToProject(data);
    await linkProjectCustomer(updated);
    return updated;
  }
  // Insert: job registration begins with the project (completed separately later),
  // matching the previous behaviour and the column's own default.
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...projectToRow(p), job_registration: "started" })
    .select()
    .single();
  if (error) fail("saveProject (insert)", error);
  if (!data) fail("saveProject (insert)", null);
  const created = rowToProject(data);
  await linkProjectCustomer(created);
  return created;
}

// Auto-populate the contractor's customer book from their project work: the first time a
// project is saved carrying a customer email, create the matching contractor_customer.
// Matching is by email (case-insensitive) within this owner, so re-saving a project — or
// starting a second project for the same homeowner — never duplicates the row.
//
// Deliberately best-effort: a project save must not fail because the customer book is
// unavailable (e.g. 0011_contractor_customers.sql hasn't been run yet). Errors are logged
// and swallowed.
async function linkProjectCustomer(project: Project): Promise<void> {
  const email = project.customer.email?.trim();
  if (!email || !project.customer.name) return;
  try {
    if (await findCustomerByEmail(project.ownerId, email)) return; // already on the books
    await saveContractorCustomer({
      ownerId: project.ownerId,
      name: project.customer.name,
      email,
      phone: project.customer.phone ?? null,
      address: Object.values(project.address).some(Boolean) ? project.address : null,
      source: "project",
      projectId: project.id, // the project that introduced them
    });
  } catch (e) {
    console.error("[store] linkProjectCustomer failed (project saved anyway):", e);
  }
}

export async function deleteProject(id: string): Promise<void> {
  // Quotes are removed automatically via the ON DELETE CASCADE foreign key.
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) fail("deleteProject", error);
}

// --------------------------------- quotes ---------------------------------
export async function listQuotes(opts: { ownerId?: string; projectId?: string }): Promise<Quote[]> {
  let query = supabase.from("quotes").select("*");
  if (opts.ownerId != null) query = query.eq("owner_id", opts.ownerId);
  if (opts.projectId != null) query = query.eq("project_id", opts.projectId);
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) fail("listQuotes", error);
  return (data ?? []).map(rowToQuote);
}

export async function getQuote(id: string): Promise<Quote | null> {
  const { data, error } = await supabase.from("quotes").select("*").eq("id", id).maybeSingle();
  if (error) fail("getQuote", error);
  return data ? rowToQuote(data) : null;
}

/**
 * Run a quote write, falling back to the pre-0018 column set when `bathrooms` is absent.
 *
 * Same guard as writeProposal, for the same reason: deploying this code ahead of migration
 * 0018 would otherwise take out quote saving entirely — a working feature broken by an
 * unrelated one. The fallback is safe because a single-bathroom quote dual-writes, so the
 * flat columns already carry everything; dropping `bathrooms` loses nothing.
 *
 * A MULTI-bathroom quote cannot fall back, because the flat columns cannot hold it. That is
 * refused loudly rather than saved lossily — silently dropping bathroom 2 would look like a
 * successful save and lose a dealer's work.
 */
async function writeQuote(
  context: string,
  row: Record<string, unknown>,
  run: (row: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<Quote> {
  let { data, error } = await run(row);
  if (error && isMissingColumn(error)) {
    const baths = row.bathrooms;
    if (Array.isArray(baths) && baths.length > 1) {
      fail(`${context} — quotes.bathrooms is missing; run supabase/migrations/0018_quotes_bathrooms.sql before saving a multi-bathroom quote`, error);
    }
    const reduced = { ...row };
    delete reduced.bathrooms;
    console.warn(`[store] ${context}: quotes.bathrooms missing - run supabase/migrations/0018_quotes_bathrooms.sql. Saving the legacy columns only.`);
    ({ data, error } = await run(reduced));
  }
  if (error) fail(context, error);
  if (!data) fail(context, null);
  return rowToQuote(data as QuoteRow);
}

export async function saveQuote(q: QuoteInput): Promise<Quote> {
  const row = quoteToRow(q);
  const id = q.id;
  return id
    ? writeQuote("saveQuote (update)", row, (r) => supabase.from("quotes").update(r).eq("id", id).select().single())
    : writeQuote("saveQuote (insert)", row, (r) => supabase.from("quotes").insert(r).select().single());
}

export async function deleteQuote(id: string): Promise<void> {
  const { error } = await supabase.from("quotes").delete().eq("id", id);
  if (error) fail("deleteQuote", error);
}

// -------------------------------- proposals -------------------------------
export async function listProposals(opts: { ownerId?: string; projectId?: string }): Promise<Proposal[]> {
  let query = supabase.from("proposals").select("*");
  if (opts.ownerId != null) query = query.eq("owner_id", opts.ownerId);
  if (opts.projectId != null) query = query.eq("project_id", opts.projectId);
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) fail("listProposals", error);
  return (data ?? []).map(rowToProposal);
}

export async function getProposal(id: string): Promise<Proposal | null> {
  const { data, error } = await supabase.from("proposals").select("*").eq("id", id).maybeSingle();
  if (error) fail("getProposal", error);
  return data ? rowToProposal(data) : null;
}

export async function saveProposal(p: ProposalInput): Promise<Proposal> {
  const row = proposalToRow(p);
  const id = p.id;
  return id
    ? writeProposal("saveProposal (update)", row, (r) => supabase.from("proposals").update(r).eq("id", id).select().single())
    : writeProposal("saveProposal (insert)", row, (r) => supabase.from("proposals").insert(r).select().single());
}

export async function deleteProposal(id: string): Promise<void> {
  const { error } = await supabase.from("proposals").delete().eq("id", id);
  if (error) fail("deleteProposal", error);
}

// A url-safe, unguessable token (two concatenated uuids, hyphens stripped). crypto.randomUUID
// is available in modern browsers and Node 18+; a Math.random fallback keeps it from throwing.
function genShareToken(): string {
  const uuid = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return (uuid() + uuid()).replace(/-/g, "");
}

// Generate a fresh share token, mark the proposal shared, and return the token. The public
// route at /api/proposal/[token] can then resolve it.
/**
 * Share a proposal, freezing the contractor's branding onto it.
 *
 * Branding is captured HERE rather than read at display time so the document the homeowner
 * receives keeps saying what it said - see ContractorBranding. Re-sharing a revoked proposal
 * re-snapshots, which is right: that is a new link and a new send.
 */
export async function shareProposal(id: string, branding?: ContractorBranding | null): Promise<string> {
  const share_token = genShareToken();
  const row: Record<string, unknown> = { share_token, status: "shared" };
  if (branding) row.contractor_branding = branding;
  const saved = await writeProposal("shareProposal", row,
    (r) => supabase.from("proposals").update(r).eq("id", id).select().single());
  return saved.shareToken ?? share_token;
}

/** Stamp the last time the contractor sent this proposal to a homeowner. */
export async function markProposalSent(id: string): Promise<Proposal> {
  return writeProposal("markProposalSent", { last_sent_at: new Date().toISOString() },
    (r) => supabase.from("proposals").update(r).eq("id", id).select().single());
}

// Revoke sharing: null the token (so the public link 404s) and drop the status back to draft.
export async function revokeProposal(id: string): Promise<Proposal> {
  const { data, error } = await supabase
    .from("proposals")
    .update({ share_token: null, status: "draft" })
    .eq("id", id)
    .select()
    .single();
  if (error) fail("revokeProposal", error);
  if (!data) fail("revokeProposal", null);
  return rowToProposal(data);
}

// --------------------------------- orders ---------------------------------
export type OrderStatus =
  | "submitted" | "confirmed" | "in_production" | "ready_to_ship"
  | "in_transit" | "delivered" | "completed" | "cancelled";
export type WarrantyStatus = "unregistered" | "registered" | "claim_open" | "claim_resolved";

export type Order = {
  id: string;
  projectId: string;
  quoteId: string;
  proposalId: string | null;
  ownerId: string;
  orderNumber: string; // KIT-YYYYMM-NNNN, generated by the DB at insert
  snapshot: unknown; // frozen record captured at order time
  status: OrderStatus;
  customer: { name: string | null; email: string | null; phone: string | null };
  address: { street?: string; city?: string; state?: string; zip?: string } | null;
  carrier: string | null;
  trackingNumber: string | null;
  estimatedDelivery: string | null;
  actualDelivery: string | null;
  installDate: string | null;
  completionPhotos: string[];
  warrantyStatus: WarrantyStatus;
  warrantyRegisteredAt: string | null;
  notes: string | null;
  placedAt: string | null;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// What createOrder needs; order_number (DB trigger), id and timestamps are server-managed.
type OrderCreate = {
  projectId: string;
  quoteId: string;
  proposalId?: string | null;
  ownerId: string;
  snapshot: unknown;
  status?: OrderStatus;
  customer?: { name?: string | null; email?: string | null; phone?: string | null };
  address?: Order["address"];
  placedAt?: string | null;
};

type OrderRow = {
  id: string;
  project_id: string;
  quote_id: string;
  proposal_id: string | null;
  owner_id: string;
  order_number: string;
  snapshot: unknown;
  status: OrderStatus;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: Order["address"];
  carrier: string | null;
  tracking_number: string | null;
  estimated_delivery: string | null;
  actual_delivery: string | null;
  install_date: string | null;
  completion_photos: unknown;
  warranty_status: WarrantyStatus;
  warranty_registered_at: string | null;
  notes: string | null;
  placed_at: string | null;
  confirmed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToOrder(r: OrderRow): Order {
  return {
    id: r.id,
    projectId: r.project_id,
    quoteId: r.quote_id,
    proposalId: r.proposal_id ?? null,
    ownerId: r.owner_id,
    orderNumber: r.order_number,
    snapshot: r.snapshot ?? null,
    status: r.status,
    customer: { name: r.customer_name ?? null, email: r.customer_email ?? null, phone: r.customer_phone ?? null },
    address: r.customer_address ?? null,
    carrier: r.carrier ?? null,
    trackingNumber: r.tracking_number ?? null,
    estimatedDelivery: r.estimated_delivery ?? null,
    actualDelivery: r.actual_delivery ?? null,
    installDate: r.install_date ?? null,
    completionPhotos: Array.isArray(r.completion_photos) ? (r.completion_photos as string[]) : [],
    warrantyStatus: r.warranty_status ?? "unregistered",
    warrantyRegisteredAt: r.warranty_registered_at ?? null,
    notes: r.notes ?? null,
    placedAt: r.placed_at ?? null,
    confirmedAt: r.confirmed_at ?? null,
    shippedAt: r.shipped_at ?? null,
    deliveredAt: r.delivered_at ?? null,
    completedAt: r.completed_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// order_number is intentionally omitted — the DB trigger generates it (KIT-YYYYMM-NNNN).
function orderToRow(o: OrderCreate) {
  return {
    project_id: o.projectId,
    quote_id: o.quoteId,
    proposal_id: o.proposalId ?? null,
    owner_id: o.ownerId,
    snapshot: o.snapshot ?? {},
    status: o.status ?? "submitted",
    customer_name: o.customer?.name ?? null,
    customer_email: o.customer?.email ?? null,
    customer_phone: o.customer?.phone ?? null,
    customer_address: o.address ?? null,
    placed_at: o.placedAt ?? new Date().toISOString(),
  };
}

export async function listOrders(opts: { ownerId?: string; projectId?: string; proposalId?: string }): Promise<Order[]> {
  let query = supabase.from("orders").select("*");
  if (opts.ownerId != null) query = query.eq("owner_id", opts.ownerId);
  if (opts.projectId != null) query = query.eq("project_id", opts.projectId);
  if (opts.proposalId != null) query = query.eq("proposal_id", opts.proposalId);
  const { data, error } = await query.order("placed_at", { ascending: false, nullsFirst: false });
  if (error) fail("listOrders", error);
  return (data ?? []).map(rowToOrder);
}

export async function getOrder(id: string): Promise<Order | null> {
  const { data, error } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) fail("getOrder", error);
  return data ? rowToOrder(data) : null;
}

export async function getOrderByNumber(orderNumber: string): Promise<Order | null> {
  const { data, error } = await supabase.from("orders").select("*").eq("order_number", orderNumber).maybeSingle();
  if (error) fail("getOrderByNumber", error);
  return data ? rowToOrder(data) : null;
}

async function createOrder(o: OrderCreate): Promise<Order> {
  const { data, error } = await supabase.from("orders").insert(orderToRow(o)).select().single();
  if (error) fail("createOrder", error);
  if (!data) fail("createOrder", null);
  return rowToOrder(data);
}

// The fulfilment pipeline, in order. 'cancelled' is deliberately absent: it's reachable
// from any non-terminal status rather than occupying a position in the sequence.
const STATUS_SEQUENCE: OrderStatus[] = [
  "submitted", "confirmed", "in_production", "ready_to_ship", "in_transit", "delivered", "completed",
];
// Nothing moves out of these two — the order is done either way.
const TERMINAL = new Set<OrderStatus>(["completed", "cancelled"]);
// Cancelling is off the table once the goods are with the customer.
const NON_CANCELLABLE = new Set<OrderStatus>(["delivered", "completed", "cancelled"]);

// Single source of truth for "may this order move from → to", shared by the store and by
// the admin controls on the order page (so the UI can't offer a move the store rejects).
// Forward-only along STATUS_SEQUENCE; cancellation is the one sideways move allowed.
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  if (TERMINAL.has(from)) return false;
  if (to === "cancelled") return !NON_CANCELLABLE.has(from);
  const i = STATUS_SEQUENCE.indexOf(from);
  const j = STATUS_SEQUENCE.indexOf(to);
  if (i < 0 || j < 0) return false;
  return j > i; // never backwards
}

// Thrown instead of writing when a caller asks for a move canTransition() rejects — in
// practice a stale page whose buttons no longer match the row's real status.
export class InvalidStatusTransition extends Error {
  constructor(public readonly from: OrderStatus, public readonly to: OrderStatus) {
    super(`store: invalid status transition ${from} → ${to}`);
    this.name = "InvalidStatusTransition";
  }
}

// Shipping details captured at the ready_to_ship → in_transit hand-off.
export type OrderStatusFields = {
  carrier?: string | null;
  trackingNumber?: string | null;
  estimatedDelivery?: string | null;
};

// Advance an order along the pipeline, stamping the lifecycle timestamp for whichever
// status is being entered. Each stamp is written only if it isn't already set, so a
// re-entry (or a manual correction) never rewrites the original history.
//
// NOTE: an admin acting on another contractor's order needs the orders UPDATE policy from
// 0010_admin_order_updates.sql. Without it RLS matches no row and this throws.
export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  fields?: OrderStatusFields,
): Promise<Order> {
  const current = await getOrder(id);
  if (!current) throw new Error("store: updateOrderStatus — order not found");
  if (!canTransition(current.status, status)) throw new InvalidStatusTransition(current.status, status);

  const now = new Date().toISOString();
  const row: Record<string, unknown> = { status };

  if (fields && "carrier" in fields) row.carrier = fields.carrier ?? null;
  if (fields && "trackingNumber" in fields) row.tracking_number = fields.trackingNumber ?? null;
  if (fields && "estimatedDelivery" in fields) row.estimated_delivery = fields.estimatedDelivery ?? null;

  if (status === "confirmed" && !current.confirmedAt) row.confirmed_at = now;
  if (status === "in_transit" && !current.shippedAt) row.shipped_at = now;
  if (status === "delivered") {
    if (!current.deliveredAt) row.delivered_at = now;
    // actual_delivery is a date column — store the calendar day, not the instant.
    if (!current.actualDelivery) row.actual_delivery = now.slice(0, 10);
  }
  if (status === "completed" && !current.completedAt) row.completed_at = now;

  const { data, error } = await supabase.from("orders").update(row).eq("id", id).select().single();
  if (error) fail("updateOrderStatus", error);
  if (!data) fail("updateOrderStatus", null);
  return rowToOrder(data);
}

// General order patch (camelCase → snake_case), for the contractor actions in the Orders
// hub — set install date, mark completed, register warranty, and (later) shipping fields.
export type OrderPatch = Partial<{
  status: OrderStatus;
  carrier: string | null;
  trackingNumber: string | null;
  estimatedDelivery: string | null;
  actualDelivery: string | null;
  installDate: string | null;
  completionPhotos: string[];
  warrantyStatus: WarrantyStatus;
  warrantyRegisteredAt: string | null;
  notes: string | null;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
}>;
const ORDER_PATCH_COLUMNS: Record<keyof OrderPatch, string> = {
  status: "status", carrier: "carrier", trackingNumber: "tracking_number",
  estimatedDelivery: "estimated_delivery", actualDelivery: "actual_delivery",
  installDate: "install_date", completionPhotos: "completion_photos",
  warrantyStatus: "warranty_status", warrantyRegisteredAt: "warranty_registered_at",
  notes: "notes", confirmedAt: "confirmed_at", shippedAt: "shipped_at",
  deliveredAt: "delivered_at", completedAt: "completed_at",
};
export async function updateOrder(id: string, patch: OrderPatch): Promise<Order> {
  const row: Record<string, unknown> = {};
  for (const k of Object.keys(patch) as (keyof OrderPatch)[]) row[ORDER_PATCH_COLUMNS[k]] = patch[k];
  const { data, error } = await supabase.from("orders").update(row).eq("id", id).select().single();
  if (error) fail("updateOrder", error);
  if (!data) fail("updateOrder", null);
  return rowToOrder(data);
}

// Convert an ACCEPTED proposal into a frozen order. Reads the accepted quote + project,
// captures an immutable snapshot, creates the order (DB assigns the order number), and
// advances the proposal to 'ordered'. Idempotent: one order per proposal — a second call
// returns the existing order rather than creating a duplicate.
export async function createOrderFromProposal(proposalId: string): Promise<Order> {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error("store: createOrderFromProposal — proposal not found");
  if (proposal.status !== "accepted" || !proposal.acceptedQuoteId) {
    throw new Error("store: createOrderFromProposal — proposal must be accepted with a chosen tier");
  }
  const existing = await listOrders({ proposalId });
  if (existing.length) return existing[0]; // already ordered — don't duplicate

  const quote = await getQuote(proposal.acceptedQuoteId);
  if (!quote) throw new Error("store: createOrderFromProposal — accepted quote not found");
  const project = await getProject(proposal.projectId);
  const retailTotal = quote.total * (1 + (proposal.markupPct || 0) / 100);

  const snapshot = {
    frozenAt: new Date().toISOString(),
    proposal: {
      id: proposal.id, name: proposal.name, markupPct: proposal.markupPct,
      acceptedTier: proposal.acceptedTier, acceptedBy: proposal.acceptedBy,
      acceptedEmail: proposal.acceptedEmail, acceptedPhone: proposal.acceptedPhone, acceptedAt: proposal.acceptedAt,
    },
    quote: {
      id: quote.id, name: quote.name,
      // BOTH shapes, always. The flat slots are what every snapshot before Phase C1 carries
      // and what inventory_order_lines() falls back to, so they stay even on a multi-bathroom
      // order — where they hold bathroom 1 and the full truth is in `bathrooms`. A snapshot
      // is an immutable record of what was sold, so it is written wide rather than narrow:
      // a reader that has never heard of bathrooms still finds something correct.
      room: quote.room, shower: quote.shower, vanity: quote.vanity, plumbing: quote.plumbing,
      bathrooms: quoteBathrooms(quote),
      dealerTotal: quote.total,
    },
    retailTotal,
    project: project ? { id: project.id, name: project.name, customer: project.customer, address: project.address } : null,
  };

  const order = await createOrder({
    projectId: proposal.projectId,
    quoteId: proposal.acceptedQuoteId,
    proposalId: proposal.id,
    ownerId: proposal.ownerId,
    snapshot,
    status: "submitted",
    customer: {
      name: proposal.acceptedBy ?? project?.customer.name ?? null,
      email: proposal.acceptedEmail ?? project?.customer.email ?? null,
      phone: proposal.acceptedPhone ?? project?.customer.phone ?? null,
    },
    address: project?.address ?? null,
  });

  // Advance the proposal to 'ordered' (best-effort; the order already exists and the dedup
  // guard above prevents a duplicate if this fails and the contractor retries).
  const { error: upErr } = await supabase.from("proposals").update({ status: "ordered" }).eq("id", proposalId);
  if (upErr) console.error("[store] mark proposal ordered failed:", upErr);

  return order;
}

// -------------------------- contractor customers --------------------------
// The homeowners a contractor serves (see 0011_contractor_customers.sql). Separate from
// public.companies, which is the ADMIN CRM's entity — that tracks contractors, this tracks
// their end customers.
//
// listContractorCustomers takes an ownerId rather than leaning on RLS: the SELECT policy
// lets an admin read every row, and an admin using this page should still see their OWN
// customers, not the network's.

export type CustomerAddress = { street?: string; city?: string; state?: string; zip?: string };

export type ContractorCustomer = {
  id: string;
  ownerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: CustomerAddress | null;
  notes: string | null;
  source: string; // 'manual' | 'project'
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContractorCustomerInput = {
  id?: string; // present ⇒ update, absent ⇒ insert
  ownerId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: CustomerAddress | null;
  notes?: string | null;
  source?: string;
  projectId?: string | null;
};

type ContractorCustomerRow = {
  id: string;
  owner_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: CustomerAddress | null;
  notes: string | null;
  source: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

function rowToCustomer(r: ContractorCustomerRow): ContractorCustomer {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    email: r.email ?? null,
    phone: r.phone ?? null,
    address: r.address ?? null,
    notes: r.notes ?? null,
    source: r.source ?? "manual",
    projectId: r.project_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function customerToRow(c: ContractorCustomerInput) {
  return {
    owner_id: c.ownerId,
    name: c.name,
    email: c.email ?? null,
    phone: c.phone ?? null,
    address: c.address ?? null,
    notes: c.notes ?? null,
    source: c.source ?? "manual",
    project_id: c.projectId ?? null,
  };
}

export async function listContractorCustomers(ownerId: string): Promise<ContractorCustomer[]> {
  const { data, error } = await supabase
    .from("contractor_customers")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) fail("listContractorCustomers", error);
  return (data ?? []).map(rowToCustomer);
}

export async function getContractorCustomer(id: string): Promise<ContractorCustomer | null> {
  const { data, error } = await supabase.from("contractor_customers").select("*").eq("id", id).maybeSingle();
  if (error) fail("getContractorCustomer", error);
  return data ? rowToCustomer(data) : null;
}

export async function saveContractorCustomer(input: ContractorCustomerInput): Promise<ContractorCustomer> {
  if (input.id) {
    const { data, error } = await supabase
      .from("contractor_customers")
      .update(customerToRow(input))
      .eq("id", input.id)
      .select()
      .single();
    if (error) fail("saveContractorCustomer (update)", error);
    if (!data) fail("saveContractorCustomer (update)", null);
    return rowToCustomer(data);
  }
  const { data, error } = await supabase.from("contractor_customers").insert(customerToRow(input)).select().single();
  if (error) fail("saveContractorCustomer (insert)", error);
  if (!data) fail("saveContractorCustomer (insert)", null);
  return rowToCustomer(data);
}

export async function deleteContractorCustomer(id: string): Promise<void> {
  const { error } = await supabase.from("contractor_customers").delete().eq("id", id);
  if (error) fail("deleteContractorCustomer", error);
}

// Case-insensitive email match within one contractor's book. Compared in JS rather than
// via ilike so an address containing % or _ can't be read as a wildcard; a contractor's
// customer list is small enough that fetching the id/email pairs is cheap.
export async function findCustomerByEmail(ownerId: string, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  const { data, error } = await supabase
    .from("contractor_customers")
    .select("id, email")
    .eq("owner_id", ownerId);
  if (error) fail("findCustomerByEmail", error);
  const hit = (data ?? []).find((r) => (r.email ?? "").trim().toLowerCase() === target);
  return hit ? hit.id : null;
}

// --------------------------------- claims ---------------------------------
// Warranty claims filed against a completed, warranty-registered order (see
// supabase/migrations/0009_claims.sql). claim_number is CLM-YYYYMM-NNNN and is assigned
// by a DB trigger — never sent from here.
//
// Unlike the tables above, claims has had RLS since its first migration, so these reads
// need no ownerId filter: a contractor sees only their own rows and an admin sees all.

export type ClaimStatus = "submitted" | "under_review" | "approved" | "denied" | "resolved";

export type Claim = {
  id: string;
  orderId: string;
  ownerId: string;
  claimNumber: string;
  status: ClaimStatus;
  affectedProducts: string[]; // snapshot line-item keys — 'room' | 'shower' | 'vanity' | 'plumbing'
  description: string;
  photos: string[]; // storage URLs
  resolution: string | null;
  adminNotes: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// What the filing form supplies. status/claim_number/timestamps are server-managed.
export type ClaimInput = {
  orderId: string;
  ownerId: string;
  affectedProducts: string[];
  description: string;
  photos?: string[];
};

type ClaimRow = {
  id: string;
  order_id: string;
  owner_id: string;
  claim_number: string;
  status: ClaimStatus;
  affected_products: unknown;
  description: string;
  photos: unknown;
  resolution: string | null;
  admin_notes: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function rowToClaim(r: ClaimRow): Claim {
  return {
    id: r.id,
    orderId: r.order_id,
    ownerId: r.owner_id,
    claimNumber: r.claim_number,
    status: r.status,
    affectedProducts: strArray(r.affected_products),
    description: r.description,
    photos: strArray(r.photos),
    resolution: r.resolution ?? null,
    adminNotes: r.admin_notes ?? null,
    submittedAt: r.submitted_at ?? null,
    reviewedAt: r.reviewed_at ?? null,
    resolvedAt: r.resolved_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listClaims(orderId?: string): Promise<Claim[]> {
  let query = supabase.from("claims").select("*");
  if (orderId != null) query = query.eq("order_id", orderId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) fail("listClaims", error);
  return (data ?? []).map(rowToClaim);
}

export async function getClaim(id: string): Promise<Claim | null> {
  const { data, error } = await supabase.from("claims").select("*").eq("id", id).maybeSingle();
  if (error) fail("getClaim", error);
  return data ? rowToClaim(data) : null;
}

export async function createClaim(input: ClaimInput): Promise<Claim> {
  const { data, error } = await supabase
    .from("claims")
    .insert({
      order_id: input.orderId,
      owner_id: input.ownerId,
      affected_products: input.affectedProducts,
      description: input.description,
      photos: input.photos ?? [],
      // claim_number omitted on purpose — the BEFORE INSERT trigger assigns it.
    })
    .select()
    .single();
  if (error) fail("createClaim", error);
  if (!data) fail("createClaim", null);
  return rowToClaim(data);
}

// Admin review action. The review/resolve timestamps are stamped here (rather than by a
// trigger) so a status correction doesn't silently rewrite them: each is only set the
// first time the claim reaches that stage.
export async function updateClaimStatus(
  id: string,
  status: ClaimStatus,
  fields?: { resolution?: string | null; adminNotes?: string | null },
): Promise<Claim> {
  const row: Record<string, unknown> = { status };
  if (fields && "resolution" in fields) row.resolution = fields.resolution ?? null;
  if (fields && "adminNotes" in fields) row.admin_notes = fields.adminNotes ?? null;

  const existing = await getClaim(id);
  const now = new Date().toISOString();
  if (status !== "submitted" && !existing?.reviewedAt) row.reviewed_at = now;
  if ((status === "resolved" || status === "approved" || status === "denied") && !existing?.resolvedAt) {
    row.resolved_at = now;
  }

  const { data, error } = await supabase.from("claims").update(row).eq("id", id).select().single();
  if (error) fail("updateClaimStatus", error);
  if (!data) fail("updateClaimStatus", null);
  return rowToClaim(data);
}

// ------------------------------ admin (CRM) -------------------------------
// Reads that span the whole network. RLS gates them: the profiles/orders SELECT policies
// return every row only when is_admin() is true (a non-admin sees just their own).

export type Profile = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  territory: string | null;
  /** Company branding, shown on proposals in place of any Kitify chrome. */
  companyLogo: string | null;
  companyTagline: string | null;
  companyWebsite: string | null;
  role: "contractor" | "admin";
  status: "active" | "invited" | "disabled";
  mustChangePassword: boolean;
  profileConfirmed: boolean;
  invitedAt: string | null;
  firstLoginAt: string | null;
  createdAt: string;
  /** "Inventory tracking" feature toggle (Phase 2). Reads false when the migration that adds
   *  the column has not run yet, so this stays safe ahead of 0014. */
  inventoryTrackingEnabled: boolean;
};

type ProfileRow = {
  id: string;
  name: string;
  company_logo?: string | null;
  company_tagline?: string | null;
  company_website?: string | null;
  email: string;
  company: string | null;
  phone: string | null;
  territory: string | null;
  role: Profile["role"];
  status: Profile["status"];
  must_change_password: boolean;
  profile_confirmed: boolean;
  invited_at: string | null;
  first_login_at: string | null;
  created_at: string;
  inventory_tracking_enabled?: boolean;
};

function rowToProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    company: r.company ?? null,
    phone: r.phone ?? null,
    territory: r.territory ?? null,
    // Null until the branding migration runs; consumers treat null as "not set".
    companyLogo: r.company_logo ?? null,
    companyTagline: r.company_tagline ?? null,
    companyWebsite: r.company_website ?? null,
    role: r.role,
    status: r.status,
    mustChangePassword: !!r.must_change_password,
    profileConfirmed: !!r.profile_confirmed,
    invitedAt: r.invited_at ?? null,
    firstLoginAt: r.first_login_at ?? null,
    createdAt: r.created_at,
    inventoryTrackingEnabled: r.inventory_tracking_enabled ?? false,
  };
}

// A contractor updating their OWN profile (RLS profiles_update_self: id = auth.uid()) —
// used by the first-login onboarding gate (set a permanent password flag, confirm info).
export type ProfilePatch = Partial<{
  name: string;
  company: string | null;
  phone: string | null;
  territory: string | null;
  companyLogo: string | null;
  companyTagline: string | null;
  companyWebsite: string | null;
  mustChangePassword: boolean;
  profileConfirmed: boolean;
  firstLoginAt: string | null;
}>;
const PROFILE_PATCH_COLUMNS: Record<keyof ProfilePatch, string> = {
  name: "name", company: "company", phone: "phone", territory: "territory",
  companyLogo: "company_logo", companyTagline: "company_tagline", companyWebsite: "company_website",
  mustChangePassword: "must_change_password", profileConfirmed: "profile_confirmed",
  firstLoginAt: "first_login_at",
};
/** Branding columns, which land in the same migration as the proposal ones. */
const MIGRATED_PROFILE_COLUMNS = ["company_logo", "company_tagline", "company_website"];

export async function updateProfile(id: string, patch: ProfilePatch): Promise<Profile> {
  const row: Record<string, unknown> = {};
  for (const k of Object.keys(patch) as (keyof ProfilePatch)[]) row[PROFILE_PATCH_COLUMNS[k]] = patch[k];
  const run = (r: Record<string, unknown>) => supabase.from("profiles").update(r).eq("id", id).select().single();
  let { data, error } = await run(row);
  if (error && isMissingColumn(error)) {
    // Same reasoning as writeProposal: the first-login onboarding gate also calls this, and
    // it must not break because an unrelated branding migration has not been applied.
    const reduced = { ...row };
    for (const c of MIGRATED_PROFILE_COLUMNS) delete reduced[c];
    console.warn("[store] updateProfile: branding columns missing - run docs/migrations/2026-08-04-proposal-enhancements.sql. Saving without them.");
    ({ data, error } = await run(reduced));
  }
  if (error) fail("updateProfile", error);
  if (!data) fail("updateProfile", null);
  return rowToProfile(data as ProfileRow);
}

// All profiles across the network (admin only — RLS returns just the caller's own otherwise).
export async function listAllProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
  if (error) fail("listAllProfiles", error);
  return (data ?? []).map(rowToProfile);
}

// A single profile by id (admin can read any; a contractor can read only their own).
export async function getProfile(id: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) fail("getProfile", error);
  return data ? rowToProfile(data) : null;
}

// All orders across every owner (admin only — same RLS gating). Reuses listOrders' mapping
// and placed_at DESC ordering; with no owner filter, admins get the whole network.
export async function listAllOrders(): Promise<Order[]> {
  return listOrders({});
}
