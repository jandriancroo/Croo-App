import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';
import { effectiveStationId } from '@/utils/groupShiftsByStation';
import { useUserRole, type AppRole } from '@/hooks/useUserRole';

/**
 * The person's shift context at this store, from ONE shift lookup (read-only):
 * 1. clocked in now (last punch today at this store is clock_in with a shift_id), else
 * 2. today's shifts on a published schedule at this store: the one covering now,
 *    else the next upcoming, else the latest.
 * "Today" = local day in location_settings.timezone, as real UTC instants.
 * station uses effectiveStationId (shift's own station, else its template's).
 */
export interface UserShiftContext {
  position: string | null;
  station: string | null;
  role: AppRole | null;
  loading: boolean;
}

interface ShiftRow {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  station_id: string | null;
  template: { position: string | null; station_id: string | null } | null;
}

/** Pure chooser: covering now, else next upcoming, else latest. Times are store-local. */
export function pickShiftForNow<T extends { shift_date: string; start_time: string; end_time: string }>(
  shifts: T[],
  tz: string,
  now: DateTime = DateTime.now(),
): T | null {
  if (!shifts.length) return null;
  const spans = shifts.map((s) => {
    const start = DateTime.fromFormat(`${s.shift_date} ${s.start_time.slice(0, 5)}`, 'yyyy-MM-dd HH:mm', { zone: tz });
    let end = DateTime.fromFormat(`${s.shift_date} ${s.end_time.slice(0, 5)}`, 'yyyy-MM-dd HH:mm', { zone: tz });
    if (end <= start) end = end.plus({ days: 1 }); // overnight
    return { s, start, end };
  }).sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const covering = spans.find((x) => x.start <= now && now < x.end);
  if (covering) return covering.s;
  const next = spans.find((x) => x.start > now);
  if (next) return next.s;
  return spans[spans.length - 1].s;
}

const SHIFT_SELECT = 'id, shift_date, start_time, end_time, station_id, is_time_off, template:shift_templates(position, station_id)';

export function useUserShiftContext(userId?: string, locationId?: string): UserShiftContext {
  const { role, loading: roleLoading } = useUserRole();
  const [position, setPosition] = useState<string | null>(null);
  const [station, setStation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId || !locationId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const apply = (shift: ShiftRow | null) => {
      if (cancelled) return;
      setPosition(shift?.template?.position ?? null);
      setStation(effectiveStationId(shift));
    };

    (async () => {
      setLoading(true);
      try {
        const { data: settings } = await supabase
          .from('location_settings')
          .select('timezone')
          .eq('location_id', locationId)
          .maybeSingle();
        const tz = settings?.timezone || 'America/Los_Angeles';
        const now = DateTime.now().setZone(tz);
        const todayStr = now.toFormat('yyyy-MM-dd');
        const dayStartUtc = now.startOf('day').toUTC().toISO()!;
        const dayEndUtc = now.endOf('day').toUTC().toISO()!;

        // 1. Clocked in right now at this store?
        const { data: lastPunch } = await supabase
          .from('time_punches')
          .select('shift_id, punch_type')
          .eq('user_id', userId)
          .eq('location_id', locationId)
          .gte('punch_time', dayStartUtc)
          .lte('punch_time', dayEndUtc)
          .order('punch_time', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastPunch?.punch_type === 'clock_in' && lastPunch.shift_id) {
          const { data: shift } = await supabase
            .from('scheduled_shifts')
            .select(SHIFT_SELECT)
            .eq('id', lastPunch.shift_id)
            .maybeSingle();
          if (shift) {
            apply(shift as unknown as ShiftRow);
            return;
          }
        }

        // 2. Today's shifts on a published schedule at this store.
        const { data: todayShifts } = await supabase
          .from('scheduled_shifts')
          .select(`${SHIFT_SELECT}, schedule:schedules!inner(location_id, is_published)`)
          .eq('user_id', userId)
          .eq('shift_date', todayStr)
          .eq('schedule.location_id', locationId)
          .eq('schedule.is_published', true);

        const rows = ((todayShifts ?? []) as unknown as ShiftRow[]).filter((s) => !(s as any).is_time_off);
        apply(pickShiftForNow(rows, tz, now));
      } catch (err) {
        console.error('Error detecting user shift context:', err);
        apply(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, locationId]);

  return { position, station, role: (role as AppRole | null) ?? null, loading: loading || roleLoading };
}
