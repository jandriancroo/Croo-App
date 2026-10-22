# TestFlight notes

What testers see under "What to Test" in TestFlight. Plain English, one line per change.
Claude adds a line under "Next build" whenever a native change ships (iPhone app, widgets, Watch, Siri).
Croo Builder's Ship button shows this for editing, posts it to TestFlight, then moves it under the build number.

## Next build

## Build 19 · Oct 21, 2026

- Talk to Theo without opening the app: use the Action Button, Siri ("Talk to Theo") or the Theo button in Control Center. Theo shows up in the Dynamic Island and on the Lock Screen, with Mute and End.
- Ask Siri about your store: "Ask CrooHQ how sales are at Hemet." Siri also answers labor, who's on and what's next on the schedule.
- Widgets connect on their own after you sign in. No more "Pair CrooHQ."
- Changes like tasks, shifts and messages still happen inside the app. If you ask for one during a call, Theo offers to open CrooHQ.

What to test: start a call from the Lock Screen and from the home screen, ask a couple of questions, try Mute and End, and check that your widgets show your store.
