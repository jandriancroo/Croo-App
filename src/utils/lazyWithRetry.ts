import { lazy, ComponentType } from 'react';

/**
 * Wraps React.lazy with retry logic for stale chunk failures.
 * When a deploy changes chunk hashes, browsers with cached HTML
 * try to load old filenames that no longer exist, causing
 * "Importing a module script failed" errors + blank screens.
 * 
 * This retries by force-reloading the page once.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory().catch((err) => {
      // Only auto-reload once per session to avoid infinite loops
      const key = 'chunk_reload_attempted';
      const alreadyReloaded = sessionStorage.getItem(key);
      
      if (!alreadyReloaded) {
        console.warn('[LazyRetry] Chunk load failed, reloading page...', err);
        sessionStorage.setItem(key, Date.now().toString());
        window.location.reload();
        // Return a never-resolving promise so React doesn't render an error
        return new Promise<{ default: T }>(() => {});
      }
      
      // Already tried reloading — clear flag for next time and throw
      sessionStorage.removeItem(key);
      throw err;
    })
  );
}
