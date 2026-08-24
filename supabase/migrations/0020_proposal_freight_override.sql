-- ============================================================================
-- Kitify Solutions — dealer freight override (Phase D)
-- Migration: 0020_proposal_freight_override
--
-- Freight is COMPUTED, per quote, from that quote's bathroom count: one bathroom $500, two or
-- more $850 flat — the second bathroom rides the same truck. The table lives in lib/freight.ts
-- and nothing about it is stored here; a stored estimate would go stale the moment the rate
-- sheet moved, and every proposal ever written would keep quoting the old number.
--
-- What IS stored is the dealer's override, because it is not derivable from anything. A dealer
-- who has phoned a carrier and holds a real freight quote for this job needs to type it, and
-- the number they type has to survive a reload and land in the order snapshot.
--
-- NULLABLE, and null is the ordinary case: use the computed estimate. Zero is a MEANINGFUL
-- value, not an absence — freight absorbed into the price, or the customer collecting — which
-- is why this is a nullable numeric rather than a defaulted one.
--
-- One column for the whole proposal, not one per tier. An override is a fact about the job's
-- logistics ("the carrier quoted me $650 to this address"), and the three options on a proposal
-- ship to the same address. The COMPUTED figure is still per option, so an option that drops
-- the second bathroom still estimates on its own — the override simply replaces all of them.
--
-- No backfill. Every existing proposal keeps its computed estimate, which is what it has always
-- effectively been quoting.
--
-- Depends on 0003 / 0004. Re-runnable.
-- ============================================================================

alter table public.proposals add column if not exists freight_override numeric;

comment on column public.proposals.freight_override is
  'Dealer-entered freight for this job, overriding the computed per-bathroom-count estimate '
  '(lib/freight.ts). NULL = use the computed estimate. ZERO IS MEANINGFUL — freight absorbed '
  'or customer-collected — and is not the same as NULL. Never marked up: freight is passed '
  'through to the homeowner at cost, so markup_pct does not apply to it.';

-- ============================================================================
-- VERIFY (SQL editor, after running)
--
-- 1. Column exists, is nullable, and nothing was backfilled:
--      select count(*) filter (where freight_override is null) as using_estimate,
--             count(*)                                          as total
--      from public.proposals;
--      -- expect using_estimate = total.
--
-- 2. Zero survives as zero and is distinguishable from null:
--      begin;
--        update public.proposals
--           set freight_override = 0
--         where id = (select id from public.proposals order by created_at desc limit 1)
--        returning freight_override, freight_override is null as is_null;
--        -- expect 0, false — NOT null. A zero override means "charge no freight",
--        -- which must not read back as "use the $500 estimate".
--      rollback;
--
-- 3. A real override round-trips as a number, not a string:
--      begin;
--        update public.proposals
--           set freight_override = 650.00
--         where id = (select id from public.proposals order by created_at desc limit 1)
--        returning freight_override, pg_typeof(freight_override);
--        -- expect 650.00, numeric. (PostgREST may still serialise it as a string —
--        --  rowToProposal coerces with Number(), as it does for markup_pct.)
--      rollback;
-- ============================================================================
