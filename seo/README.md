# Crawler-readable homepage

`/` is served by the same `index.html` shell as every app route, so crawlers that
don't run JS used to see an empty `#root`. Now:

- `seo/home-snapshot.html` = text-only copy of the real rendered `<Home/>` (H1, copy,
  nav/footer links). Generated, committed. Do not hand-edit.
- `vite.config.ts` (`croohq-home-snapshot` plugin) injects it inside `#root` at build.
- It is visually hidden (sr-only) on `/`, `display:none` + removed on every other route
  (inline scripts in `index.html`), and `createRoot()` replaces it when React mounts.
- Canonical/og:url stay in `Home.tsx` (Helmet) only: the shell is shared by `/jobs`,
  `/jobs/:slug` (indexed, own canonicals), so a static homepage canonical would mislabel them.

## Refresh after homepage copy changes
```
npm run build
NODE_PATH=/path/with/playwright/node_modules npm run snapshot:home   # fresh logged-out Chromium
npm run build
```
Commit `seo/home-snapshot.html`. The script fails if it finds JWTs, supabase, keys or localhost.
