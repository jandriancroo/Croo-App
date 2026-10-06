# THEO_INVENTORY.md — parked: Theo and inventory

Last updated: 2026-10-05. Owner: Jordan. Status: PARKED.

Jordan's decision (Oct 1, 2026): Theo does nothing that involves inventory for now. This file holds everything inventory-related so it is not lost, and so it stays out of `THEO_DATA.md` and `THEO_ABILITIES.md`.

## What is in and what is out

Out (Theo must not answer or act on these): inventory counts, count values, pack sizes, food cost and COGS, variance and actual-vs-theoretical, vendor orders, invoices, transfers, waste, recipes and menu pricing.

In (this is sales data, not inventory): item sales from the POS. That means the Sales Summary top items (units and dollars) and the promo tracker (store rankings, units, dollars and P-mix per item). These are covered in `THEO_DATA.md`.

When asked about anything in the "out" list, Theo says: "Inventory isn't something I can help with yet."

## What the audit found (for when this is un-parked)

Theo's `query_inventory` tool in `supabase/functions/ai-assistant/index.ts` reads `inventory_counts`, `inventory_count_items`, `inventory_items`, `item_conversions`, `pfg_orders` and `pa_orders` directly.

`query_inventory` is still parked: it is filtered out of the tools offered to the model (`THEO_TOOLS`, lines 914-915). Its code is kept for later, not offered to Theo today.

- It never calls the per-store pack rule (`get_store_pack_lens` / `v_store_pack_lens`).
- Its copy of the valuation math can fall back to the retired `inventory_items.pack_quantity_override` (fallback at lines 119-120; selected at lines 1727 and 1841). A count that has a frozen pack size (`pack_quantity_at_count`) always wins, so the retired field is only used when a count has no frozen value. Even a request for live data cannot override a saved snapshot (lines 60-63).
- COGS is calculated from order totals, not vendor invoices.
- Lite inventory, transfers, waste logs and spot counts are ignored.
- The valuation math is a copy of `src/utils/countItemValue.ts`, so the two can drift.

## Parked ideas

| Idea | Kind | Where it came from |
|---|---|---|
| What is low, what is over-ordered, top food-cost driver this week | Brain | Roadmap B8 |
| Food cost coaching: spot an over-ordered item and suggest how to cut its use | Brain | Sept 23 call |
| Voice-guided count: Theo walks the count by storage area, one item at a time ("2 cases and 1 bag") | Hands | Sept 21 call |
| Draft a vendor order from low stock (draft only, never sent by Theo) | Hands | Roadmap H11 |
| Flag a count that looks wrong before it is submitted | Proactive | New |
| Explain a food cost swing between two periods | Brain | New |

## Conditions to un-park

1. Pack configuration is locked and trusted for the stores involved.
2. Theo's inventory answers go through `get_store_pack_lens` and the count-time snapshots, not his own copy of the math.
3. COGS uses invoices, or Theo says clearly that it uses order totals.
4. Jordan's bar of roughly 90% data accuracy is met for inventory at the stores involved.
5. The inventory system is a locked feature: any change needs Jordan's "unlock please".

## Change log

- 2026-10-01: Created. Inventory scoped out of Theo; ideas and audit findings parked here.
- 2026-10-05: Re-checked against code; still parked; line references updated.
