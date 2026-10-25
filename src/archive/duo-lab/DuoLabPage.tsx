import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useUserRole } from '@/hooks/useUserRole';
import { useDuo } from '@/hooks/useDuo';
import { DuoPanelContext } from '@/hooks/use-mobile';
import { DuoLabDash } from './DuoLabDash';
import { useDuoLabData } from './useDuoLabData';

// Mounted hidden so today's sales fill the shared cache, exactly as on the Dash.
const SalesSummary = lazy(() => import('@/components/dashboard/SalesSummary').then(m => ({ default: m.SalesSummary })));

const FRONT = { w: 466, h: 678 };
const FULL = { w: 951, h: 669 };
const DOCK = 84;

function DeviceFrame({ label, w, h, children }: { label: string; w: number; h: number; children: React.ReactNode }) {
  return (
    <figure className="shrink-0">
      <figcaption className="mb-2 text-sm font-semibold text-muted-foreground">{label} · {w}×{h}</figcaption>
      <div
        className="relative overflow-hidden rounded-[28px] border-4 border-foreground/80 shadow-xl bg-background"
        style={{ width: w + 8, height: h + 8 }}
        data-duo-lab-frame={label}
      >
        <div className="relative" style={{ width: w, height: h }}>
          {children}
          <div className="absolute top-0 right-0 h-full bg-muted border-l border-border flex flex-col items-center gap-3 pt-4" style={{ width: DOCK }}>
            {[0, 1, 2, 3].map(i => <div key={i} className="h-11 w-11 rounded-full bg-muted-foreground/20" />)}
          </div>
        </div>
      </div>
    </figure>
  );
}

function readColRight() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--duo-col-right');
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : DOCK;
}

export default function DuoLabPage() {
  const { isSuperAdmin, loading } = useUserRole();
  const duo = useDuo();
  const d = useDuoLabData();
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  const hiddenSales = (
    <div className="hidden" aria-hidden="true">
      <Suspense fallback={null}><SalesSummary locationSettings={d.locationSettings as any} /></Suspense>
    </div>
  );

  if (duo.isDuo) {
    return (
      <DuoPanelContext.Provider value={true}>
        <div className="fixed inset-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <DuoLabDash d={d} variant={duo.isOpen ? 'full' : 'front'} width={vw} colRight={readColRight()} />
        </div>
        {hiddenSales}
      </DuoPanelContext.Provider>
    );
  }

  return (
    <DuoPanelContext.Provider value={true}>
      <div className="min-h-screen bg-muted/30 p-6">
        <h1 className="text-2xl font-bold text-foreground">Duo Design Lab</h1>
        <p className="text-sm text-muted-foreground mb-6">Dash · live data for {d.currentLocation?.name ?? 'your store'}. Exploration only.</p>
        <div className="flex gap-8 items-start overflow-x-auto pb-6">
          <DeviceFrame label="Front screen" {...FRONT}>
            <DuoLabDash d={d} variant="front" width={FRONT.w} colRight={DOCK} />
          </DeviceFrame>
          <DeviceFrame label="Full screen" {...FULL}>
            <DuoLabDash d={d} variant="full" width={FULL.w} colRight={DOCK} />
          </DeviceFrame>
        </div>
      </div>
      {hiddenSales}
    </DuoPanelContext.Provider>
  );
}
