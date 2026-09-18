# Did automated PFG pricing ever exist?

Short answer: **yes, it exists and it runs nightly — and it worked for six of your seven stores. South Meadows is the one store where it produced nothing.** So this isn't "nobody ever automated pricing"; it's "the automated pricing ran everywhere and silently came back empty for one store."

One correction to your framing, from the data itself: the Hemet batch you're describing as June 8 / 161 rows isn't what's in the table. Details below.

## 1. Every pricing call site

Only one PFG pricing endpoint has ever been used: **`GetProductDetail`**, one product at a time. There has never been a bulk pricing call anywhere in the app until tonight's discovery.

It is called from exactly one place — the `categories` action inside `pfg-service`. That action pulls the store's list, notices which items came back without a price (which is all of them, since the list endpoint sends none), then fetches prices ten products at a time and writes them onto the cached list rows on the way past.

Three things trigger that action:

| Trigger | Automatic? | Notes |
|---|---|---|
| Nightly vendor gap scan (runs 3:15 AM Pacific) | **Yes, automatic** | Loops every store with live PFG credentials. This is the real pricing engine. |
| Scheduled price sync, every 8 hours | Was automatic | Added Aug 5, **switched off Sep 2** because it wrote costs outside the new pricing chain. |
| A staff member opening Start Count or the inventory items screen | No, human | Prices whatever list they're looking at, as a side effect. |

And the nightly **list scrape** — the job that writes the bid-guide rows — deliberately fetches **no** prices. There's a note in the code saying exactly that: pricing every item would take ~170 separate calls per store, so it was left out on purpose, with a suggestion to add a weekly priced job later. That job was never built.

So: pricing has only ever happened as a side effect of the gap scan, or of a person browsing.

## 2. The Hemet batch — what actually happened

Hemet's write history, straight from the table:

| When (UTC) | Rows | Priced |
|---|---|---|
| Jun 12, Jun 25, Jul 7 | 1 each | 1 each |
| Jun 13 | 3 | 0 |
| Sep 1, Sep 12, Sep 17 10:21 | 12 total | 0 |
| **Sep 17 10:34** | **181** | **181** |

So Hemet's priced guide isn't from June at all — it landed in **one batch on Sep 17**, and every row in it came back priced. June 8 is simply the oldest row's creation date across the five original stores (a handful of single rows, mostly unpriced), not a 161-row priced batch.

The Sep 17 10:34 batch is the nightly gap scan doing its per-item pricing walk. And it wasn't just Hemet:

| Store | Sep 17 priced batch |
|---|---|
| Hemet | 181 of 181 |
| Palm Springs | 181 of 181 |
| Tuscaloosa | 138 of 138 |
| Sparks | 115 of 115 |
| Rowlett, Palm Desert | same pattern |
| **South Meadows** | **nothing — only the unpriced list write at 10:21** |

Sparks matters here: it's just as new as South Meadows (both first appeared Aug 23) and it got fully priced anyway. So "new store" isn't the explanation.

## 3. Bottom line

- Automated pricing **did** exist and **does** work: the nightly gap scan prices a store's whole guide, one item at a time, and it did exactly that for six stores on Sep 17.
- Hemet wasn't lucky and wasn't hand-fed. It's on the automated path.
- South Meadows is on the same path with the same code and was **not** excluded — same brand, not on any exclusion list. Its pricing pass simply produced zero rows that night.
- **Why it produced zero for South Meadows, I can't tell you from evidence.** The logs from Sep 17 are no longer retained, so anything I said about the cause would be a guess. Two candidates worth naming, both unproven: the pricing walk failing or timing out partway for that store, or its wrong list pointer sending the walk somewhere unproductive.

So the honest version: South Meadows was missing something the others got, from a pipeline that does exist — not from a pipeline that never existed. And the fix we found tonight makes the whole question moot: one bulk call per store replaces the 180-call-per-store walk that's been quietly failing for one store and silently costing time at the other six.
