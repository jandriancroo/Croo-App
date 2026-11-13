# Plan: Switch an Org or Location Off (Archive) and Back On

## What you get
- Every **Location** and every **Org** gets an **Active / Inactive** switch. Only you (super admin) can flip it.
- Switched-off Locations and Orgs show an **Inactive** badge in Settings.
- Nothing is deleted. All schedules, punches, sales, labor, checklists, logbook, hiring and inventory history stays saved. Switching it back on brings everything back.
- **Org off = all of its Locations are treated as off**, but each Location keeps its own switch. When the Org comes back on, only the Locations that were on before come back. Nothing needs to be remembered or restored by hand.

## What employees see (no need to deactivate employees)
- **On several Locations, one switched off:** that Location disappears from their Location switcher. They sign in normally and keep working at the active ones.
- **Only on switched-off Locations:** after sign-in they see a simple screen: "Your location isn't active in CrooHQ right now. Talk to your manager." It has a Sign out button. Their account stays as it is, so they can sign straight back in if the Location is switched on again.
- **Employee accounts, roles and Location assignments are never changed** by the switch.

## Where it lives (your layout)
- **Super Admin → All Organizations list:** every Org and every Location shows an **Active** or **Inactive** badge. This is the one place you see the status of everything at a glance.
- **Location Settings page (each store):** a **Make Location Inactive** button at the bottom that only you can see. If the Location is already off, it changes to **Make Location Active**.
- **Org Settings page:** a **Make Org Inactive** button that only you can see, with the same on/off behavior.
- **Safety step when switching OFF:**
  1. A box opens explaining what will stop.
  2. You type the exact Location or Org name.
  3. The red button stays locked behind a **10-second cool-off countdown** and only unlocks when the name matches and the countdown ends.
- **Switching back ON** asks for a single plain confirm, with no countdown. *(Tell me if you want the countdown both ways or a different length.)*
- **Your Location switcher:** switched-off Locations are hidden there too, even for you. You open them from All Organizations, which takes you to Location Settings. *(Default. Tell me if you'd rather keep them in your switcher under an Inactive label.)*

## What stops for a switched-off Location (or Location in a switched-off Org)
- Shown nowhere for anyone but you: Location switcher, Org and Brand dashboards, promo trackers and their rankings, Messages store lists, hiring job pickers, and the public job application list.
- Automatic work skips it: sales pulls, labor refreshes, Theo briefings and insights, Quick Nudge, phone alerts, daily and weekly emails, overdue-checklist digests, goal planning, and Google reviews checks.
- **Left running on purpose:** auto clock-out still closes any punch that's still open, so no shift stays stuck.

## Delete button (default, since no answer was picked)
- The red Delete on a Location shows up **only after the Location is switched off**, and only for you, with a stronger "this permanently erases all data" confirm. *(Say "leave Delete as is" or "remove Delete" to change this.)*

## Things to confirm
1. **Punch clock tablets** paired to a switched-off Location would show "This location isn't active." That touches the punch/kiosk area, so it's **in only if you say yes**.
2. **Inventory jobs** (nightly count snapshots and inventory checks) are part of the locked Inventory system. I'll **leave them alone** unless you say "unlock please." They don't harm a switched-off Location, they just keep running.
3. The test location **"[TEST] Sandbox (Retired Clone)"** is already marked inactive. It will drop out of everyone's Location switcher (you'll still see it under Inactive).

## Not changing
- Employee accounts, roles, Location assignments, pay data, schedules and history.
- 3D cubes, the dock, version updates, support tickets, inventory (all locked).
- Database access rules for each Location's data stay as they are in this version, so switching a Location back on is instant and old reports and payroll exports still work.

---

## Technical details
**Database (one migration, additive only)**
- Add nullable `deactivated_at` and `deactivated_by` to `locations` and `organizations`. Both tables already have `is_active`.
- Helper `public.location_is_live(_location_id)`: `locations.is_active AND COALESCE(org.is_active, true)`. It's stable and SECURITY DEFINER, with `search_path = public, pg_temp`.
- RPCs `set_location_active(_location_id, _active)` and `set_organization_active(_org_id, _active)`. They're SECURITY DEFINER, `is_super_admin(auth.uid())` only, stamp the deactivated_* fields, and grant execute to authenticated only.
- Guard trigger on `locations` and `organizations`: changes to `is_active` are rejected unless the caller is super admin or service role. This stops org admins from flipping it through existing update policies.
- `list_promo_trackers` / `get_active_promo_tracker` and any SQL cron loops over locations (goal engine, Google reviews due-check) get a `location_is_live` filter. `run_auto_clock_out()` stays untouched.
- No changes to `has_location_access` or any RLS policy.

**Frontend**
- `src/hooks/useLocation.tsx`: select `is_active` plus `organizations(is_active)`. Everyone, including super admin, gets only live Locations in the switcher; inactive ones are opened from All Organizations. Saved and default Location fall back to the first live one.
- `src/components/LocationPickerDialog.tsx`: hide inactive Locations for everyone.
- New `src/components/NoActiveLocationScreen.tsx` plus a gate in the app shell, shown when the user isn't a super admin, has finished loading, and has zero live Locations.
- `src/pages/Settings.tsx` (All Organizations section): Active/Inactive badge on each Org and Location row. Inactive Locations still listed so you can open them.
- `src/pages/LocationProfile.tsx` (Location Settings): super-admin-only Make Inactive/Active button.
- `src/pages/OrganizationProfile.tsx` (Org Settings): super-admin-only Make Inactive/Active button.
- New `src/components/settings/ArchiveConfirmDialog.tsx`: shared type-the-name, 10-second countdown dialog used by both pages. It calls the super-admin RPCs.
- `src/components/settings/LocationsSection.tsx`: Delete shown only when the Location is off, for super admin only.
- `src/hooks/useOrgDashboardData.ts`, Brand dashboard, `src/lib/promoTrackers.ts`, Messages/Hiring Location lists, and the public application Location list: filter to live Locations.

**Edge functions (skip non-live Locations in batch loops; user-triggered calls for a dead Location return a quiet no-op)**
- Missing a filter today: labor-service, theo-day-insights, theo-voice, quick-nudge, send-push-notification, labor-rules-ai, maintenance-queue-processor, fresh-kds-service, toast-status, plus the toast/aloha/clover/qu sync loops and google-reviews-service once audited.
- Already filtering `is_active` (will switch to the shared live check so Org-off also counts): generate-daily-briefing, overdue-checklist-digest, availability-insights, labor-intelligence, maintenance-service, check-subscription.
- New `supabase/functions/_shared/locationLive.ts` used by all of the above.
- Untouched unless approved: punch-device-service (kiosk), inventory-snapshot-backfill, _shared/inventoryGate.ts, inventory-reconciliation-scan.

**Verify**
- Tests for `location_is_live`: Location off, Org off, both on, Org back on keeps an off Location off.
- Test that a non-super-admin can't flip `is_active` (guard trigger).
- Browser check as you: on the TEST sandbox Location Settings page, the button stays locked until the name is typed and the countdown ends. The badge flips in All Organizations, and the Location leaves and returns to the switcher.
- Check that a single-Location employee sees the notice screen, using a test account only.
- Build passes. Not published until you say so.

**Rollback**
- Revert the UI and function changes.
- The new columns, helper and RPCs can stay unused. Drop the guard trigger if needed.
