# PFG list naming — ground truth from the live portal

Read-only. I called PFG's list endpoint and its list-contents endpoint for all seven stores. Nothing was written; the list-contents endpoint doesn't touch our database.

**This changes the diagnosis, and it corrects two things I told you earlier.** The short version: the numbers we store are PFG's own numbers and are not wrong, and the reason 77 rows have no price is that the routine that actually fetches prices is pointed at the wrong list at exactly two stores — South Meadows and Sparks.

## 1. The real lists, per store

Every store has a **Purchase History** list (a system list with an all-zeros ID, effectively empty) plus the ones below.

| Store | List name | Type | Items |
| --- | --- | --- | --- |
| South Meadows | **Order Guide** | 2 vendor-managed | 186 |
| South Meadows | **Blaze Form** | 3 store-built | 109 |
| Sparks | **Order Guide** | 2 vendor-managed | 185 |
| Sparks | **Blaze Form** | 3 store-built | 115 |
| Hemet | `!! BLAZE PIZZA MONTHLY  AH - Bid 73` | 2 vendor | 181 |
| Hemet | `Proprietary Items 55067468` | 2 vendor | 16 |
| Hemet | `Blaze Hemet` | 3 store-built | 129 |
| Palm Springs | `!! BLAZE PIZZA MONTHLY  AH - Bid 73` | 2 vendor | 181 |
| Palm Springs | `Proprietary Items 56356274` | 2 vendor | 16 |
| Palm Springs | `Blaze Palm Springs` | 3 store-built | 117 |
| Palm Desert | `!! BLAZE PIZZA MONTHLY  AH - Bid 73` | 2 vendor | 181 |
| Palm Desert | `Proprietary Items 56357158` | 2 vendor | 16 |
| Rowlett | `!! BLAZE PIZZA DALLAS - Bid 10` | 2 vendor | 163 |
| Rowlett | `Proprietary Items 56795040` | 2 vendor | 28 |
| Tuscaloosa | `Bid_10_BL305` | 2 vendor | 138 |
| Tuscaloosa | `Order Guide_10_BLAZE1` | 2 vendor | 166 |

The owner is right: the naming vocabulary is completely inconsistent — `Order Guide`, `Blaze Form`, `!! BLAZE PIZZA DALLAS - Bid 10`, `Bid_10_BL305`, `Order Guide_10_BLAZE1`, `Proprietary Items 56795040`, `Blaze Hemet`. Matching on the word "bid" catches Hemet, Palm Springs, Palm Desert, Rowlett and Tuscaloosa, and catches nothing at South Meadows or Sparks.

**Correction to something I said earlier: no list carries prices.** I asked all sixteen lists for their contents and every single one came back with **zero prices** — at every store, vendor-managed and store-built alike. PFG's list endpoint returns products, descriptions, pack sizes and categories, but never a price. Prices only exist on a separate per-product detail call. So "which list is priced" is the wrong question; the right question is which list the price-fetching routine walks. That's question 3, and it's the answer.

## 2. Which list each store is ingesting

We don't record which list a row came from — `pfg_bid_items` has no origin column — so this is reconstructed by matching stored numbers back against each live list.

- **Five stores** (Hemet, Palm Springs, Palm Desert, Rowlett, Tuscaloosa) have a "bid"-named list, so the name filter matched and only that list was scraped.
- **Tuscaloosa** matched only `Bid_10_BL305` (138 items) and never touched `Order Guide_10_BLAZE1` (166 items), because the second list has no "bid" in the name.
- **South Meadows and Sparks** matched nothing, so the fallback scraped **everything** — Order Guide plus Blaze Form plus Purchase History, merged with no marker.

The good Aug 23 South Meadows batch came from the **Order Guide**, and it was priced because the deploy-time browse path fetched per-product detail for it. The Sep 1 batch came from the nightly master scrape, which never fetches detail — that's why it's unpriced, not because the list itself lacks prices.

## 3. The stored header ID — populated, still used, and wrong at two stores

`product_list_header_id` is populated for all seven stores and is **still actively used** by two routines: the scheduled price sync and the vendor gap scan. Both call the browse action with it, and the browse action is the only thing in the system that fetches actual prices. So the stored ID decides which items ever get priced.

| Store | Stored ID points at | Type |
| --- | --- | --- |
| Hemet | `!! BLAZE PIZZA MONTHLY  AH - Bid 73` | vendor ✓ |
| Palm Springs | `!! BLAZE PIZZA MONTHLY  AH - Bid 73` | vendor ✓ |
| Palm Desert | `!! BLAZE PIZZA MONTHLY  AH - Bid 73` | vendor ✓ |
| Rowlett | `!! BLAZE PIZZA DALLAS - Bid 10` | vendor ✓ |
| Tuscaloosa | `Bid_10_BL305` | vendor ✓ |
| **South Meadows** | **Blaze Form** (109 items) | **store-built ✗** |
| **Sparks** | **Blaze Form** (115 items) | **store-built ✗** |

And this lines up perfectly with the missing prices at South Meadows:

- 130 priced rows — **119 of them are on Blaze Form**
- 77 unpriced rows — **0 of them are on Blaze Form**

Not approximately. Exactly zero. The 77 unpriced items are Order-Guide-only products, and the only routine that fetches prices has never been pointed at the Order Guide for this store. It is not an item-number problem and never was.

The header ID was not orphaned by the Sep 1 change — the *scrape* stopped using it while the *price fetch* kept using it. So we now have two routines disagreeing about which list matters. And you're right that it's the more durable selector: it's a stable GUID, it's populated everywhere, and it's correct at five of seven stores. It just needs to point at the vendor-managed list, and at two stores it doesn't.

## 4. There is a reliable structural signal — three of them

PFG's list objects expose exactly what you were hoping for. Available fields: `ProductListHeaderId`, `ProductListTitle`, `ProductListType`, `CreateUserAlternateKey`, `IsPrivate`, `IsReadOnly`, `IsNotificationsDisabled`, `CanShare`, `CanCopy`, `CanEdit`, `CanDelete`, `CanManageNotification`, `HasCustomCategorySequence`, `IsProductListOwner`, `ProductListDetailCount`.

The vendor/customer distinction is unambiguous and consistent across all seven stores:

| Signal | Vendor-managed | Store-built | Purchase History |
| --- | --- | --- | --- |
| `ProductListType` | **2** | **3** | **4** |
| `IsReadOnly` | true | false | true |
| `CanEdit` / `CanDelete` | false | true | false |
| `CreateUserAlternateKey` | empty | a user's ID | `"System"` |
| `IsProductListOwner` | false | true (mostly) | false |

`ProductListType == 2` is the signal. It holds at every store with no exceptions, it's a number rather than a typed string, and it correctly identifies both `Order Guide` and `Bid_10_BL305` and correctly excludes `Blaze Form` and `Blaze Hemet`. `ProductListDetailCount` is unreliable — it reads 0 for most lists even when the list has 186 items.

One nuance for whatever we design: type 2 includes the small `Proprietary Items` lists (16–28 items each), which are real vendor lists, not noise. "Vendor-managed" is not always a single list.

## 5. Tuscaloosa

Tuscaloosa's fallback never fired — it matched `Bid_10_BL305` by name and scraped only that. Its 149 priced rows come from the scheduled price sync walking that same list, which is the correct vendor list, so pricing works there. The 158 "uncategorized" rows are a separate cosmetic issue: its lists use shouty vendor category names (`BEVERAGE`, `CHEMICALS & CLEANING`, `GROCERY DRY`) rather than the friendly ones South Meadows gets (`Cheese & Dairy`, `Bakery, Frozen`), and the uncategorized label comes from rows whose category didn't survive. Category has nothing to do with price here.

Its real gap is the opposite of South Meadows': it ignores `Order Guide_10_BLAZE1` entirely, 166 items, because of the name filter.

## 6. What we'd lose by ingesting only the vendor-managed lists

Measured against the live lists — priced rows we currently hold, and whether each is on a vendor list today:

| Store | Priced rows | On a vendor list | Only on the store-built list | On no current list |
| --- | --- | --- | --- | --- |
| Palm Springs | 186 | 181 | **0** | 5 |
| Palm Desert | 185 | 181 | **0** | 4 |
| Hemet | 185 | 181 | **0** | 4 |
| Rowlett | 166 | 163 | **0** | 3 |
| Tuscaloosa | 149 | 138 | **0** | 11 |
| Sparks | 135 | 125 | **0** | 10 |
| South Meadows | 130 | 119 | **0** | 11 |

**The store-built lists contribute nothing unique — zero rows at all seven stores.** Every product on `Blaze Form` / `Blaze Hemet` / `Blaze Palm Springs` is also on that store's vendor list; they're curated subsets. Narrowing to vendor-managed lists would lose no priced data.

The 3–11 rows per store on no current list are the ones to be careful about — items that have dropped off the guide but still have a price we captured. Those are the ship-ins and discontinued-but-still-on-the-shelf cases, and they'd need to be kept rather than pruned.

## Plain summary

1. The list endpoint gives us **no prices at all**, at any store. Prices come only from a separate per-product call.
2. That per-product call is driven by the **stored list ID**, which at South Meadows and Sparks points at the store's own hand-built list instead of PFG's Order Guide.
3. Therefore the 77 unpriced South Meadows rows are precisely the products that are on the Order Guide but not on Blaze Form — 0 of 77 are on the list we price from. That's the whole cause.
4. **The item numbers we store are PFG's own.** PFG's API returns `18705` for Diet Coke 24/20 oz, `259393` for the glass cleaner, `243526` for the stainless polish, `1039457` for the register rolls — exactly what we hold. The `H0622` / `EA940` codes on the printed export are a second namespace PFG doesn't return here. One item even exposes both (`261442` with an alternate `CN127`). So there is no wrong-column bug in the bid guide, and my earlier "wrong list, wrong numbers" framing was half wrong — the list part stands, the numbers part does not.
5. `ProductListType == 2` is a solid structural replacement for the name pattern.

No fix proposed, per your instruction.
