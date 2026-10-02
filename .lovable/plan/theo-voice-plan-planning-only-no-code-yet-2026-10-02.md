# Theo Voice — Plan (planning only, no code yet)

## Recommendation

Ship **voice only** first: today's Theo writes the words, and Grok reads them aloud. That's option (i) below: keep Gemini as the brain and use Grok for the voice. It's the cheapest option, it uses the same numbers as text Theo, and you can switch voice companies later without rebuilding anything. Add a **live back-and-forth voice agent** in a later phase, once the spoken brief has proven itself. Even then, keep Theo's brain in charge of the store data.

---

## Step 0: What's in the code today

- **The Theo window** opens from the "Ask Theo" pill in the top bar and from the dashboard orb. It loads today's morning brief and marks it read. Voice input uses the phone's built-in speech-to-text. Theo can't speak yet.
- **Theo's brain** runs on Gemini 2.5 Flash, with about 23 tools for store data: sales, labor, schedule, checklists, inventory, tips, reviews, punches, crew performance and more. It follows one set of rules for every answer.
- **The morning brief** is also written by Gemini 2.5 Flash, saved in the brief table and tracked as read or unread. It's written to be read on screen: headings, a table and lists.
- **Voice input** has two versions: the phone's built-in one, and a recording one used for inventory counting.
- **The existing ElevenLabs voice** uses their fast model and makes MP3 files. Today it's used for audio in other features, not by Theo.
- **The Theo icon** is a static dotted three-ring mark. The old animated sphere has already been removed.
- **Settings** has a notifications area. That's the natural home for a "Theo voice" section.

## Locked features this touches (each needs your "unlock please")

- **Fluid dock and toasts.** The dashboard orb sits in the dock. The full-screen voice view must cover the dock and pause toasts while it's open.
- Not affected: inventory voice counting (separate code, not touched), 3D cubes, version updates, support tickets.

---

## Answers to your questions

### 1. How Grok voice gets connected

1. **You:** create an account at console.x.ai, add billing and create an API key.
2. **You:** paste the key into Project Settings, then Secrets, as `XAI_API_KEY`. I can't create this key for you.
3. **Me:** build a backend function, "theo-voice". It turns the spoken script into audio and sends it back. The key stays on the server.
4. **Me (later, live agent):** a backend function that hands out a short-lived pass for each voice session. The phone connects to Grok with that pass, never with the real key.
5. **Me:** the voice view, the setting and the voice picker.

What I can't do: create the xAI account, accept their terms, or add billing.

### 2. Voice only, or a voice agent?

- **(a) Voice only (recommended first).** Theo's brain writes a short spoken script, and Grok reads it aloud. Follow-up questions use the phone's own speech-to-text: Theo's brain answers, then Grok speaks the answer. There's a small pause between turns (about 1–3 seconds), but the numbers always match text Theo.
- **(b) Voice agent (later).** Grok's live speech-to-speech model handles the whole conversation, with natural turn-taking and interruptions. For store data, Grok must call tools, and those tools would go to the same server logic text Theo uses. It's more natural, but it costs more and the brain is harder to control.

### 3. Cost (assumptions stated)

**Usage assumptions per location:** 2 managers, 1 spoken brief a day each (about 45 seconds, about 700 characters), and about 3 minutes of conversation a day in total. That's 60 briefs and 90 conversation minutes a month.

| | Per brief | Per conversation minute | Per location per month |
|---|---|---|---|
| (i) Gemini brain + Grok voice | ~$0.015 | ~$0.02–0.03 | **~$3** |
| (ii) Grok for brain and voice (live agent) | ~$0.06 | ~$0.08 plus tool use | **~$10–12** |
| (iii) Gemini brain + ElevenLabs | ~$0.10–0.15 | ~$0.15–0.25 | **~$15–30** (depends on your plan) |

**Quality and speed:**
- **(i)** Good voices and a short pause per turn. Numbers always match text Theo.
- **(ii)** The most natural and fastest to respond (under a second). The risk is that Grok's brain and Theo's rules start to drift apart.
- **(iii)** The most polished voices, but the most expensive, with a pause similar to (i).

**Is Grok cheaper as the brain?** For text, Grok's lowest-priced listed model costs more than Gemini Flash is assumed to cost. The live agent's per-minute rate is the biggest cost. So no: Grok as the brain is not cheaper. Grok as the voice is.

**Which prices I checked:**
- **Checked:** xAI's pricing page lists live speech-to-speech at $0.08 per minute (plus $0.004 per text input) and text model prices. Their voice docs confirm short-lived client passes ("ephemeral tokens") and tool calling. Sources: https://docs.x.ai/developers/pricing and https://docs.x.ai/developers/model-capabilities/audio/voice
- **Partly checked:** Grok's voices are listed as Ara, Eve, Leo, Rex and Sal (https://x.ai/api/voice).
- **Not checked, assumed:**
  - Grok text-to-speech at $15 per 1 million characters. The pricing page cut off before that line. I'll confirm it before building.
  - Gemini Flash prices: about $0.30 per million input tokens and $2.50 per million output tokens.
  - ElevenLabs prices, which depend on your plan (about $0.15–0.30 per 1,000 characters).

### 4. Phases — see below.

---

## The 10 review points

1. **Sound without a tap.** iPhone and iPad (Safari and installed app) block sound until the person taps. Android usually blocks it too. Desktop blocks it unless the site has been used before. **Design:** on opening, the screen dims and the orb pulses with "Tap to hear today's update." One tap starts Theo. I won't try to work around the block.
2. **Shared iPads and privacy.**
   - **Who gets it:** shift manager and above only.
   - **Setting:** saved per person. The toggle defaults to **off**; the manager turns it on.
   - **Kiosk and punch-clock devices:** never.
   - **What Theo says out loud:** store totals only. No names, no labor grades, no cash variances, no lateness. Those stay in the text and are mentioned as "details on screen."
3. **One brain.** The spoken script and every voice answer come from Theo's current brain, with the same tools and rules. Grok only turns the text into sound. In the later live-agent phase, every Grok tool call is routed to the same server logic.
4. **A script written for the ear.** When the morning brief is made, the same run also writes a spoken script: 30–45 seconds, plain sentences, rounded numbers, no tables. It's saved next to the brief. The "show text" bubble shows that script, with a "Full brief" link to the normal card.
5. **Missing data out loud.** If a number is missing or zero because no data came in, Theo leaves it out of the spoken script. At most he says one line: "Labor and schedule data haven't come in yet, so I'll skip those." He never says "0%", "grade F" or "no shifts posted" out loud.
6. **The trigger.** I recommend **the first time a manager opens the app in the business day, when there's an unread brief**. The app already tracks this. A timer would fire at random moments. Each person gets at most one spoken brief per day.
7. **The orb.** The big voice orb uses the same three dotted rings, animated with Theo's voice: the rings breathe and grow with volume, and slowly turn in opposite directions. Listening and thinking each get their own gentle motion. The old animated sphere code is gone, and I won't bring it back. The new animation stays light so it runs smoothly on phones.
8. **Failure and exit.**
   - **Exit:** a large X at the top, plus tap outside or swipe down. Exiting stops the audio immediately.
   - **Interrupting:** tapping the orb while Theo is talking stops him and starts listening.
   - **No network, voice fails, or no microphone permission:** Theo shows the text with a short note and falls back to normal text chat.
   - **Phone muted:** the text bubble opens automatically after a few seconds of silence.
9. **Security.** The xAI key lives only on the server. Each voice request checks that the person is signed in, is shift manager or above, and belongs to the store. The later live agent uses one-time passes that expire within minutes. There's a daily per-user limit to cap cost.
10. **Locked features.** As listed above: the fluid dock and toasts.

---

## Phases

**Phase 1: Spoken morning brief**
- What ships: the voice view, one tap to play, the text bubble, exit and interrupt.
- New setting "Theo speaks upon opening" (off by default), plus a choice of 3 voices.
- **You:** create the xAI key and give the unlock for the dock and toasts.

**Phase 2: Push-to-talk follow-ups**
- What ships: ask by voice, Theo answers aloud (option a).

**Phase 3: Live voice agent (optional)**
- What ships: Grok's live speech-to-speech with short-lived passes, using Theo's tools.
- Decided only after you've reviewed Phase 2 usage and cost.

**Phase 4: Smarter and more conversational**
- What ships: better prompts and data, Theo remembering past chats, a friendly but serious tone.

## Technical details

- **Phase 1:**
  - New function `theo-voice` (Grok text-to-speech, MP3, cached per brief and voice).
  - New column on `croo_ai_briefings`: `spoken_script`.
  - Change `generate-daily-briefing` to write that script.
  - New table `theo_voice_settings` (per user: enabled, voice), with access rules and grants.
  - New `TheoVoiceOverlay` view plus an animated version of the dotted-ring orb (a separate component, so the static icon stays as it is).
  - Trigger logic hooked into `useTheoUnread`.
  - Settings section in Settings.
  - The overlay is mounted from `Layout`, and it hides the dock and pauses toasts while open (locked).
- **Phase 2:** reuse `useVoiceInput`. Pass `voice:true` to `ai-assistant` so it gives a short spoken reply. Reuse `theo-voice`.
- **Phase 3:**
  - New function `theo-voice-session`, which mints xAI short-lived passes.
  - New function `theo-voice-tool`, a bridge that sends Grok's tool calls to the same tool code as `ai-assistant` (shared module).
  - The phone connects directly to Grok's live voice service.

## Decisions I need from you

1. Do you approve voice only first (Gemini brain + Grok voice), with the live agent later?
2. Will you create the xAI account and key?
3. Defaults: managers only, per person, off by default, never on kiosks, no names spoken. Agreed?
4. Trigger: first open of the business day with an unread brief. Agreed?
5. Which 3 voices? (For example Eve, Ara and Leo, after you listen to them in xAI's playground.)
6. "Unlock please" for the fluid dock and toasts, when you're ready for Phase 1.
7. Monthly spending cap per location (for example $10)?
