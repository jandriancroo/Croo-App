import { useSyncExternalStore } from 'react';

/**
 * Shared clock tick — ONE setInterval for all subscribers.
 * Components call useClock(1000) or useClock(60000) to get a
 * shared Date that updates at the requested cadence.
 *
 * Multiple components using the same interval share the same timer.
 * When the last subscriber unmounts, the timer is cleaned up.
 */

type TickStore = {
  now: Date;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => Date;
};

const stores = new Map<number, TickStore>();

function getStore(intervalMs: number): TickStore {
  let store = stores.get(intervalMs);
  if (store) return store;

  store = {
    now: new Date(),
    listeners: new Set(),
    timer: null,

    subscribe(cb: () => void) {
      this.listeners.add(cb);
      // Start timer on first subscriber
      if (this.listeners.size === 1 && !this.timer) {
        this.timer = setInterval(() => {
          this.now = new Date();
          this.listeners.forEach(fn => fn());
        }, intervalMs);
      }
      return () => {
        this.listeners.delete(cb);
        // Stop timer when no subscribers
        if (this.listeners.size === 0 && this.timer) {
          clearInterval(this.timer);
          this.timer = null;
        }
      };
    },

    getSnapshot() {
      return this.now;
    },
  };

  // Bind methods so they work when destructured
  store.subscribe = store.subscribe.bind(store);
  store.getSnapshot = store.getSnapshot.bind(store);

  stores.set(intervalMs, store);
  return store;
}

/**
 * Hook: returns a Date object that updates at the given interval.
 * All components using the same interval share a single setInterval.
 *
 * @param intervalMs - tick rate in milliseconds (default 1000)
 *
 * Usage:
 *   const now = useClock();        // ticks every second
 *   const now = useClock(60000);   // ticks every minute
 */
export function useClock(intervalMs: number = 1000): Date {
  const store = getStore(intervalMs);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
