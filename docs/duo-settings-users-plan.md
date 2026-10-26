# Duo build log: Settings, Users, My Profile, Location/Org, sub-pages (Oct 25 overnight)

_Stored in the repo (docs/) because the CrooHQ Project is full — remove old Project docs if you want it there too. Patterns referenced: Project doc claude/duo-ui-patterns.md._

Built and pushed to branch duo-dash-fixes (commits 51a16c027, 6e5da3daa). Not merged, not on TestFlight. Nothing was visually checked on the simulator; Jordan reviews page by page. Patterns referenced here are defined in duo-ui-patterns.md.

## Global changes that touch every page (check these first)
1. Overlay fallback (src/lib/duoOverlay.ts): every Dialog / AlertDialog / Sheet on Duo is auto-classed slide-over or popup. This also changes dialogs on pages not redone yet (Schedule, Inventory, Hiring...). If any dialog looks wrong, add `duo-native` to its className to opt out, or classify it by hand.
2. PageTitle now publishes the page name + status into the top band on every Duo page. Pages that are not themed yet will show BOTH the band page line and their old in-page title until they get `.duo-tasks-page` / `<DuoPage>`.

## Settings (/settings): master/detail
- List (left): Tour CrooHQ, then every section for the tab (Location / Org / Super Admin pills in one row at the top; pills show location name and org name).
- Rows that navigate (Edit Location Settings, Inventory, Customize Punch Clock, Plans & Billing, Reporting, Live KDS, Plan Catalogs, System Alerts, Edit Org Settings) keep a chevron and go to their page. Support chats opens the support inbox and shows the unread badge.
- Rows that are panels (Theme, Theo Voice, Notifications, Nudge Templates, Audit Results, Org Admins, Roles & Permissions, Positions, Brands, All Organizations, System Maintenance, PIN Migration, Theo Usage) show in the RIGHT dock (open, first one selected) or a right slide-over (folded). No more accordions.
- Orb: none (shift managers keep it for Theo voice + long-press).
- To check: panels like Roles & Permissions are wide; confirm they fit the half pane. Theme panel still offers the old 8 themes (Duo's Auto/Paper/OLED switch is still the date-line tap on the Dash).

## Users (/users): list + docked profile
- Left: Active / Inactive pills + Select on one row; rows = avatar, name, last login, role, status badge, cert tick. Bulk mode shows checkboxes + Select all, and the existing bulk bar still appears.
- Open: Employee Profile docked right (first active user selected). Folded: row opens the profile as a slide-over.
- Orb (admins): Invite user, Select users, Update outdated, Add test employee (Hemet only), Certifications (everyone who sees the page). Invite, wage, resend, password dialogs are auto slide-over/popup.
- To check: the profile is long (photo, details, PIN, I-9, records, write-ups); the Save Changes bar is sticky at the bottom of the dock.

## My Profile (/my-profile)
- Left: photo + name, nickname, email, phone, birthday (flat form, no card, no Back button). Right dock (open) / below (folded): Punch PIN card.
- Orb: Save changes.

## Location Settings (/location/:id)
- Left: map, general info, timezone, business hours, blackout dates, time-off cutoff, break coverage. Right dock (open) / below (folded): Billing (super admin), Labor Rules, Integrations.
- Orb: Save settings. New location uses the same page (button reads from the orb).

## Org Settings (/organization/:id)
- Left: details, brand, locations list. Right dock (open) / below (folded): Library toggle, Org members, Roles & permissions, Positions, Punch clock devices, Apple Watch devices.
- Orb: Save settings, Add location.

## Settings sub-pages (DuoPage shell: themed, flat cards, page line from the title)
Billing, Reporting, Punch Clock Customization, Brand Management, Plan Catalogs (Super admin plans), System Alerts, Schedule Settings, Alert Feed, Certifications. These get theme + flat cards + the page line only. Each still needs its own pass for: orb actions, docked detail, and long forms. Suggested order for tomorrow: Punch Clock Customization (biggest, tabs), Schedule Settings (tabs), Certifications (list + dock), Billing, Reporting (builder + preview = natural two-pane), Brand Management, Plans, System Alerts, Alert Feed (list + dock).

## Not touched
Schedule, Inventory, Hiring, Timecard pages, Availability, My Team (My Team still uses the old layout), Dynamic checklist calendar, Testing checklist.

## Oct 25 evening pass (voice-review list) - built, NOT committed (waiting for "ship")
- Menu handle: 19x88 tab + 44px-wide invisible tap area. Crease: dock `::before` book-spine fade (Paper warm shadow / OLED faint glow), hard divider removed, OLED right pane lifted to 3%. Left pane width now `50vw - 20px` (main's right padding was shrinking it). Docked panes: 16px inset for rules, children keep text clear of Apple's column.
- Users Save bar: dock bottom padding 0, sticky, solid bg, right inset for the orb. Settings: Tour CrooHQ only at bottom of Location tab.
- Theme: src/lib/duoTheme.ts (Auto/Paper/OLED, localStorage), switch next to CrooHQ in the menu; Dash date no longer toggles. html background follows theme (beige-flash fix, unverified).
- Menu: collapsible Time group (My Timecard, Availability, Time Tracking), opens on those pages. Ovation: bubble pops out of its row (DuoOvation rewritten, no dialog).
- Chat inbox selector: Duo uses SegmentedControl pill, themed header. Support chats: docked list in open mode, conversation as duo-slide.
- DuoPage shell added to: My Timecard, Availability, My Team, Dynamic checklist calendar, Schedule, Hiring (main render), Time Tracking (PayrollReview), Testing checklist, Shift templates, Week template builder, Submission details, Temperature validation, Changelog, Multi-location dashboard, Brand dashboard, Create/Edit checklist.
- NOT done: Inventory family (locked, waits for "unlock please"), KDS, real master/detail + orb actions for Hiring/Schedule/Time pages (theme only so far), per-page duplicate slide-over audit, haptics.
