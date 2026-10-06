# Heimark beer invoices: reading profile, price flow, dedup (PLAN ONLY)

Nothing was changed. All evidence below comes from reading the code plus a few light read-only queries.

## A. What happens today (evidence)

- **Prompt and schema:** `supabase/functions/_shared/invoice-ai.ts:27-41` (system prompt) and `:44-79` (tool schema). The model is asked for product_name, item_number, pa_product_id, pack_size ("Pack UM" column), quantity, unit, unit_price and total_price. It is never asked for discount, CRV/deposit or footer totals. Its pack wording expects a PFG/PA-style "Pack UM" column (`:37`, `:127`), but Heimark prints the pack inside the description. Model: `gemini-3-flash-preview` (`:112`).
- **Invoice record:** a new `vendor_invoices` row is created on every upload (`parse-vendor-invoice/index.ts:75-90`). There is no check for vendor + number + store, so #200019 was saved three times. The vendor name is saved as the model read it (`:199-207`). A registry link is attempted (`:220-270`), but the raw string stays on the invoice.
- **Matching:** `:307-389`. The store item is found by PA id, then store `item_number`, then exact name, then brand item through any vendor number on `brand_vendor_mappings` (`:328-336`, `:383`, `:387`).
- **Line save:** `:391-402` and `:430-434`. There is no pack, discount or deposit. `vendor_invoice_items` has no `pack_size`.
- **Pack write-back:** this goes to `inventory_items.pack_size`, and only for matched lines (`:404-408`, `:438-443`). Pack is not saved on the line itself.
- **Gaps:** `:410-424` and `:473-477`. Each gap gets vendor_source `'invoice'`, `pack_size: li.unit` (this is why it says "CASE"/"CS"), and no reporting store. The upsert uses `ignoreDuplicates`, so an ignored gap stays ignored silently.
- **Price write-back:** an invoice does not write a price. It only calls `vendor-price-chase` for matched items (`:450-470`). That chain reads **only `pfg_invoices`** (`_shared/vendorPriceChase.ts:199-203`, `:264-291`). It never reads `vendor_invoice_items`, so **Heimark prices can never reach a store item**, even when a line matches.
- **Why 81 of 82 lines aren't linked (from the data):**
  - **The 22 "matched_brand" lines:** each one has an active store item with that brand item today, and those store items existed before the uploads (Apr 8 and Apr 17; uploads ran Jun–Sep). Their brand mappings exist (for example `heimark:10351`). The comments at `:277-282` record that the store-item list query used to fail (old `status` and `vendor_item_id` columns), which left the list empty. So the brand-level match worked and the store-level match had nothing to look in. This is the likely cause. Step 1 confirms it against the commit dates.
  - **The 59 "unmatched" lines:** no brand mapping exists for those numbers, mostly the other packagings (13631, 37744, 37743, 70939, 11451 and so on).
  - **Palm Desert store items have `item_number = null`.** That would also defeat matching by number, but the brand-mapping path covers it.

## B. Design: vendor reading profiles

- New `supabase/functions/_shared/invoiceProfiles/` folder:
  - `index.ts` picks the profile.
  - `default.ts` holds today's prompt, schema and post-processing, moved byte-for-byte.
  - `heimark.ts` holds Heimark's rules.
- **How a profile is chosen:** two steps.
  1. A cheap first pass reads only the vendor name, using the normalized name and `match_vendor_name`.
  2. If it resolves to the Heimark registry entry, the second pass uses Heimark's prompt and schema. Anything else uses `default`, so PFG/PA parsing is unchanged.
  - **Alternative to avoid the extra call:** run the default parse, and re-run with Heimark only when the vendor resolves to Heimark.
- **What the Heimark profile asks for:** per line, item#, qty (cases), description as printed, price, disc, crv_dep and amount. It also asks for the footer: CRV units, CRV$, cases, gallons, content$, deposit$, discount$ and total.
- **Pack is worked out by code, not by the model,** in `heimark.ts`:
  - Units per case = CRV ÷ 0.05.
  - Read the description: "N/oz" (with an optional inner layout or LOOSE), or a layout only ("a/b", where a×b = units). The CRV unit count decides which form it is and checks the result.
  - CN means can. NR is ignored for the container type.
- **Cost per case** = AMOUNT ÷ QTY (what was actually paid). List price and discount are saved separately.
- **Self-checks:**
  - Σ amount = total
  - Σ qty = cases
  - Σ qty×units = CRV units
  - Σ oz÷128 ≈ gallons, when ounces are known
  - Every line: amount = qty×(price−disc+crv)
  - If any check fails, the invoice is set to `needs_review` and no prices or gaps are written.
- **Price flow, for all vendors:**
  - Add a fourth source to `vendorPriceChase.ts`: **non-PFG vendor invoice lines** from `vendor_invoice_items`, only on invoices with `review_status = 'ok'`, keyed by `vendor:item_number`.
  - Match against **every approved number** on the brand item (all `brand_vendor_mappings` rows plus its pack configs).
  - The price is written per case. The store item's `item_number` is filled in when it is empty.
  - This stays in the one shared price chain (project rule), so nothing in the invoice function writes a price itself.
- **Gaps:**
  - vendor_source becomes `heimark`, the vendor name is the normalized registry name, `pack_size` is the parsed string, and the reporting store is appended to `reported_by_locations`.
  - **Ignored number seen again:** reopen it as `new`, with a "seen again on invoice X" note and the latest store. Ignored means "not now", not "never". Option for Jordan: keep it ignored but show a badge.
- **Extra packagings** (13631, 37744 and 37743, 70939): these become extra mappings and pack configs on the same brand item, approved through the existing pack-config approval screen. They are never auto-created.

## C. Schema changes (one migration, later)

- **`vendor_invoice_items`:** add `pack_size text`, `units_per_case numeric`, `oz_per_unit numeric`, `inner_layout text`, `list_price numeric`, `discount numeric`, `deposit numeric`, `cost_per_case numeric`, `raw_description text`.
- **`vendor_invoices`:**
  - Add `vendor_registry_id uuid`, `vendor_name_normalized text`, `review_status text` (ok / needs_review), `self_checks jsonb` and `profile text`.
  - Add a partial unique index on `(location_id, vendor_name_normalized, invoice_number)` where invoice_number is not null.
  - A re-upload updates that record and replaces its lines.
- **`vendor_gap_alerts`:** no new columns (it already has `reported_by_locations` and `pack_size`). Only the writer changes.

## D. Dry run (no writes)

- **Script location:** a one-off script in `/tmp`, using the Heimark profile. It reads the 10 stored invoices (all images are in storage) with the new rules.
- **Per line, old vs new:** item number, pack (`pack_size` on the gap / units / oz / layout), and cost per case (old `unit_price` vs new AMOUNT÷QTY).
- **Per invoice:** pass/fail on each self-check.
- **Sep 28 fixture:** checked against the hand-read #235013 lines as the known-good answer, before Jordan's photo test.
- **Price table for the 9 Palm Springs / Palm Desert beer items:** today's `cost_per_unit` and source next to the new per-case paid price. For example, Bud Light at Palm Springs goes from 1.2042 (manual, per can) to 24.55 (per case), and Palm Desert's empty Bud Light, Budweiser and the two Lagunitas get prices.
- **#200019 triplicate cleanup (dry run):**
  - Keep `0694ed82` (dated, 7 lines). Delete `b9694d4e` and `77b63b79` and their lines.
  - The 21-line copy is first compared line by line, to confirm it is a misread and not a genuine combined copy.
  - Re-point anything that references the deleted ones.
- **Vendor-name normalization:** a list of the rows that would change.

## E. Beer pack configs (list now, change later)

| Item | Today |
|---|---|
| Bud Light 16 | 24 ea, case, no inner |
| CVB CDMX | 24 can, inner 1 ea, label "6/4 ea" |
| Firestone 805 | 2 packs × 12 ea |
| Lagunitas Poolside | 6 packs × 4 ea |
| Estrella 12 | **288 oz**, counted in oz, labeled "24/12 ea" |
| Stella, Mich Ultra 12, Lagunitas Heatwave, Porch Pounder, others | need a full listing; some are 216 or 264 oz with inner 12 or 11 oz |

**Proposed standard for every beer config** (counted by the can):
- common_unit = `ea` (can)
- count_units_per_case = units per case (24)
- inner = the printed layout (2×12, 4×6, 6×4), or none for LOOSE
- show_cases on, show_inner_packs on only when an inner layout exists
- Ounces kept in the label only
- Each Heimark number for the same beer gets its own config

The dry run outputs the full list and the proposed config for each.

## F. Count screen: cans typed into "Cases"

- Palm Springs' Firestone has `show_cases` on, and its "Cases" box is the first input. On Oct 1, 128 typed into Cases = 3,072 cans.
- Estrella-style configs count in **ounces**, so a "can" box does not exist there. Staff fall back to Cases.
- **Fix candidates (config only, no screen change):** make "cans" the main box for beer by setting `show_cases` off, or keep cases but have the screen show "= N cans" live.
- The count screen (`InventoryCountSession.tsx:517-533`, `:3014-3016`) is part of the **locked inventory system**. Any change to the screen itself needs "unlock please". The config-only route doesn't touch it.
- Separately: flag that Oct 1 count line for correction (128 → about 5.3 cases, or 128 cans).

## Steps after approval

1. Confirm the A cause from the commit dates.
2. Run the D/E dry run in `/tmp` and report.
3. Jordan reviews and decides on the cleanup and the ignored-gap behavior.
4. Run the migration (C).
5. Add the profiles and the gap writer.
6. Add the price-chase source.
7. Live photo test of #235013.

PFG/PA parsing stays byte-identical (the default profile), and that is checked with a before/after parse diff on one PFG invoice.
