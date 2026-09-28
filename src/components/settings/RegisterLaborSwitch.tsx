import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { useUserRole } from '@/hooks/useUserRole';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * C10: "Use register labor". The server merges only the pull_labor key
 * (never rewrites credentials), allows super admins / org admins only, and
 * refuses to turn on when the register sent no labor in the last 7 days.
 * Stores with a punch tablet get a confirm prompt first.
 */
export function RegisterLaborSwitch({
  locationId, integrationType, credentials,
}: { locationId: string; integrationType: 'qubeyond' | 'aloha' | 'clover'; credentials: any }) {
  const qc = useQueryClient();
  const { role } = useUserRole();
  const allowed = role === 'super_admin' || role === 'org_admin';
  const on = credentials?.pull_labor === true || credentials?.pull_labor === 'true';
  const [pending, setPending] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: hasTablet } = useQuery({
    queryKey: ['has-punch-tablet', locationId],
    queryFn: async () => {
      const { count } = await supabase
        .from('punch_clock_devices' as any)
        .select('id', { count: 'exact', head: true })
        .eq('location_id', locationId)
        .is('revoked_at', null);
      return (count || 0) > 0;
    },
    enabled: !!locationId && allowed,
  });

  const apply = async (next: boolean) => {
    setSaving(true);
    const { error } = await supabase.rpc('set_register_labor' as any, {
      _location_id: locationId, _integration_type: integrationType, _on: next,
    });
    setSaving(false);
    setPending(null);
    if (error) {
      toast.error(error.message.includes('7 days')
        ? 'This register has sent no labor in the last 7 days'
        : 'Could not change register labor');
      return;
    }
    toast.success(next ? 'Using register labor' : 'Using time clock labor');
    qc.invalidateQueries({ queryKey: ['location-integration', locationId] });
  };

  const onChange = (next: boolean) => {
    if (hasTablet) setPending(next);
    else apply(next);
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">Use register labor</p>
        <p className="text-xs text-muted-foreground">
          {allowed ? 'Labor comes from the register instead of the time clock.' : 'Only org admins can change this.'}
        </p>
      </div>
      <Switch checked={on} disabled={!allowed || saving} onCheckedChange={onChange} />
      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This store uses a time clock tablet</AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? 'Labor will come from the register instead of the tablet punches.' : 'Labor will come from the tablet punches instead of the register.'} Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending !== null && apply(pending)}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
