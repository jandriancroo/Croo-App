# South Meadows: why 99–103 items came out with no price

Read-only diagnostic. Nothing changed. (Current count is 103 unpriced of 219 — the 99 in the deploy log was the number at the moment the sweep finished; three more items have since gone to zero/null.)

## Bottom line

**Not a matching bug.** Of the 103 unpriced items, **zero** have a hit on any of the three legs — no priced bid-guide row, no order line, no invoice line. There is nothing we had and failed to find. Two separate real gaps did show up though, and one of them is worse than the small bid guide:

- **The PFG order leg is completely dead at this store.** All 9 PFG orders have `items` = NULL — headers only, no line items. Even if an item had been ordered, the fallback had nothing to read.
- **This store has never had an invoice uploaded.** Zero rows, ever. That leg cannot fire.

## 1. The 103 unpriced by vendor

| Vendor | Items | Priced | Unpriced |
| --- | --- | --- | --- |
| PFG (has item number) | 189 | 108 | 81 |
| Produce Alliance | 14 | 8 | 6 |
| No vendor identifier at all | 11 | 0 | 11 |
| House-made / recipe | 5 | 0 | 5 |
| **Total** | **219** | **116** | **103** |

The 16 with no vendor identifier or house-made status can never be priced by a vendor sweep — that's by design, not failure.

## 2. Three legs, checked independently

For all 103 unpriced items:

| Leg | Hits |
| --- | --- |
| On South Meadows' PFG bid guide **with a price** | **0** |
| On the bid guide but with **no price** on the row | 14 |
| Any PFG order line, ever | **0** (impossible — see below) |
| Any Produce Alliance order line, ever | **0** |
| Any Produce Alliance catalog entry | **0** |
| Any invoice line, ever | **0** (no invoices exist) |

So: **103 of 103 hit zero on all legs. Zero items had data we failed to use.**

The 14 that sit on the guide with a blank price are all non-food and bottled drinks — Coke/Diet Coke/Coke Zero 20oz, Pellegrino, Fanta BIB, crushed red pepper, glass cleaner, plastic wrap, receipt paper, sanitizer wipes, steel polish, napkin dispenser, handle replacement. PFG lists them on the guide without a contract price. That's PFG's data, not ours.

Worth knowing about the guide itself: it now holds **197 SKUs, of which only 120 carry a price** — 77 price-less rows. All 197 existed before the deploy started, so the guide was not "smaller at deploy time"; it simply has price gaps.

## 3. Order and invoice history at this location

| Source | Rows | Oldest | Newest | Usable? |
| --- | --- | --- | --- | --- |
| PFG orders | 9 | Aug 14 | Sep 12 | **No — every one has NULL line items** |
| Produce Alliance orders | 21 | Jul 2 | Sep 16 | Partly — 15 of 21 are empty, 6 carry 43 lines |
| Invoices | **0** | — | — | No |
| PFG bid guide | 197 rows (120 priced) | — | refreshed Sep 16 | Yes |
| PA catalog | 11 rows, all priced | — | Sep 16 | Yes |

Direct answer to your concern: **the 30-day order window did have something to read here** (9 PFG orders and 21 PA orders fall inside it) — but the PFG ones are hollow, so functionally the window was useless. That's not a new-store problem, it's the empty-`items[]` problem showing up on a store where nothing else covers for it.

## 4. Produce Alliance

Yes, South Meadows is mapped and syncing — PA is active in its integrations, the catalog pulled 11 items on Sep 16, and **8 of its 14 PA items priced correctly** straight off that catalog (Romaine hearts $30.59, mushrooms $29.94, cilantro $24.91, cucumbers $24.43, red onions $24.32, grape tomatoes $23.24, peppers $17.99, arugula $17.50, basil $16.69, spring mix $15.38, spinach $7.01).

The 6 unpriced PA items — Strawberries, Blueberries, Lemon Juice, Roasted Broccoli, Romaine Lettuce (Bag), Pineapple Tidbits — are unpriced because **there is no catalog entry and no order line for them at this store**. Not a mapping failure, not a sync failure. This store's PA account carries 11 products; those six aren't among them.

One thing I'd flag while we're in here: Produce Alliance uses **three different identifier namespaces** for the same product. The item carries `16901`, the catalog row says `10176`, and the order line says `00447` — all "Arugula, Baby, 4 lb." Pricing succeeded anyway, which means it matched on description, not on ID. That works today and is fragile: rename a product on PA's side and those eight prices go quiet. Worth a look separately.

## 5. Timing of the PA order fallback

**It was live before the deploy.** The commit that added `pa_orders` to the order map in `_shared/vendorPriceChase.ts` landed **Sep 15 02:00 UTC**; the deploy run started **Sep 16 04:20 UTC** — 26 hours later. None of these results are stale-code artifacts.

## What I'd actually chase next (your call, no code written)

1. **The NULL `items` on all 9 PFG orders.** This is the real finding. It kills the order leg at this store entirely and it will kill it at any store with the same pattern. Worth checking how widespread NULL-vs-empty `items` is across all locations before anything else.
2. **77 price-less bid guide rows.** Decide whether that's a PFG-side ask (get prices on the guide) or an expectation change on our side (these SKUs will never price from the guide).
3. **The 16 no-vendor / house-made items** should probably be excluded from the "unpriced" count entirely so the number means something.
4. **PA identifier drift** — matching produce on description is a latent failure.
