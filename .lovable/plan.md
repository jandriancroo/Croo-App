# Training Checklists + Manager Approval

Two connected pieces: a new **Training Style Checklist** template that is a reusable, per-person, date-scheduled asset, and the **approval flow** (push + Quick Task) that closes it out.

## 1. Training Style Checklist

A third template type alongside Standard and Dynamic Weekly.

- Lives in a **Training Library** (Tasks > Edit > Checklists, grouped separately). Never appears on anyone's daily list on its own — it only appears once assigned.
- **Assigned to one team member at a time, for one date.** The same template can be assigned to Johnny for Monday and to Maria for Thursday, each with their own progress, photos, and approval.
- Assigning supports **multi-select of people and multiple dates in one pass**, so a 5-day onboarding plan is: pick "Day 1 New Team Member", pick Johnny, pick Monday → repeat for Day 2–5 templates with Tue–Fri (or assign all five in one dialog).
- Each assignment names an **approver** (defaults to the assigner). One approver can hold several trainees on the same template — they show up as separate approval items with the trainee's name.
- When complete (and approved, if required) the assignment moves to history. It does **not** reappear the next day.
- Overdue assignments stay visible until completed or cancelled, with an "Overdue" chip.

## 2. Scheduling: Single Day option

`frequency` gains **Single Day** for standard and training checklists, with a date picker defaulting to today. A single-day checklist appears only on that business date and then rolls into history. Daily / Weekly / Monthly behave exactly as they do now.

## 3. Approval flow

- Template toggle: **Requires manager approval** (column already exists).
- Trainee's button reads **Submit for Approval**; submission locks read-only with a "Pending approval" state and does not count as complete in Tasks.
- Approver discovery, in priority order:
  1. **Push notification** at submit time to the named approver (and shift managers and above at that location as fallback).
  2. **Quick Task card on the dashboard** — "Checklists awaiting your approval (N)" — tapping opens the list of pending submissions with the trainee's name, template title, and date.
  3. A **Needs Approval** section at the top of Tasks > History for approvers.
- Approval sheet shows every item, response, and photo, plus **Approve** or **Request Changes** (note required). Approve stamps approver + timestamp; Request Changes reopens it for the trainee with the note pinned at the top.

## 4. Build order

1. Migration: assignments table + `single_day` support.
2. Training template create/edit (reuse the existing checklist editor with training options).
3. Training Library + Assign dialog (people x dates x approver).
4. Trainee view: assignment-scoped completion and Submit for Approval.
5. Approval Quick Task card, Tasks section, and approval sheet.
6. Push notification on submit and on approve / changes requested.

## Technical detail

- New `checklist_assignments`: `checklist_id`, `assignee_id`, `assigned_date` (`date`, business date), `assigned_by`, `approver_id`, `status` (`assigned` | `in_progress` | `pending_approval` | `changes_requested` | `approved` | `cancelled`), `submitted_at`, `approved_at`, `manager_note`, timestamps. Unique on (`checklist_id`, `assignee_id`, `assigned_date`). GRANTs for `authenticated` + `service_role`; RLS: assignee reads/updates own, managers at the location read/manage all, approver can approve.
- `checklists`: `template_type` accepts `'training'`; add `scheduled_date date` used when `frequency = 'single_day'`.
- `checklist_responses` / `checklist_submissions` gain nullable `assignment_id` so two trainees on the same template and date never collide. Existing non-training rows keep `null` and current behavior is untouched.
- All dates are string-first `yyyy-MM-dd` via Luxon in the location timezone, per the business-date standard.
- Push reuses the existing `alert_queue` dispatch path; no new cron.
