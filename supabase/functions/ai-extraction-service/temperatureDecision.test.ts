import { decideReads, decideTemperature, needsTiebreak } from './temperatureDecision.ts';
import { parseTempReply } from './parseTempReply.ts';

function equal(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

Deno.test('agreeing reads: averaged, confirmed, no third read', () => {
  equal(needsTiebreak({ value: 38 }, { value: 40 }), false);
  equal(decideTemperature(38, 40).temperature, 39);
  equal(decideTemperature(38, 40).reason, null);
});

Deno.test('Sparks tomatoes: 49.8 vs 38.9, third read 38.6 agrees with B → 38.8 confirmed', () => {
  equal(needsTiebreak({ value: 49.8 }, { value: 38.9 }), true);
  const d = decideTemperature(49.8, 38.9, 38.6);
  equal([d.temperature, d.isValid, d.reason, d.tiebreak], [38.8, true, null, true]);
});

Deno.test('disagree, third agrees with A', () => {
  equal(decideTemperature(36, 50, 37).temperature, 36.5);
});

Deno.test('disagree, third agrees with neither → no number', () => {
  const d = decideTemperature(36, 50, 70);
  equal([d.temperature, d.isValid, d.reason], [null, null, 'reads_disagree']);
});

Deno.test('one read fails → third read; agreeing third confirms', () => {
  equal(needsTiebreak({ value: null }, { value: 45 }), true);
  equal(decideTemperature(null, 45, 44).temperature, 44.5);
  equal(decideTemperature(null, 45, null).reason, 'one_read_failed');
  equal(decideTemperature(null, 45, null).temperature, null);
});

Deno.test('both fail → no third read, nothing saved', () => {
  equal(needsTiebreak({ value: null }, { value: null }), false);
  equal(decideTemperature(null, null).reason, 'read_failed');
});

Deno.test('unclear photo → rejected with coaching, no number', () => {
  const d = decideReads({ value: null, unclear: 'too_far' }, { value: null, unclear: 'too_far' });
  equal([d.temperature, d.reason, d.coaching], [null, 'unclear', 'too_far']);
  equal(needsTiebreak({ value: null, unclear: 'too_far' }, { value: null, unclear: 'glare' }), false);
});

Deno.test('one unclear + one number → third read decides', () => {
  const a = { value: null, unclear: 'too_dark' as const }, b = { value: 38 };
  equal(needsTiebreak(a, b), true);
  equal(decideReads(a, b, { value: 39 }).temperature, 38.5);
  equal(decideReads(a, b, { value: null, unclear: 'too_dark' }).reason, 'unclear');
});

Deno.test('parse reply: digital, clear', () => {
  const r = parseTempReply('Upside down, decimal at top.\nDISPLAY: digital\nCLEAR: yes\nISSUE: none\nCONFIDENCE: 0.9\nANSWER: 38.6');
  equal(r, { value: 38.6, unclear: null, display: 'digital', confidence: 0.9 });
});

Deno.test('parse reply: unclear always drops the number and whitelists the issue', () => {
  equal(parseTempReply('CLEAR: no\nISSUE: glare\nANSWER: 40').value, null);
  equal(parseTempReply('CLEAR: no\nISSUE: glare\nANSWER: NONE').unclear, 'glare');
  equal(parseTempReply('CLEAR: no\nISSUE: <b>hack</b>\nANSWER: NONE').unclear, 'blurry');
});

Deno.test('parse reply: old format still reads (dial back-compat) and keeps -60..250', () => {
  equal(parseTempReply('Tip over short blue.\nANSWER: 37').value, 37);
  equal(parseTempReply('ANSWER: 999').value, null);
});
