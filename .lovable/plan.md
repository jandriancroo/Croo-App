# Fixing the out-of-division item numbers at Tuscaloosa and Rowlett

## Answer first

Name matching is not the fix, and it is not needed. The candidate pool at each store is tiny — **Tuscaloosa has only 18 order-guide lines not already claimed by an item, Rowlett only 29**. That is the entire universe of possible answers. Matching 44 items against a 18/29-row list is a one-screen human decision, not an algorithm problem.

The second finding matters more: **44 of those 47 guide lines have already been through the vendor gap queue** — and the queue did the wrong thing with them. It "promoted" each one into a brand-new brand item named after the raw PFG description (`BROOM HEAD 9" BLUE`, `HAIR NET DARK BROWN LARGE NYLON`, `SAUCE SRIRACHA`), most of which are now archived. The real brand item (Broom Head Replacement, Beard Net, Chipotle Sauce) never received the local number. So the number the store needs is already in our database — attached to a duplicate ghost instead of the real item.

## What the data says about each matching strategy you asked about

### Brand item as the bridge — does not work, zero hits
For all 44 numbered-unpriced items: **0** have any PFG number, from `brand_vendor_mappings` or from a sibling store's copy of the same brand item, that appears on their own store's guide. Every number they carry is SoCal-only. The bridge has nothing to bridge with — which is exactly the gap this project has to fill by hand once.

### Pack size + category — useful as a ranking hint, not as an answer
- Only **18 of the 44** items have a pack size recorded on our side at all. The other 26 are blank, so this test cannot even run on them.
- Our format and PFG's differ by whitespace only (`1/1CT` vs `1/1 CT`). Normalizing that makes the comparison work — today it silently scores zero for everything.
- After normalizing, against the unclaimed pool: 7 items get 1–4 candidates, 11 get **zero**. Zero means the answer is not in that store's guide at all (the fountain-syrup BIBs, soap/sanitizer cartridges and Coke-branded cups look like direct-from-Coke/chemical-program items PFG never carried there).
- Where it does return one candidate it can still be wrong: Salami `2/5LB` matches exactly one unclaimed Tuscaloosa line — `BEEF TOPPING FULLY-COOKED FROZEN`. Wrong item, identical pack. **Confirmation by a human stays mandatory.**

### Cross-store number overlap — real, but not a private non-SoCal set
Shared distinct numbers between guides:

| Pair | Shared |
|---|---|
| South Meadows ↔ Sparks | 195 |
| Hemet ↔ Palm Desert ↔ Palm Springs | 181 (identical) |
| Rowlett ↔ SoCal | 109 |
| Tuscaloosa ↔ SoCal | 103 |
| Tuscaloosa ↔ Rowlett | 92 |
| Tuscaloosa ↔ Sparks / South Meadows | 69 |

Guide sizes: South Meadows 197, Sparks 196, SoCal 181 each, Rowlett 162, Tuscaloosa 138. So most of PFG's catalog is nationally numbered; only roughly 35–45 numbers per store diverge, and those are precisely the ones that broke. The divisions do **not** share a separate common set that would let one solved store answer for another — Tuscaloosa↔Rowlett overlap (92) is no better than Tuscaloosa↔SoCal (103).

### What the data does support: rank the small pool
For each unpriced item, score the 18/29 unclaimed lines by normalized pack size, category family, the SoCal sibling's known unit price (±30% window), and vendor brand name. Present the top 3 side by side and let Jordan pick. That is an aid to a human eye, never an auto-link.

## The approval flow — reuse what exists

`vendor_gap_alerts` already carries everything the queue needs: `item_number`, `vendor_description`, `pack_size`, `category_name`, `status`, and `reported_by_locations` (already tagging which store reported it). The scan already walks every PFG-connected location. **No schema change is needed** — suggested candidates are computed when the screen renders, not stored.

Two changes to the existing Brand Inventory gap screen:

1. **Default action becomes "link to an existing brand item", not "create new."** `InlineLinkToExisting` already does exactly the right thing today — it writes a `brand_vendor_mappings` row for the number. It just has to be the prominent path, with the same pack/category/price ranking driving its suggestion list instead of only word overlap.
2. **Show the store context.** Each alert displays the reporting store and, beside it, that store's unpriced items whose pack/category are compatible — so the decision reads as "this Tuscaloosa line is our Broom Head Replacement" rather than an abstract SKU.

Also needed: **re-open the 44 wrongly-promoted alerts** and archive/merge the duplicate templates they created, so the real brand item gets the number.

## What happens after approval — chain verified

Traced end to end, not assumed:

1. Approval writes `brand_vendor_mappings(brand_template_id, vendor='pfg', vendor_item_id=<local number>)`.
2. The price chase's number resolver reads the template's own columns **plus every `brand_vendor_mappings` row**, so the new number joins the set it looks for.
3. Stage A loads `pfg_bid_items` filtered to that one location, so the Alabama number resolves against Alabama prices and cannot leak a SoCal price.
4. A price hit clears `unpriced_since`, sets cost, and — in activation mode — switches the item on provided the brand template is `live`.

The chain works as-is. The only missing link was the mapping row.

## Division/scope — no new concept, no collision

`brand_vendor_mappings` is unique on `(brand_template_id, vendor, vendor_item_id)`, so one brand item can already hold several PFG numbers — and does: the maximum today is **5 numbers on one template**. It also already has `territory` and `source_location_id` (populated on 171 of 335 PFG rows).

So the minimal change is a convention, not a migration: every approved number records `source_location_id` = the store whose guide it was seen valid on. That records observation, not PFG's org chart, exactly as decided earlier. Price chase stays location-scoped, so extra numbers are harmless.

## Prevention — the deploy-time check

When an item deploys to a location, validate each PFG number against that location's `pfg_bid_items` before trusting it. If absent: leave the number off the local row (rather than planting a number that store can't use), mark the item unpriced-pending, and raise a gap alert tagged to that store. This runs in the deploy path and the nightly availability sweep, so store #8 surfaces a short review list on day one instead of a silent pile of unpriced items.

## Expected outcome, real numbers

Current unpriced active items: **Tuscaloosa 49, Rowlett 17** (higher than the 36/11 you quoted — worth reconciling which filter you were using). These split into two unrelated problems:

| | Tuscaloosa | Rowlett |
|---|---|---|
| Carry a PFG number their own guide rejects — **this project** | 34 | 10 |
| No PFG number at all (dough balls, prepped recipes, beer via invoice) — separate | 15 | 7 |

For the 44:

- **Automatically resolved with no human: 0.** Nothing in the data supports a safe auto-link, and the one-candidate cases include a confirmed wrong answer.
- **Recoverable from work already done: up to 44.** The numbers already sit on duplicate templates from earlier promotes; re-pointing those to the correct brand item is a confirm-only decision, not a hunt.
- **Needs a genuine human decision: all 44**, but bounded — 18 candidate lines at Tuscaloosa, 29 at Rowlett, each with a ranked suggestion. Realistically one sitting.
- **Genuinely not carried at that store: at least 16 at Tuscaloosa** (34 items vs only 18 unclaimed lines). Those should be marked not-available-at-this-store, not chased forever. Rowlett has more unclaimed lines (29) than unpriced items (10), so all 10 are plausibly solvable.

Guardrail for the build: Palm Desert ≥ 201 and Palm Springs ≥ 211 active priced items before and after, with Tuscaloosa and Rowlett measured before and after as the success metric.

## Build order, when approved

1. Fix the pack-size comparison (whitespace normalization) and add the candidate-ranking helper.
2. Re-open the 44 mis-promoted alerts; surface the duplicate templates for merge into the real brand item.
3. Make "link to existing brand item" the default gap action, with ranked candidates and store context shown.
4. Record `source_location_id` on every approved mapping.
5. Run the price chase at both stores; report priced/activated counts.
6. Add the deploy-time and sweep-time number validation with gap raising.
7. Mark the genuinely-uncarried items as not available at that store.
