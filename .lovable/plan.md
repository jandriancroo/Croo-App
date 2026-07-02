# Sprint A — Lite Inventory Counts (Dry Run)

Goal: make `/inventory/{loc}/count/{countId}` work end-to-end for Lite locations, without touching any Brand-governed table. Same isolation standard as the Phase 2 rebuild — everything Lite-specific lives under `lite_*`.

## Scope changes from the gap list

- **AvT tab is a scope leak, not a future sprint.** Gate it off for Lite mode alongside Genius / PFG-sync empty states. Remove from roadmap.
- **Storage locations are single-assignment.** Nullable `storage_id` column on `lite_inventory_items`. No join table. Multi-storage can come later if ever needed.

---

## 1. Database — one migration, four steps

Order matters: storages exist before items reference them, items exist before counts snapshot them.

```text
lite_storage_locations
        │
        ▼ (nullable FK)
lite_inventory_items ──────┐
                           │
                           ▼
                lite_inventory_counts
                           │
                           ▼
             lite_inventory_count_items
             (snapshots cost + storage at count time)
```

### 1a. `lite_storage_locations`
- `id`, `location_id → locations`, `name`, `sort_order int`, `is_active bool default true`, timestamps
- Unique `(location_id, lower(name))` to prevent dupes
- RLS: `has_location_access(auth.uid(), location_id)` on all four verbs
- GRANTs: `authenticated` + `service_role`

### 1b. Add columns to `lite_inventory_items`
- `storage_id uuid null references lite_storage_locations(id) on delete set null`
- No backfill — existing items sit in "Unassigned" bucket until moved
- Index on `(location_id, storage_id)` for count-session grouping

### 1c. `lite_inventory_counts`
- `id`, `location_id`, `period_start date`, `period_end date`, `status text default 'draft'` (`draft` | `submitted`), `submitted_by`, `submitted_at`, `created_by`, timestamps
- Unique `(location_id, period_end)` — one weekly count per location per week
- RLS + GRANTs same pattern as above

### 1d. `lite_inventory_count_items`
- `id`, `count_id → lite_inventory_counts on delete cascade`, `item_id → lite_inventory_items on delete restrict`
- `quantity numeric(12,3)`, `unit_value_at_count numeric(12,4)`, `storage_id_at_count uuid null`, `counted_by`, `counted_at`, timestamps
- Unique `(count_id, item_id)` — one row per item per count
- Snapshot fields (`unit_value_at_count`, `storage_id_at_count`) are the immutability guarantee — same principle as `cost_at_count` on Brand
- RLS + GRANTs

**Non-negotiable:** every CREATE TABLE followed by GRANTs, then RLS enable, then policies. Same four-step structure Phase 2 used.

---

## 2. Archive/unarchive (item #1)

- Add "Archive" action to `LiteInventoryItemsList` row menu → `update({ is_active: false })`
- Add "Include archived" toggle at top of list — when off (default), keep existing `.eq("is_active", true)` filter
- Archived items are excluded from count sessions automatically

No schema change — column already exists.

---

## 3. Storage locations UI

- New settings screen: `LiteStorageLocationsManager` — list + add/rename/reorder/archive
- Per-item picker: single `<Select>` on the item row (or in an edit sheet) writing `storage_id`
- "Unassigned" is a virtual bucket rendered when `storage_id IS NULL`, always sorts last

---

## 4. Count session (item #5)

New component: `LiteCountSession` (mirrors Brand `InventoryCountSession` conceptually, isolated code).

- Route detection: in `InventoryCount.tsx`, branch on `useInventoryMode(locationId).isLite` → render `LiteCountSession`
- Reads active `lite_inventory_items` for the location, groups by `storage_id` (joined to `lite_storage_locations.name`), Unassigned last
- Per-row quantity input; on blur/enter, upsert into `lite_inventory_count_items` with `unit_value_at_count = item.cost_per_unit` and `storage_id_at_count = item.storage_id` (snapshot at write time)
- Progress = counted rows / total active rows
- Total Value = Σ(qty × unit_value_at_count)
- Submit: `update lite_inventory_counts set status='submitted', submitted_by, submitted_at`
- Continue Counting: navigates back to the session with `?continue=true`

Snapshot rule: once a row is written, editing quantity leaves `unit_value_at_count` and `storage_id_at_count` alone. If cost or storage on the item changes later, the count row keeps what was true when it was counted. Matches every other snapshot table (`inventory_count_items.cost_at_count`, invoice line vs item pack_size split we shipped tonight).

---

## 5. Count creation entry point

- `Inventory.tsx` "New Count" button — when Lite, insert into `lite_inventory_counts` (period = current week Sun–Sat, `America/Los_Angeles`) and navigate to `/inventory/{loc}/count/{id}`
- Brand path unchanged

---

## 6. AvT tab gate

- In the Lite inventory shell, hide the "Actual vs Theo" tab entirely — same pattern as the Genius tab hide for Lite
- If someone reaches the route directly, render the Lite empty state ("Actual vs Theo needs recipes — available in Brand Mode.")
- Remove from any Lite settings/roadmap surface

---

## 7. Files touched

**New**
- Migration (all schema in one file)
- `src/components/inventory/LiteStorageLocationsManager.tsx`
- `src/components/inventory/LiteCountSession.tsx`
- `src/hooks/useLiteCount.ts` (data hook for session state)

**Edited**
- `src/pages/InventoryCount.tsx` — Lite branch
- `src/pages/Inventory.tsx` — Lite "New Count" insert path, hide AvT tab
- `src/components/inventory/LiteInventoryItemsList.tsx` — archive action, storage picker column, "include archived" toggle

**Untouched**
- All Brand tables and components
- `parse-vendor-invoice-lite` edge function (unless we tack fee-filter on separately in Sprint B)
- `useInventoryMode`

---

## 8. Verification before shipping

- Migration diff: only new `lite_*` tables + one column on `lite_inventory_items`; no ALTER on any Brand table
- `SELECT conname, confrelid::regclass FROM pg_constraint WHERE conrelid::regclass::text LIKE 'lite_%' AND contype='f'` → FKs only point at `locations` or other `lite_*` tables
- Grep proof: `rg "inventory_items|inventory_counts|inventory_count_items" src/components/inventory/Lite*` returns zero hits on Brand names
- Manual smoke on `5ce2f74e…` (Lite): create 2 storages, assign 5 items across them + leave 3 unassigned, start count, enter quantities, submit → row count and totals match hand math
- Brand-store regression: create + submit a count on a Brand location (e.g. Hemet) → unchanged flow

---

## Out of scope for Sprint A (explicit)

- Fee-line filter + duplicate collapse (Sprint B)
- Categories (Sprint B, if wanted — text column, not a table)
- Waste/transfers/usage rates (not planned)
- AvT for Lite (removed from roadmap)
- Multi-storage per item (may never happen)
- `lite_inventory_count_item_legs` (per-storage split counts — defer until asked for)
