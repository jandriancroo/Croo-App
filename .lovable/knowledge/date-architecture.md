# Date & Timezone Architecture — CrooHQ

Last updated: 2026-04-05

## Core Principle: String-First, Luxon-Only

All business date logic uses a **yyyy-MM-dd string** as the single source of truth, anchored to the **store's local timezone** (not the browser's). This prevents off-by-one errors when viewing stores in different timezones.

## Two Date Categories

### 1. Business Dates (store-relative)
Used by: Sales Summary, Tasks, Logbook, Checklists, Catering, Manager Dashboard

- **State**: `targetDateStr` — a plain `yyyy-MM-dd` string in the location's timezone
- **"Today" calculation**: `getBusinessDateInTimezone()` from `useLocationTimezone` — factors in `close_time` + buffer so the active shift stays as "today" until the business day ends
- **Date math**: Use Luxon `DateTime.fromFormat(dateStr, 'yyyy-MM-dd', { zone: locationZone })` — never `new Date(dateStr)`
- **Navigation**: Parse string → Luxon shift → re-serialize to string
- **Helper**: `toBusinessDateTime(dateStr)` is the single conversion function

### 2. Calendar Dates (wall-clock)
Used by: Schedule, Punch Clock, Timecards

- Use raw calendar dates for legal/logging accuracy
- Still format display using store timezone

## Rules

1. **NEVER** use `new Date(dateStr)` for business dates — it parses in browser timezone
2. **NEVER** use `T12:00:00` or `T00:00:00` hacks — they're fragile across DST
3. **ALWAYS** use Luxon with explicit `{ zone: locationZone }` for business date math
4. **OK** to use `new Date()` for real-time system timestamps (e.g., `lastFetchTimestamp`) — these are moments in time, not business dates
5. Navigation functions (`navigateDay`, `navigateWeek`, `navigateMonth`) operate on strings via Luxon, never raw Date objects
6. Labels, disabled states, and comparisons use the date string directly when possible

## Key Code Pattern (SalesSummary.tsx)

```tsx
// Single source of truth — string in location timezone
const [targetDateStr, setTargetDateStr] = useState(() => getBusinessDateInTimezone());

// Single helper to get Luxon DateTime when needed
const toBusinessDateTime = useCallback((dateStr: string) => {
  const parsed = DateTime.fromFormat(dateStr, 'yyyy-MM-dd', { zone: locationZone });
  return parsed.isValid ? parsed.startOf('day') : DateTime.now().setZone(locationZone).startOf('day');
}, [locationZone]);

// Navigation — string in, string out
const navigateDay = (direction: 'prev' | 'next') => {
  setTargetDateStr(prev => {
    const dt = toBusinessDateTime(prev);
    const next = direction === 'prev' ? dt.minus({ days: 1 }) : dt.plus({ days: 1 });
    return next.toFormat('yyyy-MM-dd');
  });
};

// Derived values via useMemo
const isToday = targetDateStr === getBusinessDateInTimezone();
const targetWeekStart = useMemo(() => 
  toBusinessDateTime(targetDateStr).minus({ days: dt.weekday - 1 }).toFormat('yyyy-MM-dd'),
  [targetDateStr]
);
```

## Timezone Resolution

Each location has a `timezone` field (e.g., `America/New_York`, `America/Los_Angeles`) auto-detected from its address. The `useLocationTimezone()` hook provides:
- `timezone` — the IANA timezone string
- `getBusinessDateInTimezone()` — today's business date as yyyy-MM-dd
- `formatInTimezone()` — display formatting in store's zone

## Common Pitfalls Prevented

| Bug | Cause | Prevention |
|-----|-------|------------|
| Off-by-one day | `new Date('2026-04-04')` → UTC midnight → prev day in PST | Use Luxon with zone |
| Skipped days in nav | Date object shifts across midnight | Navigate strings only |
| Wrong "today" | Browser in PST, store in EST | `getBusinessDateInTimezone()` uses store zone |
| Midnight flip | Store open till 2am, UI shows next day | Business date uses `close_time` + buffer |
