# Customer review diagnosis (read-only, no changes)

## Findings
- Review function: the key is present (yes). The function reached the AI service twice (08:33:44 and 08:35:22 UTC). Both calls came back HTTP 200 with no error, and each used about 216 of the 220-word-piece output limit.
- The function writes nothing to its own logs, so the reason it then returned fallback is not recorded. The most likely cause is that the reply was cut off at the length limit and failed the draft check. This is not confirmed.
- Other fast calls (under 70 ms) returned before reaching the AI service, so the answers were empty or the hidden spam field was filled. One call at 08:29:30 got 401 (not signed in / no token).
- Saving reviews: POST 400 at 08:34:14 (no database error logged, so the request was rejected before reaching the database). POST 201 at 08:35:02 succeeded.
- Two GET requests (08:29:31, 08:33:21) got 401 "permission denied for table customer_reviews". That is expected: nobody may read the table.
- The table holds 1 review. There are 2 approval notices on the outgoing email list.

## Proposed next step (needs approval)
Look into why there are 2 notices but only 1 review. Separately, raise the AI output limit and add a log line that records only the reason for the fallback (no customer text). No changes until approved.
