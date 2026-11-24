import { describe, it, expect } from 'vitest';
import { jumpCheck, isCurrentReadToken, planBackgroundOutcome, isBgRejected } from '../../supabase/functions/_shared/bgTempRead';

describe('4°F jump flag (median of last 5 valid readings)', () => {
  it('flags a reading more than 4°F from the median when there are at least 3 earlier readings', () => {
    expect(jumpCheck(45, [36, 37, 38])).toEqual({ flag: true, baseline: 37 });
  });
  it('does not flag exactly 4°F away', () => {
    expect(jumpCheck(41, [36, 37, 38]).flag).toBe(false);
  });
  it('needs at least 3 earlier readings', () => {
    expect(jumpCheck(80, [36, 37]).flag).toBe(false);
  });
  it('uses only the 5 most recent readings', () => {
    // newest first: 10,10,10,10,10 then older 90s ignored
    expect(jumpCheck(20, [10, 10, 10, 10, 10, 90, 90, 90])).toEqual({ flag: true, baseline: 10 });
  });
  it('even count takes the middle average', () => {
    expect(jumpCheck(50, [30, 32, 34, 36]).baseline).toBe(33);
  });
});

describe('newest photo wins (token rule)', () => {
  it('applies a result only when the row still has the same token', () => {
    expect(isCurrentReadToken('a', 'a')).toBe(true);
    expect(isCurrentReadToken('b', 'a')).toBe(false);
    expect(isCurrentReadToken(null, 'a')).toBe(false);
  });
});

describe('background outcome mirrors the phone rules', () => {
  it('defrost/error screen with no number fails with the defrost tip', () => {
    expect(planBackgroundOutcome({ temperature: null, defrostOrError: true })).toEqual({ status: 'failed', reason: 'defrost_or_error', coaching: 'defrost_or_error' });
  });
  it('hot holding just under 135°F asks for one retake, then saves failed', () => {
    expect(planBackgroundOutcome({ temperature: 132, equipmentType: 'hot_holding' }).status).toBe('failed');
    expect(planBackgroundOutcome({ temperature: 132, equipmentType: 'hot_holding', borderlineRetakeUsed: true })).toEqual({ status: 'saved', tempF: 132, valid: false });
  });
  it('rejected reasons are unclear, defrost and borderline only', () => {
    expect(isBgRejected('failed', 'unclear')).toBe(true);
    expect(isBgRejected('failed', 'timeout')).toBe(false);
  });
});
