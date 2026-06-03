# Sandbox Count System

Super-admin-only feature for cloning real inventory counts into an isolated
testbed, validating fixes against the clone, then deploying validated fixes
globally with Lovable chat-restore as the safety net.

## Visibility model

- `locations.requires_super_admin = true` hides a location from every role
  except those that pass `public.can_see_admin_locations(auth.uid())`.
- Today `can_see_admin_locations` returns true only for `super_admin`.
- Future: a `brand_admin` role will be added in **one place** — the helper
  function — and every dependent RLS policy inherits the change automatically.
- The Sandbox location is seeded as `name='Sandbox'`,
  `requires_super_admin=true`, `brand_id=<Blaze>`.

## Sandbox identity & scoping

- A super looks up the Sandbox by `(requires_super_admin=true AND name='Sandbox')`.
- Multiple supers share one Sandbox **location** but each owns their own
  sandbox **counts** via `inventory_counts.sandbox_owner = auth.uid()`. RLS
  enforces this at the DB layer.

## Workflow

1. Super clicks **Clone to Sandbox** on any real count.
   → `clone_count_to_sandbox(source_location_id, source_count_id)` runs in a
   single transaction. Wipes any previous sandbox count owned by this super,
   then mirrors: `inventory_locations`, `inventory_items`,
   `location_pack_selections`, the `inventory_counts` row, all
   `inventory_count_items` (incl. `pan_inputs` JSON), and all
   `inventory_count_item_legs`.
2. Browser navigates to the cloned count. The **SandboxBanner** mounts.
3. Super clicks **Request fix for testing** → describes the bug → a
   `sandbox_active_fix` row is written + the **Request fix prompt** is
   copied. Paste into Lovable chat.
4. Lovable returns a sandbox-gated fix. Super views the sandbox count to
   verify visually. Mounting the count stamps
   `sandbox_active_fix.last_viewed_at`.
5. **Deploy fix** button enables only when `last_viewed_at > requested_at`
   (i.e. the super has actually looked at the sandbox after the fix landed).
6. Super clicks Deploy fix → the **Deploy fix prompt** is copied + the row
   is marked `deployed_at`. Paste into Lovable chat. The gate is removed,
   the fix applies globally. Undo: Lovable chat-restore.

## Lowest-level gating example

For a bug in `inner_pack_quantity_at_count` rollup, the gate should live
inside the calculation function (`countItemValue.ts`):

```ts
export function countItemValue(item: CountItem, ctx: Ctx) {
  if (ctx.is_sandbox) {
    // corrected math
    return entered_units * cost_at_count;
  }
  // original (buggy) math, preserved byte-for-byte
  return (entered_units * cost_at_count) / inner_pack_quantity_at_count;
}
```

If the gate would force changes in 2+ files just to thread `is_sandbox`,
that means the gate belongs deeper: push `is_sandbox` (or
`requires_super_admin`) into the source query once and every consumer reads
it for free.

## Files

- `supabase` migration: `locations.requires_super_admin`, `locations.brand_id`,
  `inventory_counts.cloned_from_*`, `sandbox_active_fix` table,
  `can_see_admin_locations`, `clone_count_to_sandbox` RPC.
- `src/components/inventory/SandboxBanner.tsx` — banner UI + prompt builders.
- `src/components/inventory/CloneToSandboxButton.tsx` — launcher.

## Future role: brand_admin

Already architected for. To add later:

1. Add `brand_admin` to the `app_role` enum.
2. Add one OR clause to `can_see_admin_locations`.
3. Decide whether each brand gets its own Sandbox location (set
   `locations.brand_id` accordingly) and whether `sandbox_owner` scoping
   should widen to `brand_id` scoping.

That is the entire change. No RLS policy edits required.
