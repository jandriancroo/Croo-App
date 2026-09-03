
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

## Punch clock freeze + pairing-until-revoke (Sep 3)
- [x] Durable hashed device secret on punch_clock_devices (migration, no rows touched)
- [x] reissue + backfill_secret actions; redeem returns secret; revoke clears hash
- [x] One shared pairing lock; markPairingBroken retired (server-declared dead only)
- [x] In-session repair-and-retry + bounded punch writes (freeze fix)
- [x] Heartbeat on wake; /version.json + idle cache-busted reload on PIN screen
- [x] Build version stamp on PIN screen
- [x] Replace-vs-add prompt on duplicate device name at code generation
- [x] Locked docs: SHARED_WORKSPACE/punch_clock/pairing-until-revoke.md
- [ ] Publish to croohq.com and verify on a real paired iPad
