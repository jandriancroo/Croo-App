import { describe, it, expect } from 'vitest';
import { parsePinLookup, lockoutMessage, lockoutSecondsLeft } from './punchPinLookup';

describe('parsePinLookup', () => {
  it('reads a match', () => {
    expect(parsePinLookup({ status: 'ok', id: 'u1', full_name: 'A B', profile_photo_url: null })).toEqual({
      status: 'ok',
      match: { id: 'u1', full_name: 'A B', profile_photo_url: null },
      upgrade: { needed: false, token: null },
    });
  });
  it('reads the 6-digit upgrade ask', () => {
    const r = parsePinLookup({ status: 'ok', id: 'u1', full_name: 'A', profile_photo_url: null, needs_six_digit: true, upgrade_token: 'abc' });
    expect(r.status === 'ok' && r.upgrade).toEqual({ needed: true, token: 'abc' });
    const capped = parsePinLookup({ status: 'ok', id: 'u1', needs_six_digit: true, upgrade_token: null });
    expect(capped.status === 'ok' && capped.upgrade).toEqual({ needed: true, token: null });
  });
  it('treats ok without an id as an error', () => {
    expect(parsePinLookup({ status: 'ok' })).toEqual({ status: 'error' });
  });
  it('reads miss, not_paired and locked', () => {
    expect(parsePinLookup({ status: 'miss' })).toEqual({ status: 'miss' });
    expect(parsePinLookup({ status: 'not_paired' })).toEqual({ status: 'not_paired' });
    expect(parsePinLookup({ status: 'locked', retry_after_seconds: 119.2 })).toEqual({ status: 'locked', retryAfterSeconds: 120 });
  });
  it('falls back to 60s when locked has no usable wait', () => {
    expect(parsePinLookup({ status: 'locked' })).toEqual({ status: 'locked', retryAfterSeconds: 60 });
    expect(parsePinLookup({ status: 'locked', retry_after_seconds: -3 })).toEqual({ status: 'locked', retryAfterSeconds: 60 });
  });
  it('handles junk', () => {
    expect(parsePinLookup(null)).toEqual({ status: 'error' });
    expect(parsePinLookup([])).toEqual({ status: 'error' });
    expect(parsePinLookup({ status: 'weird' })).toEqual({ status: 'error' });
  });
});

describe('lockoutMessage', () => {
  it('rounds minutes up', () => {
    expect(lockoutMessage(120)).toBe('Too many tries. Wait 2 min.');
    expect(lockoutMessage(61)).toBe('Too many tries. Wait 2 min.');
    expect(lockoutMessage(60)).toBe('Too many tries. Wait 1 min.');
  });
  it('shows seconds under a minute, never 0', () => {
    expect(lockoutMessage(45)).toBe('Too many tries. Wait 45 sec.');
    expect(lockoutMessage(0)).toBe('Too many tries. Wait 1 sec.');
  });
});

describe('lockoutSecondsLeft', () => {
  it('counts down and stops at 0', () => {
    expect(lockoutSecondsLeft(null, 1000)).toBe(0);
    expect(lockoutSecondsLeft(11_000, 1_000)).toBe(10);
    expect(lockoutSecondsLeft(1_000, 5_000)).toBe(0);
  });
});
