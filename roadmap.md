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
