# punch_clock_lookup_pin log check (read-only, nothing changed)

## Result
- Logs available: about 10 minutes only (2026-11-20 06:37 to 06:47 UTC, ~4,700 requests). Not days.
- Requests to /rest/v1/rpc/punch_clock_lookup_pin in that window: 0.

| role | sub | count | first_seen | last_seen | user_agent |
|------|-----|-------|------------|-----------|------------|
| (none) | (none) | 0 | - | - | - |

## Why
The request log keeps only a short rolling window here, so a 30-day grouping is not possible from these logs.

## Options (pick one if wanted)
1. Re-run this same check at a set time each day and save the grouped counts (needs approval to build).
2. Add a small audit table filled by the lookup function itself (role, sub, user agent, time; never the PIN) — needs code + migration approval.
