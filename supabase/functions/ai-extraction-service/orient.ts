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
  /** Small copies (long side <= 640) for the orientation pick, in ROTATIONS order. */
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
  const small = long > 640 ? img.clone().resize(Math.round(img.width * 640 / long), Math.round(img.height * 640 / long)) : img.clone();
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
