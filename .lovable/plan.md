# Stage 3 — Split deploy into structure, then activation

## Agreement on the reasoning

Confirmed against the current code, and I agree with all of it:

- Line 363: new items are inserted with `is_active: true` unconditionally.
- Line 292: the existing-item branch force-sets `is_active: true` on every re-deploy, so a genuinely dead item gets resurrected by any manual "Sync".
- The "5c. Backfill PFG cost_per_unit" block (lines 399–530) makes a live PFG bid-guide call and re-implements a two-tier price search that the shared price chain now does better (and, since Stage 2, does for produce too). It is also PFG-only, so produce items were never priced by deploy at all.
- The bottom "Auto-trigger vendor syncs" block (lines ~698–740) races three invokes against a 2-second timer. It cannot report success, cannot be waited on, and there is no step afterwards to use its results — exactly the fire-and-forget being replaced.

One correction to the brief, from the code: the second deploy pass in `LocationActivationList.tsx` is **not** needed for SKU stamping (you're right — SKUs are stamped at insert, lines ~350–360). But it does do one real thing: recipe ingredient linking (section 6) matches ingredients on `item_number` / `pa_item_id`, and that runs *before* the vendor syncs on the first pass. On a brand-new store the first pass links fine anyway, because the SKUs come from `brand_vendor_mappings` at insert, not from the syncs. The syncs only add prices. So the second pass is genuinely redundant and gets removed — with one caveat noted under Risks.

## Phase 1 — structural deploy

In `deploy-location-inventory/index.ts`:

- New items insert with `is_active: false`.
- Existing-item branch: drop `is_active: true` from the update. Keep name/category/pack/shelf/SKU refresh — that's identity, not activation.
- Delete the whole 5c PFG cost-backfill block, including the `pfg-service` invoke and the 30-day order window added in Stage 2 (that logic now lives only in the shared chain).
- Delete the "Auto-trigger vendor syncs" block at the bottom.
- Keep untouched: template fetch, shelf/storage mirroring, product groups, SKU stamping from `brand_vendor_mappings`, recipe ingredient linking, the multi-shelf shortcut restore, the pre-flight warnings, `last_deployed_at`.
- Response gains `deployedItemIds` (the values of `templateToItemId`) so callers can hand Phase 2 an exact set, and the warnings text stops promising "syncs will run automatically" — it now says items are inactive until the activation sweep prices them.

Result: deploy becomes a pure internal copy — no outbound vendor traffic, fast, fully idempotent, and it can never activate anything.

## Phase 2 — activation sweep

`_shared/vendorPriceChase.ts` gets one additive option:

- `opts.activateOnHit?: boolean` (default `false`). When true and `hit !== null`, the patch also sets `is_active: true`. Nothing else changes — no hit still means `unpriced_since` stamped and the item left inactive.
- Nightly `price_fill` and the existing unpriced-counter button pass nothing, so their behaviour is byte-identical.

The sweep itself runs through the existing `vendor-price-chase` function rather than a new one, with two new body flags:

- `activate: true` → passes `activateOnHit: true` and `windowDays: 30`.
- `includeInactive: true` → drops the `.eq("is_active", true)` filter and the unpriced-only `.or(...)`, so freshly deployed inactive items are actually selected. Also raises the item cap for this mode (a full brand catalog is well over the current 300) and pages the select.

Deploy does not call this itself. Each entry point calls it explicitly, which is what makes the two phases decoupled and independently retryable.

## Entry points

**1. `LocationActivationList.tsx` (manual re-deploy)** — four steps become three, second deploy pass removed:

1. `deploy-location-inventory` — "Copying inventory structure…"
2. `pfg-service` sync + `produce-alliance-service` sync_items + orders, in parallel, awaited — "Refreshing vendor lists and orders…"
3. `vendor-price-chase` with `{ locationId, activate: true, includeInactive: true }` — "Pricing and activating items…"

Toast reports `priced` / `still_unpriced` from the sweep, so the number that matters (how many items are live) is visible immediately instead of inferred.

**2. `DeployLocationWizard.tsx` (new location)** — step 6 stays as the Phase 1 call, `runInitialSync` (step 8) stays as the vendor sync, and a new step 9 runs the activation sweep after it, surfacing "X items live, Y waiting on a vendor price" in the existing result panel. Lite mode skips both 8 and 9 as it already does.

**3. `auto_deploy_brand_template` trigger** — per-location loop keeps its single `net.http_post` to `deploy-location-inventory`, then adds a second `net.http_post` to `vendor-price-chase` with `{ locationId, activate: true, includeInactive: true }`. Both are still fire-and-forget with no ordering guarantee across separate HTTP calls; that's acceptable here because the sweep is idempotent and the nightly run is the backstop. Per your instruction, retry and error visibility for this trigger stay out of scope.

## Risks and how they're handled

- **Vendor lists empty at sweep time.** If PFG/PA syncs haven't populated `pfg_bid_items` / `pa_catalog_items` yet, the sweep finds nothing and everything stays inactive. Mitigated in the two UI flows by awaiting the syncs first; in the trigger path the nightly `price_fill` picks it up. The shared chain's existing "never guess when we couldn't read a master" guard already prevents wrongly stamping `discontinued_at` in that case.
- **House-made prep and sub-recipes have no vendor number.** The chain skips them entirely (`pfg.size === 0 && pa.size === 0` → `continue`), so they'd deploy inactive and never activate. Fix: in the sweep mode only, items with no vendor identifier and `is_recipe = true` are activated directly, since no vendor price was ever expected for them. I'll confirm the exact set (recipes plus any item with no vendor SKU and no `vendor_source`) before writing it.
- **Existing live stores.** Nothing runs against them until someone presses Sync or the nightly job runs, and the nightly job doesn't activate. The only behaviour change for an existing store is that re-deploy stops silently resurrecting dead items — which is the intended fix.

## Files touched

- `supabase/functions/deploy-location-inventory/index.ts` (remove 5c + auto-sync, inactive inserts, return item ids)
- `supabase/functions/_shared/vendorPriceChase.ts` (`activateOnHit` option)
- `supabase/functions/vendor-price-chase/index.ts` (`activate` + `includeInactive` modes, paging)
- `src/components/brand/LocationActivationList.tsx`
- `src/components/settings/DeployLocationWizard.tsx`
- one migration: `CREATE OR REPLACE FUNCTION public.auto_deploy_brand_template()` with the added sweep post

No schema change. Three edge functions redeploy. No publish.
