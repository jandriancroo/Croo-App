# Theo spoken update — why GPT-6 Astra, and switching back (answers only, nothing changed)

## 1. Why the model changed in ac66e195
I can't recover that exact turn's reasoning. There was no error. My standing platform instructions tell me to use `openai/gpt-6-astra` on the newer endpoint for every new or edited server-side AI call, unless the user names a different model. That rule is the most likely cause: it wasn't Jordan's request, and it wasn't a problem with Gemini.

## 2. Did the Gemini version fail or write a worse script?
There's no evidence it did. No error was logged and no Gemini sample was compared. The switch came 15 seconds after the first version, before it could have been tested.

## 3. Is `google/gemini-2.5-flash` fine for this job?
Yes. A 20–35 second script from a few numbers and the brief is a light job, and the same model already writes the morning brief and answers Theo's chats.
- **Possible downside:** `gemini-2.5-flash` is not in the current list of models I'm shown for new work. That list starts at Gemini 3.x. It still works in about a dozen of your functions today, but it could be retired later.
- **If you'd rather future-proof:** `google/gemini-3-flash-preview` is a listed, low-cost Gemini. Its price would need confirming before the usage card can show it.
- **Quality:** for a script this short I'd expect no noticeable difference from Astra. That's an expectation, not something I've tested.

## 4. What changes if we switch back
Only the spoken-update writer inside the voice service, plus one line on the usage card if needed.
- **Endpoint:** `/v1/responses` goes back to `/v1/chat/completions`, the same one the morning brief uses.
- **Request:** `instructions` + `input` become `messages: [{role:"system"}, {role:"user"}]`.
- **Reading the reply:** `output_text` becomes `choices[0].message.content`.
- **Token counts:** `usage.input_tokens` / `output_tokens` become `usage.prompt_tokens` / `completion_tokens`.
- **Model saved in usage records:** `"openai/gpt-6-astra"` becomes `"google/gemini-2.5-flash"`.
- **Usage card price table:** no change. It already has `gemini-2.5-flash` at $0.30 / $2.50. The Astra line can stay so the 17 past updates are still priced correctly.
- **Elsewhere:** nothing else in the project uses `openai/gpt-6-astra`; this writer is the only place.

## 5. Recommendation
Switch the spoken-update writer back to `google/gemini-2.5-flash`. It matches the morning brief, costs about 1/24th as much, and has no evidence of worse quality. If Jordan approves this plan, I'll make only that change and test one update.
