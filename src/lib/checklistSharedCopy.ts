import { checklistScorePeriod, type ChecklistScheduleFields } from '@/lib/taskHistory/schedule';

/**
 * Which shared copy (submission window) crew land on when opening a Standard
 * list on `dateStr`. Lists scored over a whole week / month / quarter share one
 * copy for that period; everything else gets one copy per day.
 */
export function sharedCopyWindow(c: ChecklistScheduleFields, dateStr: string) {
  return checklistScorePeriod(c, dateStr);
}
