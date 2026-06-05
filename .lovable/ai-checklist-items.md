# AI Checklist Items — Video Grading Feature (Parked)

Last updated: 2026-06-05
Status: **Spec only — not built. Return here when ready.**

## The Big Idea
Employees record a short video (or photo) when completing certain checklist tasks. Gemini watches the video, grades it against a task-specific rubric, returns a letter grade + score + issues + confidence. Video gets deleted nightly; the grade + a poster frame stays forever.

## Why Video (not just photos)
- Gemini natively ingests video — samples ~1 frame/sec + understands motion between frames
- Reads visible text (signage, test strip colors, screens)
- 10 sec clip = ~10 frames analyzed
- No audio (stripped to save cost)

## Cost (Gemini 2.5 Flash via Lovable AI)
- ~2,580 input tokens per 10s video → **~$0.001/video**
- 100 stores × 5 videos/day = 15K/mo → **~$15/mo**
- Worst case 2× retry buffer → ~$60/mo

## Proposed Spec (locked in pending build)
- **Capture:** 10 sec / 480p / no audio
- **Trigger:** Immediately on upload (instant feedback to employee) — AI's recommendation
- **Output:** `{ grade: A-F, score: 0-100, issues: [], confidence: 0-100, poster_frame_url }`
- **Storage:** Video kept 24h for manager dispute. Nightly 3 AM PST cron deletes the video file. DB row (grade, poster, AI notes) kept forever.
- **Alerts:** Auto-ping GM if grade ≤ D

## The Killer Feature: Per-Task Coaching Rubrics
New field on `quick_task_templates`: **`ai_video_rubric` (TEXT)**

Each task type gets its own pass/fail criteria. Gemini grades against THAT specific rubric, not generic cleanliness.

### Example Rubric — "Sani Bucket Test Strip Check"
- **Pass:** Strip fully submerged ≥1s, pulled out, color is DARK PURPLE/BLUE (200-400 ppm), bucket water clean
- **Fail:** Strip WHITE/LIGHT PINK (<150 ppm), VERY DARK BLACK/PURPLE (>500 ppm — unsafe), bucket dirty, no strip visible, strip never touches water
- **Output extras:** `ppm_estimate`

### Other task rubrics to design
- Wipe Lobby Tables
- Empty Trash
- Bathroom Check
- Walk-in Temp Check (reads thermometer)
- Prep Line Breakdown
- Hand Wash (20 sec, soap visible, water running)
- Knife / Cutting Board Sani

## Bonus Power Moves
1. **Reference images** — upload "gold standard" photo of perfect sani strip color → Gemini compares
2. **Brand-specific standards** — Blaze ≠ BWW
3. **Manager training mode** — GMs edit rubric in plain English → saved as prompt text → every video graded consistently forever
4. **Confidence threshold** — if <70% confidence, auto-flag for manager review
5. **Leaderboard** — A-grade streaks by employee
6. **Trend reports** — bathroom score trending down 3 weeks straight → alert
7. **Theo context** — Theo can pull grade history when answering "how's the team doing?"
8. **Dispute trail** — manager can override grade, both grades preserved

## DB Schema Sketch (when we build)
```sql
-- New column on existing table
ALTER TABLE quick_task_templates ADD COLUMN ai_video_rubric TEXT;
ALTER TABLE quick_task_templates ADD COLUMN ai_video_enabled BOOLEAN DEFAULT false;

-- New table for grades
CREATE TABLE checklist_ai_grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID REFERENCES checklist_responses(id) ON DELETE CASCADE,
  task_template_id UUID,
  location_id UUID NOT NULL,
  grade TEXT NOT NULL,        -- 'A' | 'B' | 'C' | 'D' | 'F'
  score INTEGER NOT NULL,     -- 0-100
  issues JSONB,
  confidence INTEGER,
  poster_frame_url TEXT,
  video_url TEXT,             -- nulled out by nightly cron
  video_deleted_at TIMESTAMPTZ,
  manager_override_grade TEXT,
  manager_override_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Build Order (when we're ready)
1. Rubric editor UI on `quick_task_templates` (manager-editable textarea + presets)
2. Video capture component (10s, 480p, no audio, MediaRecorder API)
3. Upload → Supabase Storage bucket `checklist-videos` (24h lifecycle)
4. Edge function `grade-checklist-video` → calls Gemini 2.5 Flash with rubric + video
5. Save grade to `checklist_ai_grades`
6. Nightly cron: delete video files older than 24h, keep DB row
7. Manager dispute UI
8. Leaderboard + trends

## Open Questions (decide at build time)
- Storage bucket lifecycle vs cron-based delete?
- Show employee the grade immediately or only manager sees?
- Per-brand rubric inheritance pattern?
- How to handle "no rubric set" — generic prompt or skip grading?

---
**Resume here whenever — all decisions above are AI-recommended but not locked.**
