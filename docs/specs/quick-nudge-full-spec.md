# Quick Nudge: full spec

Owner: Jordan Andrian. Written by Ryan (Grok Bot), Oct 9, 2026.
Docs only. Nothing here is built yet unless section 1 says so.

How to read this:
- **From code** = what the repo does today (main, Oct 9).
- **From notes** = Jordan's decisions and earlier plans (`quick-nudge/PLAN.md`, the icon mockups, the Toast follow-up, MASTER-LIST).
- **Proposed (Ryan)** = my suggestion. Not decided. Jordan picks.

---

## 1. What v1 does today

### Status (from notes)
- v1 is live: Lovable deployment `24212bb2` (Oct 7, ~1:52 PM PT). Verified at Hemet.
- Icon: Jordan picked the E2 finger badge. Made bigger, outer circle and impact lines removed (live Oct 8).
- Oct 9: Quick Nudge now sees Toast clock-ins (Coop's Hayward).

### Who can send (from code)
- Managers and up only: `NUDGE_ROLES = manager, admin, org_admin, brand_admin, super_admin` (`_shared/theoActions.ts`, mirrored in `src/lib/quickNudges.ts`, a test keeps them equal).
- The sender must have access to the store (`has_location_access`). Others get 403.

### What can be nudged (from code, `_shared/nudgePlan.ts`)
Three target types: `checklist`, `task`, `event`.
- **Checklist:** must be on today's list, not locked (`lock_until_time`), have items, and not be complete. Training checklists and superseded versions are refused.
- **Task** (`temporary_tasks`): on the dashboard, not done, not expired, not personal (write-ups, Opus). Alarm tasks only while triggered and not done this interval.
- **Event** (`schedule_events` daily tasks): today, not checked off, not past its end time. Can be nudged before it starts (a heads-up).

### Who gets it (from code)
- No picking. Everyone on the clock at that store right now, minus the sender, minus anyone in cooldown.
- "On the clock" is one shared helper, `clockedInUserIds()` in `_shared/onClock.ts`:
  - Toast stores (`labor_source_for = 'toast'`, e.g. Coop's): open `toast_shifts` rows (no `out_time`), paired to a Croo user (`croo_user_id`), started in the last 24 h.
  - Every other store: `time_punches` with an open clock-in in the last 24 h (`onClockIds`).
- Then filtered to people linked to the store (`user_locations`) and active profiles (`nudgeData.ts` `nudgeAudience`).
- The server recomputes the list at send time.

### Cooldown (from code)
- 1 nudge per recipient per target (checklist family / task / event) per 60 minutes (`NUDGE_COOLDOWN_MIN`).
- Enforced again inside `record_nudges` under a lock, so two managers tapping at once can't double-send.
- People in cooldown are shown as "nudged Xm ago" and skipped.

### Message (from code)
- Editable text, 1 to 300 characters, prefilled from the store's default template.
- Smart fields: `{sender_first_name}`, `{recipient_first_name}`, `{item}` (alias `{checklist}`), `{item_type}`, `{event_time}`, `{done}`, `{total}`. Rendered per recipient on the server.
- A field the target doesn't have (e.g. `{event_time}` on a checklist) is greyed out in the sheet and refused by the server.
- Templates: per store, up to 5, one default. Edited in Settings → Nudge Templates (managers and up). Four seed templates: Friendly follow-up (default), Quick check-in, Before close, Heads-up.

### Delivery (from code)
- Web push. Title = the sender's first name (never "Theo"). `notification_type = 'quick_nudge'`.
- In-app card (`visual_alert_queue`, `alert_type 'quick_nudge'`), expires at the end of the business day.
- Tap: checklist → `/complete/<id>` (the named exception to "checklist pushes open the dashboard"); task/event → the in-app card (`/?alert=nudge:<type>:<batch>`).
- Every send is logged in `nudge_log` with push status `sent` / `no_device` / `failed`.

### Where it shows (from code)
- Dashboard checklist rows (`ChecklistsGrid.tsx`) and quick task / event pills (`TemporaryTaskCard.tsx`) via `NudgeBadge`.
- Sheet: `QuickNudgeSheet.tsx` (template chips, message box, "will see" preview, "Going to" list, Send).
- Theo chat and voice: action `quick_nudge`, preview card, sent only when the manager taps Send nudge.
- One send path for all of these: edge function `quick-nudge` (`options` never sends, `send` sends).

---

## 2. Full spec (what's still to build)

### 2.1 Other surfaces
From notes: only the dashboard, Theo chat and Theo voice exist. Catering orders, cash handling, spot checks, announcements, documents, I-9 and PIN tasks are not nudge targets.

Proposed (Ryan):
- **Checklists page** (the full list, not only the dashboard): same badge on each checklist row that passes `canNudgeChecklist`.
- **Checklist detail / review screen** (manager view of a list in progress): a "Nudge crew" button in the header.
- **Manager dashboard overlay / org view:** a nudge button next to incomplete or overdue lists per store, so an org admin can nudge a store they aren't standing in. Still goes through `quick-nudge`, still needs store access.
- **Overdue alert card and overdue push** (`check_alerts_sql`): add a "Nudge crew" action, so a manager who gets "X is overdue" can nudge in one tap.
- **Catering orders** as a 4th target type (`catering`), only if Jordan wants it (flagged in PLAN §13).
- **Apple Watch:** a "Nudge" action on the overdue complication. Later, lower priority.
- Rule for all of them: no new send path. Every surface calls `src/lib/quickNudges.ts` → `quick-nudge`.

### 2.2 Nudging groups
From notes: v1 has no picking by design (Jordan: "always everyone on the clock"). Open note from PLAN §13: tasks/events go to everyone on the clock even if the item isn't on their list.

Proposed (Ryan): keep "everyone on the clock" as the default, and add optional narrowing. Never widen past "on the clock now".
- **Group options in the sheet** (one chip row above "Going to"):
  - Everyone on the clock (default, today's behaviour)
  - By role / position (e.g. Kitchen, FOH, Shift leads), from the roles or stations on the current shift
  - People who can see this item (on the clock ∩ the checklist's role/user tags, or the task's assignments, or the event's tagged roles)
  - Pick people (checkboxes from the on-the-clock list)
- **Server rule:** the client sends a group key (and ids for "pick"); the server recomputes the on-the-clock set and intersects. A picked person who clocked out is dropped and listed.
- **Cooldown stays per person per target**, whatever group was used.
- **Theo:** "nudge Maria about…" uses "pick" with one person if she's on the clock; if not, Theo says so and offers everyone.
- **Saved groups per store** (e.g. "Closers"): later, only if the chips aren't enough.

### 2.3 Per-store settings
From code: the only per-store setting today is the templates. Cooldown (60 min), max length (300), roles (managers+) and "everyone on the clock" are hard-coded.

Proposed (Ryan): one "Quick Nudge" settings card per store (Settings → Nudge Templates becomes Settings → Quick Nudge, templates stay inside it). Stored in one table, e.g. `location_nudge_settings`, read by `nudgeData.ts` only.
| Setting | Default (= today) | Options |
|---|---|---|
| Quick Nudge on/off | On | Off hides the badge and the server refuses |
| Who can send | Managers and up | + Shift managers |
| Default audience | Everyone on the clock | Can see this item / By role |
| Allow narrowing (groups) | Off | On |
| Cooldown | 60 min | 15 / 30 / 60 / 120 |
| Max nudges per person per shift | none | e.g. 5 |
| Quiet window | none | no nudges in the first N min after clock-in, or during breaks |
| Target types | checklists, tasks, events | each on/off |
| Templates | 4 seeds | up to 5, one default (today) |
- Admins edit; managers read-only ("Set by your admin"), like the schedule approval settings.
- Org-level defaults that stores inherit: later.

### 2.4 Other gaps found in the notes and code
- **Breaks (Proposed (Ryan)):** someone on a break still counts as on the clock (open clock-in). Skip people on a break, or show them as "on break".
- **Toast unpaired staff (from code):** Toast shifts with no `croo_user_id` are skipped, so unpaired Coop's staff never get nudges. Proposed (Ryan): show "2 people on the clock aren't linked to Croo" in the sheet, with a link to the Toast mapping.
- **No device (from code):** `push_status = 'no_device'` is logged but the sender isn't told. Proposed (Ryan): after send, "Sent to 4 (1 has no phone notifications on; they'll see it in the app)".
- **Read / done tracking (Proposed (Ryan)):** v1 doesn't show whether the nudge worked. Add "seen" from the card, and "done after nudge" from completion, in a small history view.
- **Nudge history (Proposed (Ryan)):** `nudge_log` has the data but there is no screen. Add a per-store log (who, what, when, recipients, push status) for managers.
- **Theo drafting guard (from notes):** Theo-drafted text goes through `draftGuard`; dashboard text isn't filtered. Keep as is unless Jordan wants a filter.
- **Push tag (from notes):** `sw-push.js` uses one shared tag, so a nudge can replace an earlier banner. Proposed (Ryan): a per-batch tag for nudges.
- **Push caller auth (from notes):** `send-push-notification` has no caller authorization (existing gap, out of scope for nudges, still worth fixing).
- **Multi-store crew (from code):** a person on the clock at store A is never nudged for store B. That is correct; keep it.

---

## 3. Open questions for Jordan
1. Groups: keep "everyone on the clock" only, or add narrowing (role / can see it / pick people)?
2. For tasks and events, should the default be "everyone on the clock" or "people who can see this item"?
3. Should shift managers be able to send nudges (as a per-store setting)?
4. Which other surfaces first: Checklists page, overdue alert card, org/manager overlay, Watch?
5. Should the cooldown be per store, and should there be a cap per person per shift?
6. Skip people who are on a break?
7. Add catering orders as a nudge target?
8. Do you want a nudge history screen and "seen / done after nudge" tracking?
9. Who edits Quick Nudge settings: admins only, or managers too?
