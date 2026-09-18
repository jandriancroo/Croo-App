# Tuscaloosa unpriced items — match analysis (read-only findings)

Headline: the item-number mismatch is **not** the main story at Tuscaloosa. Only **3 of the 49** unpriced items have a believable replacement on that store's guide. The rest are either not carried by that division at all or aren't PFG items in the first place.

## 1. What the 49 actually are

| Group | Count | Meaning |
|---|---|---|
| Carries a number used by the SoCal stores, not on Tuscaloosa's guide | 31 | the "mismatch" class |
| Carries a number that exists on no store's guide | 3 | (NEW) Plastic Spoons, Broom Head Replacement, Pellegrino Glass Bottle 500ml |
| No PFG number at all | 15 | 7 Heimark beers, 2 dough balls, Prepped Dough, Chopped Romaine Hearts, Classic Red Sauce (Prepped), Romaine Lettuce (Bag), Pineapple Tidbits (Produce Alliance), Water |

Hard ceiling on what linking can fix: Tuscaloosa's guide has 138 rows and **120 of them are already claimed** by an existing item. Only **18 rows are unclaimed** — that is the entire pool any of the 34 numbered items could be matched into. 49 cannot become 49 no matter how good the matching is.

## 2. Method

Matching our friendly names ("Coke Zero BIB 5g") against vendor descriptions ("SODA SYRUP COLA ZERO SUGAR BAG-IN-BOX") scores badly and produces garbage. Instead I matched **vendor description to vendor description**: take the description PFG itself gives our SoCal number at the other stores, and compare that to Tuscaloosa's descriptions — same vocabulary both sides. Scoring is `pg_trgm similarity` blended 50/50 with the token-overlap score the invoice matcher already uses, plus a normalized pack-size equality check.

## 3. High confidence — 3

| Our item | Our number (SoCal) | SoCal description / pack / price | Tuscaloosa row | Pack | Tusc price |
|---|---|---|---|---|---|
| Equal Sweetener Packets | 27553 | SWEETENER BLUE PACKET W/ASPARTAME · 2000/1 GM · $31.26 | SUGAR SUB BLUE PACKET W/ASPARTAME **#336787** | 2000/1 GM (same) | **$31.26** |
| Forks | 705219 | FORK PLASTIC HEAVY_WEIGHT BLACK POLYSTYRENE · 1/1000 CT · $25.00 | FORK PLASTIC POLYPROPYLENE EXTRA_HEAVY_WEIGHT BLACK **#708856** | 1/1000 CT (same) | $33.46 |
| Knives | 707270 | KNIFE PLASTIC HEAVY_WEIGHT BLACK POLYSTYRENE · 1/1000 CT · $25.99 | KNIFE PLASTIC HEAVY_WEIGHT BLACK POLYPROPYLENE INDIVIDUALLY_WRAPPED **#806199** | 1/1000 CT (same) | $30.38 |

Cross-check (item 3 of your list): Equal Sweetener is exact — identical pack, identical price to the cent at all four SoCal stores. Forks and Knives are the same count and use but a **different resin and spec** (polypropylene extra-heavy / individually wrapped vs polystyrene heavy). Prices land +34% and +17% over SoCal — plausible for an upgraded spec, not a red flag, but they are substitutes, not the same SKU. Flagging them as "approve, don't auto-link".

## 4. Ambiguous — 4

| Our item | Competing Tuscaloosa rows | Why it's unresolved |
|---|---|---|
| Small Gloves (#563906, GLOVE POLY SMALL, 10/100 CT, $17.51) | GLOVE HYBRID STRETCH MEDIUM #609025 / LARGE #608998 / EXTRA_LARGE #609006 — all 10/100 CT, all $17.51 | Guide carries M/L/XL only, no Small; all three already claimed by other items. Linking Small to a bigger size is a size substitution decision, not a match. |
| Pellegrino Glass Bottle 500ml (number on no guide) | WATER SPARKLING MINERAL PLASTIC #497409 · 24/500 ML · $25.40 | Right water, right volume, **plastic not glass**. |
| Pink Cleaning Towels (#66140, WIPE FABRIC PINK/WHITE 13X24, 1/200 CT, $21.55) | WIPE MEDIUM WITH-TRACKING RED 13X21 #243695 · 1/150 CT · $36.02 | Different colour, different count, 67% higher. |
| Dispenser Sani Wipes (#585164, DISPENSER WIPES TRIPLE TAKE RED, 1/1 CT, $14.05) | DISPENSER TOWEL ELEVATION MATIC H1 #363719 · 1/1 CT · $20.05 | Pack matches but it's a paper-towel dispenser, not a wipes dispenser. Likely a false friend. |

## 5. No match — 42, and why

Nothing on Tuscaloosa's 138-row guide resembles these. My read, by cause:

- **Not carried by that division (25 items).** All 7 fountain syrups (Coke Zero, Cherry Coke, Dr Pepper, Fanta, Barq's, Powerade, plus BIB siblings) — Tuscaloosa's guide has **zero** bag-in-box syrup rows, so soda concentrate is bought outside PFG there. Same for the whole ecolab-style chemical program (Glass Cleaner concentrate, Peroxide Disinfectant, Enzyme Drain Cleaner, Hand Soap/Foaming Soap/Sanitizer cartridges, Multi-Surface canister wipes) — Tuscaloosa's 16 chemical rows are a different lineup (EZ SNAP quat/chlorine, quarry-tile cleaner). Also Salami, Sugar Packets (granulated), Wax Paper, Toilet Seat Covers, Handle Replacement, Broom Head, 1" deli hot labels, orange sealed-hot labels, 24oz Coke cups, Entree Salad Container (Tuscaloosa carries a different hinged size), Chipotle Sauce, Fruit/Veggie wash strips, Orange Pellegrino.
- **Not PFG at all (15 items).** 7 Heimark beers (Bud Light, Michelob Ultra, Stella, Estrella, Firestone, Lagunitas, Coachella Valley) — beer distributor, invoice-priced. Prepped/recipe items (Chopped Romaine Hearts, Classic Red Sauce, Prepped Dough, 17oz and 6.8oz Dough Balls) — cost out from ingredients, should never chase a vendor price. Produce Alliance items (Pineapple Tidbits, Romaine Lettuce bag). Water.
- **Genuinely unknown (2).** (NEW) Plastic Spoons #1002342 and Pellegrino Glass 500ml — numbers that appear on no store's guide, so we can't even confirm what they are.

## 6. Does the plumbing work? Yes — traced

`_shared/vendorPriceChase.ts`:
- `loadApprovedNumbers` reads `brand_inventory_templates.item_number/pa_item_id` **plus every `brand_vendor_mappings` row** for that template and unions them into one set of approved PFG numbers.
- `numbersForItem` adds the local item's own number to that set.
- Stage A loads `pfg_bid_items` **filtered to the location being chased** and takes the first number in the set that has a price.

So creating a `brand_vendor_mappings` row with Tuscaloosa's number does feed pricing: the chase will find #336787 on Tuscaloosa's guide, write $31.26, and (in sweep mode) activate. No code change needed.

**Same brand item, two numbers — no collision.** The table's unique key is `(brand_template_id, vendor, vendor_item_id)`, so multiple numbers per brand item are legal by design, and the table already carries `territory` and `source_location_id` columns for exactly this. Because Stage A is location-scoped, a Tuscaloosa-only number can never price a SoCal item — verified: #336787, #708856 and #806199 exist on **no other store's guide**, so nothing can cross-contaminate. Recommendation: still stamp `source_location_id` = Tuscaloosa and `territory` on any new rows so the origin is auditable.

## 7. Expected outcome

- Link the 3 high-confidence matches → **3 of 49** priced and activated. 46 still unpriced.
- Approve all 4 ambiguous ones too → at most **7 of 49**.
- 15 of the remainder should never have a PFG price (beer, prepped recipes, produce, water) — the honest fix for those is a non-PFG cost source, not a mapping.
- That leaves ~27 items that are active at Tuscaloosa but appear not to be bought there at all. The real question is whether they should be active in that store's count at all.

## 8. Flags worth your call before anything gets built

- Tuscaloosa's guide is 138 rows vs ~200 in SoCal, and 12 categories vs 16. Before we mass-map, worth confirming this really is the store's full order guide.
- Tuscaloosa's PFG order history (37 orders, May 5 – Sep 15) contains **80 distinct item numbers, 12 of which are not on the guide, and 7 of which match no item we have**. Order history is stronger ground truth than the guide for "what this store actually buys" — a second pass matching against orders would likely price more than the guide can.
- I created nothing. No mappings, no writes.

## Suggested next step (not built)

A review screen, not an auto-linker: show the 18 unclaimed Tuscaloosa rows against the 34 numbered unpriced items with the score, pack check, and SoCal-vs-Tuscaloosa price delta side by side, and require a tap to create each `brand_vendor_mappings` row. Auto-link nothing.
