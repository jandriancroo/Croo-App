<!--
Entries dated + attributed: [YYYY-MM-DD · Author: Lovable/Claude/Jordan]
STATUS: OPEN / IN-PROGRESS / DONE / WONTFIX
Newest entries at top. Never delete — strike-through or mark SUPERSEDED.
-->

# Cascade SKU Pollution

**STATUS: OPEN**

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
