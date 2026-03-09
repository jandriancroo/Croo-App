import { useState, useCallback } from 'react';

const STORAGE_KEY = 'schedule-layout-v2';

/**
 * Feature flag to toggle between current and Option 6 mobile schedule layout.
 * Stored in localStorage so it persists across sessions.
 */
export function useScheduleLayoutFlag() {
  const [isV2, setIsV2] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleLayout = useCallback(() => {
    setIsV2(prev => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  return { isV2, toggleLayout };
}
