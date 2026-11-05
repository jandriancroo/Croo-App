# Lock down the internal widget-permission helper

## What changes for Jordan
Nothing you can see. Signed-in users lose the ability to call a behind-the-scenes permission checker directly. Adding, editing, removing and hiding dashboard cubes keep working the same.

## What I checked (before planning)
- The app code never calls the checker. It only shows up in the auto-generated database types and in a test that builds a fake copy of it on its own. No direct calls from the app.
- In the live database, only three functions call it: add, edit and delete widget. All three run with full rights, so they keep working after the lock-down. Hiding a widget (`toggle_widget_hidden_for_self`) never calls it.
- Right now the checker's search path is `public`, and signed-in users and the service role can both call it.
- Current commit: 99e5864e6.

## Change
One new migration (the next file number in drizzle/migrations), with Andy's exact SQL:

```sql
alter function public._validate_widget_authority set search_path = public, pg_temp;
revoke execute on function public._validate_widget_authority from public, anon, authenticated;
```

The service role keeps its access. Nothing else changes: no other schema, RLS, ReadReceipts, punch/kiosk, shift offers or native files.

## Verify
- Read back the checker's settings: search path is `public, pg_temp`, and no grant exists for `authenticated` or `anon`.
- As a real signed-in manager in the preview: add a cube, edit it, hide it, unhide it and delete it. All five should succeed.
- As the same user, call the checker directly. It should be refused with "permission denied".
- Run the existing dashboard cube test file (`dashboardCubeAccess.test.ts`), and check the build passes.
- Do not publish. Ryan publishes.

## Report
The search result, the migration file name, the test results and the commit.

## Rollback
```sql
grant execute on function public._validate_widget_authority to authenticated;
```
