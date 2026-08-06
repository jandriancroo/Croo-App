# Training Checklists + Manager Approval

## Answers to your questions

1. **No separate library.** Same Edit > Checklists page. One list with a **Templates** divider heading, and training templates listed under it with a small "Training" chip. No new page, no new tab.
2. **Yes — two trainees, same day, same template, separate everything.** Each assignment is its own record (template + person + date), so Johnny and Maria both do "Day 1" on Monday with their own responses, photos, timing, and their own approval. Logged individually in history under each person's name.
3. **Yes — approver can be a role or a person.** Pick "Shift Manager" and whoever is on shift can pick it up and approve; pick a person and only they get it. Uses the same `AssigneePicker` pattern already in the checklist editor.
4. **Yes — approval is an item type.** You add a **Manager Approval** item to the checklist (normally the last item). Its presence is what turns on the approval flow: the trainee sees **Submit for Approval**, the approver sees **Approve & Sign**. No separate template-level setting to remember.

## 1. Training Style Checklist

A third template type alongside Standard and Dynamic Weekly.

- Never appears on anyone's daily list on its own — it only appears once assigned to a person for a date.
- Assign dialog: pick **one or more team members**, pick **one or more dates**, pick the **approver** (role or person). That creates one assignment per person per date.
- A 5-day onboarding plan = five templates ("Day 1"…"Day 5"), assigned to Johnny for Mon–Fri in one pass. Repeat for the next new hire without touching the templates.
- Once complete (and approved, if there's an approval item) the assignment moves to history and does **not** reappear the next day.
- Overdue assignments stay visible with an "Overdue" chip until completed or cancelled.

## 2. Scheduling: Single Day

`frequency` gains **Single Day** with a date picker defaulting to today, available to standard and training checklists. It shows only on that business date, then rolls into history. Daily / Weekly / Monthly are unchanged.

## 3. Approval flow

- **Manager Approval item** in the editor, alongside the existing item types. It cannot be checked off by the trainee.
- Trainee: finishes all other items, button reads **Submit for Approval**. Submission locks read-only, shows "Pending approval", and does not count as complete in Tasks.
- Approver: gets a **push notification** at submit time (the named person, or everyone holding the named role at that location).
- Discovery surfaces:
  1. Push notification.
  2. **Quick Task card** on the dashboard — "Checklists awaiting your approval (N)" — listing trainee name, template, and date.
  3. A **Needs Approval** section at the top of Tasks > History for approvers.
- Approval sheet shows every item, response, and photo, plus **Approve & Sign** or **Request Changes** (note required). Approve stamps the approver's name, signature, and timestamp. Request Changes reopens it for the trainee with the note pinned at the top.

## 4. Build order

1. Migration: assignments table, `single_day` support, approval item type.
2. Training template type in the checklist editor + Manager Approval item type.
3. Templates divider on Edit > Checklists + Assign dialog (people x dates x approver).
4. Trainee view: assignment-scoped completion and Submit for Approval.
5. Approval Quick Task card, Tasks section, approval sheet with signature.
6. Push on submit, and on approve / changes requested.

## Technical detail

- New `checklist_assignments`: `checklist_id`, `assignee_id`, `assigned_date` (`date`, business date), `assigned_by`, `approver_user_id` (nullable), `approver_role` (nullable, one of the two must be set), `status` (`assigned` | `in_progress` | `pending_approval` | `changes_requested` | `approved` | `cancelled`), `submitted_at`, `approved_by`, `approved_at`, `approval_signature`, `manager_note`, `location_id`, timestamps. Unique on (`checklist_id`, `assignee_id`, `assigned_date`) — that constraint is what makes two trainees on the same day independent. GRANTs for `authenticated` + `service_role`; RLS: assignee reads/updates own, managers at the location read/manage all, approver (by id or by role match) can approve.
- `checklists`: `template_type` accepts `'training'`; add `scheduled_date date` used when `frequency = 'single_day'`.
- `checklist_items`: `item_type` accepts `'manager_approval'`.
- `checklist_responses` / `checklist_submissions` gain nullable `assignment_id` so two trainees on the same template and date never collide. Existing non-training rows keep `null` and current behavior is untouched.
- All dates are string-first `yyyy-MM-dd` via Luxon in the location timezone, per the business-date standard.
- Push reuses the existing `alert_queue` dispatch path; no new cron.
