import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { whenInviteAllowed } from '@/lib/startupSequence';
import { safeAlertLink, SystemAlert } from '@/lib/systemAlerts';
import { syncChromeColor } from '@/utils/syncChrome';
import { SystemAlertDialog } from './SystemAlertDialog';

export function SystemAlertsPopup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handled, setHandled] = useState(false);
  const { data: alert } = useQuery({
    queryKey: ['next-system-alert', user?.id], enabled: !!user?.id && !handled,
    staleTime: 60_000, refetchInterval: handled ? false : 60_000,
    queryFn: async (): Promise<SystemAlert | null> => {
      const { data, error } = await supabase.rpc('get_next_system_alert');
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  useEffect(() => { setOpen(false); setHandled(false); }, [user?.id]);
  useEffect(() => {
    if (!alert || handled) { setOpen(false); return; }
    return whenInviteAllowed(() => setOpen(true));
  }, [alert?.id, handled]);

  const finish = async (outcome: 'dismissed' | 'action') => {
    if (!alert || !user || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('system_alert_receipts').insert({ alert_id: alert.id, user_id: user.id, outcome });
      if (error && error.code !== '23505') throw error;
      setHandled(true); setOpen(false);
      if (outcome === 'action' && alert.action_kind === 'theme' && alert.action_value) {
        localStorage.setItem('app-theme', alert.action_value);
        document.documentElement.setAttribute('data-theme', alert.action_value);
        syncChromeColor();
      }
      if (outcome === 'action' && alert.action_kind === 'link' && alert.action_value && safeAlertLink(alert.action_value)) {
        if (alert.action_value.startsWith('/')) navigate(alert.action_value);
        else window.location.assign(alert.action_value);
      }
    } catch { toast.error('Could not save your response. Please try again.'); }
    finally { setBusy(false); }
  };
  return <SystemAlertDialog alert={alert ?? null} open={open} busy={busy} onDismiss={() => void finish('dismissed')} onAction={() => void finish('action')} />;
}