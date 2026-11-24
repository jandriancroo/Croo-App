import { asCoaching, type TempRead } from './temperatureDecision.ts';

// Parse the reader's reply. The number keeps the existing -60..250°F range
// check; the coaching value is only ever one of the fixed set.
export function parseTempReply(text: string): TempRead {
  const line = (key: string) => text.match(new RegExp(`^\\s*\\**${key}\\**:\\s*\\**\\s*([^\\n*]+)`, 'im'))?.[1]?.trim() ?? null;
  const displayRaw = line('DISPLAY')?.toLowerCase() ?? '';
  const display = displayRaw.startsWith('digital') ? 'digital' : displayRaw.startsWith('dial') ? 'dial' : null;
  const clearRaw = line('CLEAR')?.toLowerCase() ?? '';
  const issue = asCoaching(line('ISSUE')?.toLowerCase().split(/[\s|,.]/)[0]);
  const confRaw = parseFloat(line('CONFIDENCE') ?? '');
  const confidence = Number.isFinite(confRaw) ? Math.min(1, Math.max(0, confRaw)) : null;
  const tenthsRaw = line('TENTHS')?.toLowerCase() ?? '';
  const tenthsSure = /^(unsure|no\b)/.test(tenthsRaw) ? false : /^(sure|yes\b)/.test(tenthsRaw) ? true : null;
  const m = text.match(/ANSWER:\s*\**\s*(-?\d+(?:\.\d+)?|NONE)/i);
  let value: number | null = null;
  if (m && m[1].toUpperCase() !== 'NONE') {
    const v = parseFloat(m[1]);
    value = Number.isFinite(v) && v >= -60 && v <= 250 ? v : null;
  }
  // Unclear only when the model explicitly says so; a missing CLEAR line is
  // treated as clear so a well-read dial never gets rejected by format drift.
  if (clearRaw.startsWith('no')) return { value: null, unclear: issue ?? 'blurry', display, confidence, tenthsSure };
  return { value, unclear: null, display, confidence, tenthsSure };
}
