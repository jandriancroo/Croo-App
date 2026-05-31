# Count Screen Item Card Redesign

Render-only redesign of `InventoryCountSession.tsx` item cards. No changes to save logic, RPCs, computeCountLanes, panCounts state, or any write path. Only JSX + Tailwind/inline styles in the per-item render block (~lines 2440–2900) and matching update to `CountLanesPreview.tsx` so the preview stays in parity.

## Files changed

1. `src/components/inventory/InventoryCountSession.tsx` — replace the item-card render block (header + single-leg stepper + multi-leg legs + pan/cambro section) with new unified layout.
2. `src/components/inventory/CountLanesPreview.tsx` — mirror the new structure in `FakeStepper`/preview rows.
3. `src/index.css` — add 4 small utility classes (`.count-btn-down`, `.count-btn-up`, `.count-value-badge`, `.count-default-bg`) so the coral/teal/orange/mint colors are reused without scattering hex values.

No edits to: `computeCountLanes.ts`, state setters, `updateCount`, `updatePanCount`, save handlers, hydration logic.

## Layout strategy

**Single source of structure**: build one `rows` array per item describing each row (`type: 'config-header' | 'config-steppers' | 'pan-header' | 'pan-steppers'` + lane cells). Render twice:

- **Mobile (`<640px`, `sm:hidden`)**: stacked card. Each config = colored header strip + `grid-cols-N` lane grid (N = active lane count, no ghost columns). Pan section = label strip + `grid-cols-N` of pan lanes.
- **Desktop (`sm:`, `≥640px`, `hidden sm:grid`)**: one CSS grid `grid-template-columns: 180px 1fr 1fr 1fr` wrapping ALL rows so left label column and 3 lane columns stay row-synced via the grid itself (not flex). Unused lane cells render a faded `—`.

Tailwind arbitrary values used for exact spec sizes (`text-[15px]`, `min-h-[36px]`, `grid-cols-[180px_1fr_1fr_1fr]`, etc.). Colors `#e85d04`, `#E1F5EE`, `#0F6E56`, `#085041`, `#FEF3EE`, `#F5C4B3`, `#993C1D`, `#9FE1CB`, `#1D9E75` referenced via the 4 new utility classes + a couple of inline `style` props for the orange badge / default-config tinted backgrounds. Borders use `border-border` (existing semantic token mapping to `--color-border-tertiary` equivalent).

## Row structure

### Header row (both viewports)
- Item name (`text-[15px]`/`sm:text-base` font-medium) + subtitle (`text-[11px] text-muted-foreground`)
- Value badge top-right: orange `#e85d04`, white, two-line ($value / unit count). Inline style for exact color.

### Per-config rows
- **Mobile**: `config-header` strip (default = mint bg + dark green text + "default" pill; non-default = muted bg). Then lane grid with vertical `border-r border-border/60` dividers, lane cell = label (`text-[9px] uppercase tracking-wider text-muted-foreground`) + number (`text-[32px] font-medium leading-none`) + button row (gap-3, 36×36 coral down / mint up).
- **Desktop**: two rows per config in the parent 4-col grid — Row A (label cell with config name + default badge, lane cells with centered labels), Row B (label cell with cost/pack subtitle, lane cells with 30px number + 34×34 buttons). Default config: cells get mint bg + mint borders. Unused lane cells render `<span class="opacity-20">—</span>` (labels) and `opacity-[0.08]` (steppers).

### Pan/Cambro rows
- Only render when `item.pan_sizes?.enabled_keys?.length > 0`.
- Mobile: `border-t` separator, label strip "PAN / CAMBRO" (muted bg, `text-[9px] uppercase`), flows directly into pan lane grid (NO border between label strip and pan column labels — pan labels live in the first pan grid row). Pan steppers: 26px number, 32×32 buttons, gap-2.5.
- Desktop: Row C (label cell "PAN / CAMBRO" muted bg + pan-size labels in lane cells, muted bg), Row D (empty label cell + pan steppers, 26px number, 30×30 buttons, gap-2).

## Button styling (shared)
Down: `bg-[#FEF3EE] border border-[#F5C4B3] text-[#993C1D]` rounded-md.
Up: `bg-[#E1F5EE] border border-[#9FE1CB] text-[#0F6E56]` rounded-md.
Mobile 36×36, desktop steppers 34×34, desktop pan 30×30, mobile pan 32×32. Icons `h-4 w-4` (ArrowDown/ArrowUp from lucide).

The previous "centered fade divider between +/−" pattern is **removed** — the new design has separate square buttons with gap, not a joined stepper. All `via-foreground/20` spans deleted from the touched sections.

## What I will NOT touch

- `computeCountLanes.ts` (lane labels, sublabels, abbreviations stay as-is)
- Any `setCounts` / `setPanCounts` / `updateCount` / `updatePanCount` / `handleCountInput` / save / cache code
- Header search bar, period selector, save button, snapshot logic
- Other inventory pages

## After applying

I'll screenshot the preview at 390px (mobile) and ~1024px (desktop) and zoom into one multi-config item (Baby Spinach style) and one single-config item (Fresh Basil style) to confirm match against your two screenshots before declaring done.

Approve to apply, or tell me what to adjust.
