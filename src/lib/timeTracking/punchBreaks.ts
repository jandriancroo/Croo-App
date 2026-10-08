/**
 * Break lines for the Time Tracking approve list, built from the day's punches.
 * Each break_start pairs with the next unused break_end after it (fallback: next
 * clock_in). Duplicate break_end punches are skipped. Display only.
 */
export interface PunchBreakLine {
  start: string;
  end: string | null;
  minutes: number;
  isLong: boolean;
}

const ms = (p: any) => new Date(p.punch_time).getTime();

export function buildBreaksFromPunches(dayPunches: any[]): PunchBreakLine[] {
  const sorted = [...(dayPunches || [])].sort((a, b) => ms(a) - ms(b));
  const used = new Set<any>();
  return sorted
    .filter((p) => p.punch_type === 'break_start')
    .map((bs) => {
      const t = ms(bs);
      let end = sorted.find((p) => p.punch_type === 'break_end' && !used.has(p) && ms(p) > t);
      if (end) used.add(end);
      else end = sorted.find((p) => p.punch_type === 'clock_in' && ms(p) > t);
      const minutes = end ? Math.round((ms(end) - t) / 60000) : 0;
      return { start: bs.punch_time, end: end ? end.punch_time : null, minutes, isLong: !!end && minutes > 35 };
    });
}
