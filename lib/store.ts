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
  total: number;
  status: "draft" | "sent" | "accepted" | "ordered" | "archived";
  createdAt: string;
  updatedAt: string;
};

// The save inputs: everything except the server-managed id / timestamps, with an
// optional id (present ⇒ update, absent ⇒ insert). Unchanged from the previous API.
type ProjectInput = Omit<Project, "id" | "createdAt" | "updatedAt"> & { id?: string };
type QuoteInput = Omit<Quote, "id" | "createdAt" | "updatedAt"> & { id?: string };

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
  createdAt: string;
  updatedAt: string;
};

// Save input covers only the contractor-editable fields. share_token and the accepted_*
// fields are managed by shareProposal / revokeProposal and the accept flow — never written
// here — so an edit can't clobber a live link or an acceptance.
type ProposalInput = Pick<
  Proposal,
  "ownerId" | "projectId" | "name" | "markupPct" | "tierGood" | "tierBetter" | "tierBest" | "status"
> & { id?: string };

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
    total: Number(r.total), // numeric may arrive as a string — normalise to number
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// The four config objects are jsonb — passed through as-is (null when absent).
function quoteToRow(q: QuoteInput) {
  return {
    project_id: q.projectId,
    owner_id: q.ownerId,
    name: q.name,
    room: q.room ?? null,
    shower: q.shower ?? null,
    vanity: q.vanity ?? null,
    plumbing: q.plumbing ?? null,
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
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
    return rowToProject(data);
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
  return rowToProject(data);
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

export async function saveQuote(q: QuoteInput): Promise<Quote> {
  if (q.id) {
    const { data, error } = await supabase
      .from("quotes")
      .update(quoteToRow(q))
      .eq("id", q.id)
      .select()
      .single();
    if (error) fail("saveQuote (update)", error);
    if (!data) fail("saveQuote (update)", null);
    return rowToQuote(data);
  }
  const { data, error } = await supabase.from("quotes").insert(quoteToRow(q)).select().single();
  if (error) fail("saveQuote (insert)", error);
  if (!data) fail("saveQuote (insert)", null);
  return rowToQuote(data);
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
  if (p.id) {
    const { data, error } = await supabase.from("proposals").update(proposalToRow(p)).eq("id", p.id).select().single();
    if (error) fail("saveProposal (update)", error);
    if (!data) fail("saveProposal (update)", null);
    return rowToProposal(data);
  }
  const { data, error } = await supabase.from("proposals").insert(proposalToRow(p)).select().single();
  if (error) fail("saveProposal (insert)", error);
  if (!data) fail("saveProposal (insert)", null);
  return rowToProposal(data);
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
export async function shareProposal(id: string): Promise<string> {
  const share_token = genShareToken();
  const { data, error } = await supabase
    .from("proposals")
    .update({ share_token, status: "shared" })
    .eq("id", id)
    .select()
    .single();
  if (error) fail("shareProposal", error);
  if (!data) fail("shareProposal", null);
  return rowToProposal(data).shareToken ?? share_token;
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

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
  const { data, error } = await supabase.from("orders").update({ status }).eq("id", id).select().single();
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
      room: quote.room, shower: quote.shower, vanity: quote.vanity, plumbing: quote.plumbing,
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
  role: "contractor" | "admin";
  status: "active" | "invited" | "disabled";
  mustChangePassword: boolean;
  profileConfirmed: boolean;
  invitedAt: string | null;
  firstLoginAt: string | null;
  createdAt: string;
};

type ProfileRow = {
  id: string;
  name: string;
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
};

function rowToProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    company: r.company ?? null,
    phone: r.phone ?? null,
    territory: r.territory ?? null,
    role: r.role,
    status: r.status,
    mustChangePassword: !!r.must_change_password,
    profileConfirmed: !!r.profile_confirmed,
    invitedAt: r.invited_at ?? null,
    firstLoginAt: r.first_login_at ?? null,
    createdAt: r.created_at,
  };
}

// A contractor updating their OWN profile (RLS profiles_update_self: id = auth.uid()) —
// used by the first-login onboarding gate (set a permanent password flag, confirm info).
export type ProfilePatch = Partial<{
  name: string;
  company: string | null;
  phone: string | null;
  territory: string | null;
  mustChangePassword: boolean;
  profileConfirmed: boolean;
  firstLoginAt: string | null;
}>;
const PROFILE_PATCH_COLUMNS: Record<keyof ProfilePatch, string> = {
  name: "name", company: "company", phone: "phone", territory: "territory",
  mustChangePassword: "must_change_password", profileConfirmed: "profile_confirmed",
  firstLoginAt: "first_login_at",
};
export async function updateProfile(id: string, patch: ProfilePatch): Promise<Profile> {
  const row: Record<string, unknown> = {};
  for (const k of Object.keys(patch) as (keyof ProfilePatch)[]) row[PROFILE_PATCH_COLUMNS[k]] = patch[k];
  const { data, error } = await supabase.from("profiles").update(row).eq("id", id).select().single();
  if (error) fail("updateProfile", error);
  if (!data) fail("updateProfile", null);
  return rowToProfile(data);
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
