# Count Screen Config Visibility

## Summary
Per-location visibility preferences for pack config fields in the count screen.
Admin-only toggle. Clone-safe. Valuation unaffected.

## Data model
New table: location_count_config_preferences
- location_id (fk)
- brand_template_id (fk)
- pack_config_id (fk)
- is_visible BOOLEAN DEFAULT true
- Unique on (location_id, brand_template_id, pack_config_id)

## Behavior
- Visibility is per-LOCATION, not per-user. One setting applies to all counters at that location.
- Edit mode toggle: ADMIN AND ABOVE ONLY. Regular managers and shift managers cannot see or use edit mode. Gated by useInventoryPermissions role check.
- When edit mode is active: eye icons appear next to each pack config field in the count screen.
- Tapping eye icon toggles visibility, saves immediately to location_count_config_preferences.
- Clone-safe: preferences are location-scoped so they transfer automatically when cloning.
- Hidden configs with existing non-zero values show a subtle indicator rather than fully hiding — counter can see something is there.
- Valuation math completely unaffected by visibility state.

## Build order
1. Migration: location_count_config_preferences table
2. Load preferences in InventoryCountSession.tsx for current location
3. Admin edit mode toggle in count screen header
4. Eye icon per pack config field, saves on tap
5. Subtle indicator for hidden configs with non-zero values

## Build after
Session 3 (inventory gate) must ship first.
