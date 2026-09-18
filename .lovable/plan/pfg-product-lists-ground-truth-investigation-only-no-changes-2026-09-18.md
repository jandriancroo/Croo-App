# PFG product lists — ground truth (investigation only, no changes made)

All numbers below are live reads taken today from PFG's own list endpoint plus our stored list cache. Nothing was changed.

## 1. What lists actually exist, store by store

Every store has exactly one PFG-managed main list, plus extras. "Type 2" = PFG-managed and read-only. "Type 3" = built by the store. "Type 4" = Purchase History (a system placeholder, always empty).

| Store | PFG-managed main list | Items | Store-built list | Items | Other PFG list |
|---|---|---|---|---|---|
| Hemet | `!! BLAZE PIZZA MONTHLY AH - Bid 73` | 181 | Blaze Hemet | 129 | Proprietary Items (16) |
| Palm Desert | `!! BLAZE PIZZA MONTHLY AH - Bid 73` | 181 | — | — | Proprietary Items (16) |
| Palm Springs | `!! BLAZE PIZZA MONTHLY AH - Bid 73` | 181 | Blaze Palm Springs | 117 | Proprietary Items (16) |
| Rowlett | `!! BLAZE PIZZA DALLAS - Bid 10` | 163 | — | — | Proprietary Items (28) |
| South Meadows | `Order Guide` | 186 | Blaze Form | 109 | — |
| Sparks | `Order Guide` | 185 | Blaze Form | 115 | — |
| Tuscaloosa | `Order Guide_10_BLAZE1` | 166 | — | — | `Bid_10_BL305` (138), also PFG-managed |

So the naming vocabulary is genuinely three different conventions: "Bid 73/Bid 10" in California and Dallas, plain "Order Guide" in Nevada, and "Order Guide_10_BLAZE1" / "Bid_10_BL305" in Alabama. Your read of the South Meadows portal is exactly right.

**Important correction on pricing:** the list endpoint returns **zero prices for every list at every store** — not one of the 14 lists came back priced. The prices you see in the portal are fetched one product at a time. So "Order Guide is fully priced" is true in the portal, but not something we get from the list call.

## 2. Which list is each store actually pulling?

Matching our cached rows back against each real list:

- Hemet, Palm Desert, Palm Springs, Rowlett — pulling the PFG-managed "Bid" list (their stored ID points at it). Name-matching on "bid" would also have caught these, which is why they never broke.
- Tuscaloosa — pulling `Bid_10_BL305` (138 items) via its stored ID. Its bigger `Order Guide_10_BLAZE1` (166 items) is **not** what the stored ID points to, but 166 of our cached rows do match it, from the older scrape-everything era.
- South Meadows — pulling `Blaze Form` (109) via its stored ID. 196 of our 197 cached rows exist in `Order Guide`; the extra ones are leftovers from the old scrape-everything run, which is where those 80 unpriced rows came from on Sep 1.
- Sparks — same as South Meadows: stored ID points at `Blaze Form` (115), while its `Order Guide` has 185.

## 3. The stored list ID

Still populated at all seven stores, still resolving correctly, and it **is** the primary selector again as of the fix shipped yesterday. The name pattern is now last-resort only, and it shouts in the logs if it ever fires. It was never orphaned — the problem is narrower: at South Meadows and Sparks the stored ID points at the store-built `Blaze Form` instead of the PFG `Order Guide`. That is a data question about those two rows, not a code question.

## 4. A reliable non-name signal — yes

Each list object carries structural fields, no guessing needed:

`ProductListType` (2 = PFG-managed, 3 = store-built, 4 = purchase history), `IsReadOnly`, `IsPrivate`, `IsProductListOwner`, `CanEdit`, `CanDelete`, `CreateUserAlternateKey` (empty on PFG-managed lists, a user ID on store-built ones), `ProductListDetailCount`, `ProductListTitle`, `ProductListHeaderId`.

The clean test for "this is the vendor's own guide" is `ProductListType = 2` combined with `IsReadOnly = true` and no creating user. That held for all seven stores with no exceptions.

## 5. Tuscaloosa's 158 uncategorized but 149 priced

Two separate stories sitting in one table:

- The **149 priced** rows are old (June through mid-September) and came in through the browse screen, which fetches per-product prices but writes no category.
- The **categorized** rows (25 of them, names like `BEVERAGE_06`) came from the list scrape, which writes categories but no prices.

South Meadows looks opposite (197 rows, 1 priced) simply because nobody has browsed its list, so no per-product price fetch ever ran there. That is the whole difference — not a list-selection difference.

## 6. What we'd lose by ingesting only the PFG-managed guide

Counting priced rows that appear in no PFG-managed list at each store:

| Store | Priced rows lost |
|---|---|
| Hemet | 4 |
| Palm Desert | 4 |
| Palm Springs | 5 |
| Rowlett | 3 |
| South Meadows | 1 |
| Sparks | 0 |
| Tuscaloosa | 11 |

28 priced rows total across all seven stores, and every one of them is a stale row no longer in any current list, not something the store-built lists uniquely contribute. Narrowing to the PFG-managed guide costs essentially nothing in real pricing.

## Open item for you

South Meadows and Sparks both point at their store-built `Blaze Form` rather than PFG's `Order Guide` (186 and 185 items). Say the word and I'll repoint those two.
