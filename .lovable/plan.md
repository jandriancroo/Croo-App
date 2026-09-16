# Why Sep 12 showed a false ~$180 overage at South Meadows

Investigation only — nothing was changed.

## Short answer

Every drawer count at this store pulls one number from Qu: the till's **ending cash**, which for South Meadows behaves as "cash taken so far today" (no $200 bank in it). CrooHQ then scores the count as:

```
(cash in the envelope now + earlier pulls today) − Qu's number
```

That only works if Qu's number still includes the earlier pull. On Sep 12 it did not — somebody recorded the 7:18pm cash pull inside Qu (a paid‑out / till close), so Qu's number dropped by exactly that pull. CrooHQ then added the pull back on its own side, so the same $179.99 got credited twice. That is the entire $179.99 "overage."

On Sep 11, 13, 14 and 15 the pull was **not** recorded in Qu, so Qu's number still covered the whole day and the math happened to come out right.

## Evidence

Qu cash sales for the day vs. what the last count of the night compared against:

| Day | Qu cash sales (whole day) | Last count's "expected" | Read |
| --- | --- | --- | --- |
| Sep 11 | 300.46 | 300.20 | whole day — pull not in Qu |
| **Sep 12** | **198.27** | **19.45** | **remnant only — pull was in Qu** |
| Sep 13 | 188.82 | 188.50 | whole day |
| Sep 14 | 101.66 | 101.57 | whole day |
| Sep 15 | 233.58 | 233.32 | whole day |

The arithmetic closes exactly on Sep 12: cash actually handled all day was 179.99 + 19.45 = 199.44 (Qu 198.27 plus a little cash‑tip/rounding drift). 199.44 − 179.99 = **19.45** — precisely the number Qu handed back for count #2. So Qu's till had the pull subtracted, or a fresh till with $0 starting cash was opened after the pull. Either way it was reporting remnant cash, not the day.

The store itself was fine on Sep 12. No cash was missing.

## Second, separate failure on Sep 8

Sep 8 had two counts eight minutes apart (22:54 and 23:02 UTC) with the **identical** expected figure of 65.85 and the identical drawer counts. The second one credited a 65.10 "prior pull" against an expected number that had not moved, producing a false +64.35. That is not the Qu‑reset issue — it is the same structural flaw seen from the other side: a second count fired before Qu's total moved, and prior pulls were added regardless. (It also looks like a duplicate/re-save of the same count, which inflates it further.)

## What I ruled out

- **Caching:** the drawer form calls `fetch-qubeyond-sales` live per open (`DrawerCountForm.tsx` lines 105–150); no stored till value is reused.
- **Business-date cutoff:** both Sep 12 counts were saved under entry_date 2026‑09‑12 and both landed inside the same business day. Not a date-boundary flip.
- **Manual typing of the expected figure:** the field is editable, so it can't be excluded outright, but the 19.45 falls out of the remnant arithmetic exactly, which a typed guess would not.
- **Volume / multiple tills:** Sep 12 was an ordinary sales day (3,429.91 net), lower cash than Sep 11 or 15. Nothing unusual about the day itself.

## Root cause in one line

`DrawerCountForm.tsx` line 201: `variance = (actualDeposit + priorPullsTotal) − expectedDeposit`, where `expectedDeposit` is Qu's raw `endingCash` (`fetch-qubeyond-sales/index.ts`, `fetchTillsData`, lines 586–608). The formula assumes Qu's figure is always whole-day and never reduced by pulls. Whether that assumption holds depends on staff behaviour at the POS, which is why it fails on some days and not others.

## Options if you want it fixed (not part of this plan — say the word)

1. **Preferred — stop guessing what Qu's number means.** Read the till fields already being requested (`startingCash`, `cashSales`, `paidIns`, `paidOuts`) instead of only `endingCash`, and rebuild expected as day-to-date cash: `cashSales + paidIns`. That is immune to pulls being recorded as paid-outs, and needs no behaviour change from staff.
2. **Detect the mismatch and warn instead of scoring.** If Qu's expected figure comes back smaller than prior pulls already logged, treat the count as unscoreable and show "Qu already accounted for the earlier pull" rather than a variance.
3. **Guard duplicate counts** — block or merge a second drawer count saved minutes after an identical one (the Sep 8 case).
4. **Backfill correction** — recompute the two bad variances (Sep 8 count #2, Sep 12 count #2) so the cash log stops showing phantom overages.

I'd do 1 and 2 together; 3 and 4 are small cleanups on top.
