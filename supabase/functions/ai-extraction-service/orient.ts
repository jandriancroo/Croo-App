// Upside-down / sideways probe fix. Before reading, the photo is turned all
// four ways (0/90/180/270) and the model picks the one where the display reads
// upright. The reads then run on that upright copy.
// Why: Sparks' upside-down LCD (~36°F) was read as ~75 by BOTH reads, so the
// tie-break never kicked in. Rotating in our code means the model never has to
// turn the digits in its head.
import { Image, decode } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

export type Rotation = 0 | 90 | 180 | 270;
export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

const toDataUrl = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(bin)}`;
};

export interface Rotated {
  /** Copies for the orientation pick (long side <= 1200, i.e. full size for app photos), in ROTATIONS order. */
  thumbs: string[];
  /** Full-size copy for a rotation (built on demand). */
  full: (r: Rotation) => Promise<string>;
}

/** Decode once; returns null when the photo can't be decoded (then we read it as-is). */
export async function rotations(bytes: Uint8Array): Promise<Rotated | null> {
  let img: Image;
  try {
    const d = await decode(bytes);
    if (!(d instanceof Image)) return null;
    img = d;
  } catch {
    return null;
  }
  const long = Math.max(img.width, img.height);
  // Full size: small probe screens need every pixel (at 640px the Sparks
  // display was too small to tell upright from upside down).
  const small = long > 1200 ? img.clone().resize(Math.round(img.width * 1200 / long), Math.round(img.height * 1200 / long)) : img.clone();
  const thumbs: string[] = [];
  for (const r of ROTATIONS) {
    const t = r === 0 ? small : small.clone().rotate(r);
    thumbs.push(toDataUrl(await t.encodeJPEG(80)));
  }
  return {
    thumbs,
    full: async (r) => toDataUrl(await (r === 0 ? img : img.clone().rotate(r)).encodeJPEG(88)),
  };
}

/** Parse "UPRIGHT: 3" (1-4) from the orientation reply. null = no pick. */
export function parseOrientReply(text: string): Rotation | null {
  const m = text.match(/UPRIGHT:\s*\**\s*(\d)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 4 ? ROTATIONS[n - 1] : null;
}

// ---------------------------------------------------------------------------
// Digital orient + straighten (location_settings.digital_orient_reads_enabled).
// Ported from the benchmark (commit 0b1b597). imagescript Image.rotate(deg)
// turns COUNTER-CLOCKWISE for positive deg; cardinal copies are CCW
// 0/90/180/270 and TILT_CW from the model is clockwise, so final CCW = base - tilt.
// ---------------------------------------------------------------------------
export const ORIENT_TILT_PROMPT = (rangeHint: string) => `These are 4 copies of ONE thermometer photo, each turned a different way (Image 1, Image 2, Image 3, Image 4 in order). Do two things.

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

/** Parse "UPRIGHT: n" + "TILT_CW: x" (clamped to ±45). base null = no pick. */
export function parseOrientTilt(text: string): { base: Rotation | null; tiltCw: number } {
  const base = parseOrientReply(text);
  const t = text.match(/TILT_CW:\s*\**\s*([+-]?\d+(?:\.\d+)?)/i);
  let tiltCw = t ? Number(t[1]) : 0;
  if (!Number.isFinite(tiltCw)) tiltCw = 0;
  tiltCw = Math.max(-45, Math.min(45, Math.round(tiltCw)));
  return { base, tiltCw: base == null ? 0 : tiltCw };
}

/** Total counter-clockwise turn for a pick. */
export const totalCcw = (base: Rotation, tiltCw: number) => (((base - tiltCw) % 360) + 360) % 360;

const fit = (img: Image, maxLong: number) => {
  const long = Math.max(img.width, img.height);
  return long > maxLong ? img.resize(Math.round(img.width * maxLong / long), Math.round(img.height * maxLong / long)) : img;
};

export interface Straightener {
  /** Four cardinal copies (long side <= 1200), CCW 0/90/180/270. */
  thumbs: string[];
  /** The photo turned `ccw` degrees counter-clockwise (long side <= 1400). */
  turned: (ccw: number) => Promise<string>;
}

/** Decode once; null when the photo can't be decoded (then read it as taken). */
export async function straightener(bytes: Uint8Array): Promise<Straightener | null> {
  let img: Image;
  try {
    const d = await decode(bytes);
    if (!(d instanceof Image)) return null;
    img = d;
  } catch {
    return null;
  }
  const small = fit(img.clone(), 1200);
  const thumbs: string[] = [];
  for (const r of ROTATIONS) thumbs.push(toDataUrl(await (r === 0 ? small : small.clone().rotate(r)).encodeJPEG(80)));
  return {
    thumbs,
    turned: async (ccw) => toDataUrl(await fit((ccw === 0 ? img.clone() : img.clone().rotate(ccw)) as Image, 1400).encodeJPEG(88)),
  };
}
