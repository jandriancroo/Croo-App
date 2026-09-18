# Verification: what is actually fixed, and what is not

Your instinct is right on both counts. Two real gaps remain. Everything below is live output read just now, nothing changed.

## 1. List selection: the fix shipped and ran — the stored ID points at the wrong list

South Meadows is reading from the stored ID, exactly as designed. That ID is `8a95e48f-1754-46dc-9d82-2d0e709936b6`, and calling PFG directly shows what it is:

- `8a95e48f…` = **Blaze Form**, store-built, editable, **109 items**  ← what we're reading
- `5bda5ec0-0a73-4486-870d-3540683fff3c` = **Order Guide**, PFG-managed, read-only, **186 items**  ← the real one

The proof is in the category names. Our table holds `Sauce`, `Dough`, `Dry Food`, `Paper`, `Drinks`, `Desserts` — franchisee vocabulary from Blaze Form. Your Order Guide export has `Bakery Frozen`, `Beef`, `Beverage`, `Commodity Grocery`, `Disposables`, `E&S`. Not one of your 16 categories appears in our data. So no, this does **not** match a manual Order Guide export, and it can't until the stored ID is repointed. Sparks has the identical problem.

So the 66-of-67 pricing win came from fixes #1 and #3, not from list selection. List selection is now correct code reading a wrong pointer.

**Current row count and breakdown (197 rows):**

| Source | Rows | Uncategorized |
|---|---|---|
| Yesterday's fixed sync (Sep 18, Blaze Form via stored ID) | 119 | 10 |
| Old scrape-everything run (Sep 17) | 77 | 77 |
| Older single row (Sep 11) | 1 | 1 |

That answers why the count went **up**: the write path only adds and refreshes rows, it never removes ones that dropped off the list. The 88 Uncategorized are 78 old scrape leftovers plus 10 Blaze Form items PFG returned with no category. Nothing prunes them today.

## 2. The 2 hollow South Meadows orders — one is genuinely fine, one is the original bug in a corner we didn't cover

| Order | Status | Date | PFG header says | We stored | Verdict |
|---|---|---|---|---|---|
| 495418 | Submitted (not yet delivered) | Sep 18 | **47 lines** | 0 | **Still broken** |
| 488696 | Submitted shell | Sep 8 | 1 line | 0 | Superseded — the same order came through as delivered on Sep 2 with its 1 line stored |

Order **495418** is the real remaining failure. The fix passed PFG's own key through for *delivered* orders, which is where the 9-to-2 improvement came from. Submitted orders carry no delivery key at all, so they still go down the old rebuilt-identifier path and come back empty — and the new alarm was deliberately scoped to delivered orders only, so this one failed silently again. Header says 47, we hold 0.

488696 is harmless: a stale pre-delivery shell that the delivered version already replaced.

## What I'd fix next (not doing it now)

1. **Fetch line items for submitted orders** using PFG's submitted-order detail endpoint and its own order key, rather than the delivery path. Then extend the hard-failure alarm to submitted orders so a 47-versus-0 mismatch shouts instead of passing.
2. **Repoint South Meadows and Sparks** to their real Order Guide IDs (South Meadows `5bda5ec0…`, Sparks `756af714…`).
3. **Prune stale list rows** after a successful sync so the table reflects the current guide instead of accumulating every list we ever read — that's what clears the 88 Uncategorized and lands the count at the real 186.

Say which of these you want and I'll build them.
