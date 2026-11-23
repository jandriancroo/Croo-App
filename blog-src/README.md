# CrooHQ static blog

Static, crawler-readable HTML served from `public/blog/` (Vite copies `public/` verbatim into `dist/`).

## Add a post
1. Drop `blog-src/posts/<slug>.md` with front matter: `title, seo_title, meta_description, slug, date (YYYY-MM-DD), author, hero, hero_alt` (optional `updated`).
   The last two paragraphs are the CTA lines (bold markdown links) and become the CTA buttons.
2. Drop `blog-src/heroes/<hero>-1600x900.png` (page hero) and `<hero>-1200x627.png` (OG/Twitter + listing card).
3. Run `node scripts/build-blog.mjs` (or `npm run build:blog`). It regenerates `public/blog/**` (including `feed.xml` and `posts.json`) and `public/blog-sitemap.xml` (listed in `public/sitemap.xml`). Front matter `date` is the scheduled date and the only sort key. The byline, JSON-LD `datePublished`, index date, `posts.json` date, and RSS `pubDate` are the earlier of that date and the America/Los_Angeles build date. JSON-LD `dateModified` and sitemap `lastmod` use the same cap, and `dateModified` is never earlier than `datePublished`.
4. Commit `blog-src/` + `public/blog*`.

URLs: `https://croohq.com/blog/` and `https://croohq.com/blog/<slug>/` (always link with the trailing slash).
Link to the blog from React with a plain `<a href="/blog/">`, not a router `<Link>` (the SPA has no /blog route).
