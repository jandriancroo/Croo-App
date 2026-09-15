# Stage 2 — Produce price fallback + deploy price window

## Both problems are real. Confirmed in the code and the data.

### 1. Produce items can never hit the order/invoice fallback

`_shared/vendorPriceChase.ts` builds its recent-activity lookups from **only two tables**: `pfg_orders` and `pfg_invoices` (lines 169-182). The matching loop then looks up produce numbers in those same PFG-only maps (lines 256-266). So for a produce item the chain is effectively "catalog or nothing" — the orders and invoices tiers run but can never match.

Knock-on effect, worse than just a missing price: `hadActivity` (line 269) is also computed from those PFG-only maps, so a produce item that has been ordered every week still counts as "no activity" and can get tagged discontinued.

The produce order data does exist and is usable: `pa_orders` has 253 rows, with `items` JSON lines carrying `item_code`, `master_product_code`, `pa_product_id`, and `price`, plus `order_date` / `delivery_date`.

Produce **invoices** are the one gap: there is no `pa_invoices` table. Produce invoices only arrive through the manual upload path (`vendor_invoices` + `vendor_invoice_items`, vendor "Worldwide Produce"), which today holds a single invoice across the whole system.

### 2. Deploy's fallback really is 50 orders with no date limit

`deploy-location-inventory/index.ts` lines 479-485: `pfg_orders`, newest first, `.limit(50)`, no date filter. Confirmed. It is also PFG-only, same blind spot as above.

## Plan

**A. Add produce orders as a real tier in the nightly chain**
- Query `pa_orders` alongside the two PFG tables, same location filter, same `order_date >= today - ACTIVITY_WINDOW_DAYS` (14 days), newest first.
- Fold its lines into the same `orderByNumber` map, keyed on `item_code`, `master_product_code` and `pa_product_id` (all normalised the same way as today) so any of the three identifiers on an item can match. Price from `price`, ref from `order_number`, date from `order_date` falling back to `delivery_date`.
- PFG lines are read first so an item carrying both identifiers still prefers its PFG order — tier order stays master list → orders → invoices → unpriced.
- Because the produce lines now land in the shared map, `hadActivity`, `ship_in_only` and the discontinued guard start behaving correctly for produce with no extra changes.

**B. Produce invoices**
- Add manually-uploaded produce invoices to the invoice tier: `vendor_invoice_items` joined to `vendor_invoices` for the location, within the same 14-day window, matched on `item_number`.
- This is thin by nature (1 invoice exists today) — it is a completeness belt so the tier isn't structurally dead, not a source we should lean on. If you'd rather not add a join for one row, I'll skip B and do A only; say which.

**C. Deploy window: 30 days by date, not 50 rows**
- Replace `.limit(50)` with `.gte("order_date", <today − 30 days>)`, keeping the newest-first ordering and first-hit-wins behaviour. The date filter is the limit — no row cap, so a busy store gets its full 30 days and a quiet store doesn't reach back six months.
- Same 30-day window applied to a new `pa_orders` read in deploy, so a new produce-carrying store gets a starting price picture too.

## Technical notes
- `ACTIVITY_WINDOW_DAYS` (14) stays the nightly constant; deploy gets its own local 30-day constant with a comment explaining why it is wider (one-time initial sweep vs nightly refresh).
- Produce identifiers are numeric in the JSON (`pa_product_id: 10320`); they'll be string-normalised through the existing `norm()` before being used as map keys.
- No schema change, no migration. Two files: `_shared/vendorPriceChase.ts` and `deploy-location-inventory/index.ts`. Both edge functions redeploy; nothing else imports the changed code paths.

## Open question
Include part B (produce invoices via the manual-upload tables), or ship A + C only?
