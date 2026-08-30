// Shared promo banner geometry + label chrome so the live widget, the crop tool,
// and the dialog preview all render identically.

export const PROMO_BANNER_ASPECT = 4 / 2.3;
export const PROMO_BANNER_ASPECT_CLASS = 'aspect-[4/2.3]';

interface PromoBadgeOverlayProps {
  label: string;
}

/** Static (non-interactive) copy of the live widget's centered promo label. */
export function PromoBadgeOverlay({ label }: PromoBadgeOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center px-3">
      <div className="inline-flex max-w-full flex-col items-center gap-1 rounded-2xl border border-background/15 bg-foreground/35 px-3 py-1.5 text-background shadow-md shadow-foreground/15 backdrop-blur-md">
        <span className="flex items-center gap-1.5 leading-none">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_hsl(142_76%_55%)]" />
          </span>
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-background/90">PROMO</span>
        </span>
        <span className="min-w-0 truncate text-sm font-bold leading-tight">{label}</span>
      </div>
    </div>
  );
}

/** Image treatment layers used behind the label in the live widget. */
export function PromoImageLayers() {
  return (
    <>
      <div className="absolute inset-0 bg-background/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/15 via-transparent to-background/15" />
    </>
  );
}
