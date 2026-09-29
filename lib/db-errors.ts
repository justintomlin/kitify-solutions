// Turning a database refusal into something a contractor can read.
//
// Migrations 0027 through 0032 put the authorization and contract-integrity rules in the
// database, where they hold regardless of what the client believes. Each one raises a NAMED
// error at errcode 42501 — ORDER_LOCKED, PROPOSAL_TERMS_FROZEN and so on — precisely so the
// UI could tell a rep WHY rather than showing "something went wrong".
//
// This module is the one place that mapping lives. Ten identifiers plus one bare SQLSTATE,
// resolved to an i18n key. Every catch block routes through `dbErrorKey`; none of them does
// its own string matching.
//
// WHY MATCH ON THE MESSAGE AND NOT ONLY THE CODE: all ten share errcode 42501, because that
// is the correct SQLSTATE for "insufficient privilege" and inventing private codes would make
// them lie to anything else reading them. The identifier prefix is what distinguishes them,
// and it is the first token of the message by construction — see any `raise exception` in
// supabase/migrations/003*.sql. 23503 is the exception: it is Postgres's own foreign-key
// violation, has no identifier, and is matched by code.

/**
 * Thrown by lib/store.ts instead of a bare Error, so the PostgREST error code survives the
 * trip to the UI. Before this, `fail()` interpolated `error.message` into an Error and dropped
 * `error.code` — which was fine while every failure was "something went wrong", and stopped
 * being fine the moment 23503 needed telling apart from 42501.
 */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly dbMessage: string | null,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

/** The identifiers the database raises, in the order the migrations added them. */
const IDENTIFIERS = [
  "ORDER_CREATE_FORBIDDEN", // 0030 — a salesperson may not convert
  "ORDER_LOCKED", // 0027 — past the 48-hour change window
  "ORDER_TRANSITION_FORBIDDEN", // 0032 — illegal order state move
  "PROPOSAL_ACCEPTED_IMMUTABLE", // 0031 — deleting an accepted proposal
  "PROPOSAL_ACCEPTANCE_FROZEN", // 0031 — editing an accepted_* column
  "PROPOSAL_DELETE_FORBIDDEN", // 0031 — a salesperson may not delete proposals
  "PROPOSAL_REVERT_FORBIDDEN", // 0031 — unsharing an accepted proposal
  "PROPOSAL_TERMS_FROZEN", // 0032 — editing an accepted proposal's price
  "PROPOSAL_TRANSITION_FORBIDDEN", // 0032 — illegal proposal state move
  "QUOTE_ACCEPTED_FROZEN", // 0032 — editing the quote behind an acceptance
] as const;

export type DbErrorIdentifier = (typeof IDENTIFIERS)[number];

// IDENTIFIER -> i18n key. camelCase suffix so the keys read as keys, not as shouting.
const KEY_BY_IDENTIFIER: Record<DbErrorIdentifier, string> = {
  ORDER_CREATE_FORBIDDEN: "dbError.orderCreateForbidden",
  ORDER_LOCKED: "dbError.orderLocked",
  ORDER_TRANSITION_FORBIDDEN: "dbError.orderTransitionForbidden",
  PROPOSAL_ACCEPTED_IMMUTABLE: "dbError.proposalAcceptedImmutable",
  PROPOSAL_ACCEPTANCE_FROZEN: "dbError.proposalAcceptanceFrozen",
  PROPOSAL_DELETE_FORBIDDEN: "dbError.proposalDeleteForbidden",
  PROPOSAL_REVERT_FORBIDDEN: "dbError.proposalRevertForbidden",
  PROPOSAL_TERMS_FROZEN: "dbError.proposalTermsFrozen",
  PROPOSAL_TRANSITION_FORBIDDEN: "dbError.proposalTransitionForbidden",
  QUOTE_ACCEPTED_FROZEN: "dbError.quoteAcceptedFrozen",
};

/** Shown when nothing more specific matches. The existing generic message, by another name. */
export const DB_ERROR_FALLBACK_KEY = "dbError.generic";

function messageOf(e: unknown): string {
  if (e instanceof StoreError) return `${e.message} ${e.dbMessage ?? ""}`;
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  // A raw PostgrestError, if a caller ever hands one over without going through fail().
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "";
}

function codeOf(e: unknown): string | null {
  if (e instanceof StoreError) return e.code;
  if (e && typeof e === "object" && "code" in e) {
    const c = (e as { code: unknown }).code;
    return typeof c === "string" ? c : null;
  }
  return null;
}

/**
 * The i18n key for whatever went wrong, or the generic fallback.
 *
 * Deliberately total: it never throws and never returns null, because every caller is inside a
 * catch block and a translation helper that can itself fail is worse than a vague message.
 */
export function dbErrorKey(e: unknown): string {
  const message = messageOf(e);

  for (const id of IDENTIFIERS) {
    if (message.includes(id)) return KEY_BY_IDENTIFIER[id];
  }

  // 23503 — foreign key violation. In this app it means one thing: something still points at
  // the row being deleted. The only place a contractor meets it is deleting a quote that a
  // proposal names as a tier or as its accepted quote, which 0003's plain references refuse.
  if (codeOf(e) === "23503" || message.includes("violates foreign key constraint")) {
    return "dbError.quoteInUse";
  }

  // A PLAIN RLS REFUSAL, with no named identifier behind it.
  //
  // Two shapes, one meaning. The first is Postgres's own wording when a WITH CHECK fails on
  // an INSERT or UPDATE — that is what 0031's role-gated policies on contractor_customers
  // produce, since they are policies rather than triggers and so have no message of their
  // own. The second is CUSTOMER_WRITE_FORBIDDEN, which lib/store.ts raises when an UPDATE or
  // DELETE on that table matches zero rows; a filtering USING clause removes nothing and
  // reports nothing, so the store infers it (see saveContractorCustomer).
  //
  // Both mean the same thing to the person reading it: the rule says no.
  if (
    message.includes("CUSTOMER_WRITE_FORBIDDEN") ||
    message.includes("violates row-level security policy")
  ) {
    return "dbError.notPermitted";
  }

  return DB_ERROR_FALLBACK_KEY;
}

/**
 * True when the failure is one the database raised on purpose, rather than a network blip or a
 * bug. Lets a caller decide whether to show the message inline (a rule the user can act on) or
 * to log it as an incident.
 */
export function isDbRuleError(e: unknown): boolean {
  return dbErrorKey(e) !== DB_ERROR_FALLBACK_KEY;
}
