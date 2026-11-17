import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { equipmentAlertCopy, fmtReadingTime, fmtTemp } from '../../../supabase/functions/_shared/equipmentCheck';
import type { EquipmentCheckAlert } from '@/hooks/useEquipmentChecks';

/** Near-full-screen "Please check equipment" card with Acknowledge (managers and up only). */
export function EquipmentCheckBadge({ alert, onAcknowledge }: { alert: EquipmentCheckAlert; onAcknowledge: (id: string) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const copy = equipmentAlertCopy(alert);
  const ack = async () => {
    setBusy(true);
    try {
      await onAcknowledge(alert.id);
    } catch {
      toast.error("Couldn't acknowledge. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-center bg-black/50 p-3 sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby="equip-check-title">
      <div className="flex w-full max-w-md flex-col overflow-y-auto rounded-2xl bg-background p-6 shadow-2xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
        </div>
        <h2 id="equip-check-title" className="text-center text-2xl font-bold">{copy.title}</h2>
        <p className="mt-1 text-center text-lg font-semibold text-destructive">{copy.unit} · {copy.store}</p>
        <p className="mt-1 text-center text-sm text-muted-foreground">Failed its temp check on 2 separate days</p>
        <div className="mt-4 space-y-2">
          {copy.readings.map((r) => (
            <div key={r.at} className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <span className="text-sm">{fmtReadingTime(r.at, alert.timezone)}</span>
              <span className="font-bold text-destructive">{fmtTemp(r.temp)}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-sm text-muted-foreground">{copy.rangeLabel}</p>
        <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{copy.tip} Re-check in 1 hour.</p>
        <div className="flex-1" />
        <Button className="mt-6 min-h-12 w-full text-base" variant="destructive" disabled={busy} onClick={ack}>
          I'll check it — Acknowledge
        </Button>
      </div>
    </div>
  );
}

/** After acknowledgment: who took it and when. */
export function EquipmentCheckBanner({ alert }: { alert: EquipmentCheckAlert }) {
  const when = alert.acknowledged_at ? fmtReadingTime(alert.acknowledged_at, alert.timezone).split(', ').pop() : '';
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
      <p className="font-semibold">⚠ {alert.unit_name} being checked</p>
      <p>Acknowledged by {alert.acknowledged_by_name || 'a manager'}{when ? ` · ${when}` : ''}. Re-check in 1 hour.</p>
    </div>
  );
}
