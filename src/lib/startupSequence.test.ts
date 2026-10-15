import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  __resetStartupSequence, markDashReady, registerDashSlideUp, requestDashSlideUp,
  setDockOpenState, whenInviteAllowed, installStrayPointerLockGuard,
} from './startupSequence';

describe('startupSequence', () => {
  beforeEach(() => { vi.useFakeTimers(); __resetStartupSequence(); document.body.innerHTML = ''; document.body.style.pointerEvents = ''; });
  afterEach(() => vi.useRealTimers());

  it('slides the dash up after idle, invite ~5s later and only once the dash is closed', () => {
    const order: string[] = [];
    registerDashSlideUp(() => { order.push('dash'); setDockOpenState(true); });
    requestDashSlideUp();
    whenInviteAllowed(() => order.push('invite'));
    markDashReady();
    expect(order).toEqual([]);
    vi.advanceTimersByTime(2000);
    expect(order).toEqual(['dash']);
    setDockOpenState(false);
    vi.advanceTimersByTime(4000);
    expect(order).toEqual(['dash']);
    vi.advanceTimersByTime(1500);
    expect(order).toEqual(['dash', 'invite']);
  });

  it('invite waits while the dash is still open', () => {
    const order: string[] = [];
    registerDashSlideUp(() => { order.push('dash'); setDockOpenState(true); });
    requestDashSlideUp();
    whenInviteAllowed(() => order.push('invite'));
    markDashReady();
    vi.advanceTimersByTime(10000);
    expect(order).toEqual(['dash']);
    setDockOpenState(false);
    expect(order).toEqual(['dash', 'invite']);
  });

  it('without a slide-up the invite shows once the Dash is idle', () => {
    const show = vi.fn();
    whenInviteAllowed(show);
    markDashReady();
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('guard clears a stray body pointer-events:none when no dialog is open', async () => {
    vi.useRealTimers();
    const stop = installStrayPointerLockGuard();
    document.body.style.pointerEvents = 'none';
    await new Promise((r) => setTimeout(r, 400));
    expect(document.body.style.pointerEvents).toBe('');
    const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.setAttribute('data-state', 'open');
    document.body.appendChild(d);
    document.body.style.pointerEvents = 'none';
    await new Promise((r) => setTimeout(r, 400));
    expect(document.body.style.pointerEvents).toBe('none');
    stop();
  });
});
