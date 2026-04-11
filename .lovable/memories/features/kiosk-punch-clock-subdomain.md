# Memory: features/kiosk-punch-clock-subdomain
Updated: 2026-04-11

## Kiosk Mode Punch Clock via Subdomain

**Status:** Planned (not yet implemented)

### Concept
Set up `punch.croohq.com` as a dedicated kiosk entry point for the punch clock, so managers can leave an Android tablet running as a time clock terminal without exposing the rest of CrooHQ.

### How It Works
1. **Subdomain routing**: `punch.croohq.com` → custom domain pointing to the app → auto-redirects to `/punch-clock`
2. **Existing features already support this**:
   - Fullscreen mode ✅
   - Wake lock (works on Android) ✅
   - Punch clock UI at `/punch-clock` ✅
3. **Android App Pinning**: Manager enables Settings → Security → App Pinning to lock Chrome to the punch clock tab (disables back/home/recents)
4. **Optional future enhancements**:
   - Kiosk-specific route (`/kiosk`) that strips all navigation/sidebar
   - Manager PIN to exit kiosk mode
   - Block route changes / intercept browser back/forward
   - Hostname detection to auto-redirect when accessed via `punch.croohq.com`

### Implementation Steps (When Ready)
1. Add `punch.croohq.com` as custom domain in Project Settings → Domains (A record: `185.158.133.1`)
2. Add hostname detection in router to redirect `punch.croohq.com` → `/punch-clock` (or a new `/kiosk` route)
3. Optionally build a stripped-down kiosk wrapper component with no navigation
4. Consider manager PIN lock/unlock for exiting kiosk mode

### Target Platform
- Android tablets (Chrome browser)
- iOS Guided Access is the equivalent for iPads
