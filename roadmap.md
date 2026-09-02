
## Vendor sync pipeline (Sep 1)
- [x] One nightly pipeline (vendor-sync-nightly) with stage gating, per-store tasks, retries
- [x] Retire 8h PFG price scrape + duplicate gap scans + standalone PA/pack crons
- [x] Shared price chase (master -> order -> invoice), unpriced/discontinued/ship-in tags
- [x] Targeted resync endpoint (vendor-price-chase) for the "needs price" button
- [ ] UI: "N needs price" counter + Sync button on the item list (next)
- [ ] UI: show discontinued date + ship-in-only badge in item list

## COGS parity (Sep 2)
- [x] Dash list pill honors manual order assignments (match Report Builder / panel)
- [x] Purchases expanded list highlights orders delivered outside the period window
