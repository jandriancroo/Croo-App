# Punch clock artwork keeps showing "Italian Escape"

## Root cause — confirmed

"Italian Escape" is not hardcoded anywhere. It is a saved artwork set for **Hemet** in `punch_clock_templates`, and the tablet picks it by accident.

The tablet's artwork lookup runs in two steps (`src/pages/PunchClock.tsx:531-611`):

1. First it looks for an artwork set that is "scheduled for right now" — `start_at <= now <= end_at`.
2. Only if it finds none does it read the artwork actually chosen and saved in Settings (`location_settings.punch_clock_background_url`).

The problem is step 1 never comes up empty. When someone picks "Always show" in the customization screen, the save writes an eternal window of the year 2000 through 2099 (`src/pages/PunchClockCustomization.tsx:326-343`), and the same eternal window is stamped onto every auto-seeded built-in set (`:190-191`, `:502-503`).

Live data confirms it for Hemet: all five sets — Nature, Historical, Italian Escape, March, Merry Christmas — carry the identical window `2000-01-01 → 2100-01-01` and all are active. The lookup then sorts by `start_at` descending and takes one row, but every row's `start_at` is identical, so the winner is effectively arbitrary and can stay pinned to Italian Escape no matter what Settings says. The chosen-artwork branch is skipped entirely.

So the save is working — it writes the choice correctly — but the tablet never reads it.

This also explains the "rerouting from an older fix" hunch: the always-on window was introduced so "Always show" would behave like a schedule, and that turned the scheduled-artwork branch into a permanent override.

## Floor workaround right now (no code)

For Hemet, give the wanted artwork a real, current date window in the customization screen (for example today through a year out) and set every other set — including Italian Escape — to a window that has already ended. The one with the latest start date wins, so the wanted artwork will stick immediately after the tablet reloads.

## Optimize vs named ship

This is a **named ship**, not an Optimize pass. It changes which artwork the tablet chooses, so Jordan should name it before anything is written.

Proposed fix, smallest version:
1. Stop treating "Always show" as a schedule. Save it with no window at all instead of the year-2000-to-2099 window, so the scheduled branch only matches genuinely date-limited artwork.
2. Make the tablet prefer the artwork saved in Settings, and only let a scheduled set override it when that set has a real, deliberately limited window.
3. Break ties by most recently updated instead of by start date, so identical windows can never pick a random winner.
4. Clean up the existing eternal windows on already-saved sets so the fix takes effect without every store re-saving.

Caching, the service worker, and the version stamp are not involved — the artwork is fetched fresh from the database on each punch clock load, not bundled or cached.

No code or data was changed.
