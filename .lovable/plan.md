# Sandbox stores: verification report (no changes made)

## Short answer

The code comments are wrong, both of them. The **retired clone** (`40a872fb`) is the one that is actually live sandbox infrastructure, and the one called "Sandbox #7777 / brand" (`150cfede`) is the older store with all the day-to-day history on it. **Neither is safe to delete right now.**

There is also a real bug created by last week's rename — see "Rename broke the sandbox clone" below.

## 1. The two stores today

| | 150cfede… | 40a872fb… |
|---|---|---|
| Name | [TEST] Sandbox | [TEST] Sandbox (Retired Clone) |
| Store number | T-0001 | T-0002 |
| Active | yes | no |
| Created | Feb 6 2026 | Jun 3 2026 |
| Marked as test store | yes | yes |
| Super-admin-only | no | **yes** |
| Inventory on | yes | yes |

## 2. Data attached to each (rows found; only non-zero shown)

| Table | 150cfede | 40a872fb |
|---|---|---|
| alert_queue | 1453 | 0 |
| checklist_notification_logs | 1453 | 0 |
| maintenance_queue | 376 | 28 |
| croo_ai_briefings | 172 | 14 |
| labor_cache | 202 | 14 |
| inventory_items | 37 | **219** |
| inventory_locations (shelves) | 20 | 19 |
| location_pack_selections | 0 | **161** |
| inventory_counts | 0 | **1 (177 counted lines)** |
| brand_inventory_deployments | 34 | 0 |
| logbook_entries / logbook_categories / logbook_audit | 35 / 7 / 5 | 0 / 1 / 0 |
| schedules / shift_templates / week_templates | 11 / 10 / 1 | 0 / 0 / 1 |
| checklists / submissions | 3 / 3 | 0 / 0 |
| sales_cache | 15 | 0 |
| user_locations (people with access) | 25 | 1 |
| dashboard_widgets, location_settings, labor_rules, recipe_blueprints, theo_chat_messages, daily_summary_logs | 5, 1, 1, 4, 4, 3 | 0 each |
| announcement_channels, performance_review_items, holidays | 2, 10, 2 | 2, 10, 1 |

Every table in the database that points at a store was checked (114 columns across 110 tables), not just the ones listed in the request. No rows for either store in location_integrations, location_hours, time_punches, punch clock tables, job listings, sales/labor caches beyond the above, transfers, or the vendor tables.

## 3. Which one does the sandbox clone write into?

`clone_count_to_sandbox` does **not** use a hardcoded id. It looks up the store by `requires_super_admin = true` **and** `name = 'Sandbox'`, wipes that store's items/shelves/pack selections, and copies the source store's count into it.

Only `40a872fb` has `requires_super_admin = true`. So the clone target is **40a872fb** — the "Retired Clone". Its contents confirm it: 219 items, 161 pack selections, and one in-progress sandbox count (177 lines) cloned from a real store on Jul 1. It is the live testing bench, not a retired leftover. `inventoryGate.ts` is right about which store is the clone target; the *name* we gave it in the rename is misleading.

## 4. Rename broke the sandbox clone

The lookup requires the name to be exactly `Sandbox`. Both are now `[TEST] Sandbox…`, so the clone button will fail with "No Sandbox location found." The `[TEST] Lite QA` store is unaffected. This needs fixing before anyone uses Clone-to-Sandbox again — either match on the test flag + super-admin instead of the name, or match names starting with `Sandbox`/`[TEST] Sandbox`.

## 5. Everywhere else these ids appear

- `supabase/functions/_shared/inventoryGate.ts` — both ids in the fallback exclusion list (comments now inaccurate).
- `supabase/migrations/20260612234902…sql` — one-off inventory enable, both ids, comments swapped/vague.
- `supabase/migrations/20260716185715…sql` — one-off clearing billing fields on `150cfede`.
- No other code, function, view, or trigger hardcodes either id. Everything else finds them by flag or by name.

## Recommendation (nothing done yet)

1. Do not delete either store. `40a872fb` is the working sandbox; `150cfede` carries thousands of history rows and 25 people's access, and deleting it would cascade across ~20 tables.
2. Fix the clone lookup so the rename doesn't break it, and swap the two names so the working bench isn't labelled "Retired Clone".
3. Correct the stale comments in `inventoryGate.ts`.
4. If you want cleanup instead of deletion: `150cfede`'s 1453 alert rows and 1453 notification logs are pure noise and can be pruned safely.

Say the word on which of these you want and I'll plan the change.
