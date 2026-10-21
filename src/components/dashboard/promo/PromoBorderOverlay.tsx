import { memo, useId } from 'react';
import type { PromoBorder } from '@/lib/promoTrackers';
import { borderColor } from '@/lib/promoBorders';

const c = (name: string) => `hsl(var(--promo-border-${name}))`;
const frame = 'M32 8H338A24 24 0 0 1 362 32V188A24 24 0 0 1 338 212H32A24 24 0 0 1 8 188V32A24 24 0 0 1 32 8Z';
const points = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = i / n * 1080;
  if (d < 330) return [20 + d, 8];
  if (d < 540) return [362, 8 + d - 330];
  if (d < 870) return [350 - (d - 540), 212];
  return [8, 212 - (d - 870)];
});
const lampPoints = points(28);
const edgePoints = points(20);
const colors = ['pink', 'gold', 'blue', 'green', 'orange'];

function Bulbs({ palette, glow, count = 28, marquee = false, small = false }: {
  palette: string[]; glow: string; count?: number; marquee?: boolean; small?: boolean;
}) {
  const pts = count === 28 ? lampPoints : points(count);
  return <>{pts.map(([x, y], i) => <g key={i} className={marquee ? `promo-border-chase promo-border-phase-${i % 4}` : `promo-border-twinkle${i % 2 ? '-alt' : ''} promo-border-phase-${i % 4}`}>
    <circle cx={x} cy={y} r={small ? 5.7 : 8.3} fill={palette[i % palette.length]} opacity=".55" filter={`url(#${glow})`} />
    <circle cx={x} cy={y} r={small ? 2.6 : 3.8} fill={palette[i % palette.length]} />
    <circle cx={x - .8} cy={y - .8} r=".9" fill={c('white')} opacity=".85" />
  </g>)}</>;
}

function Sparkles({ gold = false }: { gold?: boolean }) {
  return <>{[[22, 22, 9], [348, 22, 9], [22, 198, 8], [348, 198, 8], [110, 8, 4], [262, 8, 4], [46, 210, 4], [324, 210, 4]].map(([x, y, r], i) =>
    <path key={i} className={`promo-border-twinkle${i % 2 ? '-alt' : ''} promo-border-phase-${i % 4}`} transform={`translate(${x} ${y})`} fill={c(gold ? 'gold' : 'white')}
      d={`M0 ${-r}Q${r * .18} ${-r * .18} ${r} 0Q${r * .18} ${r * .18} 0 ${r}Q${-r * .18} ${r * .18} ${-r} 0Q${-r * .18} ${-r * .18} 0 ${-r}Z`} />)}</>;
}

function Web({ transform }: { transform: string }) {
  return <g transform={transform} stroke={c('white')} strokeWidth="1.3" opacity=".8" fill="none">
    {[0, 15, 30, 45, 60, 90].map(a => <path key={a} d={`M0 0L${70 * Math.cos(a * Math.PI / 180)} ${70 * Math.sin(a * Math.PI / 180)}`} />)}
    {[18, 34, 52, 70].map(r => <path key={r} d={`M${r} 0Q${r} ${r * .5} ${r * .7} ${r * .7}Q${r * .5} ${r} 0 ${r}`} />)}
  </g>;
}

function Bunting({ july }: { july: boolean }) {
  const palette = july ? ['red', 'white', 'patriot'] : ['pastel-pink', 'pastel-green', 'pastel-gold', 'pastel-blue', 'pastel-purple'];
  return <>
    <path d="M-4 4Q185 40 374 4" fill="none" stroke={c('wire')} strokeWidth="1.6" />
    {Array.from({ length: 9 }, (_, i) => {
      const x = 17 + i * 42;
      const y = 22 - 14.2 * ((x - 185) / 168) ** 2;
      return <g key={i}><path d={`M${x - 11} ${y}H${x + 11}L${x} ${y + 24}Z`} fill={c(palette[i % palette.length])} stroke={c('ink')} strokeOpacity=".12" />
        {july && i % 3 === 2 && <path d="M0 -4L1.2 -1.2H4L1.8 .8L2.6 3.6L0 2L-2.6 3.6L-1.8 .8L-4 -1.2H-1.2Z" transform={`translate(${x} ${y + 8})`} fill={c('white')} />}</g>;
    })}
    {july && <Sparkles />}
  </>;
}

function Citrus({ x, y, color, r = 11 }: { x: number; y: number; color: string; r?: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <circle r={r} fill={c(color)} /><circle r={r - 2.5} fill="none" stroke={c('white')} strokeWidth="1.5" opacity=".7" />
    {Array.from({ length: 8 }, (_, i) => <path key={i} transform={`rotate(${i * 45})`} d={`M0 0H${r - 3}`} stroke={c('white')} strokeWidth="1.2" opacity=".8" />)}
  </g>;
}

function Decorative({ border, glow, gingham, flame }: { border: PromoBorder; glow: string; gingham: string; flame: string }) {
  switch (border.style) {
    case 'christmas-garland': return <>
      <path d={frame} fill="none" stroke={c('pine')} strokeWidth="12" opacity=".95" />
      <path d={frame} fill="none" stroke={c('pine-light')} strokeWidth="7" strokeDasharray="10 5" opacity=".7" />
      {[0, 6, 11, 17, 23].map(i => <circle key={i} cx={lampPoints[i][0]} cy={lampPoints[i][1]} r="3" fill={c('red')} />)}
      <Bulbs palette={[c('ivory')]} glow={glow} count={32} small />
    </>;
    case 'string-lights-multi':
    case 'string-lights': return <>
      <path d={frame} fill="none" stroke={c('wire')} strokeWidth="1.6" opacity=".8" />
      <Bulbs glow={glow} palette={border.style === 'string-lights-multi' ? colors.map(c) : (border.color || 'orange,purple').split(',').slice(0, 2).map(v => borderColor(v, 'orange'))} />
    </>;
    case 'halloween': return <>
      <Web transform="scale(1.15)" /><Web transform="translate(370 0) scale(-1.15 1.15)" />
      <Web transform="translate(0 220) scale(1 -.7)" /><Web transform="translate(370 220) scale(-1 -.7)" />
      {[[255, 52, 1], [80, 170, .8], [318, 148, .7]].map(([x, y, s], i) => <path key={i} transform={`translate(${x} ${y}) scale(${s})`} fill={c('bat')} d="M0 0C-3 -6 -10 -8 -16 -4C-12 -4 -11 0 -9 2C-8 0 -5 0 -3 3C-2 1 -1 1 0 5C1 2 2 1 3 3C5 0 8 0 9 2C11 0 12 -4 16 -4C10 -8 3 -6 0 0Z" />)}
      {[150, 190, 230].map((x, i) => <g key={x} className={`promo-border-twinkle promo-border-phase-${i}`}><circle cx={x} cy="9" r="8" fill={c(i % 2 ? 'purple' : 'orange')} filter={`url(#${glow})`} opacity=".55" /><circle cx={x} cy="9" r="3.6" fill={c(i % 2 ? 'purple' : 'orange')} /></g>)}
    </>;
    case 'fall-leaves': return <>{points(16).map(([x, y], i) => <g key={i} transform={`translate(${x} ${y}) rotate(${(i * 79 + 12) % 360}) scale(${i % 3 === 0 ? 1.3 : 1})`}>
      <path d="M0 -9C7 -7 9 3 0 10C-9 3 -7 -7 0 -9Z" fill={c(['orange', 'red', 'gold', 'rust'][i % 4])} /><path d="M0 -6V13" stroke={c('ink')} strokeOpacity=".25" />
    </g>)}</>;
    case 'hearts': return <>{edgePoints.map(([x, y], i) => <path key={i} transform={`translate(${x} ${y + (y === 8 ? 3 : 0)}) rotate(${i % 2 ? 13 : -8}) scale(${i % 3 === 0 ? 1.2 : .9})`} d="M0 6C-11 -2 -7 -10 0 -4C7 -10 11 -2 0 6Z" fill={c(i % 2 ? 'pastel-pink' : 'pink')} />)}</>;
    case 'st-patricks': return <>
      <path d={frame} fill="none" stroke={c('pine-light')} strokeWidth="3" />
      {points(14).map(([x, y], i) => i % 3 === 2 ? <g key={i}><circle cx={x} cy={y} r="5" fill={c('gold')} /><circle cx={x} cy={y} r="3" fill="none" stroke={c('rust')} /></g> : <g key={i} transform={`translate(${x} ${y})`} fill={c('green')}><circle cy="-5" r="4.6" /><circle cx="-5" cy="2" r="4.6" /><circle cx="5" cy="2" r="4.6" /><path d="M0 3Q2 9 5 11" fill="none" stroke={c('pine')} strokeWidth="1.6" /></g>)}
    </>;
    case 'spring-bunting': return <Bunting july={false} />;
    case 'fourth-july': return <Bunting july />;
    case 'summer-rope': return <>
      <path d={frame} fill="none" stroke={c('rope')} strokeWidth="8" /><path d={frame} fill="none" stroke={c('rope-light')} strokeWidth="8" strokeDasharray="3 5" />
      <Citrus x={206} y={15} color="red" r={9} /><Citrus x={346} y={198} color="gold" /><Citrus x={24} y={198} color="lime" /><Citrus x={24} y={110} color="orange" r={8} />
    </>;
    case 'new-year': return <><path d={frame} fill="none" stroke={c('gold')} strokeWidth="1.5" opacity=".8" /><Sparkles gold /></>;
    case 'marquee': return <><path d={frame} fill="none" stroke={c('wire')} strokeWidth="12" opacity=".75" /><Bulbs palette={[c('ivory')]} glow={glow} count={36} marquee /></>;
    case 'confetti': return <>{[[0, 0], [370, 0], [0, 220], [370, 220]].map(([x, y], k) => <g key={k} transform={`translate(${x} ${y}) scale(${x ? -1 : 1} ${y ? -1 : 1})`}>
      {Array.from({ length: 12 }, (_, i) => { const a = 6 + (i * 17) % 62, b = 2 + (i * 13) % 38; return i % 3 === 0 ? <circle key={i} cx={a} cy={b} r="2.2" fill={c(colors[i % 5])} /> : <rect key={i} x={a} y={b} width="6" height="3" rx="1" transform={`rotate(${i * 43} ${a} ${b})`} fill={c(colors[i % 5])} />; })}
    </g>)}</>;
    case 'game-day': return <g fill="none" stroke={c('white')}><path d={frame} strokeWidth="2.2" strokeDasharray="14 3 6 3" opacity=".9" />
      {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${40 + i * 34} 8v8M${40 + i * 34} 204v8`} strokeWidth="2" opacity=".8" />)}
      {[40, 74, 108, 142, 176].map(y => <path key={y} d={`M8 ${y}h8M354 ${y}h8`} strokeWidth="2" opacity=".8" />)}
      <circle cx="185" cy="110" r="62" strokeWidth="1.8" strokeDasharray="10 5" opacity=".35" />
    </g>;
    case 'flame': return <>
      <rect y="206" width="370" height="14" fill={c('orange')} opacity=".55" filter={`url(#${glow})`} />
      {Array.from({ length: 17 }, (_, i) => { const x = i * 23 - 6, h = 31 + (i * 13) % 18; return <g key={i} className={`promo-border-flame promo-border-phase-${i % 4}`}><path d={`M${x} 220C${x + 3} ${220 - h / 2} ${x + 9} ${220 - h / 2} ${x + 14} ${220 - h}C${x + 17} ${220 - h / 2} ${x + 26} ${220 - h / 2} ${x + 29} 220Z`} fill={`url(#${flame})`} /><path d={`M${x + 6} 220Q${x + 10} ${220 - h * .45} ${x + 14} ${220 - h * .65}Q${x + 19} ${220 - h * .35} ${x + 23} 220Z`} fill={c('flame-core')} /></g>; })}
    </>;
    case 'neon': return <g className="promo-border-pulse" fill="none" stroke={borderColor(border.color || 'pink', 'pink')}><path d={frame} strokeWidth="8" opacity=".6" filter={`url(#${glow})`} /><path d={frame} strokeWidth="2.4" /><path d={frame} stroke={c('white')} strokeWidth=".7" opacity=".7" /></g>;
    case 'gingham': return <><rect width="370" height="12" fill={`url(#${gingham})`} /><rect y="198" width="370" height="22" fill={`url(#${gingham})`} /><path d="M0 198H370M0 12H370" stroke={c('ink')} strokeOpacity=".15" /></>;
    default: return null;
  }
}

export const PromoBorderOverlay = memo(function PromoBorderOverlay({ border, winner = false, closing = false, paused = false, reducedMotion = false }: {
  border?: PromoBorder | null; winner?: boolean; closing?: boolean; paused?: boolean; reducedMotion?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const glow = `${id}-glow`, gingham = `${id}-gingham`, flame = `${id}-flame`;
  return <svg aria-hidden="true" focusable="false" data-promo-border-layer data-border-style={border?.style || 'none'} data-winner={winner} data-closing={closing}
    data-motion={reducedMotion ? 'off' : paused ? 'paused' : 'running'} className="promo-border-overlay pointer-events-none absolute inset-0 h-full w-full"
    viewBox="0 0 370 220" preserveAspectRatio="none">
    <defs>
      <filter id={glow} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
      <linearGradient id={flame} x1="0" y1="1" x2="0" y2="0"><stop stopColor={c('flame')} /><stop offset="1" stopColor={c('orange')} /></linearGradient>
      <pattern id={gingham} width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill={c('white')} /><rect width="8" height="16" fill={c('red')} opacity=".55" /><rect width="16" height="8" fill={c('red')} opacity=".55" /></pattern>
    </defs>
    {border && <Decorative border={border} glow={glow} gingham={gingham} flame={flame} />}
    {winner && <g data-border-effect="winner" fill="none"><path d={frame} stroke={c('gold')} strokeWidth="9" opacity=".55" filter={`url(#${glow})`} /><path d={frame} stroke={c('ivory')} strokeWidth="1.2" /><Sparkles gold /></g>}
    {closing && <g data-border-effect="closing" className="promo-border-pulse" fill="none" stroke={c('orange')}><path d={frame} strokeWidth="10" opacity=".7" filter={`url(#${glow})`} /><path d={frame} strokeWidth="3" /></g>}
  </svg>;
});