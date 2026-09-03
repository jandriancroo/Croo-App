/**
 * Small build stamp for the punch clock PIN screen.
 *
 * Shows the running build version plus when THIS tablet last loaded it. If the
 * stamp goes stale after a publish, the idle auto-reload didn't fire — that's
 * the diagnostic. Deliberately inert: no tap handler, no refresh shortcut,
 * pointer-events-none, and parked in the corner away from the keypad and the
 * Punch In button so it can never be hit by a thumb.
 */
import { useMemo } from 'react';
import { format } from 'date-fns';
import { LOADED_VERSION, getBuildLoadedAt } from '@/utils/buildVersion';

export const BuildVersionStamp = ({ isDayMode }: { isDayMode?: boolean }) => {
  const loadedAt = useMemo(() => getBuildLoadedAt(), []);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none select-none fixed bottom-1 left-2 z-10 text-[10px] leading-tight tracking-wide font-mono ${
        isDayMode ? 'text-black/35' : 'text-white/35'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      v{LOADED_VERSION}
      {loadedAt ? ` · loaded ${format(loadedAt, 'MMM d, h:mm a')}` : ''}
    </div>
  );
};
