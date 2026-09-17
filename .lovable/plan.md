# Reverse gap detection — verified

Read-only. Nothing changed. (Note: I couldn't add this to `roadmap.md` — plan mode only lets me write the plan file.)

**Verdict up front: the theory is right on its central claim and wrong on three of the supporting facts.** There is genuinely no detector that starts from our own items and asks whether their number still exists at the vendor. But `reported_by_locations` is populated, the orphaned numbers are *not* absent from the gap table, and the gaps screen does show both stores for `CC146`.

## 1. Every path that creates a gap alert — all six run inbound only

| Path | Trigger | Scans | Creates a gap when |
| --- | --- | --- | --- |
| `vendor-gap-scan` (PFG leg) | nightly pipeline stage 8, or the Scan button | the store's PFG list, per PFG-connected store | a list item number isn't a brand template number, a template PA id, or a mapped vendor number |
| `vendor-gap-scan` (PA leg) | same run | `pa_catalog_items` per store | same test against PA ids |
| `produce-alliance-service` | PA sync | PA sync payload | an incoming PA line matches no local item |
| `parse-vendor-invoice` | invoice upload | invoice lines | a line matches no brand item |
| `parse-vendor-invoice-lite` | lite invoice upload | invoice lines | same |
| `inventory-reconciliation-scan` | manual repair tool | existing alerts | reads/dedupes only, doesn't originate gaps |

Every one starts from **vendor data** and looks for a missing match in our catalog. **Plainly: no path starts from `inventory_items` or `brand_inventory_templates`, and nothing anywhere checks whether a number we already hold still exists in that store's current vendor data.** The direction you described is genuinely absent — there is no query in the codebase shaped that way.

`vendor-gap-scan` does have a reverse-ish step, but it only *closes* alerts: it auto-resolves open gaps whose number has since been mapped. It never opens one.

## 2. The orphan counts — your South Meadows numbers are right

Recomputed independently: **189 items with a number, 87 matching a bid row, 102 orphaned, 67 of those unpriced.** Exact match to your figures.

Brand-wide:

| Store | Items with a number | Match a bid row | Orphaned | Orphaned and unpriced |
| --- | --- | --- | --- | --- |
| South Meadows | 189 | 87 | **102** | **67** |
| Rowlett | 192 | 146 | 46 | 24 |
| Tuscaloosa | 191 | 147 | 44 | 33 |
| Hemet | 239 | 208 | 31 | 17 |
| Palm Springs | 214 | 188 | 26 | 5 |
| Palm Desert | 188 | 175 | 13 | 5 |
| [TEST] Sandbox (Retired Clone) | 184 | 0 | 184 | 5 |
| [TEST] Sandbox | 28 | 0 | 28 | 22 |

Every real store has orphans, 13 to 102 of them, and 5 to 67 unpriced. It is not a South Meadows quirk. The sandboxes match nothing because they have no vendor connection at all — expected, ignore them.

I also tested whether a wider number lookup would rescue the 67: taking each item's own number *plus* its brand template number *plus* every number in the brand vendor registry, only **3 of 67** appear anywhere on the South Meadows guide, and **0 of those 3 carry a price**. So this isn't a matching-breadth problem — for 64 of 67 there is genuinely nothing on the guide under any number we know.

## 3. Correction: the orphaned numbers are mostly in the gap table already

You said the 102 appear in zero gap alerts. They don't:

| Their alert status | Numbers | Of those, unpriced |
| --- | --- | --- |
| resolved (PFG) | 46 | 32 |
| **no alert at all** | **31** | **19** |
| promoted (PFG) | 22 | 16 |
| resolved (PA) | 3 | 0 |

So 71 of 102 have been through the gap flow and were closed — resolved or promoted — and 46 of those are *still* unpriced today. That's arguably worse than your version of the story: the gap system saw these numbers, someone linked them, the alert closed, and pricing still never landed. Only 31 never produced an alert.

## 4. Correction: `reported_by_locations` is populated

348 of 375 rows carry locations. The only empty ones are the **15 invoice-source rows** (13 new, 2 ignored), and there's a clear reason: the invoice path is the one gap writer that does a plain table upsert with no location argument, while every other writer goes through the `upsert_vendor_gap_with_location` routine, which builds the location entry and merges it in on repeat sightings. That routine works — deployed and matching its migration.

So: designed, wired, and working — except on the invoice path, which was never given the location.

## 5. Correction: the screen shows both stores for `CC146`

`CC146` sits in both stores' guides, and its alert row carries **both** locations:

```text
CC146 → [{Sparks}, {South Meadows}]
RW742 → [{Sparks}, {South Meadows}]
FN790 → [{Sparks}]
LC490 → [{Sparks}]
DAR07455 → [{Sparks}]
```

The screen reads `reported_by_locations` straight off the row and renders every name joined with a separator, and the location filter keeps a gap if any entry matches. So `CC146` should read "Sparks · South Meadows". If you saw "Sparks" only, either the view was filtered to Sparks, or the row was rendered before the second sighting merged in (South Meadows' entry lands on a later scan) — worth a fresh look at the screen before treating it as a bug. `FN790`, `LC490` and `DAR07455` genuinely are Sparks-only sightings.

One real problem in the same area: the location dropdown only lists stores whose stored credentials contain `bid_guide_header_id`, and **only Hemet has that field** — every other store has it blank. So the filter is effectively crippled regardless of the data.

## 6. Pricing does resolve through the registry

Confirmed in `_shared/vendorPriceChase.ts`. Before chasing, it loads for each brand template: the template's own `item_number`, its `pa_item_id`, **and every `vendor_item_id` in `brand_vendor_mappings`** for that template. Then, per item, it unions that set with the item's own `item_number` and `pa_item_id` and tries all of them against the location's bid guide, the PA catalog, recent orders and recent invoices.

So a linked gap **does** feed pricing at the location — the link is honoured, and pricing does not key off the item's own number alone. That part of the system is sound, which is exactly why the 46 resolved-but-still-unpriced items matter: the link exists and there is still no price to find.

## 7. My honest read

**The theory is right in shape and understates the problem in one place while overstating it in two.**

Right: there is no reverse detector. An item whose number has gone stale, or which was seeded from the wrong division, produces no alert, no queue entry, and no counter — it silently sits unpriced. The only signal today is the `unpriced_since` tag, which says "no price" without ever saying "and the number itself is gone."

Understated: the failure isn't only for items nobody ever looked at. 46 of the unpriced orphans went through the gap flow and were closed. Closing a gap proves someone *saw* the number, not that the number works at that store.

Overstated: the location tracking works, and the numbers do appear in the gap table.

**Where a reverse detector belongs:** inside the existing nightly gap stage, as a second pass after the inbound scan — not a new stage. The inbound scan already loads each store's full vendor list and each brand's approved numbers; the reverse question needs exactly the same two sets, compared the other way. Adding it there costs no extra vendor calls and inherits the per-store retry.

**What it must know to avoid crying wolf** — this is the hard part, not the query:

- **A store legitimately not carrying an item is normal**, and it's the majority case in a brand catalog deployed to every store. The signal has to be scoped per store and must not fire merely because an item exists locally and isn't on the guide.
- **Recent activity outranks list membership.** An item shipped in the last two weeks is real regardless of whether it's on the list — that's the existing ship-in rule, and the reverse detector has to respect it or it'll flag every LTO.
- **It must check every approved number, not just the item's own** — otherwise it'll flag items that price perfectly well through the registry.
- **It has to distinguish three outcomes that look identical today:** the number is dead everywhere (a genuinely stale number, worth fixing), the number is alive at a sibling store but not this one (a division/territory mismatch — exactly the South Meadows story, and the actionable one), and the item was never a vendor item at all (house-made — should never be flagged). The sibling-store check is the discriminator, and we already hold every store's guide, so it's answerable.
- **The output shouldn't be a `vendor_gap_alerts` row.** That table is keyed brand-wide on one number and its whole vocabulary is "an unknown number appeared." A reverse finding is per store and its meaning is the opposite. Mixing them would corrupt the counters you're already reading.

One last thing worth flagging on its own: 46 items are unpriced with a *closed* gap. Whatever we build, the closing of a gap should probably be verified — link the number, then confirm a price actually landed — otherwise the queue keeps emptying without the problem being solved.

No fix proposed, per your instruction.
