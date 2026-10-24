import { createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NudgeHeaderButton, type NudgeHeaderHandle } from './NudgeHeaderButton';

const state = vi.hoisted(() => ({ items: [] as { group: string }[], open: false }));
vi.mock('@/hooks/useDuo', () => ({ useDuo: () => ({ isDuo: true, isOpen: true, isFolded: false }) }));
vi.mock('@/components/dashboard/NudgeSection', () => ({
  useNudgeList: () => ({ data: state.items, isLoading: false }),
  NudgeListPanel: () => null,
}));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => { state.open = open; return children; },
  SheetContent: ({ children }: { children: React.ReactNode }) => children,
  SheetHeader: ({ children }: { children: React.ReactNode }) => children,
  SheetTitle: ({ children }: { children: React.ReactNode }) => children,
}));
afterEach(() => { cleanup(); state.items = []; state.open = false; });

describe('native Nudge bridge', () => {
  it('reports zero when no items are late', () => {
    const onLateCountChange = vi.fn();
    state.items = [{ group: 'upcoming' }];
    render(<NudgeHeaderButton locationId="store" nativeOnly onLateCountChange={onLateCountChange} />);
    expect(onLateCountChange).toHaveBeenLastCalledWith(0);
  });
  it('counts only overdue items and reports changes', () => {
    const onLateCountChange = vi.fn();
    state.items = [{ group: 'overdue' }, { group: 'overdue' }, { group: 'upcoming' }];
    const view = render(<NudgeHeaderButton locationId="store" nativeOnly onLateCountChange={onLateCountChange} />);
    expect(onLateCountChange).toHaveBeenLastCalledWith(2);
    state.items = [];
    view.rerender(<NudgeHeaderButton locationId="store" nativeOnly onLateCountChange={onLateCountChange} />);
    expect(onLateCountChange).toHaveBeenLastCalledWith(0);
  });
  it('native toggle opens and closes the same panel', () => {
    const ref = createRef<NudgeHeaderHandle>();
    render(<NudgeHeaderButton ref={ref} locationId="store" nativeOnly />);
    expect(state.open).toBe(false);
    act(() => ref.current?.toggle());
    expect(state.open).toBe(true);
    act(() => ref.current?.toggle());
    expect(state.open).toBe(false);
  });
});