# Is the PFG code the same for every store?

**Yes — one shared integration, no store-specific branches.** Every store runs the identical code and only the account details differ (token, customer ID, list ID). Details below, plus the two wrinkles worth knowing.

## 1. The list call

There is one endpoint, `ProductListSearch/V1/SearchProductList`, and no location logic anywhere near it. Nothing looks at which store it is. The only inputs that change per store are the token, the customer ID, and the stored list ID.

It is called from **three places in the same file**, and this is a per-feature difference, not a per-store one:

- the general product search (used by the browse screen)
- the nightly list/bid-guide scrape — this is the one sending `SortByType: 5`, the mode that collapses everything into "Uncategorized"
- the mapped-search path, which **already sends `SortByType: 0`** — the good mode

So the sort-mode fix is a one-line change in one of three call sites, and one of the other two is already proof the good mode works.

## 2. Order fetching

Also one shared path. Orders are pulled through the same sequence for all seven stores (deliveries first, then submitted orders), and line-item detail goes through a single function. No store is treated specially.

## 3. Where bulk pricing would go

A single place: right after the list scrape, in that same shared function. One change, all seven stores, no per-store variants.

## 4. Anything special-casing a store?

No "if South Meadows" or "if Northern Cal" logic exists. What does exist is **division-shaped, not store-shaped**, in two spots:

- **A default division number of `428`** used when PFG's own data doesn't carry one. 428 is the California division, so this default quietly favours the CA stores; for Reno and Tuscaloosa it's only a fallback that in practice gets overridden by the real value on the order. Worth cleaning up, not urgent.
- **Order-identifier format handling.** Comments in the code note that divisions format their order keys differently, which is exactly the bug we already fixed by using PFG's own key instead of rebuilding one.

Nothing else keys off a store, division, or customer ID.

## Bottom line for your decision

A fix to "the endpoint" applies to all seven stores identically. The reason the stores look so different today is **not** the code — it's their stored data: South Meadows and Sparks point at a franchisee-built list instead of PFG's Order Guide, and some stores have had their prices filled in by people browsing while others haven't. Same engine, different settings.

The one caveat that stands: the bulk pricing call is proven on South Meadows' account only. Since the code path is shared, if it works for one store it will work for all — but confirming it per store needs live tokens, which is the build-mode question still on your desk.
