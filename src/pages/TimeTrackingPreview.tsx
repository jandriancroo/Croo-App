import { useMemo, useState } from 'react';
import { DayByDayView } from '@/components/timetracking/DayByDayView';
import { DesktopTimeTrackingTable } from '@/components/timetracking/DesktopTimeTrackingTable';

/**
 * Visual harness for the Time / punch approval screen.
 * Public preview route — mock data only, no queries, no mutations.
 */

const TZ = 'America/Los_Angeles';

type MockPunch = {
  id: string;
  punch_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  punch_time: string;
  approved_at: string | null;
  notes?: string;
  auto_clocked_out?: boolean;
  edited_by?: string | null;
  edited_by_name?: string | null;
};

let pid = 0;
const iso = (day: string, hhmm: string) => `${day}T${hhmm}:00-07:00`;

function makeDay(
  day: string,
  inT: string,
  outT: string,
  opts: { breakStart?: string; breakEnd?: string; approved?: boolean; open?: boolean; autoOut?: boolean; edited?: string } = {},
): MockPunch[] {
  const approved_at = opts.approved ? '2026-08-02T00:00:00Z' : null;
  const p: MockPunch[] = [
    { id: `p${pid++}`, punch_type: 'clock_in', punch_time: iso(day, inT), approved_at, edited_by: opts.edited ? 'u1' : null, edited_by_name: opts.edited ?? null },
  ];
  if (opts.breakStart) {
    p.push({ id: `p${pid++}`, punch_type: 'break_start', punch_time: iso(day, opts.breakStart), approved_at, notes: '30 minute meal break' });
    if (opts.breakEnd) p.push({ id: `p${pid++}`, punch_type: 'break_end', punch_time: iso(day, opts.breakEnd), approved_at });
  }
  if (!opts.open) {
    p.push({ id: `p${pid++}`, punch_type: 'clock_out', punch_time: iso(day, outT), approved_at, auto_clocked_out: opts.autoOut });
  }
  return p;
}

const shift = (start: string, end: string) => ({ start_time: start, end_time: end, is_time_off: false });

function buildCards() {
  const people = [
    { id: 'a', full_name: 'Alle Rowe', nickname: null },
    { id: 'b', full_name: 'Diego Martinez', nickname: null },
    { id: 'c', full_name: 'Desiree Ramos', nickname: null },
    { id: 'd', full_name: 'Joshua Haro', nickname: null },
  ];
  const days = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-08-03', '2026-08-04'];

  return people.map((profile, i) => {
    const punchesByDay: Record<string, MockPunch[]> = {};
    const shiftsByDate = new Map<string, any>();
    days.forEach((day, d) => {
      const inT = ['09:00', '09:30', '12:00', '15:30'][i];
      const outT = ['16:04', '15:23', '19:03', '22:47'][i];
      punchesByDay[day] = makeDay(day, inT, outT, {
        breakStart: d === 2 && i === 1 ? undefined : ['10:18', '13:32', '14:15', '17:35'][i],
        breakEnd: d === 2 && i === 1 ? undefined : ['10:48', '14:02', '14:45', '18:06'][i],
        approved: d < 2,
        open: d === 3 && i === 2,
        autoOut: d === 4 && i === 0,
        edited: d === 1 && i === 3 ? 'Jordan Miller' : undefined,
      });
      shiftsByDate.set(day, shift(['09:00', '09:30', '12:00', '15:30'][i], ['16:00', '15:00', '19:00', '23:00'][i]));
    });
    return { profile, punchesByDay, shiftsByDate, totalHours: 30 + i * 3.4 };
  });
}

/* helpers mirroring the real page's shape (mock math only) */
const sortPunches = (punches: any[]) => [...punches].sort((a, b) => a.punch_time.localeCompare(b.punch_time));

const calculateDayHours = (dayPunches: any[]) => {
  const ci = dayPunches.find((p) => p.punch_type === 'clock_in');
  const co = dayPunches.find((p) => p.punch_type === 'clock_out');
  if (!ci || !co) return 0;
  const raw = (new Date(co.punch_time).getTime() - new Date(ci.punch_time).getTime()) / 3600000;
  const hasBreak = dayPunches.some((p) => p.punch_type === 'break_start');
  return Math.max(0, raw - (hasBreak ? 0.5 : 0));
};

const getDayFlags = (dayPunches: any[]) => {
  const hasOpenShift = !dayPunches.some((p) => p.punch_type === 'clock_out');
  const hasBreakViolation = !dayPunches.some((p) => p.punch_type === 'break_start');
  const hasAutoClockOut = dayPunches.some((p) => p.auto_clocked_out);
  return { hasOpenShift, hasBreakViolation, hasAutoClockOut, hasAnyFlag: hasOpenShift || hasBreakViolation || hasAutoClockOut };
};

const groupPunchesByWeek = (punchesByDay: { [key: string]: any[] }) => {
  const groups: Record<string, { start: Date; end: Date; days: { [d: string]: any[] } }> = {};
  Object.entries(punchesByDay).forEach(([day, punches]) => {
    const key = day < '2026-08-02' ? '2026-07-27' : '2026-08-03';
    if (!groups[key]) {
      groups[key] = {
        start: new Date(`${key}T12:00:00Z`),
        end: new Date(new Date(`${key}T12:00:00Z`).getTime() + 6 * 86400000),
        days: {},
      };
    }
    groups[key].days[day] = punches;
  });
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)) as [string, { start: Date; end: Date; days: { [d: string]: any[] } }][];
};

const WIDTHS: Record<string, number> = { desktop: 1240, tablet: 820, mobile: 390 };

export default function TimeTrackingPreview() {
  const params = new URLSearchParams(window.location.search);
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>((params.get('device') as any) || 'desktop');
  const [view, setView] = useState<'day' | 'person'>((params.get('view') as any) || 'person');
  const [approved, setApproved] = useState<Set<string>>(new Set());

  const cards = useMemo(() => buildCards(), []);

  const decorated = cards.map((c) => ({
    ...c,
    punchesByDay: Object.fromEntries(
      Object.entries(c.punchesByDay).map(([day, punches]) => [
        day,
        punches.map((p: any) => ({ ...p, approved_at: approved.has(`${c.profile.id}-${day}`) ? '2026-08-02T00:00:00Z' : p.approved_at })),
      ]),
    ),
  }));

  const toggle = (dayPunches: any[], on: boolean) => {
    const card = decorated.find((c) => Object.values(c.punchesByDay).some((arr: any) => arr.some((p: any) => p.id === dayPunches[0]?.id)));
    const day = card && Object.entries(card.punchesByDay).find(([, arr]: any) => arr.some((p: any) => p.id === dayPunches[0]?.id))?.[0];
    if (!card || !day) return;
    const key = `${card.profile.id}-${day}`;
    setApproved((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const shared = {
    filteredCards: decorated,
    timezone: TZ,
    includeApproved: true,
    onApproveDay: (dp: any[]) => toggle(dp, true),
    onUnapproveDay: (dp: any[]) => toggle(dp, false),
    onEditShift: () => {},
    calculateDayHours,
    sortPunches,
    currentLocationId: 'loc',
    approvingPunchIds: new Set<string>(),
    getDayFlags,
  };

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto mb-4 flex max-w-[1280px] flex-wrap items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Screen</span>
        {(['desktop', 'tablet', 'mobile'] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDevice(d)}
            className={`rounded-full border px-4 py-1.5 text-sm font-bold capitalize ${
              device === d ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'
            }`}
          >
            {d}
          </button>
        ))}
        <span className="ml-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">View</span>
        {(['day', 'person'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-full border px-4 py-1.5 text-sm font-bold ${
              view === v ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'
            }`}
          >
            {v === 'day' ? 'By Day' : 'By Person'}
          </button>
        ))}
      </div>

      <div className="mx-auto rounded-2xl bg-background p-4 shadow-sm" style={{ width: WIDTHS[device], maxWidth: '100%' }}>
        {view === 'day' ? (
          <DayByDayView {...shared} />
        ) : (
          <DesktopTimeTrackingTable {...shared} hasDayIssues={() => false} groupPunchesByWeek={groupPunchesByWeek} />
        )}
      </div>
    </div>
  );
}
