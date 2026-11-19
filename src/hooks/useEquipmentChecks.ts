import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { uniqueChannelName } from '@/lib/realtimeChannelName';

export interface EquipmentCheckAlert {
  id: string;
  location_id: string;
  item_id: string | null;
  unit_name: string;
  location_name: string;
  equipment_type: string | null;
  timezone: string | null;
  readings: unknown;
  created_at: string;
  acknowledged_by: string | null;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
}

/**
 * Equipment-check alerts for a store (same unit failed its temp check on 2
 * separate days). The database only returns rows to manager-and-up with access
 * to the store (RLS), so everyone else always gets an empty list.
 */
export function useEquipmentChecks(locationId: string | null | undefined) {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<EquipmentCheckAlert[]>([]);

  const refresh = useCallback(async () => {
    if (!user?.id || !locationId) { setAlerts([]); return; }
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await (supabase as any)
      .from('equipment_check_alerts')
      .select('id,location_id,item_id,unit_name,location_name,equipment_type,timezone,readings,created_at,acknowledged_by,acknowledged_by_name,acknowledged_at')
      .eq('location_id', locationId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10);
    if (!error) setAlerts(Array.isArray(data) ? (data as EquipmentCheckAlert[]) : []);
  }, [user?.id, locationId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!user?.id || !locationId) return;
    // Unique per mount: the global layer and the checklist banners both use this
    // hook for the same store, and a shared name makes the second listener throw.
    // Name is built from the store id plus a random suffix only.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(uniqueChannelName(`equipment-checks-${locationId}`))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment_check_alerts', filter: `location_id=eq.${locationId}` }, () => { void refresh(); })
        .subscribe();
    } catch (e) {
      console.warn('[useEquipmentChecks] realtime subscribe failed', e);
    }
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [user?.id, locationId, refresh]);

  const acknowledge = useCallback(async (id: string) => {
    const { data, error } = await (supabase as any).rpc('acknowledge_equipment_check', { _alert_id: id });
    if (error) throw error;
    if (data) setAlerts(prev => prev.map(a => (a.id === id ? { ...a, ...(data as EquipmentCheckAlert) } : a)));
    return data as EquipmentCheckAlert;
  }, []);

  return { alerts, acknowledge, refresh };
}

/** Banner window after someone acknowledges: shown for 12 hours. */
export const ACK_BANNER_MS = 12 * 60 * 60 * 1000;
export const openAlert = (alerts: EquipmentCheckAlert[]) => alerts.find(a => !a.acknowledged_at) ?? null;
export const recentlyAcknowledged = (alerts: EquipmentCheckAlert[], now = Date.now()) =>
  alerts.filter(a => a.acknowledged_at && now - new Date(a.acknowledged_at).getTime() < ACK_BANNER_MS);
