import { useEffect, useState } from 'react';

/** Decorative only: no store reads, audio, or interaction handlers. */
export function SpookifiedEffects() {
  const [enabled, setEnabled] = useState(false);
  const [batsVisible, setBatsVisible] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      const active = document.documentElement.dataset.theme === 'spookified';
      setEnabled(active);
      setBatsVisible(active && !motion.matches);
      if (active && !motion.matches) timer = setTimeout(() => setBatsVisible(false), 7200);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    motion.addEventListener('change', update);
    update();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      motion.removeEventListener('change', update);
    };
  }, []);

  if (!enabled) return null;
  return (
    <div className="spookified-effects" aria-hidden="true">
      <div className="spookified-fog spookified-fog-back"><i /><i /><i /></div>
      <div className="spookified-fog spookified-fog-front"><i /></div>
      {batsVisible && <div className="spookified-bats">
        {[0, 1, 2, 3, 4].map(n => (
          <div key={n} className={`spookified-bat spookified-bat-${n}`}>
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