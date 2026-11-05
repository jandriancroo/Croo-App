# View team link fix

The "View Team" button in the New Team Member email opens a page that doesn't exist. Point it at the real team page.

## Confirmed
- `supabase/functions/hiring-email-service/index.ts` line 759 is the only `croohq.com/user-management` in that file.
- The team page route is `/users` (`src/App.tsx` line 239).

## Change (the only one)
Line 759:
```text
- ${getCTAButton("https://croohq.com/user-management", "View Team")}
+ ${getCTAButton("https://croohq.com/users", "View Team")}
```
Then redeploy the `hiring-email-service` edge function only.

No other file, route, template, subject, recipient logic, function, schema, migration or RLS changes. No test emails sent. Nothing published.

## Tests
- Search confirms no `croohq.com/user-management` left in the file, and the View Team button uses `https://croohq.com/users`.
- hiring-email-service deploys cleanly.
- Build log shows build OK.

## Rollback
Revert the one line and redeploy.
