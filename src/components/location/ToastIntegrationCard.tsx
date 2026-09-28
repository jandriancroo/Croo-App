import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type SyncRow = { sale_date: string; net_sales: number; fetched_at: string } | null;

function lastLine(label: string, row: SyncRow) {
  if (!row) return `${label}: not yet`;
  const when = new Date(row.fetched_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${label}: ${row.sale_date} · $${Number(row.net_sales).toFixed(2)} (updated ${when})`;
}

export default function ToastIntegrationCard({ locationId, integration }: { locationId: string; integration: any }) {
  const qc = useQueryClient();
  const [guid, setGuid] = useState('');
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setGuid(integration?.credentials?.restaurant_guid ?? '');
    setActive(!!integration?.is_active);
  }, [integration]);

  const { data: status } = useQuery({
    queryKey: ['toast-status', locationId],
    enabled: !!integration,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('toast-service', { body: { action: 'status', locationId } });
      if (error) throw error;
      return data as { lastExport: SyncRow; lastLive: SyncRow };
    },
  });

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.functions.invoke('toast-service', {
      body: { action: 'save', locationId, restaurantGuid: guid.trim(), isActive: active },
    });
    setSaving(false);
    if (error) { toast.error('Could not save Toast settings'); return; }
    toast.success(active ? 'Toast turned on' : 'Toast settings saved');
    qc.invalidateQueries({ queryKey: ['location-integration', locationId, 'toast'] });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sales, hourly sales and payments/tips come in from Toast's free nightly export, plus a live check during open hours.
      </p>
      <div className="space-y-2">
        <Label htmlFor="toast-guid">Toast restaurant ID</Label>
        <Input id="toast-guid" value={guid} onChange={(e) => setGuid(e.target.value)} placeholder="From the Toast Web address bar" />
      </div>
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <p className="text-sm font-medium">Use Toast for this store</p>
          <p className="text-xs text-muted-foreground">Sales on the dashboard will come from Toast.</p>
        </div>
        <Switch checked={active} onCheckedChange={setActive} />
      </div>
      {integration && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{lastLine('Nightly export', status?.lastExport ?? null)}</p>
          <p>{lastLine('Live check', status?.lastLive ?? null)}</p>
        </div>
      )}
      <Button className="w-full" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
    </div>
  );
}
