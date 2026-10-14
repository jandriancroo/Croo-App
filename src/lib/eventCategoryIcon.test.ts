import { describe, it, expect } from 'vitest';
import { eventKindFromTitle } from './eventCategoryIcon';

describe('eventKindFromTitle', () => {
  it('matches birthdays', () => {
    expect(eventKindFromTitle('Ana & Jordan BDAY')).toBe('birthday');
    expect(eventKindFromTitle('Sam birthday')).toBe('birthday');
  });
  it('matches orders and pizza', () => {
    expect(eventKindFromTitle('H.S. Cross Country Order: 5 Pizzas')).toBe('order');
    expect(eventKindFromTitle('Pizza party')).toBe('order');
  });
  it('put away / delivery wins over order', () => {
    expect(eventKindFromTitle('Put Away Order - Manion')).toBe('delivery');
    expect(eventKindFromTitle('Sysco delivery')).toBe('delivery');
  });
  it('falls back to default', () => {
    expect(eventKindFromTitle('Staff meeting')).toBe('default');
    expect(eventKindFromTitle(null)).toBe('default');
  });
});
