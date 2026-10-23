// The day as it will be: one read-only line per shift, changed rows tinted with a left edge and a chip.
// Shared by Theo's previews (src/components/ai/theoWizard.tsx) and the Shift Marketplace confirm sheets.
import { useCallback, useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';

export type RowKind = 'new' | 'cover' | 'removed' | 'swapped' | 'changed';
export type DayRow = { id: string; name: string; position: string; time: string; start: number; end: number; kind: RowKind | null; was?: string };
export type DayView = { date: string; title: string; rows: DayRow[] };

// 1px hairline between two neighbouring PLAIN rows only (rows marked data-plain). Drawn in the 4px gap, so row heights never change.
const HAIRLINE = "[&>[data-plain]]:relative [&>[data-plain]+[data-plain]::before]:pointer-events-none [&>[data-plain]+[data-plain]::before]:absolute [&>[data-plain]+[data-plain]::before]:inset-x-3 [&>[data-plain]+[data-plain]::before]:top-[-2.5px] [&>[data-plain]+[data-plain]::before]:h-px [&>[data-plain]+[data-plain]::before]:bg-border/60 [&>[data-plain]+[data-plain]::before]:content-['']";

export function CoverListScroller({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    setMoreBelow(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  }, []);

  useEffect(() => {
    updateFade();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children, updateFade]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    event.stopPropagation();
    updateFade();
  };

  return (
    <div className="relative flex max-h-full w-full flex-col overflow-hidden rounded-[20px] bg-card">
      <div ref={scrollRef} onScroll={onScroll} onWheel={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()}
        className={`min-h-[60px] max-h-[354px] flex-1 overflow-y-auto overscroll-contain p-3 text-foreground [-webkit-overflow-scrolling:touch] touch-pan-y md:max-h-[474px] flex flex-col gap-1 ${HAIRLINE}`}>
        {children}
      </div>
      {moreBelow && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />}
    </div>
  );
}


export const NEW_GREEN = 'hsl(142 70% 28%)';
const KIND_COLOR: Record<RowKind, string> = { new: NEW_GREEN, cover: NEW_GREEN, swapped: NEW_GREEN, changed: NEW_GREEN, removed: 'hsl(var(--destructive))' };
const KIND_TINT: Record<RowKind, number> = { new: 9, cover: 9, swapped: 9, changed: 9, removed: 7 };
const KIND_TAG: Record<RowKind, string> = { new: 'New', cover: 'Covering', swapped: 'Swapped', changed: 'Changed', removed: 'Removed' };
/** The day as it will be: one quiet read-only line per shift; changed rows tinted with a left edge and a chip. Rows scroll inside the card. */
export function DayRows({ view }: { view: DayView }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { boxRef.current?.querySelector('[data-changed="1"]')?.scrollIntoView({ block: 'nearest' }); }, [view]);
  return (
    <div ref={boxRef} className="flex min-h-0 flex-col">
      <CoverListScroller>
        {view.rows.length === 0 && <p className="p-2 text-[14px] text-muted-foreground">No one else is on that day.</p>}
        {view.rows.map((r) => {
          const k = r.kind;
          const col = k ? KIND_COLOR[k] : '';
          const strike = k === 'removed' ? 'line-through' : '';
          return (
            <div key={r.id} data-changed={k ? '1' : undefined} data-plain={k ? undefined : ''}
              className="flex min-h-[42px] shrink-0 items-center justify-between gap-2 rounded-[10px] py-[6px] pl-[11px] pr-[10px]"
              style={k ? { background: `color-mix(in srgb, ${col} ${KIND_TINT[k]}%, transparent)`, boxShadow: `inset 3px 0 0 ${col}` } : undefined}>
              <div className="min-w-0">
                <div className={`truncate text-[14.5px] font-extrabold ${strike}`}>{r.name}</div>
                <div className="truncate text-[12px] font-semibold text-muted-foreground">{r.position}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {k && <span className="inline-flex h-5 items-center rounded-full px-2 text-[11px] font-extrabold text-white" style={{ background: col }}>{KIND_TAG[k]}</span>}
                <span className="flex flex-col items-end">
                  <span className={`whitespace-nowrap text-[13px] font-bold ${strike}`}>{r.time}</span>
                  {r.was && <span className="whitespace-nowrap text-[12px] text-muted-foreground"><span className="sr-only">was </span><span className="line-through">{r.was}</span></span>}
                </span>
              </div>
            </div>
          );
        })}
      </CoverListScroller>
    </div>
  );
}
