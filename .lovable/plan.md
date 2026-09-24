# Issues panel report (read-only, no code)

## What could be read
- I have no tool that reads the editor's "17 Issues found" panel directly, so I can't confirm those 17 titles.
- Preview app (checked earlier): no runtime, console or network errors. Code typecheck: clean.
- Database checker (a different list from the 68 Security findings): 180 items, 4 types:
  - Info - RLS enabled, no policy: 3 tables are locked with no access rules
  - Warn - Extension in public: 2 add-ons installed in the public area
  - Warn - Public can run SECURITY DEFINER function: 69 functions anyone can call without signing in
  - Warn - Signed-in users can run SECURITY DEFINER function: 106 functions any signed-in user can call

## Next step
- Jordan/Andy: paste or screenshot the 17 titles from View Issues, and I'll match each one to the item above or explain it.
- Nothing gets fixed until Jordan says so.
