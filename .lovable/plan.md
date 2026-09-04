# Corrective Action — autofill Reason / Next Steps from recorded notes

Plan only. Answers first, then the smallest ship.

## 1. Required fields on the create form today

From `src/components/logbook/EmployeeWriteUpForm.tsx` (validation at lines 210–226, submit-disabled at 460–463):

| Label on form | State | DB column (`employee_writeups`) | Required? |
|---|---|---|---|
| Employee * | `selectedEmployee` | `employee_id` | yes |
| Reason * | `reason` (dropdown, not free text) | `reason` | yes |
| Issue Description | `issueDescription` | `issue_description` | required ONLY when no recorded bullets exist (label flips to "(optional — notes captured)" at line 382) |
| Next Steps for Team Member * | `nextSteps` | `next_steps` | yes, always |
| Final warning checkbox, photo | — | — | optional |

So the two fields Jordan named map to `reason` (a constrained dropdown sourced from `DEFAULT_REASONS` + `employee_writeup_reasons`) and `next_steps` (free text).

## 2. Where notes land after Gemini Flash

- `useConversationRecorder` (`src/hooks/useConversationRecorder.tsx`) holds `transcript` + `bullets`.
- The recorder component (`CorrectiveActionRecorder.tsx`, lines 15–56) emits `{ transcript, bullets, ... }` upward to form state `recording`.
- On save (`EmployeeWriteUpForm.tsx` 227–234, and the writeup insert in `LogBookNewEntrySheet.tsx` 347–353): bullets → `notes_bullets`, transcript → `transcript_text`, and `issue_description` / `next_steps` come strictly from what the manager typed.
- Bullets are never merged into `issue_description` — that separation is the existing lock and this ship keeps it.

## 3. Smallest clean place to autofill

Client-side, in the form, when `recording` first arrives with bullets — not in the edge function.

Why: the edge `summarize` action is shared and stateless (`supabase/functions/corrective-action-transcribe/index.ts`), and it does not know which form fields the manager already filled. Doing it in the form keeps one rule ("only fill what's empty") in one place and keeps `notes_bullets` out of `issue_description`.

Implementation shape (one small effect + one helper in `EmployeeWriteUpForm.tsx`):
- `next_steps`: derive from bullets that read as a forward commitment/expectation. If nothing qualifies, leave blank.
- `reason`: because it is a dropdown, autofill only when a suggestion matches an existing reason option (case-insensitive) in `allReasons`. Never create a new reason automatically.
- Guard with a ref so autofill runs once per recording result and never re-runs after the manager edits.

Optional refinement in the same ship: extend the existing `summarize` tool schema to also return `suggested_next_steps` and `suggested_reason` (both nullable) alongside `notes_bullets`. That gives better quality than client keyword matching and still leaves all writing decisions to the form. Cost: same single Flash call, no extra request.

## 4. UX one-liner

When the notes come back, any Reason or Next Steps field still empty gets a suggested value inserted in place, marked "suggested from the recording", fully editable, never overwriting typed text, and never guessed when the notes don't support it.

## Verification
- Record → notes return with both fields empty → both populate, edits stick, submit passes.
- Type Next Steps first, then record → typed text untouched.
- Short/vague recording → fields stay blank and the existing required-field validation still blocks submit.
- Confirm `issue_description` still never receives bullet text.
