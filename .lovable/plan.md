# Punch Clock: stop signed-in human entry, badge the pairing CTA

## Goal

1. Stop old-school humans from wandering into the punch clock after App Login (where they can overwrite a paired tablet's device session).
2. Make the paired-device path on the login screen more obvious.

## Why not hard-delete the route?

`/punch-clock` is load-bearing for:
- paired tablets restoring via `KioskAutoRestore.tsx`
- `PunchDeviceEntry.tsx` after a pairing code is redeemed
- `Auth.tsx` redirects when the signed-in session **is** the device user

So the route stays. Only the signed-in human-facing links are removed.

## Smallest safe ship

### 1. Strip the signed-in UI link
File: `src/components/Layout.tsx`
- Remove the `{ path: '/punch-clock', label: 'Punch Clock', icon: Clock }` entry from the desktop "Time" dropdown (`timeDropdownItems`, around line 802).
- Remove the same entry from the mobile Time sheet (`mobileTimeItems`, around line 861).
- Remove `/punch-clock` from the Time-dropdown active-path highlight list (around line 962).

This removes the path for any manager/org admin who has signed in via App Login, while leaving the route itself intact for paired devices.

### 2. Badge/enlarge the login-screen pairing CTA
File: `src/components/punchclock/PunchDeviceEntry.tsx`
- The button under the login form currently has three label states:
  - `"Open Punch Clock (Paired Device)"`
  - `"Punch Clock Needs Re-Pairing — Click Here"`
  - `"Setting Up a Punch Clock — Click Here"`
- Keep all three labels and the existing pairing logic.
- Change the button styling from the small muted link to a larger, pill/badge-style button with stronger contrast, larger icon, and clear tap target.

### 3. Changelog
Append one line to `SHARED_WORKSPACE/punch_clock/pairing-until-revoke.md`.

## What is intentionally NOT touched

- `/punch-clock` route in `src/App.tsx` stays.
- Punch Clock Devices manager (`/location/:id/punch-clock`) stays.
- Pairing/reissue/secret logic, TTL, Replace-vs-Add, device `1689ee2a`, Corrective Action, email, Universal Update — all untouched.
