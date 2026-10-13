import { describe, it, expect, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { parseSse } from './theoStream';

describe('parseSse', () => {
  it('parses complete events and keeps the remainder', () => {
    const { events, rest } = parseSse('event: delta\ndata: {"text":"Hi"}\n\nevent: done\ndata: {"content":"Hi"}\n\nevent: del');
    expect(events).toEqual([{ event: 'delta', data: { text: 'Hi' } }, { event: 'done', data: { content: 'Hi' } }]);
    expect(rest).toBe('event: del');
  });
});
