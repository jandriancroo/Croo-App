// iPhone Duo mode. The native shell sets classes on <html>:
//   duo          — always while running on a Duo
//   duo-folded   — exactly one of these two, updated live on fold/unfold
//   duo-open
// plus --duo-col-left / --duo-col-right (Apple's column width, 0px when none).
// Everything Duo is additive: with no `duo` class this hook stays false and
// no Duo CSS applies, so phone/iPad/desktop/PWA render exactly as before.
import { useEffect, useState } from 'react';

export interface DuoState {
  isDuo: boolean;
  isOpen: boolean;
  isFolded: boolean;
}

const DUO_OFF: DuoState = { isDuo: false, isOpen: false, isFolded: false };

function readDuoState(): DuoState {
  if (typeof document === 'undefined') return DUO_OFF;
  const c = document.documentElement.classList;
  const isDuo = c.contains('duo');
  return {
    isDuo,
    isOpen: isDuo && c.contains('duo-open'),
    isFolded: isDuo && c.contains('duo-folded'),
  };
}

export function useDuo(): DuoState {
  const [state, setState] = useState<DuoState>(readDuoState);

  useEffect(() => {
    const update = () => setState(readDuoState());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    // The shell can set classes between the initial render and this effect.
    // Subscribe first, then read again so that startup change cannot be missed.
    update();
    return () => observer.disconnect();
  }, []);

  return state;
}

/** True when an autoFocus / timed .focus() inside a popup is safe to run (i.e. not on a Duo). */
export function useDuoSafeAutoFocus(): boolean {
  return !useDuo().isDuo;
}
