import { describe, expect, it } from 'vitest';
import { defaultTicked, hostOf, stateFromAddress } from './lawCheck';

const cit = { url: 'https://dir.ca.gov/x', quote: 'q', state: 'CA' };

describe('defaultTicked', () => {
  it('ticks confident, non-manual rows', () => {
    expect(defaultTicked({ confidence: 0.9, current_source: 'preset', citation: cit })).toBe(true);
    expect(defaultTicked({ confidence: 0.7, current_source: null, citation: cit })).toBe(true);
  });
  it('leaves hand-edited rows unticked', () => {
    expect(defaultTicked({ confidence: 0.99, current_source: 'manual', citation: cit })).toBe(false);
  });
  it('leaves low-confidence or unsourced rows unticked', () => {
    expect(defaultTicked({ confidence: 0.69, current_source: 'preset', citation: cit })).toBe(false);
    expect(defaultTicked({ confidence: null, current_source: 'preset', citation: cit })).toBe(false);
    expect(defaultTicked({ confidence: 0.9, current_source: 'preset', citation: null })).toBe(false);
  });
});

describe('helpers', () => {
  it('hostOf', () => expect(hostOf('https://dir.ca.gov/dlse/faq.htm')).toBe('dir.ca.gov'));
  it('stateFromAddress', () => {
    expect(stateFromAddress('123 Main St, Palm Springs, CA 92262')).toBe('CA');
    expect(stateFromAddress('Hayward')).toBeNull();
  });
});
