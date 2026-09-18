/**
 * LOCKED (2026-09-18) — live/today labor is ALWAYS punch-based.
 *
 * Shared punch-clock labor math for edge functions. This is the server-side
 * twin of src/utils/liveLabor.ts. Any edge function that reports live/today
 * labor MUST call this helper — no local reimplementation, and never gate
 * labor on a POS (QuBeyond/Clover) integration being present.
 */
import { DateTime } from 'https://esm.sh/luxon@3.4.4';

export interface PunchLaborResult {
  laborCost: number;
  hoursWorked: number;
  regularHours: number;
  overtimeHours: number;
  hourlyLaborCost?: Map<number, number>;
}

function utcRangeForLocalDate(dateStr: string, timezone: string) {
  const start = DateTime.fromFormat(dateStr, 'yyyy-MM-dd', { zone: timezone }).startOf('day');
  const end = start.endOf('day');
  return { startUtc: start.toUTC().toISO()!, endUtc: end.toUTC().toISO()! };
}

interface PunchRecord {
  id: string;
  user_id: string;
  punch_type: string;
  punch_time: string;
}

/**
 * Calculates labor (hours + cost) from time_punches for one local business date.
 * Open punches are counted live up to "now".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function calculatePunchLabor(
  supabaseClient: any,
  locationId: string,
  dateStr: string,
  timezone: string
): Promise<PunchLaborResult | null> {
  try {
    const { startUtc, endUtc } = utcRangeForLocalDate(dateStr, timezone);

    const { data: punches, error } = await supabaseClient
      .from('time_punches')
      .select('id, user_id, punch_type, punch_time')
      .eq('location_id', locationId)
      .gte('punch_time', startUtc)
      .lte('punch_time', endUtc)
      .order('punch_time', { ascending: true });

    if (error) {
      console.error('[PUNCH-LABOR] Error fetching punches:', error);
      return null;
    }

    const punchesOnDate = (punches || []) as PunchRecord[];
    if (punchesOnDate.length === 0) {
      return { laborCost: 0, hoursWorked: 0, regularHours: 0, overtimeHours: 0, hourlyLaborCost: new Map() };
    }

    const userIds = [...new Set(punchesOnDate.map((p) => p.user_id))];
    const wageMap = new Map<string, number>();

    const { data: wageHistoryData } = await supabaseClient
      .from('wage_history')
      .select('user_id, hourly_wage, effective_date')
      .in('user_id', userIds)
      .lte('effective_date', dateStr)
      .order('effective_date', { ascending: false });

    for (const wh of (wageHistoryData || []) as Array<{ user_id: string; hourly_wage: number | null }>) {
      if (!wageMap.has(wh.user_id)) wageMap.set(wh.user_id, wh.hourly_wage || 15);
    }

    const usersWithoutWage = userIds.filter((id) => !wageMap.has(id));
    if (usersWithoutWage.length > 0) {
      const { data: profilesData } = await supabaseClient
        .from('profiles')
        .select('id, hourly_wage')
        .in('id', usersWithoutWage);
      for (const p of (profilesData || []) as Array<{ id: string; hourly_wage: number | null }>) {
        wageMap.set(p.id, p.hourly_wage || 15);
      }
    }

    const punchesByUser = new Map<string, PunchRecord[]>();
    for (const punch of punchesOnDate) {
      if (!punchesByUser.has(punch.user_id)) punchesByUser.set(punch.user_id, []);
      punchesByUser.get(punch.user_id)!.push(punch);
    }

    let totalHoursWorked = 0;
    let totalLaborCost = 0;
    const now = new Date();
    const hourlyLaborCost = new Map<number, number>();

    const distributeSegmentToHours = (segStart: Date, segEnd: Date, wage: number, tz: string) => {
      let cursor = new Date(segStart);
      while (cursor < segEnd) {
        const cursorLocal = new Date(cursor.toLocaleString('en-US', { timeZone: tz }));
        const hour = cursorLocal.getHours();
        const nextHourLocal = new Date(cursorLocal);
        nextHourLocal.setMinutes(0, 0, 0);
        nextHourLocal.setHours(hour + 1);
        const boundary = new Date(cursor.getTime() + (nextHourLocal.getTime() - cursorLocal.getTime()));
        const segEndInHour = segEnd < boundary ? segEnd : boundary;
        const minutesInHour = (segEndInHour.getTime() - cursor.getTime()) / 60000;
        hourlyLaborCost.set(hour, (hourlyLaborCost.get(hour) || 0) + (minutesInHour / 60) * wage);
        cursor = segEndInHour;
      }
    };

    for (const [userId, userPunches] of punchesByUser) {
      const wage = wageMap.get(userId) || 15;
      let clockInTime: Date | null = null;
      let breakStartTime: Date | null = null;
      let hoursWorked = 0;
      let breakMinutes = 0;
      const workedSegments: { start: Date; end: Date }[] = [];
      const breakSegments: { start: Date; end: Date }[] = [];

      for (const punch of userPunches) {
        const punchTime = new Date(punch.punch_time);
        switch (punch.punch_type) {
          case 'clock_in':
            if (breakStartTime) {
              breakMinutes += (punchTime.getTime() - breakStartTime.getTime()) / 60000;
              breakSegments.push({ start: breakStartTime, end: punchTime });
              breakStartTime = null;
            } else if (!clockInTime) {
              clockInTime = punchTime;
            }
            break;
          case 'clock_out':
            if (clockInTime) {
              hoursWorked += (punchTime.getTime() - clockInTime.getTime()) / 3600000;
              workedSegments.push({ start: clockInTime, end: punchTime });
              clockInTime = null;
            }
            break;
          case 'break_start':
            breakStartTime = punchTime;
            break;
          case 'break_end':
            if (breakStartTime) {
              breakMinutes += (punchTime.getTime() - breakStartTime.getTime()) / 60000;
              breakSegments.push({ start: breakStartTime, end: punchTime });
              breakStartTime = null;
            }
            break;
        }
      }

      // Open punch — count live up to now
      if (clockInTime) {
        hoursWorked += (now.getTime() - clockInTime.getTime()) / 3600000;
        workedSegments.push({ start: clockInTime, end: now });
      }
      if (breakStartTime) {
        breakMinutes += (now.getTime() - breakStartTime.getTime()) / 60000;
        breakSegments.push({ start: breakStartTime, end: now });
      }

      const netHours = Math.max(0, hoursWorked - breakMinutes / 60);
      totalHoursWorked += netHours;
      totalLaborCost += netHours * wage;

      for (const seg of workedSegments) distributeSegmentToHours(seg.start, seg.end, wage, timezone);
      for (const seg of breakSegments) distributeSegmentToHours(seg.start, seg.end, -wage, timezone);
    }

    return {
      laborCost: totalLaborCost,
      hoursWorked: totalHoursWorked,
      regularHours: totalHoursWorked,
      overtimeHours: 0,
      hourlyLaborCost,
    };
  } catch (e) {
    console.error('[PUNCH-LABOR] Error calculating labor:', e);
    return null;
  }
}
