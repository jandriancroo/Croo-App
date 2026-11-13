# Plan: Make an Org or Location Inactive (and back)

## What it does
- Only you can switch an **Org** or **Location** to Inactive and back. Nothing is deleted.
- **Badges:** Super Admin → All Organizations shows Active/Inactive on every Org and Location.
- **Buttons:** Location Settings has "Make Location Inactive," and Org Settings has "Make Org Inactive." Only you can see them.
- **Safety step:** you type the exact name, then wait out a 10-second countdown before the button unlocks. Switching back on needs one plain confirm.
- **Org off = all of its Locations off.** Turning the Org back on restores only the Locations that were on before.

## What happens to an Inactive Location
- Hidden from everyone's Location switcher, dashboards, promo trackers, Messages and hiring lists. You still reach it from All Organizations.
- Automatic work stops for it: sales pulls, alerts, emails, Theo, goal planning and Google reviews.
- Auto clock-out keeps running so no punch stays stuck open.

## What employees see
- **On several Locations:** the inactive one just disappears, and they keep working at the rest.
- **Only on inactive Locations:** they see "Your location isn't active in CrooHQ right now. Talk to your manager," with a Sign out button.
- **Employee accounts, roles and assignments are never changed.**

## Safety: active Orgs, Locations and users don't break
- **Nothing changes until you flip a switch.** Every active Org and Location keeps behaving exactly as today.
- **Adding, not changing:** the database only gets new fields and a new check. No existing data, access rules or employee records change.
- **Default is "active":** anything missing a value is treated as active, so a missing value can never hide a working Location.
- **Only you can flip it.** Org admins and managers can't switch it, even by accident.
- **Background jobs only skip inactive Locations.** Active ones run the same jobs as now.
- **Before shipping I'll check that:**
  - all 16 active Locations and their Orgs still show for their staff;
  - a multi-Location employee still signs in normally;
  - the dashboards and the switcher look the same for active Locations.
- **Easy undo:** switching back on brings everything back instantly, and the whole change can be reverted without touching data.

## Needs your OK
1. **Punch clock tablets** on an inactive Location would show "not active." This touches the punch clock, so it's in only if you say yes.
2. **Inventory jobs** are locked, so I'll leave them alone unless you say "unlock please."
3. The existing "[TEST] Sandbox (Retired Clone)" is already inactive, so it will drop out of switchers.
4. **The Delete button** will only appear once a Location is inactive, and only for you.

Not published until you say so.

---
### Technical details (short)
- **Migration (additive):**
  - nullable `deactivated_at` / `deactivated_by` on `locations` and `organizations`;
  - a `location_is_live()` helper;
  - super-admin-only `set_location_active` / `set_organization_active` RPCs;
  - a guard trigger so only super admin or service role can change `is_active`;
  - promo tracker RPCs and SQL crons filter on the live check.
  - No RLS or `has_location_access` changes.
- **Frontend:**
  - `useLocation` and `LocationPickerDialog` show live Locations only;
  - new no-active-Location screen;
  - badges in Settings → All Organizations;
  - a shared type-name/countdown dialog on `LocationProfile` and `OrganizationProfile`;
  - live filters in org/brand dashboards, promo, Messages, Hiring and the public application;
  - Delete in `LocationsSection` gated to inactive + super admin.
- **Edge functions:** a shared `_shared/locationLive.ts` skip used by the batch loops (labor, Theo, Quick Nudge, push, POS syncs, Google reviews, digests). Kiosk and inventory functions are untouched unless approved.
- **Tests:**
  - live-check cases (Location off, Org off, Org back on);
  - the non-super-admin guard;
  - signed-in browser checks on the TEST sandbox.
  - Build must pass.
