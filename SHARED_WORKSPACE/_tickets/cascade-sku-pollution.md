<!--
Entries dated + attributed: [YYYY-MM-DD · Author: Lovable/Claude/Jordan]
STATUS: OPEN / IN-PROGRESS / DONE / WONTFIX
Newest entries at top. Never delete — strike-through or mark SUPERSEDED.
-->

# Cascade SKU Pollution

**STATUS: RESOLVED** (2026-06-13)

## Resolution [2026-06-13 · Lovable]

**Root cause:** `trg_auto_deploy_brand_template` on `brand_inventory_templates` fired on status→`live` transitions and iterated **every active location in the brand's org** via `net.http_post` to `deploy-location-inventory` — with **no `inventory_enabled` filter**. Disabled stores (Akers Mill, Anaheim, IUPUI, Niles, Reno S. Meadows, Sparks) received auto-deploys whenever any `(NEW)` template was promoted, stamping phantom rows into `inventory_items` + `brand_inventory_deployments` + `location_pack_selections`.

**Fix applied (Session 3):**
1. **Entry-point gate** — added `isInventoryEnabled()` helper (`supabase/functions/_shared/inventoryGate.ts`) and wired into `deploy-location-inventory`, `pfg-service`, `produce-alliance-service`, `pack-config-seeder`, `pack-selection-backfill`. Migration: `20260612234902_f0ce9025-ced2-4751-9f95-a8260bee2a3e.sql` + `20260612234935_58855673-00f7-4322-bb3b-5660d665a22e.sql`.
2. **Cleanup** — deleted 3 polluted rows from `location_pack_selections`, ~126 from `brand_inventory_deployments`, ~144 from `inventory_items` across the 6 disabled stores. Re-run matrix confirmed all-zero.
3. **Root-cause trigger fix** — `auto_deploy_brand_template` rewritten with `AND l.inventory_enabled = true` in Case 1's location loop. Case 2 (recipe ingredient cascade) preserved verbatim (UPDATE-only, cannot create pollution). Migration: `20260613015706_2dc5f875-8cd6-4966-a4e7-7c05cb37ce27.sql`.

**Note on `net.http_post`:** async/non-blocking (queues into `net.http_request_queue`), so template promotion latency is unaffected by location count.

**Verification:** `pg_get_functiondef('auto_deploy_brand_template')` confirms `AND l.inventory_enabled = true` is inside the `FOR v_loc IN` loop. Trigger only fires on transitions TO `live` (or INSERT with `status='live'`); draft promotions are no-ops by definition of the WHEN clause.

---

**STATUS: OPEN** (historical — superseded by resolution above)



## Summary

The **April 17, 2026** brand deploy cascade stamped `item_number` + `vendor_source` directly onto `inventory_items` rows at **every** location receiving a template — including the 7 not-yet-onboarded stores (Akers Mill, Anaheim, IUPUI, Niles, Reno, Sandbox, Sparks) that have no live PFG/PA integration.

Result: those stores carry **phantom vendor SKUs** they never actually source from. Surfaced during the Cold Cup Lids cleanup (May 2026) when 7 stores were found pointing at the legacy template with SKU `603923` stamped despite zero vendor connection.

## Fingerprint (use this to scope the broader audit)

```sql
SELECT location_id, COUNT(*)
FROM inventory_items
WHERE last_synced_at IS NULL
  AND item_number    IS NOT NULL
  AND vendor_source  IS NOT NULL
GROUP BY location_id;
```

`last_synced_at IS NULL` is the tell — no vendor sync ever wrote to these rows, the SKU came from the deploy cascade mirroring `brand_inventory_templates.item_number` at row-creation.

## Likely blast radius

Hundreds of rows across the 7 unonboarded stores. Cold Cup Lids was 7 rows × 1 SKU; whole catalog deploy was almost certainly 7 × (N templates with item_number set).

## Decision pending

Three options, not yet chosen:

1. **Scrub-in-place** — null out `item_number` + `vendor_source` on every row matching the fingerprint. Fastest, but loses the "this template *intends* to come from PFG" hint when the store does onboard.
2. **Deactivate-until-onboarded** — set `is_active = false` on every fingerprint row. Reversible; store onboarding can flip them back.
3. **Fix the deploy cascade itself** — stop mirroring vendor fields into `inventory_items` until a real sync occurs. Prevents recurrence; doesn't fix existing pollution (still need 1 or 2).

Likely answer: **3 + (1 or 2)** — fix forward, clean back.

## History

- [2026-05-25 · Lovable] Logged from Cold Cup Lids Stage 3b discovery. 7 stores' legacy-template rows were deactivated as a tactical fix; the systemic issue is documented here for later.
