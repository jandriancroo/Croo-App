# Does the deploy price and switch items on by itself? Yes — I was wrong

**Plainly: my earlier statement was wrong.** I said a redeploy leaves items inactive until the nightly sweep. In fact all three entry points run the pricing/activation step themselves, immediately after the structural deploy. The nightly run is only a backstop.

## 1. Does `deploy-location-inventory` itself run phase 2?

**No — and by design.** That function is structure only: shelves, items (created inactive), vendor numbers, recipe links. Its own comments and its response say so, and it hands back `nextStep: "vendor-price-chase { activate: true, includeInactive: true }"`. It never calls the sweep. **The caller does.**

## 2. The three entry points

| Entry point | Runs phase 2? | How |
|---|---|---|
| Deploy wizard (`src/components/settings/DeployLocationWizard.tsx`) | Yes | Structural deploy → refresh PFG + Produce Alliance lists → direct call to `vendor-price-chase` with `activate: true, includeInactive: true`. The wizard shows it as its own step and reports "X items live, Y waiting on a vendor price." |
| Location activation list (`src/components/brand/LocationActivationList.tsx`) | Yes | Same three-step chain in one click, with toasts: "Deploying structure" → "Syncing PFG + Produce Alliance" → "Pricing and activating items". |
| `auto_deploy_brand_template` trigger | Yes | Two fire-and-forget web calls per location: phase 1 to the deploy function, phase 2 to `vendor-price-chase`, both logged to `brand_deploy_trigger_log`. |

One real caveat on the trigger only: its two calls are fire-and-forget with **no ordering guarantee** — the sweep can start before the structural deploy finishes. The code notes this and accepts it because the sweep is idempotent and the nightly run catches anything missed. The two UI paths await each step in order, so they don't have that gap.

Also worth knowing: both UI paths refresh the vendor lists *before* pricing, so the sweep reads fresh data rather than yesterday's.

## 3. How much of Hemet would be live immediately

Hemet's bid guide is in good shape: **200 rows, 185 priced**, last refreshed Sep 17.

Matching all 219 live brand templates against Hemet's own current vendor data, using the same chain the sweep uses (every approved vendor number on the template, not just its own):

| Outcome | Templates |
|---|---|
| Priced from the PFG bid guide | 170 |
| Priced from the Produce Alliance catalog | 16 |
| **Priced from a master list — live on the spot** | **186** |
| House-made (no vendor number, no vendor source — activates without a price) | 1 |
| Left needing an order or invoice price | 33 |
| Of those, findable in Hemet's PFG order history at some point | 10 |

So a redeploy today lands at roughly **187 items live immediately**, with up to about 10 more depending on whether their order history falls inside the sweep's 14-day activity window. That is essentially Hemet's current state (203 active, and the sweep itself turned 20 on within the last hour), so a redeploy is close to a no-op on the count sheet rather than a reset.

The bulk pricing endpoint is indeed **not** wired in — none of this depends on it. Everything above uses the existing bid-guide/orders/invoices chain.

## 4. Is there a window where Hemet's count sheet is empty?

Realistically, no. The honest list of exposure:

- **Between phase 1 and phase 2** — minutes, not overnight. On the two UI paths the operator watches it happen. The gap only exists while the sweep is running.
- **Brand-linked rows are re-used, not recreated.** A redeploy over Hemet's existing rows updates them in place and explicitly does not touch `is_active` — so already-active items never go dark at all. An empty sheet requires deleting the rows first.
- **The one scenario that does bite:** wipe the rows, then have the sweep fail (PFG token expired, bid guide stale, function error). Then Hemet sits with 219 inactive items and an empty count sheet until someone re-runs the sweep or the nightly job does at 3 AM. That is a real risk of the delete-first approach, and another reason to archive in place instead of deleting.
- The trigger path's unordered calls can leave a batch unpriced until the nightly run — but that path deploys one template at a time, not a whole store.

## Correction on record

Earlier I wrote that a wiped Hemet would have an empty count sheet "until the nightly sweep runs." Wrong: the deploy paths price and activate in the same operation, and on Hemet's current data that means about 187 of 219 items live within minutes. The wipe risk is real but it is the *delete*, not the deploy.
