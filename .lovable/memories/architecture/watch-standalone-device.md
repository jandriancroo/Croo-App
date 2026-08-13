---
name: Apple Watch standalone device
description: Watch is a location device with its own token (watch_devices) fetching read-only snapshots from watch-device-service; no iPhone app needed
type: feature
---
- Watch is treated as a **location device**, mirroring the punch-clock kiosk pattern — not a mirror of the phone session.
- `watch_devices` stores location_id, organization_id, label, SHA-256 `token_hash`, `token_hint`, `last_active_at`, `revoked_at`. Raw token is shown once at issue time only.
- `watch-device-service` edge function (verify_jwt=false) actions: `issue` / `list` / `revoke` (org admin authed) and `snapshot` (device token via `x-watch-token` header).
- Snapshot is built server-side from `sales_cache` + `labor_cache` + `dashboard_widgets` (data/data-3d, scope org/brand/location/app) + today's published `scheduled_shifts`. Labels/formats mirror METRIC_CONFIGS in `supabase/functions/watch-device-service/metricConfigs.ts`.
- Day pace = `pace_adjusted_projection ?? living_projection`, floored at actual sales. Week starts Monday. Timezone from `location_settings.timezone` (fallback America/Los_Angeles).
- Pairing handoff: iPhone `WatchBridge.pairWatch({token, locationId, locationName, apiUrl})` → WatchConnectivity applicationContext/userInfo key `pairing`. Watch stores the token in Keychain, metadata in UserDefaults, then polls the API every 5 min and on scene activation.
- Phone-mirroring snapshot path (`useWatchSync`) still works as a fallback; the API path is authoritative and works with the phone app closed.

## Multi-location (Aug 2026)
- `watch_devices.allowed_location_ids uuid[]` — set at issue time from `get_user_location_ids(pairing user)` plus the chosen location. Null/empty falls back to `location_id`.
- Snapshot action accepts optional `locationId` in the body; it is only honored when present in the allowed list, otherwise falls back to `location_id`. Response includes `locations: [{id,name}]` and `locationId`.
- Watch persists `croo.watch.selectedLocationId` + `croo.watch.locations` in UserDefaults (token stays in Keychain). Default: last selected → first available → paired location.
- Cubes header pill (`LocationHeaderButton`) opens `LocationSwitcherView`; selecting refetches the snapshot which reloads Cubes, Schedule and Sales.
- Pair payload may carry `locations` as a JSON string (`locationsJson` from the JS bridge).
