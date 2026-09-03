# Corrective Action (rename) + in-dialog conversation recording

Two pieces: a user-facing rename of "Employee Write-Up" to "Corrective Action", and a record button inside the dialog that turns a manager/employee conversation into bullet notes (with a full transcript hidden behind a tap). Audio is never stored.

## 1. Rename to Corrective Action

Copy-only. Same records, same table, same signatures, no data migration.

Where the words change:
- Logs page category label and entry list ("Employee Write-Up" -> "Corrective Action")
- New-entry sheet option and the form heading/buttons
- Employee-facing signature screen ("Employee Write-Up" -> "Corrective Action", acknowledgment wording softened to match the more positive framing)
- Employee profile section currently titled "Write-Ups" -> "Corrective Actions"
- Notification/email subject and body copy for issued and signed records
- PDF export header

What does NOT change: the `employee_writeups` table, column names, log category keys stored in the database, notification type keys, RLS. Renaming stored keys would orphan existing records and saved notification preferences; the label is resolved in the UI instead.

One decision to confirm: "Final Warning" badge wording. Suggest keeping it, since it is a real HR escalation level, but it can become "Final Notice" if you want the softer tone all the way through.

## 2. Recording inside the dialog

Flow:
1. Mic icon at the top of the Corrective Action dialog. Tapping it shows a short on-record notice, then starts recording after the manager confirms.
2. Recording UI: elapsed timer, live level bar, Pause, Stop. Screen-lock safe on iPad (keeps the audio context alive the way the inventory voice counter already does).
3. On Stop: audio goes straight to an edge function, which returns a word-for-word transcript plus 4-8 bullet notes. Nothing is written to storage.
4. Result view: bullets by default, with a "View full transcript" toggle that only appears after the record is saved. Bullets and transcript are editable text before save - the manager stays the author of record.
5. Optional convenience: a "Use in Issue / Next Steps" button that drops the bullets into the existing fields, so the record still reads like a normal corrective action.
6. If transcription fails, the manager keeps typing manually; the recording is simply lost (no retry queue, no stored audio).

Storage: two new text columns on the existing table for the bullet summary and the verbatim transcript, plus a flag for "captured from a recorded conversation." No audio bucket, no audio path column.

## 3. Model choice and cost (the direct answer)

Pick: **`google/gemini-3.1-flash-lite`** through Lovable AI (already wired in this project for voice counting, no extra key, secrets stay server-side).

Why: it takes audio natively, so one call does transcription and bullets together - no separate speech-to-text vendor, no second round trip, no extra secret.

Estimated cost for a 15-minute recording: **well under one cent - roughly $0.005 to $0.01** (about 29k audio input tokens plus ~3k output tokens for transcript + bullets). Even at 200 recordings a month that is a couple of dollars.

- Cheaper: there is no meaningfully cheaper path. The only real lever is not transcribing verbatim (bullets only), which cuts output tokens by ~90% and lands near $0.003. Not recommended - you asked for word-for-word.
- More accurate: `google/gemini-3.7-flash` for hard audio (noisy kitchen line, heavy accents, crosstalk). Roughly 5-10x the cost, so about **$0.05 to $0.10 per 15 minutes** - still trivial. Suggested approach: default to flash-lite, and add a quiet "Improve transcript" retry that reruns the same audio on 3.7-flash if the manager says the first pass looks wrong. That requires holding the audio in memory for the length of the dialog only, never on disk.

Practical note: a 15-minute clip is too large for a single request body at this project's limits, so recording is captured in ~4-minute segments, each transcribed as it completes, then stitched in order. This also means the transcript is basically ready the moment Stop is pressed.

## 4. Consent disclosure (flagged, not lectured)

California is two-party consent, and several CrooHQ stores are in California. The UI needs an explicit on-record moment, not fine print:
- Before recording starts, a short confirm step with a line the manager reads aloud: "I'm recording this conversation for notes. Are you okay with that?" plus a required checkbox "Employee was told and agreed."
- Visible red recording indicator for the whole session.
- The employee's agreement is stamped on the record (who confirmed, when).
- Recording is optional in every case; the corrective action can always be typed.

Worth deciding: whether recording should be off entirely for certain locations/states. Easy to add as a location setting later.

## Technical notes

- New edge function (e.g. `transcribe-conversation`) that accepts a base64 audio segment, calls Lovable AI with `google/gemini-3.1-flash-lite`, and returns `{ transcript, bullets[] }` via a tool-call schema. Verify JWT, confirm the caller is a manager or above at the location. No storage writes.
- Client recorder modeled on `src/hooks/useAudioVoiceInput.tsx` (16 kHz mono opus, iOS-safe MediaRecorder handling), but segment-based rather than silence-triggered.
- Files touched for the rename: `src/pages/LogBook.tsx`, `src/components/logbook/LogBookNewEntrySheet.tsx`, `LogBookEntryList.tsx`, `EmployeeWriteUpEntry.tsx`, `EmployeeWriteUpForm.tsx`, `WriteUpSignatureView.tsx`, `src/components/users/WriteUpsSection.tsx`, `EmployeeRecordsSection.tsx`, `src/utils/exportRecordPdf.ts`, `send-notification-email`, `src/pages/EmailPreview.tsx`.
- Migration: additive only - `conversation_summary text`, `conversation_transcript text`, `recorded_consent_at timestamptz`, `recorded_consent_by uuid` on `employee_writeups`. Existing RLS covers them; no new grants needed since no new table.
- Mobile/PWA: recording keeps the dialog mounted; guard against backgrounding losing the recorder, and cap a single session at 30 minutes.
