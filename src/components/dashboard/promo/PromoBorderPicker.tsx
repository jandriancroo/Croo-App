import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { BORDER_COLORS, PROMO_BORDER_STYLES } from '@/lib/promoBorders';
import type { PromoBorder, PromoTrackerConfig } from '@/lib/promoTrackers';
import { PromoBorderOverlay } from './PromoBorderOverlay';

function BorderSample({ border, image, winner = false, closing = false }: { border?: PromoBorder | null; image?: string | null; winner?: boolean; closing?: boolean }) {
  return <span className="block w-full overflow-hidden rounded-md p-2">
    <span className="relative block aspect-[370/220] w-full overflow-visible rounded-md bg-muted">
    {image && <img src={image} alt="" loading="lazy" className="absolute inset-0 h-full w-full rounded-[inherit] object-cover" />}
    <PromoBorderOverlay border={border} winner={winner} closing={closing} reducedMotion />
    </span>
  </span>;
}

export function PromoBorderPicker({ config, onChange, image, onListVisible }: { config: PromoTrackerConfig; onChange: (patch: Partial<PromoTrackerConfig>) => void; image?: string | null; onListVisible?: (visible: boolean) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const hasList = !!config.tracker_border;
  useEffect(() => {
    const el = listRef.current;
    if (!onListVisible) return;
    if (!el || !hasList) { onListVisible(false); return; }
    const io = new IntersectionObserver(([e]) => onListVisible(e.isIntersecting));
    io.observe(el);
    return () => { io.disconnect(); onListVisible(false); };
  }, [hasList, onListVisible]);
  const border = config.tracker_border;
  const picked = border?.style === 'string-lights';
  const pickable = picked || border?.style === 'neon';
  const palette = (border?.color || (picked ? 'orange,purple' : 'pink')).split(',');
  const setColor = (value: string, index: number) => {
    if (!border) return;
    const next = [...palette]; next[index] = value;
    onChange({ tracker_border: { ...border, color: next.slice(0, picked ? 2 : 1).join(',') } });
  };
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <Label htmlFor="promo-border-switch" className="text-sm">Border</Label>
      <Switch id="promo-border-switch" checked={!!border} onCheckedChange={v => onChange({ tracker_border: v ? { style: 'christmas-garland', color: null } : null })} />
    </div>
    {border && <div ref={listRef} className="space-y-3">
      {(['Seasonal', 'Event', 'Brand'] as const).map(group => <div key={group} className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{group}</p>
        <div className="space-y-1" role="radiogroup" aria-label={`${group} borders`}>
          {PROMO_BORDER_STYLES.filter(s => s.group === group).map(s => {
            const selected = border.style === s.style;
            return <div key={s.style} className="space-y-2">
              <Button type="button" variant="ghost" role="radio" aria-checked={selected}
                onClick={() => onChange({ tracker_border: { style: s.style, color: s.style === 'string-lights' ? 'orange,purple' : s.style === 'neon' ? 'pink' : null } })}
                className="h-auto min-h-11 w-full justify-between gap-3 whitespace-normal rounded-lg px-3 py-2 text-left text-sm font-medium aria-checked:bg-primary/10 aria-checked:ring-2 aria-checked:ring-primary">
                <span className="min-w-0 flex-1 break-words">{s.label}</span>
                {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
              </Button>
              {selected && pickable && <div className="px-1 pb-1">
                <div className="space-y-3">
        {Array.from({ length: picked ? 2 : 1 }, (_, index) => <div key={index} className="space-y-2">
          <Label htmlFor={`promo-border-color-${index}`} className="text-xs">{picked ? `Light color ${index + 1}` : 'Tube color'}</Label>
          <div className="flex flex-wrap items-center gap-2">
            {BORDER_COLORS.map(color => <Button key={color.value} variant="ghost" size="icon-sm" type="button" title={color.label}
              aria-label={`${picked ? `Light ${index + 1}` : 'Tube'} ${color.label}`} aria-pressed={palette[index] === color.value}
              onClick={() => setColor(color.value, index)} className={`promo-border-swatch promo-border-swatch-${color.value} rounded-full border-2 aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-offset-2`} />)}
            <Input type="color" id={`promo-border-color-${index}`} aria-label={`Custom ${picked ? `light ${index + 1}` : 'tube'} color`}
              className="h-8 w-9 cursor-pointer p-0.5" value={palette[index]?.startsWith('#') ? palette[index] : '#ff8a1f'} onChange={e => setColor(e.target.value, index)} />
          </div>
        </div>)}
      </div>
              </div>}
            </div>;
          })}
        </div>
      </div>)}
    </div>}
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">React to the numbers</p>
      {([{ key: 'tracker_border_winner', label: 'Winner glow', winner: true }, { key: 'tracker_border_closing', label: 'Closing in', winner: false }] as const).map(effect => <div key={effect.key} className="flex items-center gap-3 rounded-lg border p-3">
        <span className="w-16 shrink-0"><BorderSample image={image} winner={effect.winner} closing={!effect.winner} /></span>
        <Label htmlFor={effect.key} className="flex-1 text-sm">{effect.label}</Label>
        <Switch id={effect.key} checked={!!config[effect.key]} onCheckedChange={v => onChange({ [effect.key]: v })} />
      </div>)}
    </div>
  </div>;
}