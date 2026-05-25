<!--
Entries dated + attributed: [YYYY-MM-DD · Author: Lovable/Claude/Jordan]
STATUS: OPEN / IN-PROGRESS / DONE / WONTFIX
Newest entries at top. Never delete — strike-through or mark SUPERSEDED.
-->

# Duplicate Template Guard (Vendor SKU Twinning)

**STATUS: OPEN**

## Summary

Two `brand_inventory_templates` rows can silently share the same vendor SKU. When they do, syncs/deploys twin against both, splitting store coverage and confusing every downstream resolver (cost, vendor mapping, pack config, recipes).

Root cause of known incidents: an **April 3, 2026 double-write event** at the brand-template layer created duplicate templates for items already in the catalog. The Cold Cup Lids split (3-of-5 store coverage, requiring a 4-stage cleanup in May 2026) is the documented case.

No new dupes have been observed since April, but **nothing in the schema or code prevents it from happening again**.

## Required guard

At template create / vendor-mapping edit:

- Block (or hard-warn) when the SKU about to be attached already maps to another **live** template in the same brand.
- Surface the existing template in the warning so the user can choose: cancel, merge, or supersede.

Implementation surface:

- `brand_vendor_mappings` insert trigger, OR
- application-layer check in the template editor / mapping UI before write.

Prefer DB trigger — it catches every path, including future edge functions.

## Acceptance

- Attempt to map SKU `X` to template B when SKU `X` is already on live template A returns an error like:
  `Vendor SKU 603923 already maps to live template "Cold Cup Lids" (id …). Archive that template first or choose a different SKU.`
- Archived templates don't trip the guard — repointing during cleanup must remain possible.

## History

- [2026-05-25 · Lovable] Logged from Cold Cup Lids cleanup retrospective.
