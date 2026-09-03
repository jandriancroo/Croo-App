# LOCKED: Logs → Corrective Action (formerly Employee Write-Up)

Owner: Jordan · Librarian: Ryan · Locked ship: **2026-09-03**

This file is the lock. Read it before touching Corrective Action naming, trails,
recording, or the transcript read path. Do not change without an explicit unlock.

## Naming
- User-facing name everywhere in the app: **Corrective Action**.
- Database is unchanged: table `employee_writeups`, reasons in `employee_writeup_reasons`,
  task link `temporary_tasks.write_up_id`. Column names are unchanged.
- `send-notification-email` (and its `EmailPreview` mirror) is **locked** — styling,
  layout, and copy untouched. Email payload keys (`employee_writeup`,
  `employee_writeup_signed`) unchanged.

## Schema added (all nullable, nothing dropped)
| column | purpose |
| --- | --- |
| `family_id uuid` | trail id. Every existing row was backfilled `family_id = id` (trail of one). No auto-merge by employee+reason. |
| `transcript_text text` | verbatim transcript. Manager-tier read only (see below). |
| `notes_bullets jsonb` | array of `{ speaker, text }`. Never stuffed into `issue_description`. |
| `consent_confirmed_at timestamptz` | per-row consent stamp. Not a global/profile flag. |
| `recording_duration_seconds int` | length of the captured audio. |
| `stt_model_used text` | `"mini"` or `"standard"`. |

`issue_description` and `next_steps` are now nullable: a recorded session can rely on
`notes_bullets`. Unrecorded sessions still require both in the UI.

### Transcript access
- Column-level `SELECT (transcript_text)` is revoked from `authenticated` and `anon`,
  so employees cannot read it even on their own row, and `select *` on the table fails —
  all client reads use explicit column lists.
- Managers read it through `public.get_corrective_action_transcript(_writeup_id uuid)`
  (security definer): requires `has_role_or_higher(auth.uid(),'manager')` **and** a
  `user_locations` row for that location, or `org_admin`+.

## Recording pipeline
Edge function `corrective-action-transcribe` (JWT validated in code, manager tier only):
- `action: "transcribe_chunk"` — Hop 1, verbatim. `openai/gpt-4o-mini-transcribe`
  (default, reports `"mini"`); on 400/429/5xx it retries once on
  `openai/gpt-4o-transcribe` (reports `"standard"`).
- `action: "summarize"` — Hop 2, run **once** on the full concatenated transcript.
  `google/gemini-3.7-flash` with a forced tool call; input is the transcript plus the
  two names (signed-in manager `created_by` profile name, selected employee).
  Output labels each bullet `Manager {name}` / `Employee {name}` / `Other`.

Hard rules:
- Raw audio is **never** sent to Flash. Never summarize per chunk.
- No Gemini 2.5, no Gemini transcribe, no Groq, no extra API keys — Lovable AI only.
- Audio is never written to storage and no audio column exists. Blobs are dropped as
  soon as a chunk is uploaded, including on error/retry paths.

Client (`useConversationRecorder`, iPad-first PWA):
- Mic permission requested on the first tap of Record, not on dialog open.
- Fresh `MediaRecorder` per ~75 s segment (self-contained container per upload).
- Explicit Stop button. Visible timer. Hard cap 15 minutes (auto-stop).
- Backgrounding / `visibilitychange` / mic track end → auto-stop and keep the partial
  recording for transcription. Never silently discarded.

## Gates and flow
1. Employee must be selected before the mic can be armed.
2. Prior corrective actions for that employee are shown grouped by `family_id`
   (latest step per trail: reason, final-warning flag, date, step count).
   Manager picks **Attach to this issue** (reuse `family_id`) or **New issue**
   (`family_id` = the new row's own id).
3. Each step keeps its own reason. Attaching with a different reason shows a mismatch
   warning; nothing is inherited or overwritten.
4. `is_final_warning` lives on the step (row). "Trail at final warning?" = latest step's flag.
5. No open/closed trail status in v1. Bare `family_id` only.
6. Per-recording consent tap (read-aloud line + checkbox) stamps `consent_confirmed_at`
   on that row. Consent never blocks saving a Corrective Action.
7. Paperwork still works with no recording — today's manual flow is intact.
8. Always INSERT a new row for a new sit-down. Never UPDATE an old row to append.
9. After save: bullets show by default, verbatim transcript collapsed. Both editable
   until `signed_at` is set, then locked.

## Changelog
- **2026-09-03** — Ship. Rename to Corrective Action (UI only), recording added
  (Mini Transcribe → Flash bullets), trails via `family_id`, per-row consent stamp,
  manager-only transcript read path. Emails untouched.
- **2026-09-03 (follow-up)** — Claude gates: AI bullets never copied into
  `issue_description` (including the notification payload); `issue_description`
  waived only when `notes_bullets` exist; `next_steps` required on every save;
  recorder model badge corrected (Mini = "Mini transcription",
  GPT-4o Transcribe fallback = "Standard transcription").
