import { useEffect, useState, type CSSProperties } from 'react';

type Bat = { id: number; top: number; dy: number; arc: number; scale: number; dur: number; delay: number; flip: boolean };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
let batSeq = 0;
function makeFlock(): Bat[] {
  const n = 1 + Math.floor(Math.random() * 3); // 1-3 bats per pass
  const flip = Math.random() < 0.5;
  return Array.from({ length: n }, (_, i) => ({
    id: ++batSeq,
    top: rand(8, 38),
    dy: rand(-12, 12),
    arc: rand(-9, 9),
    scale: rand(0.55, 1.15),
    dur: rand(4.2, 7.5),
    delay: i * rand(0.25, 0.9),
    flip,
  }));
}

/** Decorative only: no store reads, audio, or interaction handlers. */
export function SpookifiedEffects() {
  const [enabled, setEnabled] = useState(false);
  const [motionOk, setMotionOk] = useState(false);
  const [bats, setBats] = useState<Bat[]>([]);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setEnabled(document.documentElement.dataset.theme === 'spookified');
      setMotionOk(!motion.matches);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    motion.addEventListener('change', update);
    update();
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', update);
    };
  }, []);

  // Loop: a small flock crosses every 8-15s while Spookified is on and motion is allowed.
  // Starts only once the Dash is idle and at least 3s after mount; no new bats while Theo's voice screen is open.
  useEffect(() => {
    if (!enabled || !motionOk) { setBats([]); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idleId: number | undefined;
    let stopped = false;
    const theoOpen = () => !!document.querySelector('[aria-label="Close Theo voice"]');
    const schedule = (ms: number) => {
      timer = setTimeout(() => {
        if (!document.hidden && !theoOpen()) setBats(prev => [...prev, ...makeFlock()].slice(-6));
        schedule(rand(8000, 15000));
      }, ms);
    };
    const mountedAt = performance.now();
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const begin = () => { if (!stopped) schedule(Math.max(0, 3000 - (performance.now() - mountedAt))); };
    if (w.requestIdleCallback) idleId = w.requestIdleCallback(begin, { timeout: 5000 }); else timer = setTimeout(begin, 300);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
    };
  }, [enabled, motionOk]);

  if (!enabled) return null;
  return (
    <div className="spookified-effects" aria-hidden="true">
      <div className="spookified-fog spookified-fog-back"><i /><i /><i /></div>
      <div className="spookified-fog spookified-fog-front"><i /></div>
      {bats.length > 0 && <div className="spookified-bats">
        {bats.map(b => (
          <div key={b.id} className={`spookified-bat${b.flip ? ' spookified-bat-rtl' : ''}`}
            onAnimationEnd={e => { if (e.target === e.currentTarget) setBats(prev => prev.filter(x => x.id !== b.id)); }}
            style={{ top: `${b.top}%`, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s`, '--bat-dy': `${b.dy}vh`, '--bat-arc': `${b.arc}vh`, '--bat-scale': b.scale } as CSSProperties}>
            <svg viewBox="0 0 80 40" width="48" height="24">
              <path className="spookified-bat-wing" d="M40 22Q23 3 2 4L10 20Q18 14 22 27Q30 20 36 31Z" />
              <path className="spookified-bat-wing" d="M40 22Q57 3 78 4L70 20Q62 14 58 27Q50 20 44 31Z" />
              <path d="M35 15L35 6L40 11L45 6L45 15Q51 29 40 35Q29 29 35 15Z" />
            </svg>
          </div>
        ))}
      </div>}
    </div>
  );
}
