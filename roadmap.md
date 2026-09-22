# POS and brand integration roadmap

- [x] Add secure brand-level integration policies and seed current brands
- [x] Add super-admin integration controls to Manage Brands
- [x] Hide and block disallowed integrations in location settings
- [x] Add shared POS-neutral week projection service for every brand and POS
- [ ] Route Week Insights through the shared projection service for all POS
- [ ] Schedule nightly shared week projections for every POS location
- [ ] Show before-and-after Week Insights results
- [ ] Verify brand controls and Week Insights on desktop and mobile
- [ ] Preserve locked inventory behavior and protected labor cache behavior
- [x] Restyle chat feed cards with pinned/regular magazine bands and split body typography
- [x] Replace the DM arrow pager with a role-aware segmented control
- [x] Verify desktop/mobile chat behavior and prepare the review summary
- [x] Fix inbox segment label truncation and increase label readability
- [x] Add an easy Unpin action for pinned feed posts
- [x] Verify both refinements on desktop and mobile
- [x] Restore compact posts with See more/less and uniform body text
- [x] Replace the labeled Unpin control with a single toggleable pin icon
- [x] Add optional subject lines to announcements
- [x] Shipped aggregate live-labor RPCs (get_live_labor_totals, get_labor_totals_for_dates, get_cut_savings_estimate); rewired liveLabor.ts + CompactDashboard; verified real wages Palm Springs (14.8h / $324.88); publish requested.
- [x] vendor_source root-cause fix: closed 3 creation paths (availability sweep auto-deploy, BrandItemActivation, DeployToLocationDialog), dropped the 'manual' column default, backfilled contradicting rows, corrected Palm Springs Blaze Red Sauce Can to pfg. Guardrail held (Palm Desert 201, Palm Springs 211 active-priced).

## Done — bogus PFG numbers cleared off PA produce items (Sep 20 2026)
- 21 active inventory_items rows had item_number set to NULL (pa_item_id, vendor_source, cost_per_unit untouched)
- Blaze Red Sauce Can (611957, real PFG) left alone; only remaining row with both identifiers
- 0 brand_inventory_templates carry both identifiers; 1 inactive contaminated row left (Sandbox Retired Clone Cilantro) — flagged, not fixed

## Done — SoCal item-number problem: assisted matching + division guard (Sep 21 2026)
- Step 1: src/utils/vendorCandidateMatch.ts (normalizePackSize, categoryFamily, scoreCandidate, rankCandidates) + tests; ranking only, never auto-links
- Step 2: migration re-opened mis-promoted PFG gap alerts (25 reopened -> 99 new at the time); 22 duplicate non-live templates surfaced
- Step 3: VendorGapFinder — Link to existing item is now the primary path with ranked one-tap suggestions, reporting-store name, duplicate-template notices; "Create as new" demoted to outline
- Step 4: source_location_id recorded on every approved mapping (+ backfill of nulls)
- Step 5: division guard in deploy-location-inventory and inventory-availability-sweep — a PFG number is validated against that store's own pfg_bid_items before stamping; mismatch = number not planted, unpriced_since set, gap alert raised for that store
- Step 6: price chase run at Tuscaloosa (49 chased, 0 priced) and Rowlett (17 chased, 0 priced) — confirms the numbers are foreign and need human linking
- Step 7 (marking items not-carried) intentionally NOT done
- Guardrail held: Palm Desert 211/201, Palm Springs 214/211 before and after

## Done — PFG order-line format regression fixed (Sep 21 2026)
- Cause: handleBackfillItems wrote fetchDeliveryDetail() raw PascalCase output verbatim; the syncOrders normalizer was never applied
- normalizeDeliveryLineItem() + isRawDeliveryLine() added in pfg-service; used by BOTH syncOrders and handleBackfillItems
- Price mapping: DeliveryDetailUnitOfMeasures[0].UnitPrice is authoritative (ExtendedPrice is 0 on shorted lines); verified vs Diet Coke 28969 = $115.95 in both shapes
- Migration reshaped 38 orders / 1214 lines (Tuscaloosa 33, South Meadows 5) -> 0 raw-format orders remain, 1214/1214 lines readable
- Readers now fail loudly: loadActivityHits counts + logs unreadable lines (unreadableLines in chase summary, unreadable_lines in vendor-price-chase response, unreadableLines in nightly detail); pfg-service gap loop counts unreadableGapLines and returns unreadableOrderLines per location
- Re-sync: Tuscaloosa 40 orders / 0 unreadable, South Meadows 27 / 0; 18 new gap alerts (81 -> 99 new)
- Syrups did NOT become alerts because all 7 numbers are already mapped in brand_vendor_mappings — they are now readable with real prices instead of invisible
- Price chase after: Tuscaloosa 49 chased / 0 priced, South Meadows 1 / 0 — local rows still carry SoCal numbers (needs Jordan's gap-screen pass)
- Guardrail held: Palm Desert 211/201, Palm Springs 214/211

## Open — Tuscaloosa second managed list (report only, no action taken)
- ORDER GUIDE_10_BLAZE1 (d34c215d, type 2, 167 lines) is a strict SUPERSET of BID_10_BL305 (57907965, type 2, 139 lines): 139 shared, 0 bid-only, 28 order-guide-only
- The 28 extras include every soda syrup (2204, 26383, 26877, 28969, 47772, 662001, 964693, 883022, 955714, 960172, 436444) plus Powerade/Vitamin Water drinks, sugar packets, sea salt, mop handle, freight
- Cleaning chemicals + dispensers are already on the bid; only the sanitary-napkin wax bag is order-guide-only
- List endpoint returns ZERO prices for both lists (per-product fetch required, which writes cache — not run, this was read-only)
- Structural field confirmed on every store: ProductListType 2 = vendor/corporate managed, 3 = store-built, 4 = Purchase History. IsReadOnly + empty CreateUserAlternateKey corroborate
- Caveat for a "sync every managed list" rule: SoCal + Rowlett each carry a second type-2 "Proprietary Items" list (16-28 items) that would also be pulled in

## Done — new job application notifications (push + email)
- New edge function notify-new-application (verify_jwt=false): trusts only applicationId, re-fetches everything service-side
- Recipients: active general_manager at the applied-to location + active admin/org_admin/super_admin in that org; shift_manager excluded
- Prefs read from user_notification_settings at the application's location_id; missing row = ON for push and email
- Push body = position + location only; email = first name + position + location + https://croohq.com/hiring link. No phone/email in either
- Dedup table application_notify_log (application_id, channel, recipient) unique; email also uses email_queue dedup_key
- send-push-notification: new_job_application mapped to its own user_notification_settings key + emoji title
- Settings UI: Hiring section with "New Job Applications" (GM/manager/admin only), alert/push/email, email defaults ON
- PublicApplication.tsx now sends only the application id; submit never fails on notify error

## Next-week time-off digest (Who's Out, Option E) — shipped 2026-09-22
- `_shared/whos-out.ts`: approved-only loader, location-scoped recipient resolver (shift managers excluded), pure Option E HTML builder. Never reads paid/unpaid, hours, notes, denial reasons or pay.
- Nightly task `whos-out-next-week` inside maintenance-service (no new cron), after daily-logbook-summaries, before weekly-schedule-emails. Target week computed per location timezone. Dedup key `whos_out_v1_{location}_{week_start}`; 23505 = already queued. No email when nobody is out.
- `whos-out-email` (verify_jwt = true): `send_sample` → caller's own address only, `[Sample]` prefix, source `test_preview`, dedup_key null. `send_location_sample` → super_admin / internal only, real recipient list.
- Settings: `time_off_weekly_digest` under a new Time Off group (manager+), email defaults ON, missing row = ON.
- One-shot Hemet sample queued to Dave Matthews, Aubrey Andrian, Jordan Andrian (Joe Roselli excluded — inactive profile).
