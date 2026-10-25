import { Button } from '@/components/ui/button';

export interface DuoCellMetric { label: string; value: string; behind?: boolean }
export function DuoSalesCell({ title, metrics, currentFace, totalFaces, onFace, onDown, onUp, onCancel }: {
  title?: string; metrics: DuoCellMetric[]; currentFace: number; totalFaces: number;
  onFace: (n: number) => void; onDown: () => void; onUp: () => void; onCancel: () => void;
}) {
  const [hero, ...rest] = metrics;
  return <div className="duo-sales-cell" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onCancel}
    onTouchStart={e => { const touch = e.touches[0]; if (touch) e.currentTarget.dataset.swipeX = String(touch.clientX); }}
    onTouchEnd={e => { const touch = e.changedTouches[0]; if (!touch) return; const x = Number(e.currentTarget.dataset.swipeX); const dx = touch.clientX - x; if (Math.abs(dx) > 40) { onCancel(); onFace((currentFace + (dx < 0 ? 1 : totalFaces - 1)) % totalFaces); } }}>
    <div className="duo-cell-heading"><span>{title || 'Daily Sales'}</span><div className="duo-cell-dots">{Array.from({ length: totalFaces }, (_, i) =>
      <Button key={i} variant="ghost" aria-label={`Show face ${i + 1}`} aria-pressed={i === currentFace}
        onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onFace(i); }}><i /></Button>)}</div></div>
    <div className="duo-cell-face" key={currentFace}><div className="duo-cell-hero"><b>{hero?.value ?? '--'}</b><small>{hero?.label}</small></div>
      <div className="duo-cell-grid">{rest.map((m, i) => <div key={i}><b>{m.behind && <i className="duo-down">↓ </i>}{m.value}</b><small>{m.label}</small></div>)}</div>
    </div>
  </div>;
}