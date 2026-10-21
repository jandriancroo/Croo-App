# Smart Close + cut history — STEP 0 report (nothing built)

## 1. History available (last 12 months, from one read-only query)

| Store | Shifts | Matched to a clock-out | Weeks matched | Closing shifts | Closers with 30+ closes |
|---|---|---|---|---|---|
| Hemet | 1,995 | 88% | 42 | 858 | 8 |
| Palm Springs | 2,130 | 90% | 41 | 613 | 4 |
| Palm Desert | 1,772 | 81% | 35 | 393 | 3 |
| Georgetown | 312 | 71% | 14 | 101 | 0 |
| Hayward (Toast) | 188 | 72% | 2 | 80 | 0 |
| Rowlett, Sandbox | ~0 | 0% | — | 0 | 0 |

- Time clock stores (Hemet, Palm Springs, Palm Desert) have enough data. Store habit and day of week will be trustworthy. Person adjustments will be trusted for only a few people at first, and the trust formula already handles that.
- Hayward: Toast punches link to shifts through the Toast employee mapping, but there are only about 2 weeks of history, so Smart Close stays off there for now.
- Qu stores: no scheduled shifts with matching Qu punches show up. Qu only gives store totals, not per-person clock-outs, so Smart Close and cut history **can't be learned at Qu stores**. Those stores keep the plain pace.

## 2. Close time
- Lives in **`location_hours`** (one row per store per weekday: `open_time`, `close_time`, `is_closed`). Every live store except Sandbox has hours.
- Closer rule: the scheduled end is at or after that day's `close_time`.
- Edge cases:
  - **Overnight:** when close is before open (e.g. closes 1 AM), a shift ending after midnight but before open counts as a closer. Its end is compared on the business-day timeline (`business_day_window`), not the clock face.
  - **24h / no hours / closed day:** no closer tag, so Smart Close is off for that day.
  - **End set past close:** still a closer. The learned minutes are measured from the scheduled end, so a late scheduled end doesn't skew anything.
  - **Hours changed mid-history:** the table has no history of past hours. Past nights are tagged against today's hours, and I'll flag nights where that may be wrong.
- Reliability: good for the three time clock stores. `location_hours` is edited by hand, so wrong hours give wrong tags. The report will list each store's hours for a sanity check.

## 3. Shift to punch matching
- Time clock: punches carry `shift_id` (with midnight continuity and phantom shifts), so matching is by `shift_id` first. Overlap is the fallback, using the same rules `_labor_pair_shifts` already uses (read, not changed).
- Toast: `toast_shifts.croo_scheduled_shift_id`.
- Match rates are in the table above (81–90% at the time clock stores). Unmatched shifts are mostly no-shows, swaps and edits. They're left out of learning, never counted as zero.

## 4. Proposed shape (additive)
- **`labor_shift_outcomes`** (one row per past matched shift, the shared history): location, business date, weekday, user, scheduled shift id, scheduled start/end, actual in/out, `minutes_vs_schedule` (+ late / − early), `is_closer`, the clock-out hour, sales so far and sales pace as % of goal at clock-out, the day's final sales % of goal and its band, `close_crew` (the other users still on the clock at close), `crew_size_at_out`, punch source. Closers feed Smart Close and non-closers feed cut history, all from the same rows.
- **`labor_close_habits`** (small, the learned numbers): per store, with `scope` = store / weekday / sales band / person, a `key`, `n`, `avg_minutes`, `trust = n/(n+8)` and `computed_at`. Windows: store and weekday rolling 8 weeks, sales band 12 months with recency weighting, person last 30 closes.
- **`smart_close_enabled`** per store (default off). It switches on only through the back-test result below.
- **Nightly job:** one SQL function, `refresh_labor_close_habits()`, added to the existing 3 AM maintenance cycle (no new cron, no edge function). It appends yesterday's outcomes and rebuilds the habits.
- **Theo read:** `get_cut_history(location_id, weekday?, hour?, sales_band?)`. It returns matching past non-closing shifts, with the same access gate as `get_labor_pace` people[] (managers only). No Theo changes in this phase.
- **Inside `get_labor_pace`:** only in the step that picks a remaining end for a person **who is a closer and not clocked out**:
  `expected_out = sched_end + store + wd*trust + band*trust + person*trust`, clamped to sched_end −30 / +60 and never before now. The past-scheduled-end rule still wins. Tonight's band = live `sales_pace` as % of today's goal (override > living > initial). New output: `expected_out` per closer in people[], plus `smart_close` and `smart_close_minutes` at the top level. When the store is off, the branch isn't taken and the output is identical to today's.

## 5. Back-test plan
- For each of the last 28 nights at Hemet, Palm Springs and Palm Desert, rebuild the habits using only data from before that night, then compute the plain pace labor % at 6 PM, the Smart Close pace labor % at 6 PM, and the actual final labor %.
- Report the average absolute miss (points) for each, per store.
- Turn on only the stores where Smart Close beats plain. I can't give expected numbers yet because they need the back-test to run, which is a build step.

## 6. Additive confirmation
- No edits to labor_day_user_totals, labor_day_totals, get_store_labor, _labor_pair_shifts, labor-service, labor_cache, sales_cache or any locked file.
- `get_labor_pace` gains one guarded branch. With smart_close off, a parity test confirms its output matches today's version exactly (fixtures plus live Hemet and Hayward).

## 7. Future reuse (auto-schedule)
Yes, the shape supports it. `labor_shift_outcomes` keeps per-shift who, when, weekday, sales band, minutes vs schedule and the close crew. A later scheduler can rank closer pairings and crews by close speed per sales band, and find shifts that are often cut early, without collecting new data. One gap: if someone wants station or position later, `station_id` from scheduled_shifts should be copied in now. I propose including it.

## Open questions for "go"
1. Qu stores: confirm Smart Close and cut history stay off there (no per-person punches).
2. Include `station_id` in the outcomes table now (recommended)?
3. Clamp of −30 / +60 min: keep it?
