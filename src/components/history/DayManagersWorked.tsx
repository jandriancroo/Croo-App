import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DateTime } from 'luxon';
import { Shield } from 'lucide-react';
import { getDisplayName } from '@/utils/displayName';

const MANAGER_ROLES = ['shift_manager', 'shift_manager_in_training', 'manager', 'admin', 'org_admin', 'brand_admin', 'super_admin'];

interface Props {
  dateStr: string; // yyyy-MM-dd
  locationId: string;
  timezone: string;
  businessDayRange: { start: Date; end: Date };
}

interface ManagerWorked {
  userId: string;
  name: string;
  role: string;
  inMs: number;
  outMs: number | null;
}

export function DayManagersWorked({ dateStr, locationId, timezone, businessDayRange }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['day-managers-worked', locationId, dateStr],
    staleTime: 60 * 1000,
    enabled: !!locationId && !!dateStr,
    queryFn: async (): Promise<ManagerWorked[]> => {
      // 1. Get manager-role user IDs at this location
      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', MANAGER_ROLES as any);

      if (!roleRows || roleRows.length === 0) return [];

      // Pick highest role per user (order matters: super_admin > brand_admin > org_admin > admin > manager > shift_manager)
      const rolePriority: Record<string, number> = {
        super_admin: 6, brand_admin: 5, org_admin: 4, admin: 3, manager: 2, shift_manager: 1,
      };
      const userRoleMap = new Map<string, string>();
      for (const r of roleRows) {
        const cur = userRoleMap.get(r.user_id);
        if (!cur || (rolePriority[r.role] || 0) > (rolePriority[cur] || 0)) {
          userRoleMap.set(r.user_id, r.role);
        }
      }
      const managerIds = Array.from(userRoleMap.keys());
      if (managerIds.length === 0) return [];

      // 2. Punches within business-day window for this location
      const { data: punches } = await supabase
        .from('time_punches')
        .select('user_id, punch_type, punch_time')
        .eq('location_id', locationId)
        .in('user_id', managerIds)
        .gte('punch_time', businessDayRange.start.toISOString())
        .lte('punch_time', businessDayRange.end.toISOString())
        .order('punch_time', { ascending: true });

      if (!punches || punches.length === 0) return [];

      // 3. Group by user → first clock_in, last clock_out
      const byUser = new Map<string, { inMs: number; outMs: number | null }>();
      for (const p of punches) {
        const ms = new Date(p.punch_time).getTime();
        const entry = byUser.get(p.user_id) || { inMs: Infinity, outMs: null };
        if (p.punch_type === 'clock_in') {
          if (ms < entry.inMs) entry.inMs = ms;
        } else if (p.punch_type === 'clock_out') {
          if (entry.outMs === null || ms > entry.outMs) entry.outMs = ms;
        }
        byUser.set(p.user_id, entry);
      }
      const userIds = Array.from(byUser.keys()).filter(uid => byUser.get(uid)!.inMs !== Infinity);
      if (userIds.length === 0) return [];

      // 4. Names
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .in('id', userIds);
      const nameMap = new Map((profiles || []).map((p: any) => [p.id, getDisplayName(p.full_name, p.nickname)]));

      return userIds
        .map(uid => ({
          userId: uid,
          name: nameMap.get(uid) || 'Unknown',
          role: userRoleMap.get(uid) || 'shift_manager',
          inMs: byUser.get(uid)!.inMs,
          outMs: byUser.get(uid)!.outMs,
        }))
        .sort((a, b) => a.inMs - b.inMs);
    },
  });

  const fmtTime = (ms: number) =>
    DateTime.fromMillis(ms).setZone(timezone).toFormat('h:mma').toLowerCase();

  const formatted = useMemo(() => data || [], [data]);

  if (isLoading || formatted.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-border/60">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
        <Shield className="w-3 h-3" /> Managers on duty
      </div>
      <div className="flex flex-col gap-2 w-full">
        {formatted.map(m => (
          <div
            key={m.userId}
            className="w-full flex items-center justify-between gap-3 rounded-xl bg-primary/10 border border-primary/20 px-3 py-2"
          >
            <span className="min-w-0 font-medium text-foreground text-[12px] truncate">
              {m.name}
            </span>
            <span className="text-muted-foreground text-[11px] shrink-0">
              {fmtTime(m.inMs)}–{m.outMs ? fmtTime(m.outMs) : 'now'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
