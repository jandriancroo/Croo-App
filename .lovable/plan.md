# Fix: publishing one brand item only switches on that item's rows

Inventory is a locked feature. This plan treats Jordan naming this ship tonight as the unlock for these files only. Please confirm.

## Callers that send `activate: true` (checked in the code and database)

| # | Caller | Sends itemIds? | Whole-store? | Breaks with the new 400? |
|---|---|---|---|---|
| 1 | DB trigger `auto_deploy_brand_template()` Phase 2 (live definition) | No | **Yes** (the bug) | Fixed by adding `templateId` |
| 2 | `src/components/settings/DeployLocationWizard.tsx` L291 (new-store wizard, Phase 2) | No | **Yes** | **Yes** |
| 3 | `src/components/brand/LocationActivationList.tsx` L118 ("deploy to store" list) | No | **Yes** | **Yes** |
| 4 | `supabase/functions/vendor-sync-nightly/index.ts` L472 (parity auto-deploy) | Yes (`deployedItemIds`) | No | No |
| 5 | `supabase/functions/parse-vendor-invoice/index.ts` L576 (invoice match) | Yes (`matchedItemIds`) | No | No |

Older migration files (Sept 2026) hold earlier versions of the same trigger; only the live one matters. `deploy-location-inventory` makes no call, it just returns `deployedItemIds` (L720).

**Callers 2 and 3 would break.** Both already get the deploy response from `deploy-location-inventory`, which includes `deployedItemIds`. Proposed fix: pass `itemIds: deployedItemIds` in both calls. That's a one-line change each, with no change to the screens. If the list comes back empty, skip the sweep and show the existing "0 live" message. `deploy-location-inventory` itself is not touched.

## One decision needed: the "newly created in 30 minutes" rule

If the 30-minute new-row rule applies to every `activate: true` call, caller 5 (invoice match) can never switch on an existing inactive item again, and invoice matches always land on older rows. That would break invoice activation as it works today.

**Default, unless you say otherwise:**
- The 30-minute new-row rule (`already_exists`) applies only when `templateId` is sent, meaning a publish.
- These apply to every activation: the `manager_deactivated` block (any non-null `deactivated_by`) and "skip if already active".

Tell me if you want the 30-minute rule on every activation anyway.

## Files to change
1. New migration `0087_scope_brand_publish_activation.sql`
2. `supabase/functions/vendor-price-chase/index.ts`
3. `supabase/functions/_shared/vendorPriceChase.ts`
4. `src/components/settings/DeployLocationWizard.tsx` (pass itemIds only)
5. `src/components/brand/LocationActivationList.tsx` (pass itemIds only)
6. Tests: extend `_shared` chase tests (block reasons, nightly path unchanged) and add a request test for the 400 guard.

No data rows changed, nothing published, no template published or test-published.

## Migration SQL

This is the live definition copied exactly, with two changes: the Phase 2 body gets `'templateId', NEW.id`, and the search path becomes `public, pg_temp`.

```sql
CREATE OR REPLACE FUNCTION public.auto_deploy_brand_template()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
-- ...identical body to live definition, except Phase 2 body:
        body := jsonb_build_object(
          'locationId', v_loc.location_id,
          'activate', true,
          'includeInactive', true,
          'templateId', NEW.id
        )
-- ...Case 2 recipe cascade unchanged...
$function$;

alter function public.auto_deploy_brand_template() set search_path = public, pg_temp;
alter function public.cascade_brand_template_name() set search_path = public, pg_temp;
revoke execute on function public.auto_deploy_brand_template() from public, anon, authenticated;
revoke execute on function public.cascade_brand_template_name() from public, anon, authenticated;
```

The full migration will contain the complete function text, copied from the live definition I read.

## Code diff

### `_shared/vendorPriceChase.ts`
```ts
// ChaseItem: add optional fields (sweep only)
  is_active?: boolean | null;
  deactivated_by?: string | null;
  created_at?: string | null;

// SkipReason: add
  | "manager_deactivated" | "already_exists" | "already_active"

// chasePrices opts: add
  opts: { windowDays?: number; activateOnHit?: boolean; newRowSince?: string } = {}

// activationBlock
const activationBlock = (item: ChaseItem): SkipReason | null => {
  if (!activateOnHit) return null;
  if (item.is_active === true) return "already_active";      // no write to is_active
  if (item.deactivated_by != null) return "manager_deactivated";
  if (opts.newRowSince && (!item.created_at || item.created_at < opts.newRowSince))
    return "already_exists";
  if (!item.brand_item_id) return "no_brand_link";
  if (!liveTemplates.has(item.brand_item_id)) return "template_not_live";
  return null;
};

export const CHASE_SWEEP_SELECT = CHASE_SELECT + ", is_active, deactivated_by, created_at";
```
`already_active` is not added to the skip list. It just leaves `is_active` alone, and the price refresh still happens. The block already covers both the price-hit path (L543) and the house-made path (L444). Without `activateOnHit` the function returns null first, so the nightly run and the other price-only callers behave exactly as before. `CHASE_SELECT` itself is unchanged.

### `vendor-price-chase/index.ts`
```ts
const templateId: string | null = typeof body?.templateId === "string" ? body.templateId : null;
if (activate && !templateId && itemIds.length === 0)
  return json400({ error: "activate requires templateId or itemIds" });

// buildQuery
.select(activate ? CHASE_SWEEP_SELECT : CHASE_SELECT)
if (activate && templateId) q = q.eq("brand_item_id", templateId);

// race retry: templateId mode only
if (activate && templateId && items.length === 0) {
  for (let t = 0; t < 3 && items.length === 0; t++) {
    await new Promise(r => setTimeout(r, 4000));
    reload();  // same paged loader
  }
}

const newRowSince = templateId ? new Date(Date.now() - 30 * 60_000).toISOString() : undefined;
chasePrices(..., activate ? { activateOnHit: true, windowDays: SWEEP_WINDOW_DAYS, newRowSince } : {});
```
The recipe integrity scan stays as it is (flag only).

### Callers 2 and 3
```ts
// DeployLocationWizard.tsx: thread deployed ids alongside deployRunId
body: { locationId, itemIds: deployedItemIds, activate: true, includeInactive: true, source, deployRunId }
// LocationActivationList.tsx
body: { locationId, itemIds: deployData?.deployedItemIds ?? [], activate: true, ... }
```

## Deploy and verify
- Deploy `vendor-price-chase` only. The four `_shared` callers pick up the shared file on their next deploy, and their behavior doesn't change without `activateOnHit`.
- Tests to run: the block reasons; the nightly path never writes `is_active`; the 400 guard; the `templateId` filter.
- Read-only check: the function definition after the migration shows the new body, the new search path, and the removed EXECUTE grants.
- Not touched: punch/kiosk code, the shift_offer_claims policy, `deploy-location-inventory`, and any data rows.
