import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Pause, Trophy } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';
import { ALL_ITEMS_REF, type PromoSlide } from '@/lib/promoTrackers';

export type PromoPeriodKey = 'day' | 'yday' | 'wtd' | 'promo';
export const PROMO_PERIOD_OPTIONS: { value: PromoPeriodKey; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'yday', label: 'Yesterday' },
  { value: 'wtd', label: 'Week' },
  { value: 'promo', label: 'Campaign' },
];

/** Hero card height rule: 220px on phones, 250px from md up. */
export const PROMO_HERO_HEIGHT_CLASS = 'h-[220px] md:h-[250px]';

interface PromoHeroViewProps {
  title: string;
  slides: PromoSlide[];
  activeRef: string;
  subtitle: string;
  dayLabel: string | null;
  rankLabel: string;
  canExpand: boolean;
  expanded: boolean;
  paused: boolean;
  reducedMotion: boolean;
  period: PromoPeriodKey;
  campaignImageUrl: string | null;
  onPeriodChange: (p: PromoPeriodKey) => void;
  onSelectSlide?: (ref: string) => void;
  onRankTap?: () => void;
  onLongPress?: () => void;
  onSwipe?: (dir: 'next' | 'prev') => void;
  interactive?: boolean;
}

const INK = 'text-[hsl(var(--promo-ink))]';

export function PromoHeroView({
  title, slides, activeRef, subtitle, dayLabel, rankLabel, canExpand, expanded, paused,
  reducedMotion, period, campaignImageUrl, onPeriodChange, onSelectSlide, onRankTap,
  onLongPress, onSwipe, interactive = true,
}: PromoHeroViewProps) {
  const activeSlide = slides.find(s => s.ref === activeRef) ?? slides[0];
  const activeImage = activeSlide?.imageUrl ?? campaignImageUrl;
  const images = Array.from(new Set(slides.map(s => s.imageUrl).concat(campaignImageUrl).filter(Boolean))) as string[];
  const fade = reducedMotion ? 'duration-0' : 'duration-700';

  // Long-press + swipe on the photo layer only (controls sit above it).
  const pressTimer = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const longPressed = useRef(false);
  const clearPress = () => { if (pressTimer.current) window.clearTimeout(pressTimer.current); pressTimer.current = null; };
  useEffect(() => clearPress, []);

  const dotsRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    const box = dotsRef.current; const el = dotRefs.current[activeRef];
    if (!box || !el) return;
    const left = el.offsetLeft; const right = left + el.offsetWidth;
    if (left < box.scrollLeft) box.scrollTo({ left, behavior: reducedMotion ? 'auto' : 'smooth' });
    else if (right > box.scrollLeft + box.clientWidth) box.scrollTo({ left: right - box.clientWidth + 16, behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [activeRef, reducedMotion]);

  const manyDots = slides.length > 5;

  return (
    <div data-promo-hero className={cn('relative w-full overflow-hidden rounded-3xl shadow-md', !activeImage && 'bg-primary', PROMO_HERO_HEIGHT_CLASS)}>
      {/* Photo layers (crossfade) */}
      {images.map(url => (
        <img key={url} src={url} alt="" aria-hidden loading="lazy" draggable={false}
          className={cn('absolute inset-0 h-full w-full select-none object-cover transition-opacity', fade, url === activeImage ? 'opacity-100' : 'opacity-0')} />
      ))}
      {/* Shade: dark from the top, light at the very bottom */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,hsl(var(--promo-shade)/0.6)_0%,hsl(var(--promo-shade)/0)_50%,hsl(var(--promo-shade)/0)_70%,hsl(var(--promo-shade)/0.25)_100%)]" />
      {/* Border layer (Phase B) sits here, under the content */}
      <div aria-hidden data-promo-border-layer className="pointer-events-none absolute inset-0" />

      {/* Photo gesture layer */}
      {interactive && (
        <div
          className="absolute inset-0 touch-pan-y select-none [-webkit-touch-callout:none]"
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={() => {
            longPressed.current = false;
            clearPress();
            pressTimer.current = window.setTimeout(() => { longPressed.current = true; onLongPress?.(); }, 500);
          }}
          onPointerUp={clearPress}
          onPointerLeave={clearPress}
          onPointerCancel={clearPress}
          onTouchStart={(e) => { startX.current = e.touches[0].clientX; }}
          onTouchMove={(e) => { if (startX.current !== null && Math.abs(e.touches[0].clientX - startX.current) > 10) clearPress(); }}
          onTouchEnd={(e) => {
            if (startX.current === null) return;
            const dx = e.changedTouches[0].clientX - startX.current;
            startX.current = null;
            if (!longPressed.current && Math.abs(dx) > 40) onSwipe?.(dx < 0 ? 'next' : 'prev');
          }}
        />
      )}

      {/* Top: title (left) + LIVE chip (right). The item line sits below and
          spans the full card width, so it never borrows the chip's column. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col">
        <div className="flex items-start gap-2">
          <div key={activeRef} className={cn('min-w-0 flex-1', !reducedMotion && 'animate-in fade-in duration-500')}>
            <p className={cn('line-clamp-2 break-words text-[25px] font-black uppercase leading-[0.92] tracking-[-0.02em] [text-shadow:0_1px_6px_hsl(var(--promo-shade)/0.35)]', INK)}>
              {title}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[hsl(var(--success-soft))] px-2.5 text-[11px] font-bold uppercase tracking-wide text-[hsl(var(--success))] shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))]" />
              LIVE{dayLabel ? ` · ${dayLabel}` : ''}
            </span>
            {paused && (
              <span aria-label="Autoplay paused" className="flex h-6 w-6 items-center justify-center rounded-full bg-card/90 text-foreground shadow-sm">
                <Pause className="h-3 w-3" />
              </span>
            )}
          </div>
        </div>
        {subtitle && (
          <p
            key={`sub-${activeRef}`}
            className={cn('mt-1.5 line-clamp-2 text-[13px] font-semibold [text-shadow:0_1px_4px_hsl(var(--promo-shade)/0.4)]', INK, !reducedMotion && 'animate-in fade-in duration-500')}
          >{subtitle}</p>
        )}
      </div>

      {/* Bottom: dots + rank chip, then period selector */}
      <div className="absolute inset-x-3 bottom-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div
            ref={dotsRef}
            className={cn('no-scrollbar -my-1.5 flex min-w-0 flex-1 items-center overflow-x-auto',
              manyDots && '[mask-image:linear-gradient(to_right,black_80%,transparent)]')}
          >
            {slides.length > 1 && slides.map(s => {
              const active = s.ref === activeRef;
              const isAll = s.ref === ALL_ITEMS_REF;
              const img = s.imageUrl;
              return (
                <button
                  key={s.ref}
                  ref={(el) => { dotRefs.current[s.ref] = el; }}
                  type="button"
                  disabled={!interactive}
                  aria-label={isAll ? 'All items' : s.label}
                  aria-pressed={active}
                  onClick={() => onSelectSlide?.(s.ref)}
                  className="flex h-11 w-10 shrink-0 items-center justify-center"
                >
                  <span
                    className={cn(
                      'relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary bg-cover bg-center ring-2 ring-[hsl(var(--promo-ink))]',
                      active && 'outline outline-2 outline-offset-2 outline-accent',
                    )}
                    style={img ? { backgroundImage: `url("${img}")` } : undefined}
                  >
                    {isAll && (
                      <>
                        <span className="absolute inset-0 bg-[hsl(var(--promo-shade)/0.45)]" />
                        <span className={cn('relative text-[10px] font-black', INK)}>ALL</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {canExpand ? (
            <button
              type="button"
              disabled={!interactive}
              onClick={onRankTap}
              aria-expanded={expanded}
              aria-label={`Rank ${rankLabel}. ${expanded ? 'Hide' : 'Show'} ranking`}
              className="relative flex h-8 shrink-0 items-center rounded-full bg-card shadow-sm after:absolute after:-inset-y-1.5 after:inset-x-0"
            >
              <span className="flex h-full items-center gap-1.5 rounded-full bg-primary/15 pl-3 pr-2 text-[13px] font-bold tabular-nums text-primary">
                <Trophy className="h-3.5 w-3.5" />
                {rankLabel}
                <span className="h-3.5 w-px bg-primary/30" />
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </span>
            </button>
          ) : (
            <span className="flex h-8 shrink-0 items-center rounded-full bg-card shadow-sm">
              <span className="flex h-full items-center gap-1.5 rounded-full bg-primary/15 px-3 text-[13px] font-bold tabular-nums text-primary">
                <Trophy className="h-3.5 w-3.5" />
                {rankLabel}
              </span>
            </span>
          )}
        </div>
        <SegmentedControl
          value={period}
          onValueChange={onPeriodChange}
          options={PROMO_PERIOD_OPTIONS}
          variant="primary"
          fullWidth
          aria-label="Period"
          className="h-8 bg-card shadow-sm"
          itemClassName="relative px-1 text-[13px] md:text-[13px] after:absolute after:-inset-y-1.5 after:inset-x-0"
        />
      </div>
    </div>
  );
}
