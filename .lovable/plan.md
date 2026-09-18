# Bulk PFG pricing: confirmed working, no order session needed

Your captured body was the missing key — but not for the reason we both expected. Tested read-only with South Meadows' live token just now.

## 1. The replay worked — and the session ID is irrelevant

Replayed your exact body: **200, 3 of 3 priced**, matching your screenshot to the cent ($32.50, $41.58, $11.01). Then swapped in the real Order Guide keys:

| Test | Result |
|---|---|
| Your captured body, your 3 keys | 3 returned, **3 priced** |
| Same body, 16 Order Guide keys | 16 returned, **16 priced** |
| Same body, **all 186** Order Guide keys | **186 returned, 186 priced — one call** |
| `OrderEntryHeaderId` field **removed entirely** | 16 returned, **16 priced** |
| `OrderEntryHeaderId: null` | 16 priced |
| All-zeros GUID | 16 priced |
| Made-up random GUID | 16 priced |

The order-entry session ID does nothing. It is not validated at all. My earlier theory that this endpoint is session-scoped was **wrong** — the only thing wrong with my guesses was the field name `CustomerProductPriceRequests`, exactly as you said.

## 2. What is actually required — I stripped it field by field

| Field removed | Still priced? |
|---|---|
| `DeliveryDate` | **NO — returns empty.** Required. |
| `BusinessUnitKey` | Yes, works without it |
| `OperationCompanyNumber` | Yes, works without it |
| `IgnoreRetry` | Yes |
| `OrderEntryDetailId` / `LastViewedPrice` per item | Yes |
| `OrderEntryHeaderId` | Yes |

So the whole recipe is: `CustomerId`, `DeliveryDate` (any date — past, today, or future all work), and `CustomerProductPriceRequests: [{ProductKey, UnitOfMeasureType: 0}]`. That's it. Wrong-but-present business-unit values (`99` / `"0000"`) also priced fine, confirming those two fields are decorative here.

Prices cross-check exactly against the per-item detail call: 597098 $63.45, BGE40 $37.55, BJT16 $63.21, 214134 $158.23 — identical both ways. Keys match the list endpoint's `ProductKey` one-to-one (case differs — response lowercases them, so matching must be case-insensitive), so we can write these straight onto the right rows.

## 3. No throwaway draft orders needed

Question 3 is moot — nothing gets created, nothing is submitted, no draft appears for store staff. It's a plain read. That whole risk category disappears.

## 4. Business unit / operation company — already in our data

They aren't needed for this call, but you asked whether they're knowable, and they are. Every store's own values are already sitting in our stored order records:

| Store | BusinessUnitKey | OperationCompanyNumber |
|---|---|---|
| Hemet | 0 | 428 |
| Palm Desert | 0 | 428 |
| Palm Springs | 0 | 428 |
| Rowlett | 0 | 412 |
| South Meadows | **3** | **3425** |
| Tuscaloosa | 10 | 770 |
| Sparks | — (no orders stored yet) | — |

South Meadows reads 3 / 3425 — exactly your captured values. So **division is knowable and stable** after all: PFG stamps it on every order header, consistent across every order per store, and the CA stores share 0/428 while Reno is 3/3425 and Tuscaloosa 10/770. That's the real explanation for the "wrong-division item numbers" on those 102 dead South Meadows items. Worth revisiting the earlier decision not to model division — the evidence supports it now, though it's a separate piece of work.

## Straight recommendation

**Build the bulk call. It isn't close.**

| | Bulk call | Per-item detail |
|---|---|---|
| Calls per store | **1** | 186 |
| Calls for 7 stores | **7** | ~1,300 |
| Runtime | seconds | many minutes, rate-limit exposure |
| Side effects | none | none |
| Prices returned | 186/186 | 186/186 |
| Extra data | none | pack size, unit |

Same prices, same source, 186× fewer calls, no order-session dependency. The only thing the detail call gives that this doesn't is pack size and unit — and we already get pack size from the list endpoint.

One honest caveat: this is an undocumented internal portal endpoint. PFG could change the field names without warning. So the sync should treat an empty `CustomerProductPrices` array as a loud failure (log it, keep the previous prices) rather than silently writing zeros — same hard-failure discipline we added to the order-detail fix. And keeping the per-item detail call as a fallback path costs nothing since it already exists.

## What I'd build, in order

1. **Bulk price fetch** in the list sync: after pulling the list, one pricing call with all product keys, write `unit_price` onto the matching rows (case-insensitive key match). Loud error if the array comes back empty.
2. **`SortByType: 0`** on the list pull — gives your exact 16 vendor categories with exact counts.
3. **Repoint South Meadows and Sparks** to their real Order Guide IDs (186 and 185 items) instead of the store-built Blaze Form.
4. **Prune stale rows** after a successful sync so old scrape leftovers stop accumulating.
5. Optional, separate: store BusinessUnitKey / OperationCompanyNumber per location and reopen the division question.

Say go and I'll build 1 through 4.
