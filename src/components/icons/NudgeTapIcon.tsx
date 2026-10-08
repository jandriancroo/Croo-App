/**
 * Quick Nudge icon: cartoon glove, long tapered index finger tapping down-left,
 * rounded cuff, 3 knuckle lines. Vectorized from Jordan's final
 * reference.
 *
 * - default: white glove, near-black outline (active)
 * - muted:   grey outline #6B7280, fill #F1F2F4 (cooldown / recently nudged)
 * Decorative (aria-hidden); put aria-label="Nudge crew" on the button.
 */
export interface NudgeTapIconProps {
  /** Rendered width/height in px (or any CSS length). Default 20. */
  size?: number | string;
  /** Grey cooldown variant. */
  muted?: boolean;
  className?: string;
}

/** Glove silhouette (interior fill). */
const GLOVE_FILL =
  "M59.7 2.3C56.9 3.0 54.4 5.4 53.5 8.0L53.3 8.8L52.5 8.8C46.1 8.8 40.5 11.3 32.6 17.4C25.8 22.7 23.1 23.9 16.4 24.8C14.8 25.0 12.8 25.4 12.0 25.6C0.0 28.5 2.2 42.8 14.9 44.4C17.9 44.8 22.5 44.1 25.6 42.9C26.6 42.5 26.6 42.5 25.2 45.3C23.0 49.7 21.2 52.9 15.1 62.5C8.2 73.5 5.9 78.3 5.4 82.7C4.5 91.0 13.1 96.0 19.4 90.8C21.4 89.2 22.7 87.4 27.4 79.2C30.5 73.8 33.3 69.2 33.9 68.5C34.0 68.2 34.1 68.2 34.7 69.0C38.2 73.6 44.2 75.3 48.8 73.2L49.5 72.8L50.3 73.4C53.5 75.8 57.7 76.4 61.1 74.8C69.8 70.8 80.4 49.6 80.1 36.8L80.0 34.8L80.5 34.6C84.0 33.5 86.1 30.0 86.1 25.7C86.1 14.7 69.4 0.0 59.7 2.3Z";
/** Glove outline + cuff + finger/curled-finger creases, one traced path. */
const GLOVE_OUTLINE =
  "M59.7 2.3C56.9 3.0 54.4 5.4 53.5 8.0L53.3 8.8L52.5 8.8C46.1 8.8 40.5 11.3 32.6 17.4C25.8 22.7 23.1 23.9 16.4 24.8C14.8 25.0 12.8 25.4 12.0 25.6C0.0 28.5 2.2 42.8 14.9 44.4C17.9 44.8 22.5 44.1 25.6 42.9C26.6 42.5 26.6 42.5 25.2 45.3C23.0 49.7 21.2 52.9 15.1 62.5C8.2 73.5 5.9 78.3 5.4 82.7C4.5 91.0 13.1 96.0 19.4 90.8C21.4 89.2 22.7 87.4 27.4 79.2C30.5 73.8 33.3 69.2 33.9 68.5C34.0 68.2 34.1 68.2 34.7 69.0C38.2 73.6 44.2 75.3 48.8 73.2L49.5 72.8L50.3 73.4C53.5 75.8 57.7 76.4 61.1 74.8C69.8 70.8 80.4 49.6 80.1 36.8L80.0 34.8L80.5 34.6C84.0 33.5 86.1 30.0 86.1 25.7C86.1 14.7 69.4 0.0 59.7 2.3ZM64.9 5.7C72.9 8.2 82.0 17.7 83.0 24.6C83.5 27.5 82.3 30.2 80.2 31.3C79.5 31.6 79.4 31.6 79.3 30.9C78.2 25.1 72.6 17.7 65.9 13.3C63.2 11.5 58.3 9.4 56.9 9.4C55.8 9.4 57.3 6.8 59.0 6.0C60.6 5.1 62.9 5.0 64.9 5.7ZM56.4 12.3C64.2 13.8 73.1 21.8 75.8 29.8C78.5 38.0 76.0 50.1 69.4 61.2C63.2 71.3 57.9 74.6 52.7 71.3L52.0 70.9L53.1 69.7C55.1 67.7 57.4 64.0 57.3 63.2C57.2 62.3 56.8 62.6 54.3 65.2C50.1 69.5 47.9 70.8 44.5 70.8C41.3 70.8 38.7 69.3 36.5 66.3C35.7 65.2 35.6 65.6 37.8 61.8C41.2 56.2 41.7 55.0 40.8 54.9C40.4 54.9 39.0 56.4 36.4 59.8C32.4 65.0 29.0 70.3 23.9 79.2C19.1 87.7 17.3 89.6 13.7 89.6C10.2 89.6 8.2 87.1 8.5 83.1C8.7 79.3 11.0 74.6 18.6 62.5C26.7 49.5 29.1 44.7 30.7 38.2C31.2 35.9 31.2 34.6 30.7 34.5C30.2 34.5 29.9 35.0 29.0 37.2L28.3 38.6L25.6 39.5C16.6 42.5 10.2 41.6 7.9 36.8C5.7 32.3 8.8 29.0 16.1 28.1C20.7 27.5 23.5 26.8 26.7 25.3C28.6 24.4 30.1 23.3 34.2 20.1C42.9 13.2 49.3 10.9 56.4 12.3Z";
const KNUCKLE_LINES = "M55.59 24.3L47.65 33.77M61.82 27.73L54.31 40.25M67.13 32.07L62.85 43.73";

const PALETTE = {
  active: { fill: "#FFFFFF", stroke: "#111418" },
  muted: { fill: "#F1F2F4", stroke: "#6B7280" },
} as const;

export function NudgeTapIcon({ size = 20, muted = false, className }: NudgeTapIconProps) {
  const c = muted ? PALETTE.muted : PALETTE.active;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-1.9 0.5 94 94"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={GLOVE_FILL} fill={c.fill} />
      <g fill="none" stroke={c.stroke} strokeLinecap="round" strokeLinejoin="round">
        <path d={GLOVE_OUTLINE} fill={c.stroke} strokeWidth={1.3} />
        <path d={KNUCKLE_LINES} strokeWidth={3} />
      </g>
    </svg>
  );
}

export default NudgeTapIcon;