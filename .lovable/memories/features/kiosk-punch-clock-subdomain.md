---
name: Kiosk Punch Clock Subdomain
description: kiosk.croohq.com as separate-origin PWA for iOS — document.write manifest in index.html, wildcard route in App.tsx
type: feature
---

# Kiosk PWA via Subdomain

## Why
iOS Safari allows only ONE PWA per origin. `croohq.com/kiosk` merges with `croohq.com`. JS manifest swapping doesn't work — iOS reads manifest before JS runs.

## Architecture
- **`kiosk.croohq.com`** = separate origin = separate PWA install
- **`index.html`**: Synchronous `document.write` outputs correct manifest link based on `location.hostname` BEFORE parser continues. No static `<link rel="manifest">` in HTML.
- **`public/kiosk-manifest.json`**: `start_url: "/"`, `scope: "/"` (relative to subdomain root)
- **`src/App.tsx`**: `isKioskSubdomain` check renders `<KioskPunchClock />` at `*` routes when on `kiosk.croohq.com`
- **`src/main.tsx`**: Subdomain-aware PWA guard; legacy `/kiosk` path still works on main domain
- **`/kiosk` route**: Kept for backward compat on main domain (Android, non-PWA use)

## Setup Required
1. Add `kiosk.croohq.com` as custom domain in Project Settings → Domains
2. DNS: CNAME `kiosk` → same host, or A record → `185.158.133.1`
