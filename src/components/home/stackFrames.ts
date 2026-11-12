/** Scroll progress 0–1 for the stack-to-phone sequence. */
export const STACK_TOOLS = [
  "Punch clock",
  "Group text",
  "Checklist app",
  "Scheduling software",
  "Hiring software",
  "Inventory tools",
  "Labor tools",
] as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const span = (v: number, start: number, end: number) => clamp01((v - start) / (end - start));

export type StackFrame = {
  /** Phone X as a percent of its own width. 0 rests in the right column. */
  x: number;
  list: number;
  all: number;
  dash: number;
  zoom: number;
  y: number;
  phone: number;
  head: number;
};

export function stackFrame(progress: number, compact: boolean): StackFrame {
  const v = clamp01(progress);
  const cover = span(v, 0.1, 0.28);
  const settle = span(v, 0.28, 0.42);
  // The phone slides over the list, then settles back. It stays full size so the
  // Plans card can follow the whole phone instead of covering a zoomed frame.
  let x = 0;
  if (!compact) {
    x = settle > 0 ? -190 * (1 - settle) : -190 * cover;
    if (!x) x = 0;
  }
  return {
    x,
    list: 1 - span(v, 0.16, 0.34),
    all: span(v, 0.34, 0.46) * (1 - span(v, 0.72, 0.86)),
    dash: span(v, 0.5, 0.64),
    zoom: 1,
    y: 0,
    phone: compact ? span(v, 0.12, 0.34) : 1,
    head: 1 - span(v, 0.06, 0.2),
  };
}

export function writeStackFrame(node: HTMLElement, frame: StackFrame) {
  node.style.setProperty("--x", frame.x.toFixed(2));
  node.style.setProperty("--y", `${frame.y.toFixed(1)}px`);
  node.style.setProperty("--list", frame.list.toFixed(3));
  node.style.setProperty("--all", frame.all.toFixed(3));
  node.style.setProperty("--dash", frame.dash.toFixed(3));
  node.style.setProperty("--zoom", frame.zoom.toFixed(3));
  node.style.setProperty("--phone", frame.phone.toFixed(3));
  node.style.setProperty("--head", frame.head.toFixed(3));
}
