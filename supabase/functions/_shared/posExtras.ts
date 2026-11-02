export const POS_EXTRA_COLUMNS = ['discount_amount', 'comp_amount', 'comp_count', 'void_amount', 'void_count', 'promo_amount', 'promo_count', 'check_count', 'tips_amount'] as const;
export type PosExtras = Partial<Record<typeof POS_EXTRA_COLUMNS[number], number | null>>;

export function knownNumber(value: unknown): number | null {
  if (value == null || value === '' || (typeof value !== 'number' && typeof value !== 'string')) return null;
  const text = String(value).trim();
  if (!text) return null;
  const n = Number(text.replace(/[$,%\s,]/g, '').replace(/^\((.+)\)$/, '-$1'));
  return Number.isFinite(n) ? n : null;
}

// Omitted/NULL fields do not participate in the write. A measured zero cannot erase a real value.
export function posExtrasPatch(incoming: PosExtras, existing: Record<string, unknown> = {}): PosExtras {
  const patch: PosExtras = {};
  for (const key of POS_EXTRA_COLUMNS) {
    const value = knownNumber(incoming[key]);
    const previous = knownNumber(existing[key]);
    if (value != null && !(value === 0 && previous != null && previous !== 0)) patch[key] = value;
  }
  return patch;
}

export function quHourlyExtras(hours: Array<{ checksCount: number; discountAmount?: number | null }>): PosExtras {
  if (!hours.length) return {};
  return {
    check_count: hours.reduce((sum, h) => sum + h.checksCount, 0),
    ...(hours.every(h => h.discountAmount != null) ? { discount_amount: hours.reduce((sum, h) => sum + (h.discountAmount ?? 0), 0) } : {}),
  };
}

export function hasHourlyAndGuests(row: { hourly_data?: unknown; guest_count?: unknown; net_sales?: unknown } | null): boolean {
  return !!row && Array.isArray(row.hourly_data) && row.hourly_data.length > 0 && Number(row.guest_count) > 0;
}

export function isPortalAccessError(error: unknown): boolean {
  return /login|locked|lockout|credentials|captcha|session|unauthori[sz]ed|HTTP (401|403)/i.test(error instanceof Error ? error.message : String(error));
}