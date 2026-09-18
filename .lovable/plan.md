# Blast radius: all seven PFG stores

Read-only. Live data where I could get it, and a plain flag where I couldn't.

## Token reality first (your question 5)

Only **South Meadows** has a usable token sitting in storage right now. The other six store a refresh token but no access token, and all six expire within the hour (refreshed 02:56, expiring 03:56).

I tried logging in fresh with each store's stored username and password — **all seven failed** with the same PFG error (`AADB2C: An exception has occurred`), including South Meadows, whose stored token works fine. So the password route is dead from this sandbox; PFG is likely blocking it by IP or requiring the browser flow.

That leaves one way to test the other six live: use their refresh tokens. PFG rotates a refresh token when it's used, so the new one **must be written back** or that store's nightly sync breaks. Writing is a code change, which I can't do in plan mode. So the six non-South-Meadows live tests need your go-ahead to run in build mode, where the app's own refresh routine saves the new token properly.

What follows is therefore: South Meadows live, the other six from our stored data plus the live list enumeration I ran earlier tonight while tokens were valid.

## Current state, per store

| Store | Rows | Priced | Uncategorized | Stored list points at | Real vendor Order Guide |
|---|---|---|---|---|---|
| Hemet | 200 | **185** | 0 | `!! BLAZE PIZZA MONTHLY AH - Bid 73` (PFG-managed, 181) | same — correct |
| Palm Desert | 201 | **185** | 0 | same Bid 73 list | same — correct |
| Palm Springs | 199 | **186** | 0 | same Bid 73 list | same — correct |
| Rowlett | 183 | **166** | 0 | `!! BLAZE PIZZA DALLAS - Bid 10` (PFG-managed, 163) | same — correct |
| Sparks | 125 | **125** | 3 | `Blaze Form` (store-built, 115) | `Order Guide` (185) — **wrong pointer** |
| South Meadows | 197 | **1** | 88 | `Blaze Form` (store-built, 109) | `Order Guide` (186) — **wrong pointer** |
| Tuscaloosa | 184 | **149** | 158 | `Bid_10_BL305` (PFG-managed, 138) | `Order Guide_10_BLAZE1` (166) — pointer valid but smaller list |

Three distinct situations, not one.

## Does each fix apply where?

| Store | 1. Bulk pricing | 2. `SortByType: 0` | 3. Repoint list | 4. Prune stale rows |
|---|---|---|---|---|
| Hemet | Helps: fills the 15 unpriced, keeps 185 current | Low risk, already 0 uncategorized | **No — leave alone** | Yes, ~19 stale rows |
| Palm Desert | Same, 16 unpriced | Low risk | **No** | Yes, ~20 |
| Palm Springs | Same, 13 unpriced | Low risk | **No** | Yes, ~18 |
| Rowlett | Helps: 17 unpriced | **Yes — only 1 category today** | **No** | Yes, ~20 |
| Sparks | Already 125/125 priced | Yes | **Yes** — gains ~60 items | Yes |
| South Meadows | **Biggest win: 1 → 186 priced** | Yes | **Yes** — 109 → 186 items | Yes, 78 stale rows |
| Tuscaloosa | Helps: 35 unpriced | **Yes — 158 uncategorized** | Maybe — worth a look, not urgent | Yes, ~46 |

Answering question 4 directly: **the three healthy California stores do not need repointing.** Their stored pointer already resolves to PFG's own managed Bid list, they have zero uncategorized rows, and 185-ish of ~200 rows are priced. The only thing they gain is having their last dozen-odd unpriced rows filled and their stale leftovers cleared — real but minor. I would not disturb their list pointer at all.

## What I could not verify live, and why it matters

- **Question 2, `SortByType: 0` at every store.** Confirmed at South Meadows (produces your exact 16 categories) and confirmed earlier tonight at Blaze Form and Order Guide both. Not yet confirmed at Hemet's Bid 73, Rowlett's Dallas list, or Tuscaloosa's lists. Rowlett matters most: it has one single category today, so the sort mode could change its whole category structure.
- **Question 3, bulk pricing at other stores.** Proven only on South Meadows' account. The endpoint is customer-scoped, so it should generalise, but "should" isn't proof and you specifically asked not to assume that.

## Recommendation on blast radius

**Do not ship all four to all seven at once.** Ship in this order:

1. **Bulk pricing + `SortByType: 0`, South Meadows and Sparks first.** Those two are already broken, so there's nothing to regress. Verify counts and categories against your Order Guide export.
2. **Repoint South Meadows and Sparks** in the same pass — they're the only two with a wrong pointer.
3. **Then Tuscaloosa and Rowlett**, checking each store's category structure before and after, since both change shape under the new sort mode.
4. **Hemet, Palm Desert, Palm Springs last, and pricing-only.** No repoint, no pointer change. Confirm their priced count doesn't drop below today's 185/185/186.
5. **Pruning last of all**, once each store's sync is confirmed producing the right rows — pruning against a bad sync would delete good rows.

That's the safe sequence. Two things I need from you: permission to run in build mode so the other six stores' tokens can be refreshed and saved properly for live verification, and confirmation you want the three California stores left on their current list pointer.
