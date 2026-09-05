# Punch Clock: retire the signed-in human entry

## 1. Every UI entry that sends a signed-in human to `/punch-clock`

Full grep of `src`. There are exactly **two** human-facing entries, both in the same nav data, both gated on `canViewTimecards` (manager and above):

| Where | File:line | Label | Who sees it |
|---|---|---|---|
| Desktop header "Time" dropdown | `src/components/Layout.tsx:806-809` (`timeDropdownItems`) | "Punch Clock" | `canViewTimecards` |
| Mobile menu sheet → Time section | `src/components/Layout.tsx:865-868` (`mobileTimeItems`) | "Punch Clock" | `canViewTimecards` |

Not an entry, but related:
- `src/components/Layout.tsx:962` — `/punch-clock` in the Time-dropdown active-highlight list. Cosmetic.
- `src/App.tsx:218` — `/punch-clock` is an **unprotected** route (no `ProtectedRoute`), so a **bookmark or typed URL** works for anyone, signed in or out. This is the entry no menu change can close.
- `src/pages/Auth.tsx:133,163,174` — redirect after sign-in, but only when the session **is** the paired device user (`isPunchDeviceUser`). Not a human path.
- `src/components/KioskAutoRestore.tsx:52,58,71` — paired-tablet cold-launch restore.
- `src/components/punchclock/PunchDeviceEntry.tsx:35,66` — the login-screen pairing link (see below).

**No dashboard tile, widget, quick action, Settings link, or Alerts link navigates to `/punch-clock`.** The only Settings reference is the separate customization page `/location/:locationId/punch-clock` (`src/pages/Settings.tsx:521`), which is a design screen, not the clock.

### PunchDeviceEntry CTA text on the login screen
`src/components/punchclock/PunchDeviceEntry.tsx:83-87` — one button, three states:
- Paired and healthy: **"Open Punch Clock (Paired Device)"**
- Server says revoked: **"Punch Clock Needs Re-Pairing — Click Here"**
- Never paired: **"Setting Up a Punch Clock — Click Here"**

Dialog title **"Pair This Device"**, body: "Ask an org admin to generate a pairing code from Organization Settings → Punch Clock Devices. Codes are single-use and expire after 1 hour."


## 2. What happens when a human opens it on a paired tablet

`KioskAutoRestore.tsx:50` treats "path is `/punch-clock` and the current session is not the device" as an explicit request to re-enter kiosk mode: it runs `enterKioskMode('boot-restore')`, which **signs the human out and installs the device session** in the same browser profile. The reverse also happens — a human signing in on a paired tablet replaces the live device session, and pairing then has to reissue.

So on one profile there is exactly one Supabase session and the two models fight over it. Every hand-off burns a reissue, and every failed reissue is the "went down" symptom on the floor. On a manager's own phone/desktop the same tap silently signs *them* out.

## 3. Kill options, safest first

| Option | Effect | Risk |
|---|---|---|
| Remove the nav item only | Stops the accidental floor path; URL/bookmark still works | Lowest. Bookmarks survive |
| Nav removal + redirect unpaired visitors away from `/punch-clock` | Route only serves paired devices; humans land on Time Tracking | Low, and closes bookmarks |
| 404 the route | Breaks paired tablets and `Auth.tsx` redirects | Do not do |
| Gate behind `ProtectedRoute` | Wrong direction — the device session *is* a user; would not stop humans | No benefit |

## 4. Legitimate remaining uses

- Paired-tablet kiosk (device session) — must keep.
- `KioskAutoRestore` cold launch and `Auth.tsx` device redirect — must keep.
- Manager "let me look at the clock screen" — not real: the manager view is reached by swipe **inside** kiosk mode, and the PIN pad is useless without a device session and location.
- Universal Update / idle reload listen from inside `PunchClock.tsx`; unaffected.
- Desktop demo — nothing depends on it.

## 5. Recommendation

Yes — the human-signed-in punch clock should die, but by **hiding and redirecting, not deleting**. The route itself is load-bearing for paired tablets. Smallest ship: drop the Punch Clock entry from both nav lists in `Layout.tsx`, and add one guard at the top of `PunchClock.tsx` — if the device is not paired and the current session is a normal human, replace-navigate to `/time-tracking` with a short toast ("Punch Clock runs on a paired tablet"). Paired devices and the pairing link on the login screen behave exactly as today. No changes to pairing, reissue, secrets, TTL, Replace-vs-Add, or Universal Update.

### Files a ship would touch
- `src/components/Layout.tsx` — remove the two `/punch-clock` nav entries (and the path from the active list at line 962).
- `src/pages/PunchClock.tsx` — one early redirect guard for unpaired human sessions.
- `SHARED_WORKSPACE/punch_clock/pairing-until-revoke.md` — changelog line.
