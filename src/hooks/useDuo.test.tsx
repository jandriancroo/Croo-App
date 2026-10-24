import { useLayoutEffect, type PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDuo } from './useDuo';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('duo', 'duo-open', 'duo-folded');
});

describe('native Duo mode', () => {
  it('stays off without the shell duo class', () => {
    document.documentElement.classList.add('duo-open');
    const { result } = renderHook(useDuo);
    expect(result.current).toEqual({ isDuo: false, isOpen: false, isFolded: false });
  });

  it('reads open mode present before mounting', () => {
    document.documentElement.classList.add('duo', 'duo-open');
    const { result } = renderHook(useDuo);
    expect(result.current).toEqual({ isDuo: true, isOpen: true, isFolded: false });
  });

  it('catches shell classes added between render and observer subscription', () => {
    function ShellStartup({ children }: PropsWithChildren) {
      useLayoutEffect(() => {
        document.documentElement.classList.add('duo', 'duo-open');
      }, []);
      return children;
    }
    const { result } = renderHook(useDuo, { wrapper: ShellStartup });
    expect(result.current).toEqual({ isDuo: true, isOpen: true, isFolded: false });
  });

  it('switches from folded to open and back to normal when shell classes change', async () => {
    document.documentElement.classList.add('duo', 'duo-folded');
    const { result } = renderHook(useDuo);
    expect(result.current.isFolded).toBe(true);
    act(() => {
      document.documentElement.classList.replace('duo-folded', 'duo-open');
    });
    await waitFor(() => expect(result.current).toEqual({ isDuo: true, isOpen: true, isFolded: false }));
    act(() => {
      document.documentElement.classList.remove('duo', 'duo-open');
    });
    await waitFor(() => expect(result.current).toEqual({ isDuo: false, isOpen: false, isFolded: false }));
  });
});