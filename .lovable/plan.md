# Corrective Action — bug status check (2026-09-04)

| # | Bug | Status | File / evidence |
|---|---|---|---|
| 1 | Admin can't open/sign the CA task | FIXED LIVE | Cause was a self-referencing access rule on `temporary_tasks` (recursion 42P17). Live DB now has `is_task_assignee` + `is_task_writeup_employee` (confirmed present) and the task rule uses them; commit `fec4c0b17` "Fixed rule loop blocking closes". Client path `src/components/tasks/TemporaryTaskDetailsDialog.tsx:267–350` unchanged and now verifies the close. Note: the separate product question — admins receiving write-ups at all — is NOT addressed; nothing filters admins out at creation (`src/components/logbook/EmployeeWriteUpForm.tsx` employee picker). |
| 2 | PDF export has no back button, user trapped | NOT FIXED | `src/utils/exportRecordPdf.ts:300–337`: the injected toolbar has only a "Print / Save PDF" button; no Back/Close/Done. It opens via `window.open("", "_blank")` with document.write, so on iPad there is no browser back entry to return to. |
| 3 | Bullets render as separate blocks / words cut off | NOT FIXED | `exportRecordPdf.ts:213–219`: each bullet is its own `<div style="margin-bottom:6px">`, so every bullet is a block. Container `.section-content` (line 97–104) has `white-space: pre-wrap` and no `overflow-wrap/word-break`, which is what clips long words. |
| 4 | Summary section same block-format problem | NOT FIXED | Same root: Issue Description and Next Steps both use `.section-content` with `pre-wrap` and no word-break (`exportRecordPdf.ts:203–211`). One shared CSS fix covers 3 and 4. |
| 5 | Transcript needs a full expanded scrolling view | PARTIAL | `src/components/logbook/CorrectiveActionNotesPanel.tsx:143–149`: transcript is inside a collapsible but rendered in a fixed `rows={8}` textarea; recorder side is the same (`CorrectiveActionRecorder.tsx:201`). It scrolls, but it is a small fixed box — no full-screen / expanded reading view. |

Pending separately (do not build in this pass): autofill of empty Reason + Next Steps from the recorded notes. That ship is still awaiting Jordan's go.

## Suggested fix order when Jordan ships
1. PDF export (items 2, 3, 4) — one file, `src/utils/exportRecordPdf.ts`: add a Back/Close button to the toolbar, render bullets as one flowing paragraph with inline separators, add `overflow-wrap: anywhere` to `.section-content`.
2. Transcript reading view (item 5) — expand-to-full-height / sheet view in `CorrectiveActionNotesPanel.tsx`.
3. Product decision on item 1: should admin-tier staff be excluded from the CA employee picker, or only from auto-assigned sign tasks?
