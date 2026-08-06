# Training Checklists + Manager Approval

## Answers

1. **No separate library** — same Edit > Checklists page, one list under a **Templates** divider, training templates carry a "Training" chip.
2. **Two trainees, same day, same template = separate everything.** Own responses, photos, timing, and own approval; logged individually in history.
3. **Approver = multi-select of roles AND people**, same picker style used elsewhere. Any one of them can pick it up and approve.
4. **Approval is an item type.** A **Manager Approval** item in the checklist turns on the flow: trainee sees **Submit for Approval**, approver sees **Approve & Sign**.
5. **Visibility** — see section 3 below; your grouped-trainee idea is the right call and is what I'll build.
6. **Non-training checklists reusable?** Yes. Standard/dynamic checklists already copy to other locations; I'll add a **Duplicate** action so any checklist can be cloned in place and renamed. Training templates get reuse-by-assignment on top of that. No new "template" concept needed — every checklist is the template.

## 1. Training Style Checklist

A third template type alongside Standard and Dynamic Weekly.

- Never appears on a daily list on its own — only once assigned to a person for a date.
- Assign dialog: pick **one or more team members**, **one or more dates**, and the **approvers** (roles and/or people). Creates one assignment per person per date.
- A 5-day onboarding plan = five templates ("Day 1"…"Day 5") assigned Mon–Fri in one pass, reusable for the next new hire.
- On completion (and approval, if there's an approval item) the assignment moves to history and does **not** reappear the next day.
- Overdue assignments stay visible with an "Overdue" chip until completed or cancelled.

## 2. Scheduling: Single Day

`frequency` gains **Single Day** with a date picker defaulting to today, for standard and training checklists. Shows only on that business date, then rolls into history. Daily / Weekly / Monthly unchanged.

## 3. Who sees what

**Team member dashboard** — only checklists assigned to them: their regular checklists plus any training assignment for today. A training assignment looks like a normal checklist card with a small "Training" tag.

**Manager / approver dashboard** — their own checklists card, plus a divider inside that card labeled **Training** listing the training checklists they oversee today (by role or by name).

**Grouped trainees:** when several trainees are on the same template the same day, it shows as **one row per template**, with a compact line per trainee underneath:

```text
Day 1 — New Team Member Training          [Training]
  Johnny R.   ████████░░  80%
  Maria L.    ███░░░░░░░  30%   Needs approval
```

Tapping a trainee's line opens that person's assignment (read-only review, or the approval sheet when it's pending).

## 4. Approval flow

- **Manager Approval item** in the editor, alongside existing item types. The trainee cannot check it off.
- Trainee finishes all other items → button reads **Submit for Approval**. Submission locks read-only, shows "Pending approval", and doesn't count as complete in Tasks.
- Approver gets a **push notification** at submit time — every named person plus everyone holding a named role at that location.
- Discovery surfaces: push, a **Quick Task card** ("Checklists awaiting your approval (N)") listing trainee, template, and date, and a **Needs Approval** section at the top of Tasks > History.
- Approval sheet shows every item, response, and photo, plus **Approve & Sign** or **Request Changes** (note required). Approve stamps name, signature, and timestamp. Request Changes reopens it for the trainee with the note pinned at the top.

## 5. Build order

1. Migration: assignments table, `single_day` support, approval item type.
2. Training template type + Manager Approval item type in the checklist editor.
3. Templates divider on Edit > Checklists, Duplicate action, Assign dialog (people x dates x approvers).
4. Trainee view: assignment-scoped completion and Submit for Approval.
5. Manager dashboard grouped training rows, approval Quick Task card, Tasks section, approval sheet with signature.
6. Push on submit and on approve / changes requested.

## Technical detail

- New `checklist_assignments`: `checklist_id`, `assignee_id`, `assigned_date` (`date`, business date), `assigned_by`, `approver_user_ids uuid[]`, `approver_roles app_role[]`, `status` (`assigned` | `in_progress` | `pending_approval` | `changes_requested` | `approved` | `cancelled`), `submitted_at`, `approved_by`, `approved_at`, `approval_signature`, `manager_note`, `location_id`, timestamps. Unique on (`checklist_id`, `assignee_id`, `assigned_date`) — this is what makes two trainees on the same day independent. GRANTs for `authenticated` + `service_role`; RLS: assignee reads/updates own, managers at the location read/manage all, approvers (by id or role match) can approve.
- `checklists`: `template_type` accepts `'training'`; add `scheduled_date date` used when `frequency = 'single_day'`.
- `checklist_items`: `item_type` accepts `'manager_approval'`.
- `checklist_responses` / `checklist_submissions` gain nullable `assignment_id` so two trainees on the same template and date never collide. Existing rows keep `null` and current behavior is untouched.
- Manager grouped view is a single query on today's assignments joined to per-assignment response counts, grouped client-side by `checklist_id`.
- Duplicate action is a client-side clone of the checklist row plus its items (new ids, title suffixed "(Copy)").
- All dates are string-first `yyyy-MM-dd` via Luxon in the location timezone, per the business-date standard.
- Push reuses the existing `alert_queue` dispatch path; no new cron.
