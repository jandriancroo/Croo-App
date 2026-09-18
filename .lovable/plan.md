# Raw test: PFG's order-entry search endpoint

Tested read-only with South Meadows' live token. Result: the endpoint exists, but it will not return anything outside an active order-in-progress session, so I cannot confirm or rule out pricing on it without starting an order in your PFG account — which I won't do read-only.

## What we already had

Searched the whole codebase first: we call `OrderEntrySearch` **nowhere**. No existing payload to copy, so I probed shapes.

## What the endpoint did

`POST /api/OrderEntrySearch/V1/ProductListOrderEntrySearch`

| Request shape tried | Response |
|---|---|
| Same shape as our working list search (CustomerId, ProductListHeaderId, QueryText, SortByType, IncludeRecipeItems) | **204 No Content**, empty body |
| Same + paging fields | 204, empty |
| Same + IncludePricing / IncludeBidGuide / view-type flags | 204, empty |
| Same + DeliverToCustomerNumber + a zero order-entry ID | 204, empty |
| Same + explicit `OrderEntryHeaderId: null` | **400 — `"Order Entry Search page is not available"`** |

That last message is the tell. The endpoint isn't rejecting our payload — it's telling us there's no order-entry session to search within. In the portal your owner had already clicked "Create new order," which opens that session; the search then runs inside it. Without that session the endpoint answers 204 and nothing else. That's why the shape probing can't get further.

I also checked for a bulk-priced shortcut and found none:

- `ProductListSearch` with `IncludePricing: true` / `IncludePrice: true` — accepted, 186 products, **still 0 priced**. The flags are ignored.
- `ProductPricing/V1/GetProductPricing` — 404
- `ProductListSearch/V1/SearchProductListWithPricing` — 404
- `OrderEntrySearch/V1/OrderEntrySearch` — 404
- `OrderEntry/V1/CreateOrderEntry` — 404

So the owner's read is plausible and probably right about the portal behaviour — but proving it requires opening an order-entry session against South Meadows' real PFG account.

## The decision I need from you

To finish this test I'd have to create an order-entry session in your live PFG account for South Meadows. Best case it's a scratch draft nobody sees; worst case it leaves a stray open order in the portal. Two ways forward:

1. **You do it, I watch.** Open "Create new order" in the portal yourself, filter by Order Guide, and send me the browser's network request for `ProductListOrderEntrySearch` — the full request body and any session ID it carries. Then I can replay it read-only from our side and confirm the prices in one call. Zero risk.
2. **I do it.** I find the create-session call, open a draft for South Meadows, run the search, and report. Faster, but it touches your live PFG account and may leave a draft order behind for someone to delete.

## Where this leaves the fix

Unchanged and still worth doing regardless of how this endpoint turns out:

- **Sort mode `SortByType: 0`** on the list scrape — that alone produces your exact 16 vendor categories with exact counts. Confirmed.
- **Repoint South Meadows and Sparks** to their real Order Guide IDs for full 186-item coverage. Confirmed.
- **Prune stale rows** so the table matches the current guide instead of accumulating every list we ever read.

The pricing question is the only one this endpoint would change: if it does return prices for a whole filtered list in one call, that replaces the 186-calls-per-store idea entirely, and it's the better fix. Tell me which of the two options above you want and I'll settle it.
