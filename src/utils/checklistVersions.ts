/**
 * Checklist version helpers (duplicate + scheduled swap, Jordan + Ryan spec).
 *
 * family_id groups every version of the same list and NEVER changes.
 * is_active stays the GM kill switch. superseded_at marks "turned off because a
 * newer version took over". A pending draft is is_active=false, superseded_at=null
 * and points at the version it replaces.
 */
import { DateTime } from 'luxon';

export interface VersionedChecklist {
  id: string;
  is_active?: boolean | null;
  family_id?: string | null;
  replaces_checklist_id?: string | null;
  superseded_at?: string | null;
  activation_at?: string | null;
  template_type?: string | null;
  frequency?: string | null;
}

/** A draft waiting for its scheduled flip. Never shown to crew. */
export const isPendingDraft = (c: VersionedChecklist): boolean =>
  !c.is_active && !c.superseded_at && !!c.replaces_checklist_id;

/** An older version that a swap turned off. Openable for history only. */
export const isSupersededVersion = (c: VersionedChecklist): boolean => !!c.superseded_at;

/** The list crew are on right now. */
export const isCurrentVersion = (c: VersionedChecklist): boolean =>
  !!c.is_active && !c.superseded_at;

/**
 * Reporting for a closed period selects by family and ignores is_active — a list
 * that was live during the period still counts even after it was swapped out.
 */
export const wasLiveDuringPeriod = (
  c: VersionedChecklist,
  periodStart: Date
): boolean => {
  if (isPendingDraft(c)) return false;
  if (c.superseded_at) return new Date(c.superseded_at).getTime() >= periodStart.getTime();
  return !!c.is_active;
};

/**
 * Live-now can split a week/month across two checklist ids. Reporting must sum
 * ACROSS the family per day and count each family exactly once, so pick the one
 * version that was live at that day's business open.
 */
export const versionsLiveOnDay = <T extends VersionedChecklist>(
  checklists: T[],
  dayStart: Date
): T[] => {
  const byFamily = new Map<string, T[]>();
  for (const c of checklists) {
    if (isPendingDraft(c)) continue;
    const key = c.family_id || c.id;
    const arr = byFamily.get(key);
    if (arr) arr.push(c);
    else byFamily.set(key, [c]);
  }

  const dayMs = dayStart.getTime();
  const picked: T[] = [];
  for (const versions of byFamily.values()) {
    if (versions.length === 1) {
      if (wasLiveDuringPeriod(versions[0], dayStart)) picked.push(versions[0]);
      continue;
    }
    // Oldest still-live version at that instant wins: superseded after the day
    // started (or never superseded and still on).
    const sorted = [...versions].sort((a, b) => {
      const av = a.superseded_at ? new Date(a.superseded_at).getTime() : Infinity;
      const bv = b.superseded_at ? new Date(b.superseded_at).getTime() : Infinity;
      return av - bv;
    });
    const hit = sorted.find((v) =>
      v.superseded_at ? new Date(v.superseded_at).getTime() > dayMs : !!v.is_active
    );
    if (hit) picked.push(hit);
  }
  return picked;
};

export type SwapCadence = 'weekly' | 'monthly' | 'daily';

export const swapCadence = (c: VersionedChecklist): SwapCadence => {
  if (c.frequency === 'monthly') return 'monthly';
  if (c.template_type === 'dynamic' || c.frequency === 'weekly') return 'weekly';
  return 'daily';
};

/** Live-now override is available on every type (Jordan, Aug 28 2026). */
export const canGoLiveNow = (_c: VersionedChecklist): boolean => true;

/** Plain-language period wording for archive confirms, per checklist type. */
export const archivePeriodCopy = (
  c: Pick<VersionedChecklist, 'template_type' | 'frequency'>
): { scoreLine: string; nextLine: string } => {
  const cadence = swapCadence(c as VersionedChecklist);
  if (cadence === 'monthly') {
    return {
      scoreLine: "This month's score still has the hole where it was, so the percentage won't jump.",
      nextLine: 'Starting the 1st it isn\'t expected at all.',
    };
  }
  if (cadence === 'weekly') {
    return {
      scoreLine: "This week's score still has the hole where it was, so the percentage won't jump.",
      nextLine: "Starting Monday it isn't expected at all.",
    };
  }
  return {
    scoreLine: "Today's score still has the hole where it was, so the percentage won't jump.",
    nextLine: "Starting tomorrow it isn't expected at all.",
  };
};


/**
 * The next legal go-live moment, at that location's business open.
 * weekly → next Monday, monthly → the 1st, daily → next business open.
 */
export const nextActivationOptions = (
  c: VersionedChecklist,
  timezone: string,
  businessOpenHour: number
): { iso: string; label: string }[] => {
  const cadence = swapCadence(c);
  const now = DateTime.now().setZone(timezone);
  const at = (dt: DateTime) => dt.set({ hour: businessOpenHour, minute: 0, second: 0, millisecond: 0 });

  const opts: DateTime[] = [];
  if (cadence === 'weekly') {
    let monday = at(now).startOf('day').set({ hour: businessOpenHour });
    monday = monday.plus({ days: (8 - monday.weekday) % 7 || 7 });
    opts.push(monday, monday.plus({ weeks: 1 }), monday.plus({ weeks: 2 }));
  } else if (cadence === 'monthly') {
    const first = at(now.plus({ months: 1 }).startOf('month'));
    opts.push(first, at(now.plus({ months: 2 }).startOf('month')));
  } else {
    const tomorrow = at(now.plus({ days: 1 }).startOf('day'));
    opts.push(tomorrow, tomorrow.plus({ days: 1 }), tomorrow.plus({ days: 7 }));
  }

  return opts.map((dt) => ({
    iso: dt.toUTC().toISO() as string,
    label: dt.toFormat("EEE, MMM d 'at' h:mm a"),
  }));
};

export const formatActivation = (iso: string | null | undefined, timezone: string): string => {
  if (!iso) return '';
  return DateTime.fromISO(iso).setZone(timezone).toFormat('MMM d');
};
