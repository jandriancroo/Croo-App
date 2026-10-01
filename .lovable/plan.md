# Theo chat visual redesign

## Build
- Replace Theo’s animated canvas sphere with the approved static three-ring dotted SVG while preserving every existing button prop, unread marker, nudge, focus state, and click target.
- Restyle only Theo chat’s header, message presentation, typing state, empty-state icon color, and input bar to the exact approved values.
- Update Theo’s message typography and convert safe two-column scorecard tables into responsive tiles; retain the existing renderer for other tables and unchanged content types.
- Remove only Theo CSS rules made unused by this redesign, retaining suggestion cards and typing animation.

## Safeguards
- Change exactly the four approved files; do not edit the dashboard or top bar.
- Leave message loading, briefings, storage, read state, pinning, helpful feedback, new chat, voice, and sending unchanged.
- Make no database, security, migration, function, or data-type changes.
- Preserve the panel’s position, size, animation, backdrop, radius, and shadow.

## Verification
- Confirm the dotted icon in the top bar, dashboard, and Theo window.
- Check briefing tiles, a user message and reply, typing/empty states, long two-column values, and a 3+ column fallback table.
- Check 390px phone and iPad widths in default, dark, and OLED themes; verify all existing controls still respond.
- Confirm a clean build and capture the requested screenshots.
