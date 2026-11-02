import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';

interface GoalRow {
  sale_date?: string;
  override_projection?: number | string | null;
  living_projection?: number | string | null;
  initial_projection?: number | string | null;
}

export function shouldEnsureFutureWeek(weekStart: string, today: string, rows: GoalRow[]): boolean {
  const T = DateTime.fromFormat(today, 'yyyy-MM-dd', { zone: 'America/Los_Angeles' });
  const start = DateTime.fromFormat(weekStart, 'yyyy-MM-dd', { zone: 'America/Los_Angeles' });
  if (!T.isValid || !start.isValid || start.weekday !== 1 || weekStart <= T.startOf('week').toFormat('yyyy-MM-dd')) return false;
  return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).toFormat('yyyy-MM-dd')).some(date => {
    const row = rows.find(row => row.sale_date === date);
    return ![row?.override_projection, row?.living_projection, row?.initial_projection]
      .some(value => Number.isFinite(Number(value)) && Number(value) > 0);
  });
}

// Share one in-flight request across the phone day strip and desktop week totals.
const pending = new Map<string, Promise<void>>();
export async function ensureFutureWeekLiving(locationId: string, weekStart: string, today: string, rows: GoalRow[]): Promise<void> {
  if (!shouldEnsureFutureWeek(weekStart, today, rows)) return;
  const key = `${locationId}:${weekStart}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const { data, error } = await supabase.functions.invoke('goal-engine', {
      body: { action: 'ensure_living', locationId, weekStart },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  })();
  pending.set(key, request);
  try { await request; } finally { pending.delete(key); }
}