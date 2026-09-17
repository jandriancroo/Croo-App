# Why PFG order lines are missing at South Meadows and Tuscaloosa

Read-only investigation. Nothing changed. **The multi-location hypothesis is not the cause.** The evidence points somewhere much more specific, and it's a code bug on our side.

## The mechanism, in one line

PFG hands us a working order key on the header. Our order sync **throws that key away before asking for the lines**, then rebuilds a key in one particular format. That rebuilt format happens to be correct at four stores and wrong at the other two — so those two get order headers with no lines, silently.

The pattern lines up perfectly with key format, not with logins:

| Store | Key format PFG sends | Orders | Orders missing lines |
| --- | --- | --- | --- |
| Hemet | `428_55067468_2026-09-17_4564931` (4 parts) | 82 | 2 |
| Palm Springs | 4 parts | 55 | 0 |
| Palm Desert | 4 parts | 28 | 0 |
| Rowlett | 4 parts | 26 | 2 |
| **Tuscaloosa** | `33501384_20260915_4250206` (**3 parts**) | 37 | **30** |
| **South Meadows** | `20260911_c8aa71bc-…` (**2 parts**) | 9 | **9** |

The rebuilt key our code uses is always the 4-part shape. Every store whose real key is 4 parts is clean. Both stores whose real key isn't 4 parts are broken. That is the whole story.

Confirming detail from South Meadows' own raw order data: order 492744 on Sep 11, **`TotalLines: 48`**, `$4,543`, and a perfectly good `DeliveryKey` of `20260911_c8aa71bc-…` sitting right there on the header we saved. PFG told us there were 48 lines and gave us the key to fetch them. We asked with a different key and got nothing.

Also confirming it's a regression, not a never-worked: Tuscaloosa's only 7 orders that *do* have lines are all from **May** (45, 45, 45, 42, 42 lines). Everything from June onward is empty. Something changed in the key handling after May.

## 1. How authentication and store scoping actually work

Everything runs through one function, `pfg-service`. Each store has its **own** row in `location_integrations` with its **own** stored credentials: username, password, refresh token, access token, a `customer_id` (a PFG GUID unique per store), and its own bid guide id. A GitHub-scheduled headless login plus a keep-alive routine refresh the tokens; every store's token is distinct.

Yes, there is a per-store account code, and yes we store it: `deliver_to_customer_number`. South Meadows has **`01206`** — exactly the "PFS Northern Cal - 01206" code from the portal screenshot. When the sync pulls orders it filters the returned list down to that number, which is precisely the multi-location guard you were asking about.

So the account-scoping side is working: South Meadows' 9 orders all come back stamped `CustomerName: "Blaze Pizza 1291"`, `CustomerNumber: "01206"`, `537 S Meadows Pkwy`. Correct store, correct address, correct orders. Nothing leaked in from 1331.

## 2. Where lines get fetched — and how the key gets lost

Lines are a **second request per order** (`GetDeliveryDetail`), not returned with the header.

The line-fetch routine was deliberately fixed a while back to trust PFG's native key first and only rebuild as a last resort. That fix is still in place and is correct. **The problem is the caller.** Just before handing each order to the line fetch, the sync repackages it into a small object containing the company number, customer number, delivery date, invoice header key and business-unit key — and **`DeliveryKey` is not among the fields copied over**. So the native key is invisible to the fetch, the "last resort" rebuild fires on *every single order*, and it always produces the 4-part shape.

For South Meadows the rebuild isn't even close: the real key ends in a customer GUID (`c8aa71bc-…`), while the rebuild ends in the invoice header key (`bd74c189-…`) — a different GUID entirely, and with the wrong number of parts and wrong date format.

**On failure it writes NULL and moves on, with no error.** The write is literally "lines if we got any, otherwise NULL," so a header row lands looking normal.

## 3. Shared logins — real, but not the cause

There **is** one shared login, and it matches your screenshot exactly: **South Meadows and Sparks share a single PFG username.** Every other store — Hemet, Rowlett, Palm Desert, Palm Springs, and **Tuscaloosa** — has its own dedicated login.

That kills the hypothesis. Tuscaloosa is on its own dedicated login and is 30-of-37 broken. South Meadows is on the shared login and is 9-of-9 broken. Sharing a login doesn't predict the failure; key format does, with no exceptions.

One genuine multi-location loose end worth noting separately: South Meadows carries the `01206` filter, but **Sparks has no filter set at all**. Sparks currently has zero PFG orders stored, so nothing is wrong today — but if Sparks ever syncs orders on that shared login, it would pull in both stores' orders with nothing to separate them.

## 4. Does the code switch active store before fetching?

There *is* a routine to switch the selected customer at PFG (`setSelectedCustomer`, which tries three different PFG endpoints). **It is never called anywhere.** Dead code.

It also isn't needed: PFG's order endpoints accept the customer id in the request body, and we send it. The proof is that South Meadows' headers come back correctly scoped to store 1291 without any switch ever happening.

## 5. Logged errors

**None — and that's meaningful.** The sync audit log holds 69,600+ rows going back to April 18, and contains **zero** `detail_fetch_failed` entries for any store, ever.

That rules out both an outright request failure and a malformed response, because either one writes an audit row. What's left is the quiet case: PFG accepted our rebuilt key, found nothing matching it, and returned an **empty list**. Zero lines is not treated as a failure anywhere — it writes NULL, logs nothing, and the sync reports success. Which is exactly why this ran for four months without a single alarm.

## What the evidence supports

1. The order sync drops PFG's native delivery key before requesting lines, forcing a rebuild that only produces a valid key for stores using PFG's 4-part key format. South Meadows (2-part) and Tuscaloosa (3-part) fail 100% and ~81% of the time respectively.
2. An empty line list is indistinguishable from success in our code — no audit row, no error, no warning on the run. This is why the earlier finding that "South Meadows' order history leg was dead" showed up only when we went looking.
3. Multi-location accounts are being scoped correctly today via the per-store customer id and the `01206` delivery-number filter. The one gap is Sparks having no filter on a shared login — latent, not currently causing harm.

No fix proposed, per your instruction. When you want one, the smallest correct change is a one-field change at the call site plus making "zero lines returned when the header claimed lines" record itself as a failure instead of passing silently.
