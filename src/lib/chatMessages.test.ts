// The chat push must carry the chat's store so each recipient's per-store chat push setting applies.
// Fallbacks: sender's default store, then no store at all (legacy flag only). A lookup failure never blocks the push.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({ data: null, error: null })),
  tables: {} as Record<string, any>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const cfg = h.tables[table] ?? {};
      const q: any = {
        select: () => q,
        eq: () => q,
        neq: () => q,
        in: () => q,
        order: () => q,
        maybeSingle: () =>
          cfg.reject ? Promise.reject(new Error('boom')) : Promise.resolve({ data: cfg.maybeSingle ?? null, error: null }),
        single: () =>
          cfg.reject ? Promise.reject(new Error('boom')) : Promise.resolve({ data: cfg.single ?? null, error: null }),
        then: (res: any) => Promise.resolve({ data: cfg.rows ?? [], error: cfg.error ?? null }).then(res),
      };
      return q;
    },
    functions: { invoke: h.invoke },
  },
}));

vi.mock('@/utils/displayName', () => ({ getDisplayName: (fullName: string | null) => fullName ?? '' }));

import { pushChatMessage } from './chatMessages';

const SENDER = 'sender-1';
const OTHER = 'other-1';

function sentBody() {
  expect(h.invoke).toHaveBeenCalledTimes(1);
  const [fn, opts] = h.invoke.mock.calls[0] as [string, { body: Record<string, any> }];
  expect(fn).toBe('send-push-notification');
  return opts.body;
}

beforeEach(() => {
  h.invoke.mockClear();
  h.tables = {
    chat_members: { rows: [{ user_id: OTHER }] },
    chats: { maybeSingle: { location_id: 'loc-1' } },
    profiles: { single: { full_name: 'Jordan Andrian', nickname: null, default_location_id: 'loc-9' } },
  };
});

describe('pushChatMessage store routing', () => {
  it('sends the chat\'s own store so per-store chat settings apply', async () => {
    await pushChatMessage('chat-1', SENDER, 'hello', 'message', 'msg-1');
    const body = sentBody();
    expect(body.location_id).toBe('loc-1');
    // everything the push has always carried is unchanged
    expect(body.user_ids).toEqual([OTHER]);
    expect(body.sender_id).toBe(SENDER);
    expect(body.notification_type).toBe('chat_messages');
    expect(body.title).toBe('Jordan Andrian');
    expect(body.body).toBe('hello');
    expect(body.data).toEqual({ chat_id: 'chat-1', type: 'message', message_id: 'msg-1' });
  });

  it('falls back to the sender\'s default store when the chat has none', async () => {
    h.tables.chats = { maybeSingle: { location_id: null } };
    await pushChatMessage('chat-1', SENDER, 'hello');
    const body = sentBody();
    expect(body.location_id).toBe('loc-9');
    expect(body.data).toEqual({ chat_id: 'chat-1', type: 'message' });
  });

  it('sends with no store when neither the chat nor the sender has one', async () => {
    h.tables.chats = { maybeSingle: { location_id: null } };
    h.tables.profiles = { single: { full_name: 'Jordan Andrian', nickname: null, default_location_id: null } };
    await pushChatMessage('chat-1', SENDER, 'hello');
    expect('location_id' in sentBody()).toBe(false);
  });

  it('still pushes when the store lookup blows up', async () => {
    h.tables.chats = { reject: true };
    await pushChatMessage('chat-1', SENDER, 'hello');
    const body = sentBody();
    expect(body.location_id).toBe('loc-9');
  });

  it('does not push when nobody else is in the chat', async () => {
    h.tables.chat_members = { rows: [] };
    await pushChatMessage('chat-1', SENDER, 'hello');
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
