// One app-wide "resume" signal: the app came back to the foreground, came back
// online, or a push was tapped. Chat/feed hooks use it to refetch and re-open
// their live channels (iOS drops the socket while the app is in the background).
import { useEffect, useRef } from 'react';

const EVENT = 'croo:app-resume';
const THROTTLE_MS = 2000;
let lastFired = 0;
let installed = false;

function fire() {
  const now = Date.now();
  if (now - lastFired < THROTTLE_MS) return;
  lastFired = now;
  window.dispatchEvent(new CustomEvent(EVENT));
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fire();
  });
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) fire();
  });
  // Capacitor's native bridge fires this DOM event on foreground (no plugin needed).
  document.addEventListener('resume', fire);
  window.addEventListener('online', fire);
}

install();

export function emitAppResume() {
  install();
  fire();
}

export function onAppResume(cb: () => void): () => void {
  install();
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export function useAppResume(cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => onAppResume(() => ref.current()), []);
}
