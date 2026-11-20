import { describe, it, expect } from 'vitest';
import { composeExtendedPin, chosenPin, canSaveSixDigit, mismatchMessage, applyKey, digitsOnly } from './punchPinUpgrade';

describe('composeExtendedPin', () => {
  it('adds two digits to the end or the front', () => {
    expect(composeExtendedPin('4821', '57', 'end')).toBe('482157');
    expect(composeExtendedPin('4821', '57', 'front')).toBe('574821');
  });
  it('is short until both added digits are in', () => {
    expect(composeExtendedPin('4821', '5', 'end')).toBe('48215');
    expect(composeExtendedPin('4821', '', 'front')).toBe('4821');
  });
  it('drops non-digits and extra digits', () => {
    expect(composeExtendedPin('48a21', '5x79', 'end')).toBe('482157');
  });
});

describe('chosenPin', () => {
  it('uses the new box in new mode and the extension in extend mode', () => {
    expect(chosenPin('new', '815263', '4821', '57', 'end')).toBe('815263');
    expect(chosenPin('extend', '815263', '4821', '57', 'front')).toBe('574821');
  });
});

describe('canSaveSixDigit / mismatchMessage', () => {
  it('needs 6 digits in both and a match', () => {
    expect(canSaveSixDigit('815263', '815263')).toBe(true);
    expect(canSaveSixDigit('815263', '815264')).toBe(false);
    expect(canSaveSixDigit('81526', '81526')).toBe(false);
    expect(canSaveSixDigit('', '')).toBe(false);
  });
  it('only complains once both boxes are full', () => {
    expect(mismatchMessage('815263', '8152')).toBeNull();
    expect(mismatchMessage('815263', '815264')).toBe("PINs don't match.");
    expect(mismatchMessage('815263', '815263')).toBeNull();
  });
});

describe('applyKey', () => {
  it('stops at the cap, backspaces and clears', () => {
    expect(applyKey('81526', '3', 6)).toBe('815263');
    expect(applyKey('815263', '9', 6)).toBe('815263');
    expect(applyKey('815263', 'back', 6)).toBe('81526');
    expect(applyKey('815263', 'clear', 6)).toBe('');
    expect(applyKey('5', 'x', 2)).toBe('5');
  });
  it('digitsOnly', () => {
    expect(digitsOnly('12-34 56 78', 6)).toBe('123456');
  });
});
