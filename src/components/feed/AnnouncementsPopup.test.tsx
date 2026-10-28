import { render, screen, fireEvent, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementsPopup } from './AnnouncementsPopup';

const mocks = vi.hoisted(() => ({ markSeen: vi.fn(), posts: [] as any[] }));
vi.mock('@/hooks/useAnnouncementFeed', () => ({ useAnnouncementFeed: () => ({ posts: mocks.posts, markSeen: mocks.markSeen }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'reader' } }) }));
vi.mock('@/hooks/useLocation', () => ({ useLocation: () => ({ currentLocation: { name: 'Hemet' } }) }));
vi.mock('@/lib/startupSequence', () => ({ whenInviteAllowed: (show: () => void) => { show(); return () => {}; } }));

describe('Dash announcement delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear(); localStorage.clear();
    mocks.markSeen.mockReset().mockResolvedValue(true);
    mocks.posts = [{ id: 'one', require_confirm: false, is_announcement: true, seen_by_me: false, author_id: 'sender', created_at: '2026-01-01', subject: 'Team update', body: 'Hello team', media: [], author: null }];
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
  it('always renders the footer button, even for require_confirm posts', () => {
    mocks.posts[0].require_confirm = true;
    render(<AnnouncementsPopup enabled />);
    expect(screen.getByRole('button', { name: "I've read this" })).toBeTruthy();
  });
  it('X closes for this session without marking read', async () => {
    mocks.posts[0].require_confirm = true;
    render(<AnnouncementsPopup enabled />);
    await act(async () => { fireEvent.click(screen.getByLabelText('Close', { selector: 'button' })); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.markSeen).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('croo-ann-dismissed:reader')!)).toEqual(['one']);
  });
  it('Escape closes without marking read', async () => {
    mocks.posts[0].require_confirm = true;
    render(<AnnouncementsPopup enabled />);
    await act(async () => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.markSeen).not.toHaveBeenCalled();
  });
  it('failed ack shows the error, counts the launch, and can still be closed', async () => {
    mocks.posts[0].require_confirm = true;
    mocks.markSeen.mockRejectedValue(new Error('permission denied'));
    const { toast } = await import('sonner');
    const spy = vi.spyOn(toast, 'error');
    render(<AnnouncementsPopup enabled />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: "I've read this" })); });
    expect(spy.mock.calls[0][1]?.description).toContain('permission denied');
    expect(JSON.parse(localStorage.getItem('croo-ann-ack-failed:reader')!)).toEqual({ one: 1 });
    await act(async () => { fireEvent.click(screen.getByLabelText('Close', { selector: 'button' })); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('stops popping up after 3 failed launches', () => {
    localStorage.setItem('croo-ann-ack-failed:reader', JSON.stringify({ one: 3 }));
    render(<AnnouncementsPopup enabled />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('renders the header: eyebrow, title, date chip, location and poster, no megaphone', () => {
    mocks.posts[0].created_at = '2026-10-27T16:14:00Z';
    mocks.posts[0].author = { full_name: 'Jordan Andrian', nickname: 'Jordan A.' };
    render(<AnnouncementsPopup enabled />);
    expect(screen.getByRole('heading', { name: 'Team update' })).toBeTruthy();
    expect(screen.getByText('Announcement')).toBeTruthy();
    expect(screen.getByTestId('announcement-date').textContent).toMatch(/^Oct 2[67] · \d{1,2}:14 (AM|PM)$/);
    expect(screen.getByText('Hemet')).toBeTruthy();
    expect(screen.getByText('Jordan A.')).toBeTruthy();
    expect(document.querySelector('.lucide-megaphone')).toBeNull();
  });
  it('image opens the lightbox with the exact url; closing it keeps the announcement open', async () => {
    mocks.posts[0].require_confirm = true;
    mocks.posts[0].media = [{ type: 'image', url: 'https://signed.example/a.jpg?token=abc', name: 'a.jpg' }];
    render(<AnnouncementsPopup enabled />);
    const btn = screen.getByRole('button', { name: 'View photo' });
    expect(btn.querySelector('img')!.getAttribute('src')).toBe('https://signed.example/a.jpg?token=abc');
    await act(async () => { fireEvent.click(btn); });
    expect(screen.getAllByRole('dialog', { hidden: true }).length).toBe(2);
    await act(async () => { fireEvent.keyDown(screen.getAllByRole('dialog', { hidden: true })[1], { key: 'Escape' }); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.getAllByRole('dialog', { hidden: true }).length).toBe(1);
    expect(screen.getByRole('heading', { name: 'Team update' })).toBeTruthy();
    expect(mocks.markSeen).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('croo-ann-dismissed:reader')).toBeNull();
  });
  it('renders body text literally, never as HTML', () => {
    mocks.posts[0].body = '<b>bold</b><img src=x>';
    render(<AnnouncementsPopup enabled />);
    expect(screen.getByText('<b>bold</b><img src=x>')).toBeTruthy();
    expect(screen.getByTestId('announcement-body').querySelector('b')).toBeNull();
  });
});
