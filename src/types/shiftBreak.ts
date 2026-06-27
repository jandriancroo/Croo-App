// Break coverage assignment types — see plan in .lovable/plan.md
export interface ShiftBreak {
  id: string;
  start_time: string; // "HH:mm"
  end_time: string;   // "HH:mm"
  covered_by_user_id?: string | null;
}

export function isShiftBreakArray(value: unknown): value is ShiftBreak[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (b) =>
      b &&
      typeof b === 'object' &&
      typeof (b as ShiftBreak).id === 'string' &&
      typeof (b as ShiftBreak).start_time === 'string' &&
      typeof (b as ShiftBreak).end_time === 'string',
  );
}

export function normalizeBreaks(value: unknown): ShiftBreak[] {
  return isShiftBreakArray(value) ? value : [];
}

export function makeBreakId(): string {
  return `brk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
