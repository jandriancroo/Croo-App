# Vendor Sync Cleanup — one nightly pipeline, master lists only

## Verdict on your plan

Your plan is right, and it's simpler than what we have. Master lists are the source of truth, order guides are a store-managed subset that can't contain anything the master doesn't have, and price should fall back order search → invoice search. Three things to add that you didn't say:

1. **The system never deactivates an item.** Correct — you were right to push back. Value sits on shelves long after you can't order something. We only ever *tag*: unpriced with an age, and discontinued with a date. Deactivating stays a human decision.
2. **We have duplicate/competing jobs today**, which is why things quietly fail. The 8-hour PFG scrape, plus two separate nightly gap scans (10:15 UTC and 12:00 UTC), plus a nightly per-store price walk pinned to the wrong list per store.
3. **Unpriced should be near-zero, and it's a signal when it isn't.** You're right that vendors don't give things away — every live item on a vendor site is priced. So an unpriced item means one of three things: wrong item number (gaps problem), item is discontinued/pulled from the list, or our sync didn't reach it. All three are worth flagging, none are "no price exists."

## What's running today (the mess)

| Job | Frequency | Problem |
|---|---|---|
| PFG bid scrape | Every 8 hours | Fills our bid cache 3x/day for data that changes weekly. Nothing reads it for pricing. |
| PFG nightly price sync | Nightly | Walks one pinned list per store — 6 of 7 stores have no bid list configured, so they price off a store-managed guide. |
| PFG orders + invoices | Nightly, 2 tasks per store | Fine, but runs interleaved with everything else, so a failure is hard to see. |
| Produce Alliance invoice sync | Nightly | Separate schedule, no shared retry or reporting. |
| Vendor gap scan | Twice nightly (two crons) | Duplicated work, doubled alerts. |
| Pack config seeder | Nightly | Runs regardless of whether new pack sizes appeared. |
| PFG keep-alive | Every 5 min | Keep. Token upkeep only. |

## The new shape

One nightly vendor window, one vendor at a time, in fixed stages. Each stage finishes before the next starts.

```text
Stage 1  PFG masters      → bid guide per store, every item + price
Stage 2  PFG activity     → 14 days orders, then invoices from those orders
Stage 3  PA masters       → catalog per store, every item + price
Stage 4  PA activity      → 14 days invoices
Stage 5  Price fill       → items still unpriced: order search → invoice search
Stage 6  Gaps             → unknown item numbers → vendor gap alerts (once)
Stage 7  Pack configs     → matched items with unknown pack size → pack config queue
Stage 8  Report           → unpriced list + failures, per store
```

Rules that make it not fail:
- One vendor at a time, one store at a time inside a vendor. No parallel hammering of a vendor's site.
- Each store/stage is its own queue task with retry — one store's failure never kills the run.
- Stages are gated: price fill can't run before masters, gaps can't run before both vendors are in, pack configs can't run before gaps.
- Idempotent — re-running the night is safe, finished work is skipped.

## Pricing chain (per item, per store)

1. Master list price (bid guide for PFG, catalog for PA) — matched on any approved number on the item's brand ID.
2. Still no price → last 14 days of orders for that store.
3. Still no price → last 14 days of invoices.
4. Still no price → flag it as **needs price** and report it.

Order guides never set price. They only decide active/inactive for that store.

## Making unpriced items visible

- A per-store "Needs price" view in inventory, sorted by how long it's been unpriced.
- Nightly report line: how many items unpriced per store, and which are new tonight.
- Items unpriced 3 nights running raise a vendor gap alert so it lands in the workflow you already use.

## Guardrails to validate (your last point)

- Every item number seen on any vendor list, order, or invoice bounces off the brand ID. Unknown number → vendor gap alert. No exceptions, all four sources.
- Once an item is matched — auto or through gaps — if its pack string doesn't resolve to a known pack shape, it goes to pack configs for approval. Nothing gets counted on a guessed pack.
- Both of these get a nightly counter in the report so we can see the funnel: seen → unknown → linked → pack-config pending.

## What gets deleted

- The 8-hour PFG price scrape. Masters move into the nightly window.
- The duplicate vendor gap scan cron (keep one, inside the pipeline).
- The per-store hardcoded "pinned list" pricing walk. Replaced by master + fallback chain.

## Technical notes

- New orchestrator function `vendor-sync-nightly`, driven by `maintenance_queue` task types: `vendor_masters`, `vendor_activity`, `vendor_price_fill`, `vendor_gaps`, `vendor_pack_configs`, `vendor_report`, each stamped with vendor + location + stage.
- Single-flight lease row per nightly run; stage gating via a `vendor_sync_runs` status row (run_date, vendor, stage, status). Paused-state guard at each entry point.
- Master walk: PFG picks the bid list by name pattern, not a stored header ID; falls back to the widest list if no bid-named list exists, and logs every list name seen. PA uses catalog sync.
- `pfg_bid_items` becomes the read source for pricing, not just a cache write target.
- Price fill reads `pfg_orders` / `pfg_invoices` / `lite_vendor_invoice_items` in that order; writes `cost_per_unit` + `last_synced_at`, or sets a `needs_price_since` stamp on `inventory_items`.
- Gap scan and pack-config seeder become stages, invoked with the item set from the run instead of re-scanning everything.
- Keeps existing inventory gate — disabled stores skipped cleanly.

## Sequence

1. Build the orchestrator + stage queue, run it in dry-run alongside today's jobs for one night.
2. Compare: prices filled, gaps raised, pack configs queued vs. current jobs.
3. Cut over, delete the retired crons.
4. Ship the "Needs price" view and the nightly report.
