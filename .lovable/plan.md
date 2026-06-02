# Sandbox Count — Plan

A throwaway count workspace for the super admin to create, count, and delete without ever touching real numbers.

## Goal

A super admin can start a new count flagged `is_sandbox = true`, owned by their `user_id`, that:
- Uses the real count UI (same items, same lens, same pack config).
- Is **invisible** to every aggregation: COGS card, AvT/variance reports, period screen, location summary, dashboard rollups, brand dashboard.
- Is **invisible** to every other user, including other super admins.
- Can be created, edited, submitted, and deleted freely with no period gating, no lock, no audit triggers firing on the real period.

## Data model

### `inventory_counts` — add two columns

```
is_sandbox     boolean NOT NULL DEFAULT false
sandbox_owner  uuid    NULL                 -- auth.users(id); only set when is_sandbox = true
```

Partial index: `CREATE INDEX ON inventory_counts (sandbox_owner) WHERE is_sandbox = true;`

No FK to `auth.users` (project convention). `sandbox_owner` is set on insert by the client to `auth.uid()` and enforced by RLS.

### `inventory_count_items` — no schema change

Rows stay joined to their `count_id`. Because every read path joins through `inventory_counts`, hiding the parent hides the children.

## Read-path exclusion (the hard part)

Every query that aggregates counts must add `AND is_sandbox = false`. Inventory of every reader we must touch — based on this codebase:

| Path | Where to filter |
|---|---|
| COGS card / location summary | `useLegsValuation`, `src/utils/countItemValue.ts` callers that pull "latest count for location" |
| Period screen / period rollups | `useInventoryPeriodSettings`, `StartCountDialog.isPeriodCounted`, period-listing queries |
| AvT / variance / `inventory-reconciliation-scan` edge fn | adapter query that pulls counts per period |
| Org dashboard + Brand dashboard | `useOrgDashboardData`, brand-mode queries that sum location ending inventory |
| `inventory-snapshot-backfill`, `inventory-inner-pack-backfill`, `pan-baseline-backfill` | All `inventory_counts` selects |
| Maintenance / nightly jobs in `maintenance-queue-processor` that touch counts | same filter |
| Validation/reporting scripts in `SHARED_WORKSPACE/inventory/validation-*` | same filter |

To make this **fail-closed**, introduce one DB view + one helper and migrate readers to it:

```sql
CREATE VIEW public.inventory_counts_live AS
  SELECT * FROM public.inventory_counts WHERE is_sandbox = false;
GRANT SELECT ON public.inventory_counts_live TO authenticated, service_role;
```

Aggregation readers switch from `inventory_counts` → `inventory_counts_live`. The base table is reserved for (a) the sandbox UI itself and (b) admin tooling that explicitly opts in. New aggregation code written against the view can never accidentally include sandbox rows.

## Writer / lifecycle

- **Create:** new button "Start sandbox count" visible only when `useUserRole().isSuperAdmin`. Inserts `inventory_counts { is_sandbox: true, sandbox_owner: auth.uid(), period_type: 'sandbox', location_id: <current>, status: 'in_progress' }`. No `effective_at`, no period_end, no lock check.
- **Use:** reuses `InventoryCountSession` unchanged. Snapshots (`pack_quantity_at_count`, `inner_pack_quantity_at_count`) still write — they live on `inventory_count_items` and are harmless since the parent is sandboxed.
- **Submit / lock:** allowed, but submission writes `status='submitted'` only — does NOT call any period-close, AvT recompute, or backfill triggers. Easiest implementation: in the submit handler, branch on `count.is_sandbox` and skip the post-submit side-effect block.
- **Delete:** super admin can hard-delete their own sandbox counts (button in a sandbox-list drawer). Cascade deletes `inventory_count_items` via existing FK.

## RLS

```sql
-- Sandbox rows: owner-only access (no one else, not even other super admins)
CREATE POLICY "Sandbox counts visible to owner only"
  ON inventory_counts FOR SELECT
  USING (
    (is_sandbox = false AND <existing location-membership check>)
    OR (is_sandbox = true AND sandbox_owner = auth.uid()
        AND public.has_role(auth.uid(), 'super_admin'))
  );

CREATE POLICY "Sandbox counts insert (super admin only)"
  ON inventory_counts FOR INSERT
  WITH CHECK (
    (is_sandbox = false AND <existing insert check>)
    OR (is_sandbox = true AND sandbox_owner = auth.uid()
        AND public.has_role(auth.uid(), 'super_admin'))
  );

-- UPDATE / DELETE: sandbox owner only for sandbox rows; existing rules for real rows.
```

`inventory_count_items` RLS: extend existing policies with `OR EXISTS (SELECT 1 FROM inventory_counts c WHERE c.id = count_id AND c.is_sandbox AND c.sandbox_owner = auth.uid())`.

## UI

Three small touchpoints (super admin only):

1. **`InventoryCount` page** — header chip "🧪 Sandbox" + dashed border + amber accent when `count.is_sandbox = true`, so it's visually impossible to confuse with a real count.
2. **`Inventory` page** — under the existing count list, a collapsible "Sandbox counts (super admin)" section showing this user's sandbox counts with a "New sandbox count" button and per-row delete.
3. **No entry point in `StartCountDialog`** — sandbox creation is its own button, deliberately separated so a normal "Start count" tap can never produce a sandbox.

## Safety checklist before merge

- Grep every `from('inventory_counts')` / `FROM inventory_counts` in `src/`, `supabase/functions/`, and migrations. Aggregating readers must use `inventory_counts_live` (or add `is_sandbox = false`).
- Add a vitest covering `useLegsValuation` / `countItemValue` ignoring sandbox rows.
- Manual smoke: create sandbox count at one location → confirm location summary $, COGS card, period screen, org dashboard, brand dashboard, AvT report, and validation CSV all unchanged.

## Out of scope

- No sharing sandbox counts between users.
- No "promote sandbox to real count" path.
- No history/audit retention beyond what the base table already does.
