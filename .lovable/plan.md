

## Make Checklist Completion More Robust on Manager Dashboard

### Problem
The checklist section in the Punch Clock Manager Dashboard currently shows a simple complete/incomplete indicator (circle vs checkmark) with no progress detail. The data already includes `completedItems` and `totalItems` counts from the query, but the UI doesn't display them.

### Changes

**File: `src/components/punchclock/ManagerDashboardOverlay.tsx`** (lines ~1536-1566)

Update the checklist row rendering to show:

1. **Progress fraction** instead of just a frequency badge — display `3/7` or `Done` when complete
2. **Mini progress bar** under the checklist title showing visual completion percentage
3. Keep the green checkmark circle for fully complete items and the open circle for incomplete ones

The updated row layout:

```text
[Circle] Checklist Title          [3/7]
         [======----] progress bar
```

- Replace the badge content from `frequency` to `{completedItems}/{totalItems}` when incomplete, and `Done` when complete
- Add a thin progress bar (2px height) below the title using the existing `Progress` component or a simple styled div
- Color coding: green for 100%, yellow/amber for partial, muted for 0%

### Technical Details

- The query at line 499 already returns `completedItems` and `totalItems` per checklist — no backend changes needed
- Only the JSX rendering block (lines 1536-1566) needs modification
- Uses existing `isDayMode` theme logic for proper dark/light styling
- Progress bar width calculated as `(completedItems / totalItems) * 100`

