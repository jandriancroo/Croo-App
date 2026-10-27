# QU menu research results (read-only, nothing changed)

## 1. QU addresses already used in server code

Host `gateway-api.qubeyond.com`:
- `/api/v4/authentication/oauth2/access-token` (pos-search, kiosk-metrics, kds-orders, fetch-qubeyond-sales, sales-service)
- `/api/v4/data/reports/product-mix/sections/main` (pos-search, fetch-qubeyond-sales, sales-service)
- `/api/v4/data/reports/summary/sections/sales` (fetch-qubeyond-sales, sales-service)
- `/api/v4/data/reports/summary/sections/payments` (kds-orders, fetch-qubeyond-sales, sales-service)
- `/api/v4/data/reports/hourly-sales/sections/main` (fetch-qubeyond-sales, sales-service)
- `/api/v4/data/reports/tills/sections/main` (fetch-qubeyond-sales)
- `/api/v4/data/reports/tips/sections/main` (fetch-qubeyond-sales, sales-service)
- `/api/v4/data/reports/payments/sections/main` (sales-service)
- `/api/v4/data/reports/check-detail/sections/main` (kiosk-metrics, kds-orders, fetch-qubeyond-sales)
- `/api/v4/data/reports/checks-details/sections/items` (kds-orders)
- `/api/v4/data/reports/real-time-summary/sections/overview` (_shared/quLabor.ts)
- `/api/v4/data/operations/{opUnitId}/inventory` (pos-search, new; returns 404)

Host `admin.qubeyond.com`:
- `/api/data/operations/{opUnitId}/inventory` (pos-search fallback; returns 401)

## 2. Live GETs for Hemet (5448), same QU sign-in as pos-search

Sign-in: 200.

| Address (after /api/v4) | Status | Result |
|---|---|---|
| /data/operational-units/5448 | 404 | empty |
| /data/operations/5448/items | 404 | empty |
| /data/operations/5448/menu-items | 404 | empty |
| **/data/item-masters?page_size=50** | **200** | **2,093 items** (page_size ignored, no paging info). Each item has only `id`, `reportTitle`, `itemTypeId`. Samples: BYO Pizza (Large), 3 Top Pizza (Large), 2 Top Pizza (Large), 1 Top Pizza (Large), Simple Pie (Large). All four found: Margherita Pizza, BBQ Chkn, Meat Eater, Green Stripe. |
| /data/lookup-table/item-types | 404 | empty |
| /configurations/operational-units/5448/menus | 404 | empty |
| /apps/ei/operational-units/5448/menu-mappings/olo | 403 | "forbidden operation" |
| /operational-units-channels/5448/menus | 404 | empty |
| /menus/lookups/portions | 200 | succeeded, empty list |
| /menus?operationalUnitId=5448 | 400 | "Operational Unit 0 not found" (also tried operationalUnitIds, ouId, operational_unit_id, same error, so the store number isn't being read) |
| /data/menus?operationalUnitId=5448 | 404 | empty |

Product-mix sections list: `/data/reports`, `/data/reports/product-mix` and `/data/reports/product-mix/sections` all return 404. The API doesn't list its sections. Only `.../sections/main` is known to work.

## What it means

- The one working full-menu source is `/data/item-masters`. It is the **whole company catalog** (2,093 items), **not limited to Hemet**, with no category and no store or "on menu" flag. It includes the four test items.
- No store-level menu address worked with our QU access.

## Possible next step (not started; needs your go-ahead)

pos-search with `includeMenu:true` could use `/data/item-masters` as the menu source:
- Name = `reportTitle`, key = `id`.
- Category comes from the sales rows when they match. Otherwise "Menu".
- Fall back to the current 90-day sales list if it fails.

Tradeoff: the picker would show company-wide items, including ones Hemet may not sell. Only the two scoped files would change.
