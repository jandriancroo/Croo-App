import { describe, it, expect } from 'vitest';
import { chatKind, canReplyInto, scopeChats, findDm, draftGuard, matchPeople, matchGroups, pickReplyTo, notifyLine, isUnread, type ChatRow } from '../../supabase/functions/_shared/messagePlan';
import { actionsFor, MESSAGE_ROLES, CREATE_TASK_ROLES } from '../../supabase/functions/_shared/theoActions';

const ME = 'me', HEMET = 'hemet', OTHER = 'other-store';
const chat = (id: string, o: Partial<ChatRow>): ChatRow => ({ id, title: null, is_group: false, is_announcement: false, location_id: HEMET, members: [ME, 'x'], ...o });

describe('privacy filter (find_chats, read_chat, query_my_chats)', () => {
  const rows = [
    chat('mine-here', {}),
    chat('mine-other-store', { location_id: OTHER }),
    chat('not-mine', { members: ['a', 'b'] }),
    chat('announce', { is_announcement: true, is_group: true, title: 'Team', members: [ME, 'a', 'b'] }),
  ];
  it('keeps only chats I am in, at this store', () => expect(scopeChats(rows, ME, HEMET).map((c) => c.id)).toEqual(['mine-here', 'announce']));
  it('a chat I am not in does not exist, even if it is at this store', () => expect(scopeChats(rows, ME, HEMET).some((c) => c.id === 'not-mine')).toBe(false));
  it('my chats at another store are not seen from Hemet', () => expect(scopeChats(rows, ME, HEMET).some((c) => c.id === 'mine-other-store')).toBe(false));
});

describe('chat kinds and where Theo may post', () => {
  it('kinds', () => {
    expect(chatKind({ title: null, is_group: false, is_announcement: false })).toBe('dm');
    expect(chatKind({ title: 'Managers', is_group: true, is_announcement: false })).toBe('group');
    expect(chatKind({ title: 'Shift Marketplace', is_group: true, is_announcement: false })).toBe('marketplace');
    expect(chatKind({ title: 'All', is_group: true, is_announcement: true })).toBe('announcement');
  });
  it('reply only into DMs and ordinary groups', () => {
    expect(canReplyInto('dm')).toBe(true); expect(canReplyInto('group')).toBe(true);
    expect(canReplyInto('announcement')).toBe(false); expect(canReplyInto('marketplace')).toBe(false);
  });
  it('findDm reuses the one-to-one chat only, never a group or marketplace', () => {
    const rows = [chat('g', { is_group: true, title: 'Two of us', members: [ME, 'ryan'] }), chat('m', { is_group: true, title: 'Shift Marketplace', members: [ME, 'ryan'] }), chat('dm', { members: [ME, 'ryan'] })];
    expect(findDm(rows, ME, 'ryan')?.id).toBe('dm');
    expect(findDm(rows.slice(0, 2), ME, 'ryan')).toBeNull();
  });
});

describe('draft guard (pay, discipline, firing, performance)', () => {
  for (const t of ["Tell Alle she's being written up", 'let him know his pay is late', 'tell Ryan he is fired', 'talk about her performance', 'tell Isaac he got a raise', 'final warning for Jasper', 'write him up']) {
    it(`declines: ${t}`, () => expect(draftGuard(t)).toBe(true));
  }
  for (const t of ['Thanks for covering!', 'Can you come in at 4?', 'We open at 10 tomorrow.']) {
    it(`allows: ${t}`, () => expect(draftGuard(t)).toBe(false));
  }
});

describe('target matching', () => {
  const people = [{ id: '1', name: 'Alle Rowe' }, { id: '2', name: 'Alle Smith' }, { id: '3', name: 'Ryan Cruz' }];
  it('one match', () => expect(matchPeople('Ryan', people)).toEqual({ one: people[2] }));
  it('two Alles -> several', () => expect('several' in matchPeople('Alle', people)).toBe(true));
  it('full name breaks the tie', () => expect(matchPeople('Alle Smith', people)).toEqual({ one: people[1] }));
  it('nobody', () => expect(matchPeople('Zed', people)).toEqual({ none: true }));
  const groups = [{ title: 'Managers' }, { title: 'Shift Marketplace' }, { title: 'Hemet Crew' }];
  it('"managers chat" -> Managers', () => expect(matchGroups('managers chat', groups)).toEqual({ one: groups[0] }));
  it('"the crew group" -> Hemet Crew', () => expect(matchGroups('the crew group', groups)).toEqual({ one: groups[2] }));
});

describe('reply-to choice', () => {
  const m = (id: string, from: string, t: string, deleted = false) => ({ id, sender_id: from, created_at: t, content: id, deleted });
  const msgs = [m('a1', 'alle', '2026-10-04T10:00'), m('me1', ME, '2026-10-04T11:00'), m('a2', 'alle', '2026-10-04T12:00'), m('a3', 'alle', '2026-10-04T13:00', true)];
  it('latest incoming, not mine, not unsent', () => expect(pickReplyTo(msgs, ME)).toEqual({ message: msgs[2], newer: false }));
  it('an earlier pick warns that a newer one arrived', () => expect(pickReplyTo(msgs, ME, 'a1')).toEqual({ message: msgs[0], newer: true }));
  it('nothing incoming -> no reply', () => expect(pickReplyTo([msgs[1]], ME)).toBeNull());
  it('unread = incoming, not unsent, after my last read', () => {
    expect(isUnread(msgs[2], ME, '2026-10-04T11:30')).toBe(true);
    expect(isUnread(msgs[0], ME, '2026-10-04T11:30')).toBe(false);
    expect(isUnread(msgs[1], ME, null)).toBe(false);
  });
});

describe('notification line never promises more than the push does', () => {
  it('dm', () => expect(notifyLine('dm', 'Alle', 1)).toBe("Alle will get a notification, unless one went out for this chat in the last 3 minutes or they've turned chat alerts off."));
  it('group', () => expect(notifyLine('group', '', 6)).toMatch(/^6 people will get a notification, unless/));
});

describe('who may use messages', () => {
  it('same list as quick tasks', () => expect(MESSAGE_ROLES).toEqual(CREATE_TASK_ROLES));
  for (const r of ['team_member', 'shift_manager_in_training', 'shift_manager', 'brand_admin']) it(`${r}: no messages (and no chat reading)`, () => expect(actionsFor(r, true).send_message).toBe(false));
  for (const r of ['manager', 'admin', 'org_admin', 'super_admin']) it(`${r}: messages`, () => expect(actionsFor(r, true).send_message).toBe(true));
  it('no store access -> none', () => expect(actionsFor('super_admin', false).send_message).toBe(false));
});
