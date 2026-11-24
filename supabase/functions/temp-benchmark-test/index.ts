// temp-benchmark-test — ISOLATED, READ-ONLY benchmark endpoint (Nov 23 2026, approved by Jordan for the Sparks 5-day benchmark).
// Not used by the app. Stateless: no database reads or writes. Live crew scans keep using ai-extraction-service unchanged.
// Locked down: only 4 models, only CrooHQ public checklist-images URLs. Safe to delete this folder + its config.toml block anytime.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image, decode } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { decideReads, needsTiebreak, applyBands, type TempRead } from "./temperatureDecision.ts";
import { parseTempReply } from "./parseTempReply.ts";
import { asEquipmentType, possibleRange, TEMP_BANDS } from "../_shared/tempBands.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ALLOWED_MODELS = new Set(["openai/gpt-6-luna", "openai/gpt-5.4-mini", "google/gemini-3-flash-preview", "google/gemini-3.1-flash-lite"]);
const IMAGE_ORIGIN = "https://lmodeiyrpwvgyqcvjkjr.supabase.co";
const IMAGE_PATH_PREFIX = "/storage/v1/object/public/checklist-images/";
const MAX_BYTES = 15 * 1024 * 1024;

function imageUrlAllowed(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw.startsWith(IMAGE_ORIGIN + IMAGE_PATH_PREFIX)) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.origin === IMAGE_ORIGIN && u.pathname.startsWith(IMAGE_PATH_PREFIX) && !u.pathname.includes("..") && !u.username && !u.password;
  } catch { return false; }
}

type Usage = { prompt_tokens: number; completion_tokens: number; reasoning_tokens: number };
async function callAI(model: string, messages: unknown[]): Promise<{ text: string; usage: Usage; ms: number }> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw { status: 500, message: "LOVABLE_API_KEY is not configured" };
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw { status: res.status, message: `gateway ${res.status}: ${body}` };
    }
    const data = await res.json();
    const u = data?.usage ?? {};
    return {
      text: data?.choices?.[0]?.message?.content ?? "",
      usage: {
        prompt_tokens: Number(u.prompt_tokens) || 0,
        completion_tokens: Number(u.completion_tokens) || 0,
        reasoning_tokens: Number(u.completion_tokens_details?.reasoning_tokens) || 0,
      },
      ms: Date.now() - t0,
    };
  } finally { clearTimeout(timer); }
}

const toDataUrl = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(bin)}`;
};
const fit = (img: Image, maxLong: number) => {
  const long = Math.max(img.width, img.height);
  return long > maxLong ? img.resize(Math.round(img.width * maxLong / long), Math.round(img.height * maxLong / long)) : img;
};
// NOTE: imagescript 1.3.0 Image.rotate(deg) turns the picture COUNTER-CLOCKWISE for positive deg
// (verified locally on a test bitmap). Cardinal copies below are CCW 0/90/180/270 (same as orient.ts);
// TILT_CW from the model is clockwise, so the final CCW angle is base - tiltCw.
const CARDINALS = [0, 90, 180, 270] as const;

function parseOrient(text: string): { base: number | null; tiltCw: number } {
  const m = text.match(/UPRIGHT:\s*\**\s*(\d)/i);
  const n = m ? Number(m[1]) : NaN;
  const base = n >= 1 && n <= 4 ? CARDINALS[n - 1] : null;
  const t = text.match(/TILT_CW:\s*\**\s*([+-]?\d+(?:\.\d+)?)/i);
  let tiltCw = t ? Number(t[1]) : 0;
  if (!Number.isFinite(tiltCw)) tiltCw = 0;
  tiltCw = Math.max(-45, Math.min(45, Math.round(tiltCw)));
  return { base, tiltCw };
}

const ORIENT_PROMPT = (rangeHint: string) => `These are 4 copies of ONE thermometer photo, each turned a different way (Image 1, Image 2, Image 3, Image 4 in order). Do two things.

1) Pick the copy whose thermometer DISPLAY is closest to upright.
For a DIGITAL display, upright means:
- every character is a normal digit standing upright and reading left-to-right;
- the decimal point sits at the BOTTOM of the digits, just before the last (tenths) digit, e.g. 36.1;
- the °F / °C symbol sits to the right of (or upper-right of) the digits;
- the small printed words right next to the screen and buttons (DIGITAL THERMOMETER, HOLD, MAX/MIN, °C/°F, CAL) read normally.
An upside-down 7-segment display still looks like digits but gives it away: a 3 turns into an E, 1 and 7 sit at the wrong edge, and the decimal point floats at the TOP.
IGNORE brand logos printed on the thermometer handle or body (for example ANDAXIN, ThermoPro). Some brands print their logo UPSIDE DOWN relative to the digits, so a logo can point the wrong way. Never use a logo to decide which way is up.
For a DIAL thermometer, upright means the outer Fahrenheit numbers read upright, 0 is at the top-left, the short blue 35–40°F arc is at the upper-right, and the scale numbers increase clockwise.
Two copies will be sideways; of the other two, one is the 180° flip of the other — compare those carefully.${rangeHint} Never decide from the food.

2) In that chosen copy, the display may still be tilted (photos are often taken at an angle). Estimate how many degrees CLOCKWISE the chosen copy must be turned so the row of digits (or the dial's 0/top) is level/upright. Between -45 and 45. Example: digits rising toward the upper-right by about 30° → TILT_CW: 30. Digits falling toward the lower-right by about 30° → TILT_CW: -30. Level → TILT_CW: 0.

Reply with one short reason naming the digits you see in the chosen image, then these two final lines exactly:
UPRIGHT: <1-4>
TILT_CW: <-45 to 45>`;

const SYSTEM_PROMPT = `You read photos of restaurant thermometers: digital probe thermometers (food temps) and cooler/freezer dial thermometers. Stores use different brands, so read what is printed on THIS thermometer — never assume a layout, and never guess a temperature from the food, the item name or what would be "normal".

DIGITAL / 7-SEGMENT DISPLAYS (probe thermometers):
- The photo has usually already been turned and straightened so the display is upright, but check: it may still be rotated or tilted. Before reading, work out which way is UP.
- Orient ONLY with: the °F / °C legend (right of, or above, the digits when upright), the decimal point (at the BOTTOM of the digits, before the last digit, e.g. 38.6), the small printed words next to the screen and buttons (DIGITAL THERMOMETER, HOLD, MAX/MIN, °C/°F), and the probe body.
- IGNORE brand logos on the handle (e.g. ANDAXIN): some are printed upside down relative to the digits.
- If the decimal point appears at the TOP of the digits, the display is upside down: rotate it 180° in your head (the digit order reverses too) and read again.
- After orienting, read each digit by which of its 7 segments are lit, relative to the UPRIGHT digit:
  * 3 = top, upper-right, middle, lower-right, bottom — NO left-side segments.
  * 9 = like 3 plus the upper-left segment. 8 = all seven. 5 = top, upper-left, middle, lower-right, bottom. 6 = like 5 plus lower-left. 7 = top plus the right side only. 0 = all but the middle. 1 = right side only (no top bar). 4 = upper-left, middle, and the right side — NO top bar.
  * 7 vs 1: a 7 has a lit horizontal TOP bar; a 1 does not. Before you read a 1, look hard for that top bar (37.8 is often misread as 31.8, 47.3 as 41.3). Some meters draw the 7 with a short or thin top bar — it is still a 7.
  * 4 vs 7: a 4 has the upper-left and middle segments and NO top bar; a 7 has the top bar and NO middle or left segments.
  * 5 vs 9: a 5 has NO upper-right segment; a 9 has BOTH upper-right and upper-left plus the top, middle and lower-right.
  * Rotated displays are easy to misread as 9, 5, 7 or 8 when the digit is really 3. Before choosing 9, 8, 6 or 5, confirm the left-side segment is really lit.
- Copy the upright digits exactly, including the decimal. Use the Fahrenheit value; if the display shows °C only, convert to °F.
- TENTHS: say whether you are sure of the LAST digit after the decimal point (sure), not sure (unsure), or there is no decimal digit (none). Never guess a tenths digit you can't see clearly.
- If the display shows letters instead of a temperature — dEF (defrost), HI, LO, Err, E1, --- — there is NO temperature: answer NONE with ISSUE: defrost_or_error. Never guess a number.

DIAL THERMOMETERS (coolers, freezers, walk-ins):
- POINTER: the needle has a THIN pointed tip and a WIDE flat tail on the other side of the centre pin. Only the thin tip shows the temperature. The wide dark end is NOT the reading, even though it is easier to see. Many dials' tips are thin and faint — look for them.
- SCALES: there are usually two rings of numbers. The OUTER ring is Fahrenheit (marked F, numbers like -40 … 0 … 30 … 50 … 65). The inner ring is Celsius (marked C) — ignore it. Read the outer F numbers the tip points at.
- COLOURS (same pattern on almost every dial): the coloured arc beside the F numbers has exactly two BLUE sections and everything else is RED.
  * Long blue section on the LEFT/lower-left: from about 0°F down to -40°F (freezer safe).
  * Short blue section on the UPPER-RIGHT: about 35–40°F (refrigerator safe).
  * Red everywhere else: roughly 0–35°F (between the two blues, at the top) and above 40°F (right side down to 65).
  So: tip over left blue → 0 or below. Tip over red at the top-left/top between them → 1–34°F. Tip over the short blue → 35–40°F. Tip over red on the right → 41°F or warmer.
  Remember the wide tail often points down-right toward the 20/65 area — ignore it and follow the thin tip.

CLARITY:
- The photo is UNCLEAR only if you truly cannot read the number with confidence: the digits or dial numbers are tiny (roughly under 5% of the photo height), out of focus, too dark, or hidden by glare/reflection. A small but sharp, readable display is CLEAR.
- If unclear, say why with one word: too_far, too_dark, blurry or glare, and answer NONE. Do not guess.

Steps:
1. Display type: digital, dial or bar.
2. Digital: find which way is up (legend, decimal point, button text — not logos), then copy the upright digits exactly, double-checking 7/1, 4/7 and 5/9.
3. Dial: find the thin tip. Name the two OUTER Fahrenheit numbers either side of it, count the small ticks, estimate a whole number. Check it against the colour band under the tip; if they disagree, re-check that you used the thin tip and the outer ring.
4. Cold storage reads between -30 and 80°F; hot food can read up to about 212°F.

Reply with a short explanation, then these final lines exactly:
DISPLAY: digital|dial|bar
CLEAR: yes|no
ISSUE: none|too_far|too_dark|blurry|glare|defrost_or_error
CONFIDENCE: <0 to 1>
TENTHS: sure|unsure|none
ANSWER: <number> (or ANSWER: NONE if it can't be read)`;

// Test-only (benchmark): tightened 5-rule analog dial block, appended only when payload.dialRules === true.
const DIAL_5RULE = `

TIGHTENED ANALOG DIAL RULES (these override the DIAL section above when they disagree):
1. Read the OUTER Fahrenheit (°F) ring ONLY.
2. Ignore the inner Celsius (°C) ring and ALL unlabeled inner ticks completely, even when no °C symbol is printed.
3. Name the two adjacent labeled major °F numbers the tip sits between. Work out the exact degrees per minor tick in THAT interval (e.g. 4 short ticks between 10°F majors = 2°F per tick; never assume 1°F or 5°F; never estimate by clock angle, because vapor-tension dials are often non-linear/compressed below 0°F). Count ticks clockwise from the LOWER major mark.
4. Follow the tapered/pointed pointer TIP, NOT the chunky counterweight tail behind the centre hub and NOT any mechanical stop pin.
5. Cross-check against the green/red or blue/pink/red coloured zone band under the tip. Ignore glass glare, needle shadow, water/condensation and sideways rotation. If it is genuinely unreadable, answer NONE rather than guessing.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const t0 = Date.now();
  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const model = payload?.model;
  if (typeof model !== "string" || !ALLOWED_MODELS.has(model)) return json({ error: "model not allowed" }, 400);
  const imageUrl = payload?.imageUrl;
  if (!imageUrlAllowed(imageUrl)) return json({ error: "imageUrl not allowed" }, 400);
  const equipmentType = asEquipmentType(payload?.equipmentType);
  const itemName = typeof payload?.itemName === "string" ? payload.itemName.slice(0, 200) : "";
  const skipOrient = payload?.skipOrient === true;
  const dialRules = payload?.dialRules === true; // test-only: append DIAL_5RULE to the read prompt

  const usage = { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, total_tokens: 0, orient_prompt_tokens: 0, orient_completion_tokens: 0, read_calls: 0 };
  const add = (u: Usage) => { usage.prompt_tokens += u.prompt_tokens; usage.completion_tokens += u.completion_tokens; usage.reasoning_tokens += u.reasoning_tokens; usage.total_tokens += u.prompt_tokens + u.completion_tokens; };

  // Download (redirects not followed, size capped).
  let bytes: Uint8Array;
  try {
    const r = await fetch(imageUrl, { redirect: "error" });
    if (!r.ok) return json({ error: `photo download failed ${r.status}` }, 502);
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return json({ error: "photo too large" }, 413);
    bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > MAX_BYTES) return json({ error: "photo too large" }, 413);
  } catch (e) { return json({ error: `photo download error ${String(e).slice(0, 120)}` }, 502); }

  let img: Image | null = null;
  try { const d = await decode(bytes); if (d instanceof Image) img = d; } catch { img = null; }

  let baseRotation: number | null = null, tiltCw = 0, orientText = "", orientMs = 0, orientError: string | null = null;
  let readUrl = toDataUrl(bytes);
  if (img && !skipOrient) {
    try {
      const small = fit(img.clone(), 1200);
      const content: any[] = [];
      const band = equipmentType ? TEMP_BANDS[equipmentType] : null;
      const range = possibleRange(equipmentType);
      const rangeHint = band ? ` This is a ${band.label.toLowerCase()} unit; its thermometer should read somewhere between ${range.min} and ${range.max}°F. Use that only to break a tie between orientations.` : "";
      content.push({ type: "text", text: ORIENT_PROMPT(rangeHint) });
      for (let i = 0; i < 4; i++) {
        const c = CARDINALS[i] === 0 ? small : small.clone().rotate(CARDINALS[i]);
        content.push({ type: "text", text: `Image ${i + 1}:` });
        content.push({ type: "image_url", image_url: { url: toDataUrl(await c.encodeJPEG(80)) } });
      }
      const o = await callAI(model, [{ role: "user", content }]);
      add(o.usage); usage.orient_prompt_tokens = o.usage.prompt_tokens; usage.orient_completion_tokens = o.usage.completion_tokens;
      orientText = o.text.slice(-400); orientMs = o.ms;
      const p = parseOrient(o.text);
      baseRotation = p.base; tiltCw = p.base == null ? 0 : p.tiltCw;
      if (baseRotation != null) {
        const ccw = (((baseRotation - tiltCw) % 360) + 360) % 360;
        const turned = (ccw === 0 ? img.clone() : img.clone().rotate(ccw)) as Image;
        readUrl = toDataUrl(await fit(turned, 1400).encodeJPEG(88));
      }
    } catch (e: any) {
      orientError = String(e?.message ?? e).slice(0, 200);
      baseRotation = null; tiltCw = 0;
    }
  }
  const totalRotationCcw = baseRotation == null ? 0 : (((baseRotation - tiltCw) % 360) + 360) % 360;

  const userPrompt = `Read the temperature on this thermometer.${itemName ? ` The item being measured is: "${itemName}" (context only — read the thermometer, not the food).` : ""}`;
  const msgs = [
    { role: "system", content: dialRules ? SYSTEM_PROMPT + DIAL_5RULE : SYSTEM_PROMPT },
    { role: "user", content: [{ type: "text", text: userPrompt }, { type: "image_url", image_url: { url: readUrl } }] },
  ];
  const readDetails: any[] = [];
  const readOnce = async (): Promise<TempRead> => {
    try {
      const r = await callAI(model, msgs);
      add(r.usage); usage.read_calls++;
      const parsed = parseTempReply(r.text);
      const defrost = /ISSUE:\s*\**\s*defrost_or_error/i.test(r.text);
      readDetails.push({ ...parsed, defrost, ms: r.ms, usage: r.usage, tail: r.text.slice(-260) });
      return defrost ? { ...parsed, value: null } : parsed;
    } catch (e: any) {
      readDetails.push({ value: null, error: String(e?.message ?? e).slice(0, 200) });
      return { value: null };
    }
  };
  const [a, b] = await Promise.all([readOnce(), readOnce()]);
  const c = needsTiebreak(a, b) ? await readOnce() : null;
  const reads = c ? [a, b, c] : [a, b];
  const d = applyBands(decideReads(a, b, c), equipmentType);
  const defrostOrError = readDetails.some((r) => r.defrost);
  const display = (c && d.tiebreak ? c.display : null) ?? a.display ?? b.display ?? null;

  return json({
    model,
    dialRules,
    temperature: d.temperature,
    isValid: d.isValid,
    verdict: d.verdict,
    reason: d.reason ?? (defrostOrError ? "defrost_or_error" : null),
    defrostOrError,
    coaching: d.coaching,
    tiebreak: d.tiebreak,
    implausibleValue: d.implausibleValue ?? null,
    reads: reads.map((r) => r.value),
    readDetails,
    rotation: totalRotationCcw,
    baseRotation,
    tiltCw,
    orientText,
    orientMs,
    orientError,
    displayType: display,
    equipmentType,
    usage,
    elapsedMs: Date.now() - t0,
  });
});

