# Status: two-layer schedule approval (manager drafts → admin approves)

## Verdict: NOT BUILT — idea-only

Searched `src`, `SHARED_WORKSPACE`, `.lovable`, `docs` for schedule approval,
pending approval, submit-for-approval, and approval columns on schedules. There is
**no schedule approval gate anywhere** — no code, no doc, no plan file. The only
"manager approval" in the repo is the training-checklist feature
(`src/components/tasks/ManagerApprovalItem.tsx`,
`.lovable/plan/training-checklists-manager-approval-2026-08-06.md`), which is a
different system (checklist_assignments, not schedules).

## What exists today: a one-layer publish snapshot

`src/hooks/useScheduleData.tsx` + `src/lib/scheduleDiff.ts`, table `schedules`:

- `is_published` (boolean), `published_shifts_snapshot` (JSON copy of the shifts at
  publish time), `last_status_changed_at` / `_by` / `last_status_action`.
- Draft weeks are hidden from staff: shifts return `[]` when
  `!is_published && !canSeeDrafts` (`useScheduleData.tsx:321-322`, `:465`).
- Publish sets `is_published = true`, snapshots current shifts, notifies staff
  (`:741-748`). Unpublish clears both (`:603`, `:808`).
- Post-publish edits are surfaced as "pending changes" by diffing live shifts
  against the snapshot (`:671-682`, `scheduleDiff.ts`) — that's a *change-tracking*
  pending state, **not** an approval pending state.
- Permission is a single tier: `isAdmin || isManager` (`useScheduleData.tsx:103`,
  `useUserRole.tsx:79` `canManageSchedule`). A manager can publish straight to staff
  with no second signature.

## What's missing for an admin approval gate

1. **State**: `schedules` has no approval status. Needs something like
   `approval_status` ('draft' | 'submitted' | 'approved' | 'changes_requested'),
   `submitted_at/by`, `approved_at/by`, `approver_note`.
2. **Split permissions**: today one flag (`canManageSchedule`) covers both build and
   publish. Needs `canSubmitSchedule` (manager+) vs `canApproveSchedule`
   (org_admin/admin+) — `useUserRole.tsx` currently collapses admin into manager
   checks (`isManager = role === 'manager' || isAdmin`).
3. **Server enforcement**: publishing is a plain client `update` on `schedules`
   (`:744`). Nothing stops a manager writing `is_published = true` directly, so the
   gate must live in RLS or a `SECURITY DEFINER` publish RPC, not just in the UI.
4. **UI**: Submit-for-Approval button for managers, an approval queue/badge for
   admins, Approve/Request-Changes with a note, and status shown on the week header.
5. **Notification**: push to approvers on submit, back to the manager on
   approve/changes — an analogue of the existing `notify-training-approval` function.
6. **Interaction with pending-changes diff**: decide whether post-publish edits to a
   live week also require re-approval, or publish immediately as today.

## Action
None — status report only. No code written. Say the word if Jordan wants a build
plan for the gate.
