// Gross sales: visibility only. Net stays the primary number everywhere
// (goals, pace, labor %, comparisons, "% vs LY at this point").
// gross = net + discounts + comps + promos + refunds; tax and tips excluded.
// Server source: sales_cache.gross_sales via get_gross_sales_periods / get_gross_sales_range.
// A day or period missing any piece comes back null and is hidden, never shown as net.

export const GROSS_FOOTNOTE = 'Gross = net + discounts, comps, promos and refunds. Tax and tips excluded.';
export const SHOW_GROSS_PREF_KEY = 'show_gross_sales';

export interface GrossPeriods {
  day: number | null;
  yesterday: number | null;
  wtd: number | null;
  mtd: number | null;
  lwDay: number | null;
  lwWtd: number | null;
  lmMtd: number | null;
  lyDay: number | null;
  lyWeek: number | null;
  lyMonth: number | null;
  days: Record<string, number>;
  hourly: Record<string, number>;
}

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const numMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
      const n = numOrNull(raw);
      if (n != null) out[k] = n;
    }
  }
  return out;
};

/** Parse one get_gross_sales_periods row (or array of one). */
export function parseGrossPeriods(raw: unknown): GrossPeriods | null {
  const r = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== 'object') return null;
  return {
    day: numOrNull(r.day_gross),
    yesterday: numOrNull(r.yday_gross),
    wtd: numOrNull(r.wtd_gross),
    mtd: numOrNull(r.mtd_gross),
    lwDay: numOrNull(r.lw_day_gross),
    lwWtd: numOrNull(r.lw_wtd_gross),
    lmMtd: numOrNull(r.lm_mtd_gross),
    lyDay: numOrNull(r.ly_day_gross),
    lyWeek: numOrNull(r.ly_week_gross),
    lyMonth: numOrNull(r.ly_month_gross),
    days: numMap(r.days),
    hourly: numMap(r.day_hourly),
  };
}

/**
 * Gross to show next to a net number, or null to hide it.
 * Hidden when the toggle is off, the piece is missing, or gross reads below net
 * (a stale or partial read; gross can never be smaller than net).
 */
export function visibleGross(showGross: boolean, gross: number | null | undefined, net: number | null | undefined): number | null {
  if (!showGross || gross == null || !Number.isFinite(gross)) return null;
  const n = Number(net);
  if (Number.isFinite(n) && n > 0 && gross + 0.01 < n) return null;
  if (!(Number.isFinite(n) && n > 0) && gross <= 0) return null;
  return gross;
}

/** "1 PM" / "1:00 PM" / "13:00" → "13:00" (the key stored in hourly_data). */
export function hourKey24(label: string | null | undefined): string | null {
  const s = String(label ?? '').trim();
  const ampm = s.match(/^(\d{1,2})(?::\d{2})?\s*([AaPp])\.?[Mm]?\.?$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12;
    if (ampm[2].toLowerCase() === 'p') h += 12;
    return `${String(h).padStart(2, '0')}:00`;
  }
  const h24 = s.match(/^(\d{1,2}):\d{2}/);
  if (h24) return `${String(parseInt(h24[1], 10)).padStart(2, '0')}:00`;
  return null;
}

/** Hover-pill gross for one hour bar. */
export function grossForHour(showGross: boolean, periods: GrossPeriods | null | undefined, hourLabel: string, net: number | null | undefined): number | null {
  const key = hourKey24(hourLabel);
  return visibleGross(showGross, key ? periods?.hourly?.[key] : null, net);
}

/** Hover-pill gross for one day bar. */
export function grossForDay(showGross: boolean, periods: GrossPeriods | null | undefined, date: string | null | undefined, net: number | null | undefined): number | null {
  return visibleGross(showGross, date ? periods?.days?.[date] : null, net);
}

/** Read the saved toggle from profiles.ui_prefs; default OFF (net only). */
export function readShowGrossPref(uiPrefs: unknown): boolean | null {
  if (!uiPrefs || typeof uiPrefs !== 'object') return null;
  const v = (uiPrefs as Record<string, unknown>)[SHOW_GROSS_PREF_KEY];
  return typeof v === 'boolean' ? v : null;
}

export function localShowGrossKey(userId: string | null | undefined): string {
  return `croo_${SHOW_GROSS_PREF_KEY}_${userId || 'anon'}`;
}

export function readLocalShowGross(storage: Pick<Storage, 'getItem'> | null | undefined, userId: string | null | undefined): boolean {
  try {
    return storage?.getItem(localShowGrossKey(userId)) === '1';
  } catch {
    return false;
  }
}
