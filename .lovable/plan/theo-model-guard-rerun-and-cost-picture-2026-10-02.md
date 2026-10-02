# Theo actions guard rerun + full cost picture — 2026-10-02 (test only, production unchanged)

Production: `google/gemini-2.5-flash` (unchanged). Spoken update writer: `openai/gpt-6-astra` (unchanged).

## What the guard is (test-only, `action_guard: true`)
1. One added instruction: only call propose_action when actually proposing; never when the change already exists, is impossible, unsupported, or details are missing; words and tool calls must agree.
2. Safety check: if a proposal was sent but Theo's own reply says no change ("can't", "already has", "no shift", "what time"...), the proposal is dropped (`guard_dropped`).
Same guard applied to all three models. Hemet, 6 requests x 3 runs. Nothing written.

## Actions results with guard (18 runs each)
| Model | Right / Partly / Wrong | Before guard | Avg / slowest s | Per answer cache / no cache | 18 runs cache / no cache |
|---|---|---|---|---|---|
| A 2.5 Flash | 14 / 3 / 1 | 12 / 6 / 0 | 2.8 / 7.0 | 0.207¢ / 0.296¢ | 3.73¢ / 5.33¢ |
| C 3.1 Flash Lite | 18 / 0 / 0 | 18 / 0 / 0 | 3.3 / 4.6 | 0.187¢ / 0.369¢ | 3.37¢ / 6.64¢ |
| D GPT-6 Luna | 17 / 1 / 0 | 9 / 3 / 6 | 4.2 / 6.6 | 0.052¢ / 0.172¢ | 0.93¢ / 3.10¢ |

- Luna: the instruction alone fixed 15 of 18. It still tried 3 bad proposals (H3 r2, H6 r2, H6 r3); the safety check dropped all 3. H6 r3 is partly: proposal dropped, but the reply said "I've prepared a task for tomorrow to delete the schedule; it's awaiting your confirmation."
- 2.5 Flash wrong: H2 r1 proposed a duplicate Saturday 9–4 shift for Alle (she already has it) with an employee id that does not exist. Partly: H2 r3 asked Alle's full name, H3 r1/r2 asked for times instead of looking up.
- Flash Lite: right on all 18 (says "Done" on H1 although it is a proposal awaiting confirmation).

## Whole picture
| | 18 questions (of 54) | Actions (of 18) | Avg answer s | Cost per question (cache / none) |
|---|---|---|---|---|
| Now: 2.5 Flash | 51 | 14 w/ guard (12 without) | 3.3 | 0.283¢ / 0.358¢ |
| 3.1 Flash Lite | 49 | 18 | 3.0 | 0.244¢ / 0.331¢ |
| GPT-6 Luna + guard | 54 | 17 (+1 partly) | 3.3 (actions 4.2) | 0.053¢ / 0.135¢ |

Monthly estimate (ASSUMPTION: 600 typed/voice questions per store per month = 20/day; usage logging only started Oct 2, too little history to measure):
| | Per store / month | 17 stores / month |
|---|---|---|
| Now: 2.5 Flash | $1.70 – $2.15 | $29 – $37 |
| 3.1 Flash Lite | $1.46 – $1.99 | $25 – $34 |
| GPT-6 Luna | $0.32 – $0.81 | $5 – $14 |

Spoken update writer (ASSUMPTION: 90 updates per store per month): Astra (now) ~1.3¢ each = ~$1.17/store; Gemini 2.5 Flash ~0.05¢ = ~$0.05/store.
Live voice ($0.08/min) and read-aloud are the same whichever brain is picked.

## Not tested
Live mic, other stores for actions, Luna with thinking on (refused with tools), real action writes (the action framework does not exist).

## Test code still in place
Bake-off model switch, propose_action tool, action_guard flag + safety check, test-only employee ids — all in ai-assistant, active only for super-admin `source: "bakeoff"` calls.
