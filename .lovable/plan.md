# Gradient cap for the dock dashboard (report only — waiting for "go" + "unlock please")

File: src/components/dock/CompactDashboard.tsx. Presentation only; no data, queries, or behavior.

## Exact lines

- **L608** sheet: `bg-accent` -> `bg-background`. Keep `rounded-t-3xl`, `overflow-hidden`, everything else.
- **L613** header: `relative shrink-0 px-4 pb-4` -> `relative z-10 shrink-0 px-4 pb-4 rounded-b-[30px]`, plus inline style:
  - background: `linear-gradient(135deg, color-mix(in srgb, hsl(var(--accent)) 82%, white) 0%, hsl(var(--accent)) 50%, color-mix(in srgb, hsl(var(--accent)) 85%, black) 100%)`
  - boxShadow: `0 10px 22px -6px hsl(var(--accent) / 0.45)`
- **L723** panel: remove `rounded-t-[24px]`; `pt-5` -> `pt-6` (about 4px more so the shade doesn't sit on the Sales label). Nothing else.
- **L730, L751**: `text-[32px]` -> `text-[28px]` (Sales, Pace).
- **L771, L777, L782**: `text-[24px]` -> `text-[22px]` (Labor, Goal, Variance).

The orb, Tap me, bubble, time, greeting, pace line, chevron, handle, Nudge/glove, On the clock, cut logic, preview dialog (L1000) are not touched.

## How it looks per theme

- **Light (orange #eb7d3c on beige):** peach top-left to a deeper burnt orange; warm orange glow over beige. This is the look Jordan picked.
- **Dark (accent 22 80% 62% on a navy page):** gradient still reads orange. The glow on dark navy is faint, but the curve shows clearly because orange sits against the dark page.
- **OLED (accent 29 14% 37%, a muted brown, on #17181b):** the header turns grey-brown. The lighter top-left goes toward taupe. The shadow is barely visible on near-black, so the curve comes from the color contrast alone. It works, but it's subtle.
- **Spookified (accent 265 20% 18%, a very dark purple):** the header is almost the same as the dark page. The curve and glow are nearly invisible, and the "lighter" corner looks greyish. This is the weakest case.

## Conflicts / notes

1. **Header text color:** the header's text uses accent-foreground, and that stays readable in every theme because the gradient stays close to the accent. No change needed.
2. **Spookified/OLED shadow:** the 45% accent glow almost disappears there. Option: add a small black shadow (e.g. `0 6px 14px -6px rgb(0 0 0 / .35)`) only for dark themes. This isn't in the spec, so I'd leave it out unless Jordan wants it.
3. **Behind the curve:** the beige that shows behind the curve is now the sheet itself. When dragging the sheet down, the top 24px corners still look the same, so nothing changes there.
4. **Scrolling:** the panel scrolls under a header with z-10. Rows slide under the curve and get hidden behind it, which is what we want, and the header shadow falls over the scrolling content.
5. **Locked feature:** the dock is locked, so this needs "unlock please" for presentation only. Nothing touches the dock's slide or toast movement.
