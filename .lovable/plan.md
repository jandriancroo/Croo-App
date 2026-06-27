# Stations for Scheduling

Add an optional per-location "Stations" layer (e.g. FOH / BOH / Patio, or Infant Room / Toddler Room / Pre-K) that groups the schedule view by Station → Role → Employee.

## 1. Schedule Settings tab — new section

In the existing Schedule Settings page, add a **Stations** card:

- Toggle: **Enable stations for this location** (off by default)
- When enabled, reveals an inline manager:
  - List of stations (drag to reorder)
  - Each row: name input, color swatch, delete
  - "+ Add station" button
- Help text: "Groups your schedule by station. Shifts without a station show under 'Unassigned'."

When the toggle is off, stations are completely hidden everywhere — no UI changes to existing screens.

## 2. Data model

New table `location_stations`:
- `location_id`, `name`, `color`, `sort_order`, `is_active`
- RLS: members of the location can read; managers+ can write

Add nullable `station_id` to:
- `shift_templates` (so a template carries a default station)
- `scheduled_shifts` (per-shift override)

Add `stations_enabled boolean default false` to `location_settings`.

Existing shifts: untouched. Null `station_id` = "Unassigned" bucket.

## 3. Schedule view changes (only when enabled)

**Desktop weekly grid** (`Schedule.tsx`): wrap employee rows in collapsible station section headers, colored by station. Inside each station, keep the existing role/employee ordering. "Unassigned" station appears last and is collapsed by default once at least one shift is tagged.

**Mobile schedule** (`MobileScheduleView.tsx`): same collapsible station headers above the day list.

**Mobile builder** (`MobileAddScheduleSheet.tsx`): station selector appears under the day chips when stations are enabled. Defaults to the template's station; can be overridden per shift. Smart Tap template list groups templates by station.

**Shift card**: small station dot/label next to the role line (only when enabled).

## 4. Templates

`ShiftTemplates.tsx` gets a Station dropdown on the template form (only visible when the active location has stations enabled). Existing templates default to "Unassigned" until edited.

## 5. Out of scope for this pass (easy follow-ups)

- Per-station coverage targets / labor %
- Station-scoped manager permissions (e.g. a room lead only edits their station)
- Filter chips to show one station at a time
- Brand-level default station list

---

### Technical notes

- Migration creates `location_stations`, adds `stations_enabled` to `location_settings`, adds `station_id` FK to `shift_templates` and `scheduled_shifts` (ON DELETE SET NULL).
- New hook `useLocationStations(locationId)` with React Query.
- Grouping helper `groupShiftsByStation(shifts, stations)` returns ordered sections with an "Unassigned" tail.
- All station UI gated on `location_settings.stations_enabled` so locked features (3D cubes, dock, etc.) and non-station locations see zero change.
- Timezone/date logic untouched — stations are purely an organizational tag.
