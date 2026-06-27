## Stations Phase 2 — Schedule grouping + drag-to-assign

### What the user will see
On the weekly schedule, when **Stations are enabled** for the location:
- Outer sections become **Stations** (e.g. *Infants*, *Toddlers*, *Pre-K*) plus a trailing **Unassigned** bucket.
- Inside each station, people are sub-grouped by **role** (Super Admins → Org Admins → Managers → Team).
- Every person starts in **Unassigned** until they're placed.
- Admins/managers can **drag a person row** from one station section into another to set their primary station for this location. Setting persists immediately.
- The header gets a small "Stations" indicator and station counts (e.g. `Toddlers (3 employees)`).

When Stations are **disabled**, the schedule looks exactly like it does today (role-only grouping). Zero behavior change.

### Where it lives
- `MobileScheduleView.tsx` — primary view (the screenshot)
- Desktop weekly schedule (whichever component renders the grid the user sees on wider viewports)
- The same grouping is used by the printable Day Timeline export, so stations show up there too

### Technical plan

1. **DB** — store the per-location assignment, not on the global profile:
   - Add `primary_station_id uuid NULL references location_stations(id) ON DELETE SET NULL` to `user_locations`.
   - Index on `(location_id, primary_station_id)`.
   - No RLS changes needed (existing `user_locations` policies cover it).

2. **Hook** — `useUserStationAssignments(locationId)`:
   - Returns `Map<user_id, station_id|null>` for the current location.
   - Mutation `assignUserToStation(userId, stationId|null)` that updates the row and invalidates.

3. **Grouping util** — `groupRosterByStationThenRole(users, stations, assignments)`:
   - Returns `[{station, roleSections: [{role, users}]}, …, {station: null /* Unassigned */, roleSections}]`.
   - Stations honor `sort_order`; empty stations still render (so you have a drop target).

4. **Schedule view changes** (gated on `stations_enabled` + `stations.length > 0`):
   - Replace the current role-only section loop with the new nested structure.
   - Station headers show name + color dot + employee count.
   - Each person row becomes a `dnd-kit` draggable; station headers are drop zones.
   - On drop → call `assignUserToStation`.
   - Permission gate: only admins/managers see drag handles; team members see read-only grouping.

5. **Day Timeline print** — pass the same grouping into `exportDayTimelinePrint` so the PDF roster mirrors the on-screen layout.

### Out of scope (can do later, just say the word)
- Per-shift station overrides (the Hybrid model we discussed) — this plan only does the *person's primary station*. A shift inherits its assignee's station for now.
- Drag a shift block onto a station header to override that one shift.
- Employee "qualified for multiple stations" picker on the profile.
