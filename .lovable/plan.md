# Theo listening cues and orb reactions

## Build
- Add the approved Web Audio cue generator unchanged for READY, GOT IT, and CLOSED.
- Play READY only when the live connection first reaches listening, and hold microphone sends until it finishes.
- Play GOT IT when a store-data lookup starts, and hold microphone sends while it plays.
- Play CLOSED once after any non-error ending of a live talk; stop the socket, microphone, and usage timer immediately, but delay only the existing audio context close long enough for the cue.
- Set xAI server silence detection to 600ms without changing its threshold or prefix padding.
- Add the approved burst, sparkle, reverse-pull, spin, flash, dim, and reduced-motion reactions to the voice-screen orb only.

## Technical details
- `TheoVoiceOrb` will expose a small `cue(name)` ref API and use the shared cue timing values.
- A per-talk live/listening flag and one-shot close flag will prevent duplicate CLOSED cues across overlapping close events.
- A microphone-send gate timestamp will prevent READY and GOT IT from reaching xAI.
- Existing voice behavior, backend functions, Theo chat, dock, small Theo icon, and all other screens remain unchanged.

## Checks
- Verify cue timing and orb reactions in a browser with mocked voice events where practical.
- Verify ending paths, reduced motion, the 600ms session setting, usage save behavior, and a clean preview build.
- Clearly report anything requiring a real microphone, speaker, iPhone, or iPad that could not be tested here.
