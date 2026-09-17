# Why 77 South Meadows bid guide rows have no price

Read-only. Nothing changed. Your core conclusion is right — **these items are priced at PFG and we're holding numbers that don't exist at this store's division.** But the mechanism isn't a wrong-column bug in the bid guide writer, and the category correlation isn't exact. Here's what the data actually says.

## The mechanism: two different PFG lists in one table

There is exactly **one** routine that writes `pfg_bid_items`, and it stores one identifier: PFG's `DisplayProductNumber` (falling back to `ProductNumber`, then the product key). It always writes the category name PFG gives it and always writes the price PFG gives it. It is not picking a different field on different rows.

What it *does* do is this: it asks PFG for the store's product lists, keeps only lists with **"bid"** in the name — and **if no list matches, it scrapes every list PFG offers and dumps them all into the same table with no marker of which list a row came from.**

South Meadows has no "bid"-named list. So it got everything. And the arrival dates prove it:

| First appeared | Rows | Priced | Uncategorized |
| --- | --- | --- | --- |
| **Aug 23** | 116 | **116 (100%)** | 8 |
| Aug 25 | 1 | 1 | 1 |
| **Sep 1** | 80 | **3 (4%)** | 79 |

Two clean populations, two different days, two different PFG lists. The Aug 23 batch is the real PFG-managed Order Guide — fully priced, properly categorized (Dough, Sauce, Cheese, Chemicals, Paper, Drinks…). The Sep 1 batch is a second list that carries no prices and whose own category label at PFG is literally "Uncategorized."

**All 17 of your example items were created on Sep 1** and are still being refreshed nightly (last seen Sep 17), which is why they stay inside the 30-day freshness window and keep looking like live unpriced products.

Sep 1 is also when the vendor sync was consolidated into one nightly pipeline, and the master walk was deliberately changed to pick the PFG list "by name pattern, not a stored header ID; falls back to the widest list if no bid-named list exists." That change is dated and documented. This is its side effect at the two stores with no bid-named list.

## Two corrections to the framing

**1. The category correlation is not exact.** Uncategorized at South Meadows is 88 rows: **77 unpriced and 11 priced**. So all unpriced rows are Uncategorized, but Uncategorized also contains priced rows. Category is a symptom of the list, not of the price.

**2. Numeric vs letter-prefixed does not separate the populations.** We *do* hold letter-prefixed PFG codes — 59 at South Meadows, 33 at Sparks, and **zero at all five other stores**. Brand-wide:

| Number style | Rows | Priced | Unpriced |
| --- | --- | --- | --- |
| numeric only | 1,197 | 1,053 (88%) | 144 |
| letter-prefixed | 92 | 63 (68%) | 29 |

Inside South Meadows' bad Sep 1 batch: 49 numeric and 31 letter-prefixed. Both styles fail together, because both came from the same wrong list.

**What is exactly true, and it's the important part:** none of the 20 real PFG codes from the owner's export — H0622, F7726, EA940, EC628, NN172, FT250, AND44, CN126, J0526, D0994 and the rest — exists **anywhere** in our system. Not in `pfg_bid_items` at any store, and not in the brand's vendor number registry (`brand_vendor_mappings`), which holds 335 PFG numbers, 312 of them numeric. For your ten example products the registry holds only the numeric number. So we have never captured this division's numbers for these products.

We also found a related sloppiness worth noting: some rows store **two numbers jammed into one field** as a literal value — `"038540, B9883"`, `"104752, EL681"`, `"HEC24000, A6847"`. There's a splitter function that's supposed to separate those, and it's applied on the read path but these rows landed unsplit. That's a second, smaller identifier defect in the same table.

## Sync paths writing `pfg_bid_items`

Only **one** writer exists: `upsertPfgBidItems`, reached solely through the `scrape_bid_all_locations` action, which the nightly pipeline calls as its PFG master stage. It stores `item_number` = `DisplayProductNumber`, plus description, pack size, category, brand and price.

Six other routines read the table (price chase, SKU health, pack seeder, pack-selection backfill, invoice hints, pack approvals). None write. So there is no competing importer and no brand-master or Blaze-Form import writing rows — the second population came from PFG itself, via a second PFG list.

## The Produce Alliance precedent — and yes, PFG never got the same treatment

You remembered correctly. The PA price path deliberately indexes each product under **every** identifier it might be known by: `item_code`, `master_product_code`, `pa_product_id`, `pa_item_id`. Its comment says so explicitly — one product, several identifiers, match on any of them. The PA catalog table also carries four separate identifier columns for the same reason.

**The PFG path has none of that.** It reads exactly one column, `item_number`, builds a single-key lookup, and matches or fails.

And the loose end I flagged earlier is the same problem seen from the other side: PA's three namespaces (item `16901`, catalog `10176`, order line `00447`) only price correctly because of the multi-key index plus description matching. The repair is real but partial — it papers over the namespaces rather than reconciling them.

## Blast radius

| Store | Bid rows | Priced | Uncategorized | Letter-prefixed | First seen |
| --- | --- | --- | --- | --- | --- |
| Palm Desert | 201 | 185 | 0 | 0 | Jun 8 |
| Hemet | 200 | 185 | 0 | 0 | Jun 8 |
| Palm Springs | 199 | 186 | 0 | 0 | Jun 8 |
| **South Meadows** | 197 | 120 | **88** | 59 | Aug 23 |
| **Tuscaloosa** | 184 | 149 | **158** | 0 | Jun 8 |
| Rowlett | 183 | 166 | 0 | 0 | Jun 8 |
| **Sparks** | 125 | 125 | 3 | 33 | Aug 23 |

Tuscaloosa is worth a second look: 158 of 184 rows are Uncategorized yet 149 are priced. Its rows also came from a non-bid-named list, but that list carried prices. So the "scrape every list" fallback isn't automatically fatal — it's fatal when one of the extra lists is unpriced.

Items currently without a cost, brand-wide: South Meadows 81, Tuscaloosa 37, Rowlett 25, Hemet 17, Palm Springs 5, Palm Desert 5, plus 27 in the two sandboxes. South Meadows is the clear outlier and the only store where the unpriced count traces to this.

## Are the wrong numbers on our inventory items too? Yes — worse than that

**Every inventory item in the entire system carries a numeric-only item number. Zero letter-prefixed numbers exist on `inventory_items` at any store, including South Meadows and Sparks.**

At South Meadows: 189 items with a number, all numeric. 87 of them find a matching bid guide row; 73 find one with a price. Which means the 59 letter-prefixed bid rows we *do* hold — including priced ones like `ALV92` Blaze white sauce at $78.08 and `HHW66` spicy Blaze sauce at $35 — **can never match a single inventory item**, because no item carries a code in that format.

So fixing the bid guide alone would not fix pricing here. The numbers on the items themselves came from the brand catalog, which was populated from the Southern California division, and they don't exist at PFS Northern Cal.

## What the evidence supports

1. **Wrong list, not wrong column.** One writer, one identifier field. The bad rows are a second PFG product list pulled in by a "scrape every list if none is named bid" fallback, which started at South Meadows on Sep 1. The Aug 23 order-guide scrape was 100% priced.
2. **This store's real PFG numbers have never been in our system** — not on the bid guide, not in the brand number registry. The numbers we hold are another division's.
3. **Single-key matching on the PFG side is the structural gap.** Produce Alliance was given multi-identifier matching; PFG was not. One product legitimately has several PFG numbers (some rows literally store two in one field), and our lookup can only hold one.
4. **The category field is a tell, not a cause** — it identifies which list a row came from. Useful as a signal, not as the diagnosis.
5. **The unpriced tag is honest here.** These items genuinely have no price *under the numbers we hold*. The tag is telling the truth about our data, not about PFG's.

No fix proposed, per your instruction.
