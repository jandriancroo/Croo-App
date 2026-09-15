# Stage 3.5 — Invoice pricing through the shared chain, active-flag fix, vendor confirmation

## What I found first (evidence)

**The `status = active` filter is a real, silent bug.** The items table has no `status` column at all — it has a true/false `is_active` flag (confirmed against the live schema). So the lookup of "what does this store already carry?" returns nothing, and every invoice line falls through to "unknown item."

Live numbers back that up:
- 89 invoice lines parsed in total: **1** ever matched a store item, and that one is from July 2. Everything since matches nothing local.
- 66 lines sit as "unmatched", 22 matched only a brand catalog entry.
- 13 gap alerts were created with source "invoice" — items flagged as unknown that the store may well already carry.

So yes: matched-invoice pricing has been quietly dead. Nothing was crashing, it just silently found zero items.

**Vendor names are free text and already drifting.** Existing invoices show `Heimark Distributing, LLC` (9), `HEIMARK DISTRIBUTING, LLC` (1), `Worldwide Produce` (1), `Unknown` (2) — the same vendor stored two ways, none of them connected to the vendor registry (which today holds only PFG and Produce Alliance). `pg_trgm` is already installed, no new dependency needed.

Note: this touches the invoice side of the inventory system, which is on the locked list. The changes below are confined to invoice parsing, plus one new table and one new review card — no changes to counting, weighing, matching screens, or period logic.

## 1. Fix the active-item lookup

Change the invoice parser's item lookup from the non-existent `status` field to `is_active = true`, matching the Lite parser and the rest of the app. This alone restores matching, price capture, and stops false "new item" gap alerts.

## 2. Route matched-item pricing through the one shared pricing path

Remove the direct cost write. Instead, after invoice lines are saved, the parser hands the matched item IDs to the shared pricing routine (`vendor-price-chase` with `activate: true`, which runs `chasePrices()` with `activateOnHit`). A confirmed invoice match then prices and switches on an item exactly the way a PFG or Produce Alliance sync match does — same window rules, same `unpriced_since` / `last_ordered_at` stamping, same activation rule.

Pack size stays on the invoice line record (it's invoice-observed detail, not a price), so no pricing information is written outside the shared chain.

The response gains `priced` / `activated` counts from the sweep instead of a local `price_updates` tally.

## 3. Vendor confirmation instead of free text

- Normalize the extracted vendor name: lowercase, strip punctuation and legal suffixes (LLC, Inc, Corp, Co, Ltd).
- Compare that against registry keys, display names, and confirmed aliases using `similarity()` (pg_trgm). Exact normalized hit → link silently.
- Anything else — including a 0.9 near-match — creates a **pending vendor** row. Nothing is auto-created and nothing is auto-linked.
- A new "Vendors to confirm" card appears in the Brand Inventory vendor review area: shows the name as printed on the invoice, the closest registry suggestion with its confidence, and two choices — link to the suggested vendor, or create a new registry entry. Confirming records the alias so the same spelling never asks again (which immediately collapses the two Heimark spellings into one).
- The invoice keeps showing the name as printed while confirmation is pending; it is simply not linked yet.

## Technical notes

- New table `vendor_name_candidates`: raw_name, normalized_name, suggested_vendor_id, similarity_score, status (pending/approved/rejected), invoice_id, location_id, brand_id, resolved_vendor_id, resolved_by, timestamps. GRANTs to authenticated + service_role, RLS on: admins/managers read and resolve, backend writes.
- New table `vendor_registry_aliases`: vendor_id → normalized alias (unique), created_by. Exact-alias hits bypass the fuzzy step entirely.
- New function `public.match_vendor_name(_name text)` — SECURITY DEFINER, `search_path = public` — returns best registry/alias candidate plus score, with a trigram index on the normalized columns.
- Parser changes are confined to `supabase/functions/parse-vendor-invoice/index.ts`; pricing logic in `_shared/vendorPriceChase.ts` is unchanged.
- UI: new `PendingVendorsCard` rendered inside `src/components/brand/VendorGapFinder.tsx`.
- Existing invoice records are left as-is; the parser is not re-run retroactively. If you want, I can re-parse or re-match the 66 stranded lines afterwards as a separate pass.
