import { render, screen, fireEvent, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementsPopup } from './AnnouncementsPopup';

const mocks = vi.hoisted(() => ({ markSeen: vi.fn(), posts: [] as any[] }));
vi.mock('@/hooks/useAnnouncementFeed', () => ({ useAnnouncementFeed: () => ({ posts: mocks.posts, markSeen: mocks.markSeen }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'reader' } }) }));
vi.mock('@/lib/startupSequence', () => ({ whenInviteAllowed: (show: () => void) => { show(); return () => {}; } }));

describe('Dash announcement delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.markSeen.mockReset().mockResolvedValue(true);
    mocks.posts = [{ id: 'one', is_announcement: true, seen_by_me: false, author_id: 'sender', created_at: '2026-01-01', subject: 'Team update', body: 'Hello team', media: [], author: null }];
  });
  afterEach(() => { vi.useRealTimers(); });
  it('waits for system alerts', () => {
    render(<AnnouncementsPopup enabled={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('records the existing read record on confirmation', async () => {
    render(<AnnouncementsPopup enabled />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: "I've read this" })); });
    expect(mocks.markSeen).toHaveBeenCalledWith('one');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('records a read after five visible seconds', async () => {
    render(<AnnouncementsPopup enabled />);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(mocks.markSeen).toHaveBeenCalledWith('one');
  });
  it('does not deliver already-read announcements', () => {
    mocks.posts[0].seen_by_me = true;
    render(<AnnouncementsPopup enabled />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
