# Croo Cash: archive note (retired feature)

_Written Oct 7 2026 for `docs/archive/croo-cash.md` from a read-only audit of the code at `15b5141` and SELECT-only counts on the live DB. Repo git history only goes back to ~Sep 18 2026 (squashed import), so earlier design notes aren't recoverable. This summary comes from the code, comments, migrations and data shape._

## What it was
**Croo Cash** was a gamified "points as money" balance per employee, shown in dollars and stored as **integer cents** on `profiles.croo_cash_balance`. It was meant to reward reliable behaviour and charge for unreliable behaviour:

| Behaviour | Effect (cents) | Source |
|---|---|---|
| Claim (pick up) a teammate's offered shift | **+100** weekday, **+200** Fri/Sat/Sun | `ShiftOfferMessage.tsx` claim handler (`take_shift`) |
| Offer up your own shift and have the claim approved | **−100** weekday, **−200** Fri/Sat/Sun ("Weekend Bonus! … doubled") | approve handler (`offer_shift`); copy in `ShiftOfferDialog.tsx` |
| Claim denied by a manager | reverse the claimer's reward | deny handler (`denied_claim`, never valid in the DB, see below) |
| Complete a checklist | **+25** each | `checklist_completion` (writer no longer in the code) |
| Miss / leave a checklist incomplete | **−25** each | `incomplete_checklist` (writer no longer in the code) |
| "No-show" penalty | mentioned in a comment only ("only when approved or no-show") | never built |

The UI pieces: a balance on the "My Wallet"/profile area ("View Croo Cash balance" in the testing checklist), a "+$X" celebration animation context (`CrooCashAnimationContext`) fired when your claim was approved, and an admin backfill tool. Theo's shift-marketplace tool also asked for a `croo_cash_reward` per offer.

It launched ~Nov 27 2025 (migration `20251127191350`), checklist types were added Nov 29 2025, and it was **hidden from the UI** later with `FEATURE_FLAGS.CROO_CASH_ENABLED = false`. The flag isn't read anywhere, so hiding it didn't stop the writes.

## Data model (as found)
- `profiles.croo_cash_balance integer NOT NULL DEFAULT 0`. Readable and updatable by `authenticated` through column grants (also listed in `src/lib/profileColumns.ts` PROFILE_SAFE_COLUMNS). A balance was updated by read-then-write from the browser, not atomically.
- `croo_cash_transactions`: `id, user_id → profiles (cascade), amount int (cents), transaction_type text CHECK IN ('offer_shift','take_shift','checklist_completion','incomplete_checklist'), shift_offer_id → shift_offers (set null), shift_date date, is_weekend bool, notes text, created_at`. RLS: own rows readable, admins read all, inserts by service_role or by shift-offer participants/managers.
- `increment_croo_cash(user_id uuid, amount int)`: SECURITY DEFINER balance increment. Not called anywhere in the current code.
- Edge: `maintenance-service` action `backfill-croo-cash` **fabricated** history. It created random ±25 rows with random dates to "explain" existing balances, so some historical rows aren't real events.

## Live data at retirement (Oct 7 2026, counts only)
| Item | Count / value |
|---|---|
| `croo_cash_transactions` rows | **321** (Nov 30 2025 → Oct 4 2026), across **15** employees |
| by type | incomplete_checklist 261 (−$65.25), checklist_completion 53 (+$13.25), take_shift 4 (+$6.25), offer_shift 3 (−$6.00) |
| by month | Nov 2025: 1 · Dec: 230 · Jan 2026: 84 · Oct 2026: 6 (shift swaps; still being written) |
| profiles with non-zero balance | **15** (14 active). Total **−$51.25**: 3 positive (sum +$6.00, max +$2.00), 12 negative (sum −$57.25, min −$17.25) |
| rows tied to a shift offer | 7 |

**No one holds a meaningful positive balance (max $2.00).** Nothing was ever paid out (there's no payout or redemption code anywhere).

## Why it's being removed
- Retired product idea. The UI was hidden, but the **shift-swap flow still writes Croo Cash** on every claim and approval (6 rows on Oct 4 2026), and the "Offer Up Shift" dialog still tells employees "You'll lose $1.00 Croo Cash".
- **It breaks Deny:** the deny handler inserts `transaction_type 'denied_claim'`, which the CHECK constraint rejects. So "Deny" on a shift offer that has claims throws before the claims are cleared.
- Theo's `query_shift_marketplace` selects `croo_cash_reward` and other columns that don't exist on `shift_offers`, so that tool always errors.
- Part of the history is fabricated by the backfill tool.

## Retirement (Oct 2026)
Jordan, Oct 7 2026 9:43 PM PT: **no backup**. "No need to back it up, we'd start balances from scratch one day." The table, the balance column and the function were dropped outright after every code reference was removed. This document is the only record. The counts above are the final state. Shift swaps keep working without the balance side effects, and Deny works again.
