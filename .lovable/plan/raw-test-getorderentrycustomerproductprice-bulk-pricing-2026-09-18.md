# Raw test: `GetOrderEntryCustomerProductPrice` (bulk pricing)

Tested read-only with South Meadows' live token. Good news and a blocker.

## The route exists and answers us

Found the real path by probing — it is **not** under `OrderEntry`:

```
POST /api/CustomerProductPrice/V1/GetOrderEntryCustomerProductPrice
```

Every other prefix (`/OrderEntry/V1/…`, `/OrderEntrySearch/V1/…`, `/Order/V1/…`, `/Pricing/V1/…`) returns 404. That one returns **200, `IsSuccess: true`**, with exactly the envelope from your screenshot:

```json
{"ResultObject":{"CustomerProductPrices":[],"UpdatedTotals":false},
 "IsSuccess":true,"ErrorMessages":[],"InformationMessages":[],"SupportMessages":[]}
```

Note `UpdatedTotals` — this call belongs to an order screen that recalculates a running total, which is consistent with it needing an order context.

## The blocker: it returns an empty price list for every payload we can guess

I pulled the real 186 Order Guide `ProductKey` values from the list endpoint first (they are GUID-style, e.g. `9712B4EE-A99C-4332-BE58-0AA8B84BC3B0` — same shape as the keys in your screenshot, so that cross-check holds), then tried ten body shapes with the first three keys:

| Body shape | Result |
|---|---|
| `Products: [{ProductKey, UnitOfMeasureType}]` | 200, **0 prices** |
| `CustomerProductPrices: [{ProductKey, UnitOfMeasureType}]` | 200, 0 prices |
| `ProductPriceRequests: [...]` | 200, 0 prices |
| `OrderEntryDetails: [...]` | 200, 0 prices |
| `ProductKeys: [...]` + `ProductListHeaderId` | 200, 0 prices |
| `ProductListHeaderId` only | 200, 0 prices |
| lowercase `productKeys` | 200, 0 prices |
| `Requests: [...]` | 200, 0 prices |
| `ProductKeys` as comma string | 200, 0 prices |
| `Products` with `Quantity: 1` | 200, 0 prices |

Identical empty answer every time — it never complains about our fields, it just has nothing to price. That pattern says the product set comes from **server-side order state**, not from our request body. Same story as `ProductListOrderEntrySearch`, which told us outright: *"Order Entry Search page is not available."*

I also looked for a read-only way into that state and found nothing: `GetActiveOrder` 404s under every prefix I tried, as does `GetProductListOrderEntrySort`. `Order/V1/GetOrder` exists but rejects the method shape I tried.

## Plain answer to your question 4

**Not proven usable standalone, and the evidence leans toward it needing an order in progress.** But the failure mode is ambiguous: an empty array could equally mean "your body field name is wrong and I silently ignored it." I can't tell those apart by guessing, and I've exhausted the reasonable guesses.

## The one thing that settles it

Your owner already had the winning call open in the Network tab. From that same screenshot's request side, I need for `GetOrderEntryCustomerProductPrice`:

1. The **full request URL** (confirms the prefix).
2. The **complete request payload** — the raw JSON body, all fields, including anything order- or session-shaped (`OrderHeaderId`, `OrderKey`, `OrderEntryHeaderId`, `BusinessUnitERPKey`, `DeliveryDate`).
3. The **request headers** other than the auth token — any custom `X-…` header the portal adds.

With the real payload I can replay it read-only in one call and tell you within minutes whether all 186 come back priced, and whether it works with no order open. Right/wrong field name is a two-second question with the actual body in hand.

## Meanwhile, unchanged and already proven

- `SortByType: 0` on the list scrape produces your exact 16 vendor categories, exact counts. Confirmed.
- Repointing South Meadows and Sparks to the real Order Guide gets full 186-item coverage. Confirmed.
- Pruning stale rows clears the Uncategorized backlog.
- Product-detail calls do return real prices ($63.45, $37.55, $63.21, $158.23) — 186 calls per store. That stays the fallback if this bulk call turns out to need an open order.

Send me that request payload and I'll close this out.
