import { memo, useId, useLayoutEffect, useRef, useState } from 'react';
import { roundedEdge, waveEdge, edgePath, type EdgePoint } from '@/lib/promoBorderGeometry';
import type { PromoBorder } from '@/lib/promoTrackers';
import { borderColor } from '@/lib/promoBorders';

const c = (name: string) => `hsl(var(--promo-border-${name}))`;
const frame = 'M24 0H346A24 24 0 0 1 370 24V196A24 24 0 0 1 346 220H24A24 24 0 0 1 0 196V24A24 24 0 0 1 24 0Z';
const points = (n: number) => roundedEdge(370, 220, 24, n).map(p => [p.x, p.y]);
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
    case 'halloween': return <>
      <Web transform="scale(1.15)" /><Web transform="translate(370 0) scale(-1.15 1.15)" />
      <Web transform="translate(0 220) scale(1 -.7)" /><Web transform="translate(370 220) scale(-1 -.7)" />
      {[[255, 52, 1], [80, 170, .8], [318, 148, .7]].map(([x, y, s], i) => <path key={i} transform={`translate(${x} ${y}) scale(${s})`} fill={c('bat')} d="M0 0C-3 -6 -10 -8 -16 -4C-12 -4 -11 0 -9 2C-8 0 -5 0 -3 3C-2 1 -1 1 0 5C1 2 2 1 3 3C5 0 8 0 9 2C11 0 12 -4 16 -4C10 -8 3 -6 0 0Z" />)}
      {[150, 190, 230].map((x, i) => <g key={x} className={`promo-border-twinkle promo-border-phase-${i}`}><circle cx={x} cy="9" r="8" fill={c(i % 2 ? 'purple' : 'orange')} filter={`url(#${glow})`} opacity=".55" /><circle cx={x} cy="9" r="3.6" fill={c(i % 2 ? 'purple' : 'orange')} /></g>)}
    </>;
    case 'spring-bunting': return <g transform="translate(0 -36)"><Bunting july={false} /></g>;
    case 'fourth-july': return <g transform="translate(0 -36)"><Bunting july /></g>;
    case 'new-year': return <><path d={frame} fill="none" stroke={c('gold')} strokeWidth="1.5" opacity=".8" /><Sparkles gold /></>;
    case 'marquee': return <><path d={frame} fill="none" stroke={c('wire')} strokeWidth="12" opacity=".75" /><Bulbs palette={[c('ivory')]} glow={glow} count={36} marquee /></>;
    case 'confetti': return <>{[[0, 0], [370, 0], [0, 220], [370, 220]].map(([x, y], k) => <g key={k} transform={`translate(${x} ${y}) scale(${x ? -1 : 1} ${y ? -1 : 1})`}>
      {Array.from({ length: 12 }, (_, i) => { const a = 6 + (i * 17) % 62, b = 2 + (i * 13) % 38; return i % 3 === 0 ? <circle key={i} cx={a} cy={b} r="2.2" fill={c(colors[i % 5])} /> : <rect key={i} x={a} y={b} width="6" height="3" rx="1" transform={`rotate(${i * 43} ${a} ${b})`} fill={c(colors[i % 5])} />; })}
    </g>)}</>;
    case 'game-day': return <g fill="none" stroke={c('white')}><path d={frame} strokeWidth="2.2" strokeDasharray="14 3 6 3" opacity=".9" />
      {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${40 + i * 34} 8v8M${40 + i * 34} 204v8`} strokeWidth="2" opacity=".8" />)}
      {[40, 74, 108, 142, 176].map(y => <path key={y} d={`M8 ${y}h8M354 ${y}h8`} strokeWidth="2" opacity=".8" />)}
      
    </g>;
    case 'flame': return <>
      <rect y="206" width="370" height="14" fill={c('orange')} opacity=".55" filter={`url(#${glow})`} />
      {Array.from({ length: 17 }, (_, i) => { const x = i * 23 - 6, h = 31 + (i * 13) % 18; return <g key={i} className={`promo-border-flame promo-border-phase-${i % 4}`}><path d={`M${x} 220C${x + 3} ${220 - h / 2} ${x + 9} ${220 - h / 2} ${x + 14} ${220 - h}C${x + 17} ${220 - h / 2} ${x + 26} ${220 - h / 2} ${x + 29} 220Z`} fill={`url(#${flame})`} /><path d={`M${x + 6} 220Q${x + 10} ${220 - h * .45} ${x + 14} ${220 - h * .65}Q${x + 19} ${220 - h * .35} ${x + 23} 220Z`} fill={c('flame-core')} /></g>; })}
    </>;
    case 'neon': return <g className="promo-border-pulse" fill="none" stroke={borderColor(border.color || 'pink', 'pink')}><path d={frame} strokeWidth="8" opacity=".6" filter={`url(#${glow})`} /><path d={frame} strokeWidth="2.4" /><path d={frame} stroke={c('white')} strokeWidth=".7" opacity=".7" /></g>;
    case 'gingham': return <><path d={frame} fill="none" stroke={`url(#${gingham})`} strokeWidth="14" /></>;
    default: return null;
  }
}

const STRANDS = new Set(['christmas-garland', 'string-lights-multi', 'string-lights', 'fall-leaves', 'hearts', 'st-patricks', 'summer-rope']);
function StrandBorder({ border, width, glow }: { border: PromoBorder; width: number; glow: string }) {
  const edge = roundedEdge(width, 220);
  const rope = border.style === 'summer-rope', garland = border.style === 'christmas-garland';
  const woven = rope || garland;
  const { points: A, cycles } = waveEdge(edge, woven ? (rope ? 4 : 6) : 4, rope ? 26 : garland ? 76 : 84);
  const B = waveEdge(edge, rope ? 4 : 6, rope ? 26 : 76, Math.PI).points;
  const first = c(rope ? 'rope-light' : garland ? 'pine-light' : border.style === 'hearts' ? 'pink' : border.style === 'fall-leaves' ? 'rust' : 'pine');
  const second = c(rope ? 'rope' : 'pine');
  const strokeWidth = rope ? 6 : garland ? 8 : 2.2;
  const lights = border.style.startsWith('string-lights');
  const palette = border.style === 'string-lights-multi' ? colors.map(c) : (border.color || 'orange,purple').split(',').slice(0, 2).map(v => borderColor(v, 'orange'));
  const step = lights ? 15 : garland ? 24 : border.style === 'hearts' ? 26 : 22;
  return <>
    {woven && <path d={edgePath(B)} fill="none" stroke={second} strokeWidth={strokeWidth} />}
    <path d={edgePath(A)} fill="none" stroke={lights ? c('wire') : first} strokeWidth={lights ? 1.8 : strokeWidth} strokeLinecap="round" />
    {woven && Array.from({ length: cycles }, (_, j) => {
      const start = Math.round(j * A.length / cycles), end = Math.round((j + .5) * A.length / cycles);
      return <path key={j} d={edgePath(B.slice(start, end + 1), false)} fill="none" stroke={second} strokeWidth={strokeWidth} strokeLinecap="round" />;
    })}
    {garland && <path d={edgePath(A)} fill="none" stroke={c('green')} strokeWidth="1.8" strokeDasharray="1 5" strokeLinecap="round" />}
    {!rope && A.filter((_, i) => i % step === 0).map((p, j) => {
      const side = j % 2 ? 3 : -3;
      const x = p.x + p.nx * side, y = p.y + p.ny * side;
      if (lights || garland) {
        const q: EdgePoint = garland && j % 2 ? B[j * step] ?? p : p;
        const bx = garland ? q.x : x, by = garland ? q.y : y;
        const color = garland ? c('ivory') : palette[j % palette.length];
        return <g key={j}>
          {lights && <line x1={p.x} y1={p.y} x2={bx} y2={by} stroke={c('wire')} strokeWidth="1.4" />}
          <g className={`promo-border-twinkle${j % 2 ? '-alt' : ''} promo-border-phase-${j % 4}`}>
            <circle cx={bx} cy={by} r={garland ? 5 : 6} fill={color} opacity=".55" filter={`url(#${glow})`} />
            <circle cx={bx} cy={by} r={garland ? 2.4 : 3.1} fill={color} />
            <circle cx={bx - .6} cy={by - .6} r=".8" fill={c('white')} />
          </g>
          {garland && j % 2 === 0 && <circle cx={p.x} cy={p.y} r="2.8" fill={c('red')} />}
        </g>;
      }
      const angle = Math.atan2(p.ny, p.nx) * 180 / Math.PI + 90 + (j % 2 ? 28 : -28);
      if (border.style === 'fall-leaves') return <g key={j} transform={`translate(${x} ${y}) rotate(${angle})`}>
        <path d="M0 -5C5 -4 6 2 0 5C-6 2 -5 -4 0 -5Z" fill={c(['orange', 'gold', 'red', 'rust'][j % 4])} />
        <path d="M0 -4V5" stroke={c('ink')} strokeOpacity=".25" strokeWidth=".7" />
      </g>;
      if (border.style === 'hearts') return <path key={j} transform={`translate(${x} ${y}) rotate(${(j % 3 - 1) * 14})`} d="M0 5C-8 -1 -5 -7 0 -3C5 -7 8 -1 0 5Z" fill={c(j % 2 ? 'pink' : 'pastel-pink')} />;
      return <g key={j} transform={`translate(${x} ${y})`} fill={c('pine-light')}>
        {j % 4 === 2 ? <><circle r="3.8" fill={c('gold')} /><circle r="2.4" fill="none" stroke={c('rust')} strokeWidth=".7" /></> : <><circle cy="-2.8" r="2.6" /><circle cx="-2.8" cy="1" r="2.6" /><circle cx="2.8" cy="1" r="2.6" /><path d="M0 2Q1 5 3 6" fill="none" stroke={c('pine')} strokeWidth="1.2" /></>}
      </g>;
    })}
  </>;
}

export const PromoBorderOverlay = memo(function PromoBorderOverlay({ border, winner = false, closing = false, paused = false, reducedMotion = false }: {
  border?: PromoBorder | null; winner?: boolean; closing?: boolean; paused?: boolean; reducedMotion?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(370);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width || 370);
    update();
    const observer = new ResizeObserver(update); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const glow = `${id}-glow`, gingham = `${id}-gingham`, flame = `${id}-flame`, ring = `${id}-ring`;
  const outer = `M-16 -16H${width + 16}V236H-16Z`;
  const inner = `M34 10H${width - 34}Q${width - 10} 10 ${width - 10} 34V186Q${width - 10} 210 ${width - 34} 210H34Q10 210 10 186V34Q10 10 34 10Z`;
  return <svg ref={ref} aria-hidden="true" focusable="false" data-promo-border-layer data-border-style={border?.style || 'none'} data-winner={winner} data-closing={closing}
    data-motion={reducedMotion ? 'off' : paused ? 'paused' : 'running'} className="promo-border-overlay pointer-events-none absolute inset-0 h-full w-full overflow-visible"
    viewBox={`0 0 ${width} 220`} preserveAspectRatio="none">
    <defs>
      <clipPath id={ring}><path d={`${outer} ${inner}`} clipRule="evenodd" fillRule="evenodd" /></clipPath>
      <filter id={glow} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2" /></filter>
      <linearGradient id={flame} x1="0" y1="1" x2="0" y2="0"><stop stopColor={c('flame')} /><stop offset="1" stopColor={c('orange')} /></linearGradient>
      <pattern id={gingham} width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill={c('white')} /><rect width="8" height="16" fill={c('red')} opacity=".55" /><rect width="16" height="8" fill={c('red')} opacity=".55" /></pattern>
    </defs>
    <g clipPath={`url(#${ring})`}>
      {border && STRANDS.has(border.style) && <StrandBorder border={border} width={width} glow={glow} />}
      <g transform={`scale(${width / 370} 1)`}>
        {border && !STRANDS.has(border.style) && <Decorative border={border} glow={glow} gingham={gingham} flame={flame} />}
        {winner && <g data-border-effect="winner" fill="none"><path d={frame} stroke={c('gold')} strokeWidth="9" opacity=".55" filter={`url(#${glow})`} /><path d={frame} stroke={c('ivory')} strokeWidth="1.2" /><Sparkles gold /></g>}
        {closing && <g data-border-effect="closing" className="promo-border-pulse" fill="none" stroke={c('orange')}><path d={frame} strokeWidth="10" opacity=".7" filter={`url(#${glow})`} /><path d={frame} strokeWidth="3" /></g>}
      </g>
    </g>
  </svg>;
});
