# Stations vs Positions + Primrose cleanup

Vocabulary: ROLE = permission level. POSITION = shift_templates.position. STATION = location_stations entry.
Mode per store = location_settings.stations_enabled (OFF = Position mode, ON = Station mode). Switching never deletes data.

## Step 1 — Station is a shift attribute (schedule only)

Shared helper (extend `src/utils/groupShiftsByStation.ts`, no new file):
- `effectiveStationId(shift) = shift.station_id ?? shift.template?.station_id ?? null`
- `groupShiftsByStation` buckets by `effectiveStationId` (inactive/missing station -> Unassigned)
- new `groupPeopleByStation(people, shifts, stations)` -> `{ station, rows: { person, shifts }[] , hours }[]`, used by the desktop grid only

Desktop grid in station mode (`src/pages/Schedule.tsx`):
- For each station section, a person gets a row if they have at least one shift that week whose effective station is that section. The row passes ONLY that section's shifts into the existing `EmployeeRow`.
- Unassigned section = shifts with no effective station, plus every person with zero shifts that week (empty row, so managers can still schedule them).
- A person can therefore appear in several sections. Section hour total = sum of that section's shifts. Overall labor/header totals keep reading the unfiltered `shifts` array (copy-week and labor totals untouched).
- `StationGroupSection`: remove `onDropUser` and the drag-over/drop handlers; keep collapse/header/hours.

Files:
- `src/utils/groupShiftsByStation.ts` (helper + tests in `groupShiftsByStation.test.ts`)
- `src/pages/Schedule.tsx` (grouping above, stop using `useUserStationAssignments`)
- `src/components/schedule/StationGroupSection.tsx` (drop-zone removed)
- `src/components/schedule/MobileScheduleView.tsx`, `DayBreakdownDialog.tsx`, `MobileDayPreviewSheet.tsx`, `src/utils/exportSchedulePrint.ts` (group via helper)
- `src/components/schedule/SmartTapPopover.tsx`: station column becomes "station for this new shift"; default = the cell's section; template pick creates the shift with `station_id` only if the pick differs from the template's station, else null
- `src/lib/scheduleActions.ts` `addShift`: add optional `station_id` to the existing row (same single insert); `src/hooks/useScheduleData.tsx` passes it through
- `src/components/schedule/MobileAddScheduleSheet.tsx`: replace the "primary station for this employee" block with a per-shift Station pick (default = template's station) written via the same insert
- `src/components/schedule/EditShiftDialog.tsx`, `MobileShiftDialog.tsx`: Station select (stations on only), default label "BOH (from template)", writes `scheduled_shifts.station_id` in the dialog's existing save (`updateShiftTimes` extra / existing insert); never touches `template_id`
- `src/pages/ScheduleSettings.tsx`: Station dropdown per template card (None + active stations) -> `shift_templates.station_id`, shown only when stations on. `/shift-templates` page untouched.
- Delete `src/hooks/useUserStationAssignments.ts` (only importers are the 4 files above). `user_locations.primary_station_id` column and data left alone.
- Station select options come from the existing `useLocationStations`.

## Step 2 — Checklists "Assigned to" + shift context hook

Migration (additive, applied via the migration tool):
```sql
ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS station_id uuid NULL REFERENCES public.location_stations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_role public.app_role NULL,
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS checklist_items_station_id_idx ON public.checklist_items(station_id) WHERE station_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS checklist_items_assigned_user_id_idx ON public.checklist_items(assigned_user_id) WHERE assigned_user_id IS NOT NULL;
COMMENT ON COLUMN public.checklist_items.position IS 'Position-mode assignment; one of position/station_id/assigned_role/assigned_user_id is set (or none).';
```
No data migration; existing position tags (Georgetown waste log, Hemet opening) keep working. The table's existing grants and RLS cover the new columns. `assigned_user_id` references `profiles` instead of `auth.users`, which is the project's rule for app tables.

Editing (`src/pages/CreateChecklist.tsx`, `src/pages/EditChecklist.tsx`, `src/components/tasks/EditTabContent.tsx`):
- One new picker component `src/components/tasks/TaskAssigneePicker.tsx` replaces the per-task Position dropdown in all three. Groups: Positions (Position mode) or Stations (Station mode), Roles, People at this location. Choosing one clears the other three fields.
- A stored position in Station mode stays visible as a selected "Position: X (position mode)" option, so it isn't lost.
- Switch label "Position Filtering" -> "Assign tasks"; helper text per mode. `position_filtering_enabled` is kept.

Shift context (`src/hooks/useUserPosition.tsx` -> becomes `useUserShiftContext`, file renamed `src/hooks/useUserShiftContext.ts`; `useUserPosition` removed since its only importer is CompleteChecklist):
- Returns `{ position, station, role, loading }` from ONE shift lookup.
- Store timezone from `location_settings.timezone`. Today's start/end are computed as real UTC instants in that timezone (Luxon), which fixes the PT evening miss.
- Clocked-in shift: latest punch at THIS location inside those bounds, `clock_in` with shift_id. Else today's shifts at this location on a published schedule (`schedules.is_published`), ordered by start_time: the one covering now, else the next upcoming, else the latest.
- station = `effectiveStationId(shift)`; role = the existing `useUserRole` result for this location.
- Read-only: no punch or kiosk code is touched.

`src/pages/CompleteChecklist.tsx` (extend existing filter/sort/headers, `positionFilter_<id>` switch kept):
- Visible when "My tasks" is on: untagged, plus position match (Position mode) or station match (Station mode), plus role match, plus assigned_user_id = me. No shift/station found = sees everything.
- Headers: Position mode = existing `formatPositionLabel`; Station mode = station name/color; then role headers, person-name headers; "General" last. Completion % stays whole-store.

## Step 3 — Copy tools + Primrose cleanup

- `src/hooks/useCloneLocationSettings.ts`: template copy maps `station_id` by station NAME in the target store (else null). Checklist item copy also carries station_id (by name), assigned_role, and assigned_user_id (only if that user is in the target location's user_locations).
- `src/components/tasks/CopyChecklistDialog.tsx`: same item fields plus `position` and `position_filtering_enabled`, reusing one small mapping function exported from `useCloneLocationSettings.ts` (not duplicated).

Primrose cleanup: this deletes data, so the migration tool is the wrong place for it (that tool is DDL-only). The same guarded block runs instead as ONE transaction through the database data tool, which will ask for your approval. First a dry run that ends in ROLLBACK and reports counts, then the real run after you say go. Deleting from auth.users with SQL works here, and the users' identities/sessions cascade. If the platform refuses it, the fallback is the admin user-delete call from a one-off backend function. I would tell you before using it.

```sql
DO $$
DECLARE
  v_loc uuid := 'f8b6e4fd-1c3e-4de4-8020-482426629249';
  v_org uuid := 'bcab5c3f-f65c-4beb-95de-4151f946b3ac';
  v_brand uuid := '1652f6d4-6c7e-4de1-9c10-51028d356e1f';
  v_users uuid[]; r record; n bigint;
BEGIN
  SELECT array_agg(id) INTO v_users FROM auth.users
   WHERE email ~ '^demo(0[1-9]|1[0-5])@demo\.croohq\.local$' OR email = 'aolson@primrosesouthreno.com';
  IF coalesce(array_length(v_users,1),0) <> 16 THEN RAISE EXCEPTION 'guard: expected 16 users, found %', coalesce(array_length(v_users,1),0); END IF;
  IF EXISTS (SELECT 1 FROM locations WHERE organization_id = v_org AND id <> v_loc) THEN RAISE EXCEPTION 'guard: org has other locations'; END IF;
  IF EXISTS (SELECT 1 FROM organizations WHERE brand_id = v_brand AND id <> v_org) THEN RAISE EXCEPTION 'guard: brand has other orgs'; END IF;
  IF EXISTS (SELECT 1 FROM user_locations WHERE user_id = ANY(v_users) AND location_id <> v_loc) THEN RAISE EXCEPTION 'guard: user in another location'; END IF;
  IF EXISTS (SELECT 1 FROM organization_members WHERE user_id = ANY(v_users) AND organization_id <> v_org) THEN RAISE EXCEPTION 'guard: user in another org'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = 'jordan@jo-pizza.com' AND id = ANY(v_users)) THEN RAISE EXCEPTION 'guard: jordan in list'; END IF;

  -- children of NO ACTION tables first
  DELETE FROM logbook_entry_values WHERE entry_id IN (SELECT id FROM logbook_entries WHERE location_id = v_loc);
  DELETE FROM logbook_fields WHERE category_id IN (SELECT id FROM logbook_categories WHERE location_id = v_loc);
  DELETE FROM scheduled_shifts WHERE schedule_id IN (SELECT id FROM schedules WHERE location_id = v_loc);
  DELETE FROM logbook_audit WHERE location_id = v_loc;
  DELETE FROM pkga_backup_rows WHERE location_id = v_loc;

  -- every NO ACTION/RESTRICT FK to locations / organizations / brands, read live from pg_constraint
  FOR r IN SELECT conrelid::regclass AS t, a.attname AS c, confrelid::regclass AS ref
    FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.contype = 'f' AND k.confdeltype IN ('a','r')
      AND k.confrelid IN ('public.locations'::regclass, 'public.organizations'::regclass, 'public.brands'::regclass)
      AND k.conrelid <> 'public.locations'::regclass
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = $1', r.t, r.c)
      USING CASE r.ref::text WHEN 'locations' THEN v_loc WHEN 'organizations' THEN v_org ELSE v_brand END;
  END LOOP;

  DELETE FROM locations WHERE id = v_loc;
  DELETE FROM organizations WHERE id = v_org;
  DELETE FROM brands WHERE id = v_brand;

  -- users: abort if any NO ACTION reference to them survives (would mean data outside Primrose)
  FOR r IN SELECT conrelid::regclass AS t, a.attname AS c
    FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.contype = 'f' AND k.confdeltype IN ('a','r')
      AND k.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = ANY($1)', r.t, r.c) INTO n USING v_users;
    IF n > 0 THEN RAISE EXCEPTION 'guard: %.% still references a Primrose user (% rows)', r.t, r.c, n; END IF;
  END LOOP;
  DELETE FROM user_roles WHERE user_id = ANY(v_users);
  DELETE FROM profiles WHERE id = ANY(v_users);
  DELETE FROM auth.users WHERE id = ANY(v_users);

  IF (SELECT count(*) FROM user_locations ul JOIN auth.users u ON u.id = ul.user_id WHERE u.email = 'jordan@jo-pizza.com') <> 17
    THEN RAISE EXCEPTION 'guard: jordan location count changed'; END IF;
  IF (SELECT count(*) FROM organization_members m JOIN auth.users u ON u.id = m.user_id WHERE u.email = 'jordan@jo-pizza.com') <> 3
    THEN RAISE EXCEPTION 'guard: jordan org count changed'; END IF;
END $$;
```
Already checked against the live data: 16 matching users, the org has 1 location, the brand has 1 org, Jordan has 18 store memberships (17 remain after this). The live store/org/brand link list currently has 25 blocking tables, all covered by the loop. Before running, the dry run also confirms that Jordan's 3 org memberships are outside Primrose and that logbook_audit/pkga_backup_rows have a location_id column. Any guard failure undoes everything. Nothing is done in Stripe.

## Reused, not rebuilt
location_stations, stations_enabled, shift_templates.station_id, scheduled_shifts.station_id, useLocationStations, groupShiftsByStation.ts (extended), StationGroupSection (trimmed), SmartTapPopover station column, EmployeeRow, CompleteChecklist filter/sort/headers and positionFilter_ switch, formatPositionLabel, useUserRole, scheduleActions.addShift / updateShiftTimes, useCloneLocationSettings, CopyChecklistDialog. New files: only TaskAssigneePicker.tsx and the renamed shift-context hook.

Untouched: punch clock, kiosk PIN/auth, auto-punch-out, labor cost math, schedule approval, restore/undo, any scheduled_shifts trigger.

## Confirming the build
After each step: the automatic build log must show "build OK", plus the project typecheck (`tsgo -p tsconfig.app.json`) with 0 errors and `bunx vitest run` all passing. I'll report all three. You can also check that the preview loads Schedule and a checklist without an error screen.
