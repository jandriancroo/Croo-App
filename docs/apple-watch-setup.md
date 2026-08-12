# Apple Watch app — setup steps (one time)

The watch app is built and lives in the `watch/CrooWatch` folder. Xcode needs to be
told about it once. After that, every future update just needs the normal
pull + build.

## What the watch shows

1. **Cubes** — a mirror of your Data Cubes from the iPhone dashboard. Multi-face
   cubes are swiped left/right. Change anything on the phone and the watch follows.
2. **Today** — a scrollable list of today's published shifts.
3. **Sales** — the dashboard sales summary, formatted for the small screen.

The watch never edits anything. The phone sends a snapshot; the watch displays it
and remembers the last one so it isn't blank when it opens.

## One-time Xcode setup

1. Open the project: `npx cap open ios`
2. Menu **File → New → Target…**
3. Choose **watchOS → App**, press Next.
4. Fill in:
   - Product Name: `CrooWatch`
   - Interface: **SwiftUI**, Language: **Swift**
   - Bundle Identifier must be: `app.lovable.p9db37c9a728f428da26f854a0e9b29a2.watchkitapp`
   - Uncheck "Include Notification Scene" and any tests.
5. Press Finish. If Xcode asks to activate a new scheme, click Activate.
6. In the new `CrooWatch` folder Xcode created, **delete** the sample
   `ContentView.swift` and `CrooWatchApp.swift` (Move to Trash).
7. Drag all four files from the repo folder `watch/CrooWatch/` into the
   `CrooWatch` group in Xcode. Check **Copy items if needed** and make sure only
   the `CrooWatch Watch App` target is checked.
8. Select the `App` target → **Signing & Capabilities** → confirm your team is set;
   do the same for the `CrooWatch Watch App` target.
9. Build and run: pick the scheme `CrooWatch Watch App`, choose your paired watch
   (or a simulator pair), press ⌘R.

## Every time after that

```bash
cd ~/Developer/Croo-App && git pull && npm run build && npx cap sync ios && npx cap open ios
```

Then in Xcode: ⇧⌘K, then ⌘R.

## Notes

- Open the CrooHQ iPhone app once after installing the watch app — that's what
  sends the first snapshot.
- Both apps must be signed with the same team, and the watch bundle ID must end in
  `.watchkitapp` exactly as above, otherwise the two apps can't talk.
- Widgets and complications come next; the data store the watch already uses is
  the same one those will read.
