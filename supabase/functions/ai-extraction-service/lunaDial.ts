// lunaDial.ts — Ship 4 (Nov 23 2026) dial re-read for extract-temperature.
// When the Flash-Lite triage says DISPLAY: dial, the photo is re-read here by
// openai/gpt-6-luna with the benchmark prompt + the 5-rule dial block: one orient
// call (4 cardinal copies + TILT_CW, rotated in code), two parallel reads, at
// most one tie-break. 100 s budget, 60 s per call. Ported verbatim from the
// retired temp-benchmark-test function (prompts unchanged).
// Logging: fixed messages + status codes only — never orient text, model
// replies, prompts, image data, response bodies or keys.
import { Image, decode } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { needsTiebreak, type TempRead } from './temperatureDecision.ts';
import { parseTempReply } from './parseTempReply.ts';
import { possibleRange, TEMP_BANDS, type EquipmentType } from '../_shared/tempBands.ts';

export const LUNA_DIAL_MODEL = 'openai/gpt-6-luna';
export const LUNA_BUDGET_MS = 100_000;
const PER_CALL_MS = 60_000;
const TIEBREAK_MIN_MS = 30_000;

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

// Tightened 5-rule analog dial block (benchmark dialRules=true), always appended for Luna dial reads.
const DIAL_5RULE = `

TIGHTENED ANALOG DIAL RULES (these override the DIAL section above when they disagree):
1. Read the OUTER Fahrenheit (°F) ring ONLY.
2. Ignore the inner Celsius (°C) ring and ALL unlabeled inner ticks completely, even when no °C symbol is printed.
3. Name the two adjacent labeled major °F numbers the tip sits between. Work out the exact degrees per minor tick in THAT interval (e.g. 4 short ticks between 10°F majors = 2°F per tick; never assume 1°F or 5°F; never estimate by clock angle, because vapor-tension dials are often non-linear/compressed below 0°F). Count ticks clockwise from the LOWER major mark.
4. Follow the tapered/pointed pointer TIP, NOT the chunky counterweight tail behind the centre hub and NOT any mechanical stop pin.
5. Cross-check against the green/red or blue/pink/red coloured zone band under the tip. Ignore glass glare, needle shadow, water/condensation and sideways rotation. If it is genuinely unreadable, answer NONE rather than guessing.`;

export const LUNA_DIAL_SYSTEM_PROMPT = SYSTEM_PROMPT + DIAL_5RULE;

type DisplayRaw = 'digital' | 'dial' | 'bar' | null;
export type LunaRead = TempRead & { defrost?: boolean; displayRaw?: DisplayRaw; errored?: boolean };
export interface LunaDialResult {
  a: LunaRead;
  b: LunaRead;
  c: LunaRead | null;
  /** Total counter-clockwise turn applied before reading, or null when read as taken. */
  rotation: number | null;
  ms: number;
  /** True when no read returned at all (every call errored or timed out). */
  failed: boolean;
  /** Background mode: one read only (b mirrors a, c is null). */
  single?: boolean;
}
type CallAI = (messages: any[], tools?: any[], toolChoice?: any, modelOverride?: string, signal?: AbortSignal, extraBody?: Record<string, unknown>) => Promise<any>;

export async function readDialWithLuna(opts: {
  photoBytes: Uint8Array | null;
  imagePayload: string;
  equipmentType: EquipmentType | null;
  userPrompt: string;
  callAI: CallAI;
  /** 'background' (extract-temperature-bg only): reasoning_effort low, no orient, 2 parallel reads + one tie-break when needed,
   *  no per-call cap (the caller's overall budget applies). Default = today's live behaviour. */
  mode?: 'live' | 'background';
}): Promise<LunaDialResult> {
  const { photoBytes, imagePayload, equipmentType, userPrompt, callAI } = opts;
  const t0 = Date.now();
  if (opts.mode === 'background') {
    const msgsBg = [
      { role: 'system', content: LUNA_DIAL_SYSTEM_PROMPT },
      { role: 'user', content: [{ type: 'text', text: userPrompt }, { type: 'image_url', image_url: { url: imagePayload } }] },
    ];
    const readBg = async (stage: 'read' | 'tiebreak'): Promise<LunaRead> => {
      try {
        const data = await callAI(msgsBg, undefined, undefined, LUNA_DIAL_MODEL, undefined, { reasoning_effort: 'low', __stage: stage });
        const text: string = data?.choices?.[0]?.message?.content || '';
        const parsed = parseTempReply(text);
        const displayRaw: DisplayRaw = parsed.display ?? (/^\s*\**DISPLAY\**:\s*\**\s*bar/im.test(text) ? 'bar' : null);
        return /ISSUE:\s*\**\s*defrost_or_error/i.test(text) ? { ...parsed, value: null, defrost: true, displayRaw } : { ...parsed, displayRaw };
      } catch (e: any) {
        console.error('[extract-temperature-bg] dial read failed', e?.status ?? null);
        return { value: null, errored: true };
      }
    };
    // Two parallel reads + at most one tie-break; only the caller's overall budget applies.
    const [a, b] = await Promise.all([readBg('read'), readBg('read')]);
    const c = needsTiebreak(a, b) ? await readBg('tiebreak') : null;
    const all = c ? [a, b, c] : [a, b];
    return { a, b, c, rotation: null, ms: Date.now() - t0, failed: all.every(r => r.errored === true) };
  }
  const remaining = () => LUNA_BUDGET_MS - (Date.now() - t0);
  // One Luna call with its own AbortController: min(60 s, remaining budget).
  const callLuna = async (messages: any[]): Promise<string> => {
    const timeout = Math.min(PER_CALL_MS, remaining());
    if (timeout <= 0) throw { status: 408, message: 'dial budget used up' };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const data = await callAI(messages, undefined, undefined, LUNA_DIAL_MODEL, ctl.signal);
      return data?.choices?.[0]?.message?.content || '';
    } finally { clearTimeout(timer); }
  };

  let img: Image | null = null;
  if (photoBytes) {
    try { const d = await decode(photoBytes); if (d instanceof Image) img = d; } catch { img = null; }
  }

  // a) Orient: one call on 4 cardinal copies; any failure → read the photo as taken.
  let readUrl = imagePayload;
  let rotation: number | null = null;
  if (img) {
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
      const text = await callLuna([{ role: "user", content }]);
      const p = parseOrient(text);
      if (p.base != null) {
        const ccw = (((p.base - p.tiltCw) % 360) + 360) % 360;
        const turned = (ccw === 0 ? img.clone() : img.clone().rotate(ccw)) as Image;
        readUrl = toDataUrl(await fit(turned, 1400).encodeJPEG(88));
        rotation = ccw;
      } else {
        console.warn('[extract-temperature] dial orient unparseable; reading as taken');
      }
    } catch (e: any) {
      console.warn('[extract-temperature] dial orient failed; reading as taken', e?.status ?? null);
      readUrl = imagePayload;
      rotation = null;
    }
  }

  // b) Two parallel reads, c) at most one tie-break if ≥30 s of budget remain.
  const msgs = [
    { role: 'system', content: LUNA_DIAL_SYSTEM_PROMPT },
    { role: 'user', content: [{ type: 'text', text: userPrompt }, { type: 'image_url', image_url: { url: readUrl } }] },
  ];
  const readOnce = async (): Promise<LunaRead> => {
    try {
      const text = await callLuna(msgs);
      const parsed = parseTempReply(text);
      const displayRaw: DisplayRaw = parsed.display ?? (/^\s*\**DISPLAY\**:\s*\**\s*bar/im.test(text) ? 'bar' : null);
      if (/ISSUE:\s*\**\s*defrost_or_error/i.test(text)) return { ...parsed, value: null, defrost: true, displayRaw };
      return { ...parsed, displayRaw };
    } catch (e: any) {
      console.error('[extract-temperature] dial read failed', e?.status ?? null);
      return { value: null, errored: true };
    }
  };
  const [a, b] = await Promise.all([readOnce(), readOnce()]);
  const c = needsTiebreak(a, b) && remaining() >= TIEBREAK_MIN_MS ? await readOnce() : null;
  const all = c ? [a, b, c] : [a, b];
  return { a, b, c, rotation, ms: Date.now() - t0, failed: all.every(r => r.errored === true) };
}
