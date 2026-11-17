import { describe, it, expect } from 'vitest';
import { decideReads, decideTemperature, needsTiebreak } from '../../supabase/functions/ai-extraction-service/temperatureDecision';

describe('thermometer reading decision', () => {
  it('agreeing reads: averaged, confirmed, no third read', () => {
    expect(needsTiebreak({ value: 38 }, { value: 40 })).toBe(false);
    expect(decideTemperature(38, 40)).toEqual({ temperature: 39, isValid: true, unconfirmed: false, reason: null, coaching: null, tiebreak: false });
  });
  it('disagreeing reads, third agrees with A: A+C averaged, confirmed', () =>
    expect(decideTemperature(38.8, 50, 39.2)).toMatchObject({ temperature: 39, isValid: true, reason: null, tiebreak: true }));
  it('disagreeing reads, third agrees with B (Sparks tomatoes 49.8/38.9/38.6): whole degree 38 confirmed (tenths differ)', () =>
    expect(decideTemperature(49.8, 38.9, 38.6)).toMatchObject({ temperature: 38, isValid: true, reason: null, tiebreak: true }));
  it('disagreeing reads, third agrees with neither: no number, never a wrong out-of-range value', () =>
    expect(decideTemperature(38, 50, 70)).toEqual({ temperature: null, isValid: null, unconfirmed: false, reason: 'reads_disagree', coaching: null, tiebreak: false }));
  it('one read failed: third read needed; no agreeing third → nothing saved', () => {
    expect(needsTiebreak({ value: null }, { value: 45 })).toBe(true);
    expect(decideTemperature(null, 45, null)).toMatchObject({ temperature: null, reason: 'one_read_failed' });
    expect(decideTemperature(null, 45, 46)).toMatchObject({ temperature: 45.5, reason: null });
  });
  it('both failed: nothing saved', () =>
    expect(decideTemperature(null, null)).toMatchObject({ temperature: null, isValid: null, reason: 'read_failed' }));
  it('unclear photo: rejected with a coaching reason', () =>
    expect(decideReads({ value: null, unclear: 'too_dark' }, { value: null, unclear: 'too_dark' })).toMatchObject({ temperature: null, reason: 'unclear', coaching: 'too_dark' }));
  it('out-of-range confirmed reading is flagged unsafe so managers are alerted', () =>
    expect(decideTemperature(50, 51).isValid).toBe(false));
});
