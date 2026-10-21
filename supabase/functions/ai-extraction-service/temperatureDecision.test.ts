import { describe, it, expect } from 'vitest';
import { decideTemperature } from './temperatureDecision';

describe('thermometer reading decision', () => {
  it('agreeing reads: averaged, confirmed', () =>
    expect(decideTemperature(38, 40)).toEqual({ temperature: 39, isValid: true, unconfirmed: false, reason: null }));
  it('disagreeing reads: first read saved, unconfirmed', () =>
    expect(decideTemperature(38.8, 50)).toEqual({ temperature: 38.8, isValid: true, unconfirmed: true, reason: 'reads_disagree' }));
  it('one read failed: the working read saved, unconfirmed', () =>
    expect(decideTemperature(null, 45)).toEqual({ temperature: 45, isValid: false, unconfirmed: true, reason: 'one_read_failed' }));
  it('both failed: nothing saved', () =>
    expect(decideTemperature(null, null)).toEqual({ temperature: null, isValid: null, unconfirmed: false, reason: 'read_failed' }));
  it('out-of-range unconfirmed reading is flagged unsafe so managers are alerted', () =>
    expect(decideTemperature(50, 38).isValid).toBe(false));
});
