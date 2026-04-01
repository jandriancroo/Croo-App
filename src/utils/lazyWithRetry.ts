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
  const key = 'chunk_reload_attempted';

  return lazy(() =>
    factory()
      .then((module) => {
        // Successful lazy import: clear any stale guard so future failures can recover.
        sessionStorage.removeItem(key);

        // Guard against malformed lazy payloads that crash React internals
        // with "undefined is not an object (evaluating 'e._result.default')".
        if (!module || typeof module !== 'object' || !('default' in module) || !module.default) {
          throw new Error('[LazyRetry] Invalid lazy module shape: missing default export');
        }

        return module;
      })
      .catch((err) => {
        // Only auto-reload once per failure window to avoid infinite loops.
        const alreadyReloaded = sessionStorage.getItem(key);

        if (!alreadyReloaded) {
          console.warn('[LazyRetry] Chunk load failed, reloading page...', err);
          sessionStorage.setItem(key, Date.now().toString());
          window.location.reload();
          // Return a never-resolving promise so React doesn't render an error.
          return new Promise<{ default: T }>(() => {});
        }

        // Already tried reloading — clear flag for the next incident and throw.
        sessionStorage.removeItem(key);
        throw err;
      })
  );
}
