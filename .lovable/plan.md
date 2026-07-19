# Kiosk RLS: schedule_events hotfix + device-scoped mirrored policies

Two migrations, in order. Migration 1 is a standalone hotfix. Migration 2 is the kiosk work. Validation is live against a paired tablet.

---

## Migration 1 — schedule_events hotfix (ship first, alone)

Drop the permissive `USING (true)` policy on `schedule_events`. The properly-scoped `Users can view events at their locations` policy already covers legitimate reads.

```sql
DROP POLICY IF EXISTS "Users can view all events" ON public.schedule_events;
```

### Audit of other `USING (true)` policies on `{public}` / `{authenticated}` roles

I ran the same check across the whole schema. 42 policies match. They fall into three buckets:

**Real multi-tenant leaks — same shape as schedule_events, need scoped replacements (not fixing in this plan, flagging for follow-up):**

- `schedule_events` — Users can view all events *(fixed in Migration 1)*
- `shift_templates` — Users can view all shift templates
- `kds_orders` — Authenticated users can view kds_orders
- `sales_aggregates` — Service role can manage sales aggregates *(`{public}` + ALL — worst case)*
- `schedule_projected_sales` — Users can view projected sales
- `vendor_invoices` — Users can view invoices at their locations *(name lies; body is `USING (true)`)*
- `vendor_invoice_items` — Users can view invoice items
- `daily_summary_logs` — Authenticated users can view summary logs
- `shift_offer_claims` — Anyone can view shift claims
- `alert_queue` — Authenticated users can read alerts

**Cross-user visibility (may be intentional, review recommended):**

- `user_roles` — Users can view all roles
- `role_permissions`, `role_notification_settings`, `organization_positions`

**Catalog / lookup / library tables (likely intentional, low risk):**

- `library_*` (5), `plan*` (4), `pa_catalog_items`, `pfg_bid_items`, `brand_event_categories`, `brand_inventory_categories`, `brand_inventory_staging`, `checklist_items`, `checklist_prep_rows`, `checklist_role_tags`, `checklist_user_tags`, `feed_badges`, `game_high_scores`, `labor_rule_presets`, `logbook_fields`, `opus_resource_index`, `location_plan_overrides`, `pfg_orders` (service role), `applicant_push_subscriptions` (service role)

After Migration 1 ships, I'll surface the "Real multi-tenant leaks" bucket for scoping decisions — each needs its own targeted policy replacement, and some of them (vendor_invoices, kds_orders) are business-critical to get right.

---

## Migration 2 — is_punch_device helper + mirrored kiosk policies

### The helper

```sql
CREATE OR REPLACE FUNCTION public.is_punch_device(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.punch_clock_devices
    WHERE auth_user_id = _user_id AND revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.punch_device_location(_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT location_id FROM public.punch_clock_devices
  WHERE auth_user_id = _user_id AND revoked_at IS NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.is_punch_device(uuid), public.punch_device_location(uuid) TO authenticated;
```

Authorization comes from the `punch_clock_devices` row, not from `raw_user_meta_data`. Metadata is never read for authz.

### Policy shape (InitPlan-wrapped)

Every mirrored policy uses the same template. Both helper calls are wrapped in `(SELECT …)` so Postgres evaluates them once per query, not once per row:

```sql
CREATE POLICY "Punch device can read <table> at its location"
ON public.<table> FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND location_id = (SELECT public.punch_device_location(auth.uid()))
);
```

For tables without a direct `location_id` column, the join runs through the parent's `location_id` using the same InitPlan pattern:

```sql
-- checklist_submissions has location_id — direct match
-- alarm_task_completions joins via temporary_tasks
CREATE POLICY "Punch device can read alarm completions at its location"
ON public.alarm_task_completions FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.temporary_tasks tt
    WHERE tt.id = alarm_task_completions.task_id
      AND tt.location_id = (SELECT public.punch_device_location(auth.uid()))
  )
);
```

### Coverage — 13 dashboard tables + punch-flow tables

Each gets one additive `SELECT` policy scoped to the device's assigned location. No existing policies modified.

**Direct `location_id`:** `sales_cache`, `labor_cache`, `location_settings`, `time_punches`, `schedule_events`, `checklists`, `checklist_submissions`, `temporary_tasks`, `punch_clock_templates`

**Joined location:**
- `scheduled_shifts` → via `schedules.location_id`
- `temporary_task_subtasks` → via `temporary_tasks.location_id`
- `task_subtask_completions` → via `temporary_task_subtasks` → `temporary_tasks.location_id`
- `event_task_completions` → via `schedule_events.location_id`
- `alarm_task_completions` → via `temporary_tasks.location_id`

**`profiles` (special — needed for both PIN lookup and active-shift roster):**

```sql
CREATE POLICY "Punch device can read profiles at its location"
ON public.profiles FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = profiles.id
      AND ul.location_id = (SELECT public.punch_device_location(auth.uid()))
  )
);
```

Only staff assigned to the device's location are readable. Cross-location staff invisible.

**Write policies for the punch flow:**

- `time_punches` — already has `Allow punch clock inserts` (INSERT `{public}`, no qual). Covers device inserts.
- `punch_clock_attempts` — already has `Anyone can log punch clock attempts` (INSERT `{public}`). Covers device inserts.

Both open write policies pre-date this work and are fine — they only permit `INSERT`, and the incoming rows always carry the device's location_id from the client (the writes were designed for the anon kiosk model).

### What is NOT granted

Confirmed by exclusion — device users still cannot read: `user_roles`, `user_locations`, `locations`, `punch_clock_pairing_codes`, or any table not listed above. `punch_clock_devices` remains restricted to `auth_user_id = auth.uid()` (own row only).

---

## Validation protocol (before declaring done)

Executed against a real paired tablet at Sandbox location:

1. Pair a fresh device, capture the device's `auth_user_id`.
2. Sign in as a manager on the same tablet, open Punch Clock, enter PIN, land on ManagerDashboardOverlay. Screenshot every tile: sales card, hourly chart, labor % badge, active-shift roster, quick-tasks list, checklist completion badge.
3. Exit to `/auth`. Confirm device session is now active (not the manager's).
4. Re-enter kiosk mode as the device (no manager session), enter PIN, open ManagerDashboardOverlay. Screenshot every tile again.
5. Diff the two screenshots. Any tile that renders in step 2 but is empty in step 4 = missing table grant. Loop back and add.
6. Punch flow end-to-end on the device session: PIN entry (profiles read) → clock in (time_punches insert) → clock out (time_punches insert). Verify rows written with correct location_id and user_id.
7. Negative test: run a `.from('sales_cache').select().neq('location_id', <paired_location>)` from the device console. Must return zero rows.

Only after 5 passes with zero delta and 6+7 succeed will I report complete.

---

## Technical notes

- Both helpers are `SECURITY DEFINER` and read only `punch_clock_devices`, which has no policy path back to itself — no recursion risk.
- `punch_clock_devices` is small (one row per tablet), so `punch_device_location()` is effectively free even without the InitPlan wrap; wrapping still matters for the composed EXISTS subqueries.
- All new policies are additive and named `Punch device can read <table> at its location` for greppability and easy rollback.
- Migration 1 is idempotent (`DROP POLICY IF EXISTS`); Migration 2 uses `CREATE POLICY` (fails loud if run twice, intentional).
