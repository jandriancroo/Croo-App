# Add "Shift Manager in Training" to every remaining role picker

The role exists and is already wired into user management, chats, announcements, and the checklist assignee picker. An audit found several places where roles are still selectable or displayed from a hard-coded list that omits it.

## Role pickers to update (checkbox / chip lists)

- Shift Templates — "Allowed roles" checkbox list
- Schedule Templates — "Allowed roles" checkbox list
- Schedule Events row — "Tagged roles" checkbox list
- Tasks: Create Temporary Task, Edit Temporary Task, Edit Template — role visibility lists

In each list the new option is inserted directly below "Shift Manager", labeled "Shift Manager in Training".

## Display labels to update

Places that translate a role value into a readable name but would currently show the raw `shift_manager_in_training` string:

- Temporary task section and task details dialog role labels
- Schedule role-change confirmation text (two spots: schedule page and schedule data hook)

## Backend role lists to update

Server-side manager-role lists that gate data access, so a trainee gets the same shift-manager-level treatment:

- Schedule service: role rank map and the two manager-role arrays
- AI assistant: manager roles array and the shift-manager guidance branch
- User service: role type union
- Punch clock manager overlay and break editor manager grouping
- Onboarding tour minimum-role rank map

## Notes

- No permission behavior changes: the trainee continues to default to identical access to Shift Manager, throttleable from Org Settings → Roles & Permissions.
- No database changes needed; the enum, hierarchy functions, and seeded permissions are already in place.
