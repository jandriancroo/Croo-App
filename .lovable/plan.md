# Raw PFG evidence: the list endpoint carries no pricing at all

Called PFG's real list endpoint directly for both South Meadows lists with the store's live token. Nothing was changed. Three findings, one of which is bigger than the question you asked.

## 1. Neither list returns prices — this is PFG, not our parsing

Raw response for a Blaze Form item (unmodified, this is the entire price-bearing block PFG sends):

```json
{
  "UnitOfMeasure": 0,
  "Quantity": 0,
  "Price": 0,
  "ExtendedPrice": 0,
  "SecondaryUnitPrice": null,
  "ProductLastPurchaseDate": "2026-09-11T00:00:00Z",
  "ProductLastPurchaseAmount": 1,
  "PackSize": "1/540Cnt",
  "ProductNumberDisplay": "BBD40",
  "UnitOfMeasureAbbreviation": "CS",
  "ViewedPrice": null
}
```

`Price: 0`, `ExtendedPrice: 0`, `SecondaryUnitPrice: null`, `ViewedPrice: null`. The product object itself carries no price field at all — the only money-shaped key on it is `ProductLastPurchaseAmount`, which is a **quantity** (1, 2), not a dollar figure.

Counts across all four calls: Blaze Form 109 products, **0 with any price**. Order Guide 186 products, **0 with any price**. Same shape, same field names, same zeros. There is no hidden or renamed price field — the field our code reads (`Price`, falling back to `UnitPrice`/`ListPrice`) is present and genuinely zero.

So: **PFG does not send prices on the list endpoint, for either list.** Repointing to Order Guide will not produce prices on its own. That part of the theory is wrong.

Prices do exist, one product at a time. Calling the product-detail endpoint on four Order Guide items just now:

| Item | Description | Price |
|---|---|---|
| 597098 | Cauliflower crust | $63.45 |
| BGE40 | Brookie bar | $37.55 |
| BJT16 | Lemon bar | $63.21 |
| 214134 | Meatball 2 oz | $158.23 |

That's 186 separate calls to price a store's guide. Our code already does this on the browse screen, one item at a time as staff look at things — which is exactly why Hemet and Palm Springs are 185-of-200 priced (people browse them) and South Meadows is 1-of-197 (nobody has).

## 2. Bigger find: your 16 categories are a sort-mode setting, and we're using the wrong one

The same endpoint returns completely different category structures depending on one request field, `SortByType`. Our sync sends `5`. Your export is `0`:

| List | `SortByType: 5` (what we send) | `SortByType: 0` |
|---|---|---|
| Blaze Form | 11 categories, big Uncategorized bucket | **your exact 16 vendor categories** |
| Order Guide | **1 category: everything Uncategorized** | **your exact 16 vendor categories** |

With `SortByType: 0`, Order Guide comes back as: Bakery Frozen 3, Beef 2, Beverage 29, Canned & Frozen Fruit & Veg 8, Cheese & Dairy 12, Chemicals 15, Commodity Grocery 21, Deli Sliced Meats 1, Disposables 48, Dry Grocery 19, E&S 14, Fzn Prepared 4, Imports 2, Pork 5, Poultry 1, Produce 2 — 186 items. Character-for-character your list, count-for-count.

This explains Tuscaloosa's uncategorized flood, and it means that if we had repointed South Meadows to Order Guide without touching the sort mode, all 186 rows would have come in Uncategorized — worse, not better.

## 3. What that means for the three-part fix

- **List selection (fix #2) works as built** and is reading the stored ID. The stored ID points at Blaze Form, so we get 109/119 items instead of 186. Still worth repointing — but for coverage, not pricing.
- The 88 Uncategorized rows are two separate causes: 78 stale leftovers from the old scrape-everything era that nothing prunes, and 10 from the wrong sort mode.
- Pricing at South Meadows was never going to come from the list sync at all.

## Recommended next steps (not doing any of it yet)

1. **Change the sort mode to `SortByType: 0`** on the list scrape. One field. It's what produces the real vendor categories on every list at every store.
2. **Repoint South Meadows and Sparks** to their real Order Guide IDs (South Meadows `5bda5ec0…`, Sparks `756af714…`) for the full 186-item coverage.
3. **Prune stale rows** after a successful sync so the table matches the current guide instead of accumulating history.
4. **Decide on pricing separately.** A weekly per-product price job (~186 calls per store) is the only way to get a fully priced guide without waiting for someone to browse it. That's a scheduled-job decision, not a parsing fix.

Tell me which of these you want and I'll build them.
