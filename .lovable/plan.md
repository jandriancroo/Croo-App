# Sandbox Count — Build Plan

A safe testbed for validating inventory math fixes against a real-data snapshot, then deploying the fix globally. Lovable chat-restore is the undo.

---

## 1. Visibility gate — location-level, single chokepoint

### Where locations are fetched (audit)

The codebase has **no single chokepoint today**. There are three categories:

**Tier A — Global list providers (must gate):**
- `src/hooks/useLocation.tsx` (lines 90/98) — React Context, hydrates `locations[]` for the whole app. **Primary gate point.**
- `src/components/LocationPickerDialog.tsx` (lines 100/148/180) — its own switcher query. **Second gate point.**
- `src/hooks/useUserManagementData.tsx` (lines 195/201/208) — user mgmt lists.

**Tier B — Admin/dropdown lists (must gate so Sandbox never appears in pickers for non-supers):**
`useCloneLocationSettings.ts`, `useOrgDashboardData.ts`, `BrandDashboard.tsx`, `OrganizationProfile.tsx`, `LocationsSection.tsx`, `OrganizationMembersSection.tsx`, `Settings.tsx`, `Hiring.tsx` + hiring dialogs, `CopyChecklistDialog`, `CopyLogbookCategoryDialog`, `CopyEventCategoriesDialog`, `CopyShiftTemplatesDialog`, `DeployToLocationDialog`, `DeployLocationWizard`, `PositionManagement*`, `ShiftTemplates`, `VendorGapFinder`, `Inventory.tsx`, `inventoryRateCalculation.ts`, `varianceReport.ts`.

**Tier C — Single-row lookups by id (safe, no gate needed):** `Layout.tsx`, `InventoryItemsManager`, `StartCountDialog`, `InventoryCount`, `LocationProfile`, `PunchClockCustomization`, `resolveBrandId`, `PublicApplication`, etc.

### Strategy: RLS gate + one shared helper

Belt-and-suspenders, no per-file rewrites:

1. **DB column:** `locations.requires_super_admin boolean NOT NULL DEFAULT false`. Set `true` on the existing Sandbox location.
2. **RLS at the source:** update the `locations` SELECT policy to add `AND (requires_super_admin = false OR public.has_role(auth.uid(), 'super_admin'))`. This makes every Tier A/B query — present and future — automatically hide Sandbox from non-supers. **Zero per-screen filter work.** Tier C single-row lookups by id keep working because the supers who clone into Sandbox are also the only ones who'd ever query it by id.
3. **Defensive client filter** in `useLocation.tsx` only (in case RLS is loosened later or a super-admin wants to "hide sandbox" by default in their main UI): pass a `{ includeSandbox?: boolean }` option. Default `false` everywhere except `LocationPickerDialog` (so supers can switch into Sandbox) and the new sandbox UI.

No need to centralize the 40+ fetch sites first — RLS does the work.

---

## 2. Tables to clone

Confirmed against `src/integrations/supabase/types.ts`:

| Table | Why | Re-parent |
|---|---|---|
| `inventory_items` | Costing context (cost_per_unit, pack_quantity, inner_pack_quantity, unit, brand_item_id, pan_sizes…) | `location_id` → Sandbox; keep `brand_item_id` |
| `location_pack_selections` | Active pack configs per template | `location_id` → Sandbox |
| `inventory_counts` | The count row itself (`is_sandbox=true`, `sandbox_owner`, `cloned_from_location_id`, `cloned_from_count_id`, `cloned_at`) | new `id`, `location_id`=Sandbox |
| `inventory_count_items` | Entered cases/units/inner_packs, snapshots, pan_inputs (JSON col), pan_sizes_at_count (JSON col) | new `id`, `count_id`→new count, `item_id`→new sandbox item |
| `inventory_count_item_legs` | Per-pack-config legs | new `id`, `count_item_id`→new count_item |

**Not separate tables (already covered):**
- `pan_inputs` — JSON column on `inventory_count_items` / `..._legs`. Copies for free.
- `storage_location_breakdown` — doesn't exist in schema. Skip; flag if user knows where it lives.

**Storage locations (`inventory_locations`):** decision needed — easiest is to copy `inventory_locations` rows for the source location into Sandbox so `storage_location_id` FKs resolve. Otherwise null them out.

---

## 3. ID re-parenting (clone algorithm)

Single RPC `clone_count_to_sandbox(source_location_id uuid, source_count_id uuid) returns uuid` running in one transaction:

```text
1. Resolve sandbox_location_id from locations where requires_super_admin AND name='Sandbox' (or pass explicitly).
2. Wipe previous sandbox count for this owner (delete inventory_counts where is_sandbox AND sandbox_owner=auth.uid()).
   Cascades to inventory_count_items → inventory_count_item_legs.
   Also delete sandbox-scoped inventory_items / inventory_locations / location_pack_selections for sandbox_location_id.
3. Build id maps in CTEs:
   - inventory_locations: old_id → new_id (gen_random_uuid())
   - inventory_items:     old_id → new_id
4. INSERT inventory_locations cloned rows with location_id=sandbox.
5. INSERT inventory_items cloned rows with location_id=sandbox,
   storage_location_id = map(old.storage_location_id), keep brand_item_id, null linked_item_id.
6. INSERT location_pack_selections (location_id=sandbox, same brand_template_id/active_pack_config_id).
7. INSERT inventory_counts → new_count_id, is_sandbox=true, sandbox_owner=auth.uid(),
   cloned_from_location_id, cloned_from_count_id, cloned_at=now(), status=source.status.
8. INSERT inventory_count_items with count_id=new_count_id, item_id=map(item_id),
   storage_location_id=map(storage_location_id). Build count_item id map.
9. INSERT inventory_count_item_legs with count_item_id=map(count_item_id). pack_config_id stays as-is
   (brand-scoped, shared).
10. Return new_count_id.
```

Snapshot semantics: clone reads source at step time, so subsequent edits to source don't bleed in. Re-clone = repeat from step 2.

---

## 4. Banner UI

Rendered at the top of `InventoryCount.tsx` whenever `count.is_sandbox = true`. Sticky, full-width, amber-themed.

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 🧪 SANDBOX  cloned from Tuscaloosa · "Mon Jun 2 — weekly close" · 2h ago         │
│                                                                                  │
│ [ ↻ Re-clone from source ]   [ 🐞 Request fix for testing ]   [ 🚀 Deploy fix ] │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **Re-clone**: confirm dialog → runs `clone_count_to_sandbox(cloned_from_location_id, cloned_from_count_id)` → navigates to new sandbox count.
- **Request fix**: opens modal (bug textarea) → renders the "Request fix" prompt → "Copy" button.
- **Deploy fix**: enabled only when `sandbox_active_fix` row exists (see §6). Renders "Deploy fix" prompt → confirm "Lovable chat-restore is your undo. Continue?" → copy.

**Post-deploy notice** (separate component on `Inventory.tsx`, dismissible, auto-clears after 1h via localStorage timestamp):

```text
⚠️ Recently deployed fix from sandbox (24 min ago). Spot-check a real location;
   restore the Lovable chat if values look wrong.                       [ Dismiss ]
```

---

## 5. Prompt templates (the deliverable)

Both are generated client-side from the sandbox count context and copied to clipboard.

### 5a. "Request fix for testing" prompt

```text
SANDBOX-SCOPED FIX REQUEST

Context
- Sandbox count_id:        {new_count_id}
- Sandbox location_id:     {sandbox_location_id}  (requires_super_admin = true)
- Cloned from location:    {source_location_name} ({source_location_id})
- Cloned from count:       {source_count_label} ({source_count_id})
- Cloned at:               {cloned_at_iso}

Bug description (from user)
{user_bug_text}

Hard constraints — read carefully
1. The fix MUST be gated at the LOWEST level: inside the calculation function,
   keyed off the count being calculated. Use either:
     - count.is_sandbox === true, OR
     - location.requires_super_admin === true
   Do NOT wrap call sites. Do NOT add flags in hooks/components/pages.
   If the change appears to require gating in more than one file,
   STOP and report — the gate is at the wrong level.
2. Do NOT modify any RLS, GRANTs, or schema.
3. Do NOT touch real-data code paths. Behavior for non-sandbox counts must be
   byte-identical to current main.
4. Reply with: (a) exact file:line of the gate, (b) the diff, (c) one sentence
   on how to verify in the sandbox count above.

When done, the user will test against count_id {new_count_id} and, if happy,
ask a separate chat to "Deploy fix everywhere" using the matching template.
```

### 5b. "Deploy fix everywhere" prompt

```text
DEPLOY SANDBOX FIX GLOBALLY

A sandbox-gated fix is currently live at:
{file_path}:{line_range}

Originally requested for sandbox count_id {new_count_id}
(cloned from {source_location_name} / {source_count_label}).

Task
1. Remove ONLY the sandbox gate (the `if (count.is_sandbox)` /
   `location.requires_super_admin` branch) so the corrected logic applies to
   every count at every location.
2. Do not change the corrected math itself.
3. Do not touch RLS, GRANTs, or unrelated files.
4. Reply with the diff and confirm which files were touched.

Safety net: the user will rely on Lovable chat-restore if values look wrong
post-deploy — do not add any feature flags or rollout staging.
```

---

## 6. Lowest-level gating — worked example

Suppose the bug is the divide-by-`inner_pack_quantity_at_count` regression in `src/utils/countItemValue.ts`. Today it's a pure function; we add a gate on the data, not the call site.

**Before:**
```ts
export function countItemValue(item: CountItem): number {
  const ipq = item.inner_pack_quantity_at_count ?? 1;
  return (item.entered_units ?? 0) * (item.cost_at_count ?? 0) / ipq;
}
```

**Gated (sandbox-only fix under test):**
```ts
// SANDBOX-GATED FIX (2026-06-03): divide-by-ipq regression.
// Active only when the count being valued is a sandbox count.
// Once validated, remove the `if (item.is_sandbox)` branch and keep the
// corrected math as the default. See plan §5b.
export function countItemValue(item: CountItem): number {
  const ipq = item.inner_pack_quantity_at_count ?? 1;

  if (item.is_sandbox) {
    // corrected: don't divide; ipq is already baked into entered_units
    return (item.entered_units ?? 0) * (item.cost_at_count ?? 0);
  }

  return (item.entered_units ?? 0) * (item.cost_at_count ?? 0) / ipq;
}
```

Requirement: `CountItem` carries `is_sandbox` (joined from parent `inventory_counts`). Callers don't change. Aggregators don't change. If a fix would force changes in 2+ files just to thread the gate, that proves the gate belongs deeper (push the `is_sandbox` join into the source query once, then every fix reads it for free).

Tracking: a small `sandbox_active_fix` localStorage entry (`{file, lines, requestedAt}`) is written when the user clicks "Request fix" so the "Deploy fix" button knows what to mention. Optional follow-up: persist server-side later.

---

## 7. Open decisions before code

1. **Storage locations:** clone `inventory_locations` for the source location into Sandbox? (recommended yes)
2. **`storage_location_breakdown`:** confirm it doesn't exist or point me at the real name.
3. **Sandbox location identity:** match by `requires_super_admin = true` + name `'Sandbox'`, or hard-code an id in env?
4. **Multiple supers, one Sandbox location:** scope sandbox counts by `sandbox_owner = auth.uid()` (RLS), so each super sees only their own clones at that shared location. Confirm.

Reply with "go" (or with answers to the open decisions) and I'll ship it.
