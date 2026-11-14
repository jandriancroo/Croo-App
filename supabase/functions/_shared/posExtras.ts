export const POS_EXTRA_COLUMNS = ['discount_amount', 'comp_amount', 'comp_count', 'void_amount', 'void_count', 'promo_amount', 'promo_count', 'check_count', 'tips_amount', 'refund_amount'] as const;
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

export function toastRawExtras(raw: unknown): PosExtras {
  if (!raw || typeof raw !== 'object') return {};
  const discounts = (raw as Record<string, unknown>).discounts;
  if (!Array.isArray(discounts)) return {};
  const amounts = discounts.map(row => knownNumber(row?.discountAmount));
  return amounts.every(v => v != null) ? { discount_amount: amounts.reduce<number>((sum, v) => sum + (v ?? 0), 0) } : {};
}
// ── Gross sales (visibility only; net stays primary) ────────────────────────
// gross = net + discounts + comps + promos + refunds; tax and tips excluded.
// A feed's own gross figure is sent with gross_basis 'pos'. Otherwise the DB trigger
// (guard_pos_sales_extras → _sales_gross_rebuild) rebuilds it from that feed's measured pieces.
export type GrossFields = { gross_sales?: number; gross_basis?: 'pos'; discount_amount?: number; refund_amount?: number };

/** Toast official day totals (raw.netSales[0]); never the discounts list, which can overcount. */
export function toastOfficialGross(raw: unknown): GrossFields {
  if (!raw || typeof raw !== 'object') return {};
  const list = (raw as Record<string, unknown>).netSales;
  const row = Array.isArray(list) ? list[0] : null;
  if (!row || typeof row !== 'object') return {};
  const gross = knownNumber((row as Record<string, unknown>).grossSales);
  const discount = knownNumber((row as Record<string, unknown>).discountAmount);
  const refund = knownNumber((row as Record<string, unknown>).refundAmount);
  if (gross == null) return {};
  return {
    gross_sales: gross,
    gross_basis: 'pos',
    ...(discount != null ? { discount_amount: Math.abs(discount) } : {}),
    refund_amount: Math.abs(refund ?? 0),
  };
}

/** Per-hour gross where the feed reports per-hour discounts: net + discount. Missing discount = no gross for that hour. */
export function hourlyGrossFromDiscounts<T extends { hour: string; sales: number; discountAmount?: number | null }>(hours: T[]): Array<T & { gross?: number }> {
  return hours.map(h => (h.discountAmount == null ? { ...h } : { ...h, gross: Math.round((h.sales + Math.abs(h.discountAmount)) * 100) / 100 }));
}

/** Copy per-hour gross onto a 24-hour hourly_data array (by "HH:00"), leaving sales/projections untouched. */
export function mergeHourlyGross(hourly: any[], grossByHour: Map<string, number>): any[] {
  return (hourly || []).map((h: any) => {
    const g = grossByHour.get(String(h?.hour));
    if (g == null) { const { gross: _g, ...rest } = h ?? {}; return rest; }
    return { ...h, gross: g };
  });
}
