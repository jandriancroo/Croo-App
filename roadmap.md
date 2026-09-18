
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

## Corrective Action (Logs) — Sep 3
- [x] Rename Employee Write-Up → Corrective Action (UI copy only, table untouched)
- [x] Schema: family_id (backfilled), transcript_text, notes_bullets, consent_confirmed_at, recording_duration_seconds, stt_model_used
- [x] Transcript read locked to manager tier via get_corrective_action_transcript RPC
- [x] Recorder: 75s segments, 15 min cap, background auto-stop, audio discarded
- [x] Mini Transcribe (fallback standard) → one Gemini 3.7 Flash bullet pass with names
- [x] Trails: attach to existing issue or start new, reason mismatch flagged
- [x] Bullets + transcript editable until signed_at
- [x] Locked docs: SHARED_WORKSPACE/logs/corrective-action.md
- [ ] Diff review, then publish to croohq.com

## Corrective Action — Sep 4 (PDF + transcript view + notes autofill)
- [x] PDF export: Close/Done button, bullets as one flowing paragraph, overflow-wrap on sections
- [x] Expanded full-height transcript reading view (notes panel + recorder), gates respected
- [x] Autofill empty Reason + Next Steps from recording notes (nullable suggestions from Flash)
- [x] Changelog written
- [ ] Publish to croohq.com and check on the floor iPad

- [x] Commit live `mark_labor_cache_stale_and_backfill` migration + changelog note (2026-09-06)

## Google for Jobs SSR — Sep 13
- [x] New `jobs-index` edge function: crawler-ready /jobs HTML + ItemList JSON-LD
- [x] `job-detail` + `jobs-index` write served rows to job_syndication_logs (google_jobs_ssr)
- [x] Cloudflare Worker source `workers/jobs-ssr-router.js` (croohq.com/jobs, /jobs/*)
- [ ] Bind Worker route in Cloudflare dashboard, then Googlebot curl verify
- [ ] Publish to croohq.com (Jordan)

## South Meadows inventory wipe — Sep 13 2026
- Wiped SM inventory_items (6), brand deployments (6), duplicate shelves (18). SM enabled, catalog empty, ready for fresh resync.
- Pending: fresh brand deploy + vendor sync for South Meadows (Jordan to trigger).
- Sparks still inventory_enabled = false; not touched.

## Sparks inventory wipe — Sep 13 2026
- Wiped all 37 leftover Sparks shelves; items/deploys/packs/counts already 0. Inventory stays disabled.
- Pending: enable inventory + integrations, then deploy + sync for Sparks (Jordan to trigger).

## Punch clock cold-boot routing fix — Sep 13 2026
- [x] `src/App.tsx` HomeRoute redirects punch-device sessions to `/punch-clock` instead of `/dashboard`.
- [x] `src/components/KioskAutoRestore.tsx` now routes an active device session back to `/punch-clock` when it lands elsewhere, and replaces a lingering human session on a paired tablet.
- [ ] Verify on a real paired iPad: power-cycle / force-quit PWA should open PIN screen, not "User" dashboard.

## Test-location exclusions — Sep 14 2026 (vendor cleanup Stage 1, Part 2)
- Part 1 (retire 4 legacy crons) = no-op: already unscheduled by the Sep 2 migration; verified live.
- [x] `locations.is_test_location` boolean (default false); flagged Sandbox #7777, inactive Sandbox clone, Lite QA — Smoke Test
- [x] Billing.tsx + check-subscription exclude by flag; `useLocation` selects the column
- [x] `inventoryGate.ts` — `isInventoryEnabled` + `filterEnabledLocations` skip test stores; EXCLUDED_LOCATION_IDS kept as fallback (QA-LITE-01 added)
- [ ] Later stage: `pfg-scheduled-price-sync` has no remaining caller — candidate for deletion

## Sandbox clone + vendor price fallback — Sep 15 2026 (Stage 2)
- [x] `clone_count_to_sandbox` matches the sandbox on `requires_super_admin = true` only (exact-name match broke after the `[TEST]` rename). Resolves to `40a872fb…` — the only row with the flag.
- [x] Same name-free lookup in `CloneToSandboxButton.tsx` and `SandboxBanner.tsx`.
- [x] `_shared/vendorPriceChase.ts` — `pa_orders` folded into `orderByNumber` (14-day window, item_code / master_product_code / pa_product_id / pa_item_id keys), so produce gets the orders tier plus correct hadActivity / ship_in_only / discontinued behaviour.
- [x] `deploy-location-inventory` Tier 2 — `DEPLOY_PRICE_WINDOW_DAYS = 30`, date-bound, `.limit(50)` removed.
- Part B (produce invoices via manual `vendor_invoices` upload) intentionally skipped.

## Stage 3 — two-phase deploy (done)
- [x] Phase 1: deploy-location-inventory is structure-only — items insert `is_active: false`, re-deploy no longer force-reactivates, 5c PFG cost backfill deleted, fire-and-forget vendor syncs deleted, response returns `deployedItemIds`.
- [x] Section 6 recipe ingredient matching no longer filters on `is_active` (inactive deploys must still resolve).
- [x] chasePrices(): additive `activateOnHit` option (default false) — nightly price_fill unchanged.
- [x] House-made rule: no vendor identifier AND no vendor_source → activated directly in sweep mode.
- [x] vendor-price-chase: `activate` / `includeInactive` sweep mode, 30-day window, paged select up to 5000 items.
- [x] LocationActivationList: deploy → vendor syncs → activation sweep (second deploy pass removed).
- [x] DeployLocationWizard: new "Pricing & activation" step after runInitialSync; Lite skips it.
- [x] auto_deploy_brand_template: adds a second net.http_post to vendor-price-chase per location.

## Stage 3 — Deploy split into Phase 1 (structure) + Phase 2 (activation sweep)
- [x] Deploy creates items inactive; never reactivates existing items
- [x] Removed deploy's direct PFG pricing block and fire-and-forget sync trigger
- [x] chasePrices() gained activateOnHit option (default off — nightly unaffected)
- [x] House-made rule: no vendor identifier AND no vendor_source → activate in sweep mode
- [x] vendor-price-chase gained activate/includeInactive sweep mode (30-day window)
- [x] All three entry points updated: wizard, activation list (2nd deploy pass removed), DB trigger
- [x] Typecheck passed; deploy-location-inventory, vendor-price-chase, vendor-sync-nightly redeployed

## Stage 4 — vendor registry (done)
- [x] `vendor_registry` table seeded with real keys: `pfg`, `produce_alliance`, `heimark` — purely additive, nothing references it yet.

## Stage 5 — nightly additions (done)
- [x] New nightly stage `reactivation` (per location): inactive items with a real order/invoice hit inside the 14-day window → chasePrices with activateOnHit. Not a bid-guide sweep.
- [x] New nightly stage `catalog_parity` (per inventory-enabled location with a brand): diff local `brand_item_id`s vs live brand templates → per-template deploy of what's missing → Phase 2 sweep on just those items. Capped at 50/store/night. Logs seen / missing / auto_deployed.
- [x] `_shared/vendorPriceChase.ts`: extracted `loadActivityHits()` + `numbersForItem()` (exported) so activity can be checked without a full chase.
- [x] Archive cascade consolidated: dropped `trg_cascade_archive_brand_template` and `trg_deactivate_items_on_template_archive`; `trg_brand_template_status_cascade` is canonical and now stamps `deactivated_by = 'brand_admin'` + `deactivated_reason`.

## Stage 5 part 1 — nightly reactivation + catalog parity (Sep 15 2026)
- [x] reactivation stage: inactive items with a real order/invoice hit in 14d → chasePrices(activateOnHit:true)
- [x] catalog_parity stage: live brand templates vs store brand_item_ids → deploy missing (cap 50) → activation sweep on created items
- [x] vendor-price-chase accepts itemIds for targeted sweep
- [x] typecheck clean; vendor-sync-nightly + vendor-price-chase redeployed
- [x] Stage 5 part 2: archive cascade consolidated — trg_cascade_archive_brand_template + trg_deactivate_items_on_template_archive already dropped; orphaned functions removed; canonical trigger stamps deactivated_by/reason

## Stage B — fail-soft sweep + broken-recipe scan (Sep 15)
- [x] Per-item guards in chasePrices (no_brand_link / template_not_live / write_rejected / error) + skips reported
- [x] Tolerant paging in vendor-price-chase
- [x] recipe_integrity_alerts table + recipe-integrity-scan function (logic in _shared/recipeIntegrity.ts)
- [x] Nightly stage recipe_integrity (per-location, after catalog_parity) + call after deploy activation sweep
- [x] Health tab card: recipes missing ingredients (grouped by missing product, flag-only)

## PFG three fixes — Sep 18 2026
- [x] Order detail uses PFG's native DeliveryKey (call site no longer drops it); header lines > 0 with 0 detail lines (delivery orders only) writes pfg_orders.detail_error + audit row instead of silent NULL. Deployed; SM 37 orders with lines, Tuscaloosa 8; backfill repaired 5 SM + 26 Tuscaloosa shells
- [x] Bid list selection uses credentials.product_list_header_id first; name-matching only as loudly-logged last resort. SM stored ID resolves to "Blaze Form" (store-built, type 3) not "Order Guide" (vendor, type 2) → 119 rows, not 186
- [x] pfg_bid_items write path splits comma-joined item numbers; 20 existing joined rows backfilled; 0 comma-joined rows remain
- [x] Verify: SM active 117 / unpriced 1 before AND after; 102 inactive unpriced items resolved 0 — their item_numbers appear in 0 of SM's real order lines (wrong-division numbers, not a missing-data problem)
- [ ] OPEN (needs Jordan): repoint SM + Sparks credentials.product_list_header_id to the vendor Order Guide list ID (SM: 5bda5ec0-0a73-4486-870d-3540683fff3c)

## PFG bulk pricing validation — Sep 18 2026
- [x] Test-only (no sync changes, no repointing, no price writes): refresh each of the 7 stores' PFG tokens via the app's own refresh routine, pull each store's list with its CURRENT stored list ID at SortByType 0, run the bulk pricing call, report per-store items/price rows/priced>0 plus any zero/null item; extra rows for SM + Sparks against their real Order Guide IDs
- [x] Result: 6 of 7 stores tested live — every store priced 100% of its list (Hemet 181/181, Palm Desert 181/181, Palm Springs 181/181, Rowlett 163/163, Tuscaloosa 138/138, SM stored/Blaze Form 109/109, SM Order Guide 186/186). Zero gaps anywhere.
- [ ] Sparks NOT testable: locations.inventory_enabled = false, so filterEnabledLocations excludes it from refresh_keep_alive and every inventory job. Needs Jordan's decision on enabling inventory for Sparks.
