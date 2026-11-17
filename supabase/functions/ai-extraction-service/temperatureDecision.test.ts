import { decideReads, decideTemperature, needsTiebreak } from './temperatureDecision.ts';
import { parseTempReply } from './parseTempReply.ts';
import { applyBands } from './temperatureDecision.ts';
import { parseOrientReply } from './orient.ts';

function equal(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

Deno.test('agreeing reads: averaged, confirmed, no third read', () => {
  equal(needsTiebreak({ value: 38 }, { value: 40 }), false);
  equal(decideTemperature(38, 40).temperature, 39);
  equal(decideTemperature(38, 40).reason, null);
});

Deno.test('Sparks tomatoes: 49.8 vs 38.9, third read 38.6 agrees with B → whole degree 38 confirmed (tenths differ)', () => {
  equal(needsTiebreak({ value: 49.8 }, { value: 38.9 }), true);
  const d = decideTemperature(49.8, 38.9, 38.6);
  equal([d.temperature, d.isValid, d.reason, d.tiebreak], [38, true, null, true]);
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
  equal(r, { value: 38.6, unclear: null, display: 'digital', confidence: 0.9, tenthsSure: null });
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

Deno.test('decimal cut: unsure tenths → whole degree cut, never rounded up', () => {
  equal(decideReads({ value: 41.7, tenthsSure: false }, { value: 41.7, tenthsSure: true }).temperature, 41);
  equal(decideReads({ value: 41.7, tenthsSure: true }, { value: 41.7, tenthsSure: true }).temperature, 41.7);
  equal(decideReads({ value: 134.9, tenthsSure: false }, { value: 134.9 }).temperature, 134);
  equal(decideReads({ value: -5.7, tenthsSure: false }, { value: -5.7 }).temperature, -5);
});

Deno.test('decimal cut: reads agree on the whole degree but not the tenths → whole degree', () => {
  equal(decideTemperature(41.7, 41.2).temperature, 41);
  equal(decideTemperature(38.6, 38.6).temperature, 38.6);
  equal(decideTemperature(38.9, 39.1).temperature, 39); // different whole degrees: averaged as before
});

Deno.test('parse reply: TENTHS line', () => {
  equal(parseTempReply('TENTHS: unsure\nANSWER: 41.7').tenthsSure, false);
  equal(parseTempReply('TENTHS: sure\nANSWER: 41.7').tenthsSure, true);
  equal(parseTempReply('TENTHS: none\nANSWER: 41').tenthsSure, null);
});

Deno.test('bands: Sparks upside-down ~75 on a walk-in is outside possible → not saved', () => {
  const d = applyBands(decideTemperature(75.9, 73.9), 'walk_in');
  equal([d.temperature, d.reason, d.implausibleValue], [null, 'implausible', 74.9]);
  // Untagged keeps today's broad check (75 saves, flagged unsafe).
  equal(applyBands(decideTemperature(75.9, 73.9), null).temperature, 74.9);
});

Deno.test('bands: inside possible but out of compliance saves as failed', () => {
  const d = applyBands(decideTemperature(46.2, 46.2), 'walk_in');
  equal([d.temperature, d.isValid, d.verdict], [46.2, false, 'fail']);
  equal(applyBands(decideTemperature(41, 41), 'refrigerator').isValid, true);
  equal(applyBands(decideTemperature(-4, -4), 'freezer').isValid, true);
  equal(applyBands(decideTemperature(150, 151), 'hot_holding').verdict, 'pass');
  equal(applyBands(decideTemperature(132, 132), 'hot_holding').verdict, 'borderline');
  equal(applyBands(decideTemperature(162, 162), 'reheating').verdict, 'borderline');
});

Deno.test('upright pick reply parsing', () => {
  equal(parseOrientReply('Image 3 has the decimal at the bottom.\nUPRIGHT: 3'), 180);
  equal(parseOrientReply('UPRIGHT: **2**'), 90);
  equal(parseOrientReply('UPRIGHT: 7'), null);
  equal(parseOrientReply('no idea'), null);
});
