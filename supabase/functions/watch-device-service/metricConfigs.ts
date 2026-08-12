// @ts-nocheck
// Mirror of METRIC_CONFIGS labels/formats from the phone dashboard so the watch
// snapshot renders the same short labels. Read-only reference data.
export type MetricFormat =
  | 'currency'
  | 'currency_signed'
  | 'percent'
  | 'percent_signed'
  | 'number'
  | 'hours'
  | 'minutes';

export const METRIC_CONFIGS: Record<string, { label: string; format: MetricFormat }> = {
  sales_today: { label: "Sales", format: "currency" },
  sales_pace: { label: "Pace", format: "currency" },
  sales_projected_today: { label: "AI Goal", format: "currency" },
  sales_last_week: { label: "SDLW", format: "currency" },
  sales_last_year_day: { label: "SDLY", format: "currency" },
  guest_count_today: { label: "Guests", format: "number" },
  pizza_count_today: { label: "Pizzas", format: "number" },
  avg_ticket: { label: "Avg Check", format: "currency" },
  labor_percent_today: { label: "Lab%", format: "percent" },
  labor_cost_today: { label: "Labor$", format: "currency" },
  labor_hours_today: { label: "Lab Hrs", format: "hours" },
  sales_wtd: { label: "WTD", format: "currency" },
  sales_pace_week: { label: "Wkly Pace", format: "currency" },
  sales_projected_week: { label: "EOW Goal", format: "currency" },
  sales_prev_week: { label: "LW", format: "currency" },
  sales_last_year_week: { label: "SWLY", format: "currency" },
  guest_count_wtd: { label: "WTD Guests", format: "number" },
  pizza_count_wtd: { label: "WTD Pizzas", format: "number" },
  labor_percent_wtd: { label: "WTD Lab%", format: "percent" },
  labor_cost_wtd: { label: "Labor$", format: "currency" },
  labor_hours_wtd: { label: "Hrs", format: "hours" },
  sales_mtd: { label: "MTD", format: "currency" },
  sales_pace_month: { label: "Pace", format: "currency" },
  sales_projected_month: { label: "EOM Goal", format: "currency" },
  sales_prev_month: { label: "LM", format: "currency" },
  sales_last_year_month: { label: "SMLY", format: "currency" },
  guest_count_mtd: { label: "MTD Guests", format: "number" },
  pizza_count_mtd: { label: "MTD Pizzas", format: "number" },
  labor_percent_mtd: { label: "MTD Lab%", format: "percent" },
  labor_cost_mtd: { label: "Labor$", format: "currency" },
  labor_hours_mtd: { label: "Hrs", format: "hours" },
  pace_vs_ly_day: { label: "vs SDLY", format: "percent_signed" },
  pace_vs_ly_week: { label: "vs SWLY", format: "percent_signed" },
  pace_vs_ly_month: { label: "vs SMLY", format: "percent_signed" },
  personal_hours_week: { label: "My Hrs", format: "hours" },
  personal_hours_payroll: { label: "Pay Hrs", format: "hours" },
  personal_pay_week: { label: "My Pay", format: "currency" },
  personal_pay_payroll: { label: "Pay $", format: "currency" },
  payment_cash_today: { label: "Cash", format: "currency" },
  payment_credit_card_today: { label: "CC", format: "currency" },
  payment_olo_doordash_today: { label: "DD", format: "currency" },
  payment_olo_ubereats_today: { label: "UE", format: "currency" },
  payment_olo_combined_today: { label: "OLO$", format: "currency" },
  payment_olo_visa_today: { label: "OLO V", format: "currency" },
  payment_olo_mastercard_today: { label: "OLO MC", format: "currency" },
  payment_olo_prepaid_today: { label: "Prepaid", format: "currency" },
  payment_olo_giftcard_today: { label: "OLO GC", format: "currency" },
  payment_svs_giftcard_today: { label: "SVS GC", format: "currency" },
  payment_cash_today_pct: { label: "Cash%", format: "percent" },
  payment_credit_card_today_pct: { label: "CC%", format: "percent" },
  payment_olo_doordash_today_pct: { label: "DD%", format: "percent" },
  payment_olo_ubereats_today_pct: { label: "UE%", format: "percent" },
  payment_olo_combined_today_pct: { label: "OLO%", format: "percent" },
  payment_olo_visa_today_pct: { label: "V%", format: "percent" },
  payment_olo_mastercard_today_pct: { label: "MC%", format: "percent" },
  payment_olo_prepaid_today_pct: { label: "Pre%", format: "percent" },
  payment_olo_giftcard_today_pct: { label: "OGC%", format: "percent" },
  payment_svs_giftcard_today_pct: { label: "SGC%", format: "percent" },
  payment_cash_wtd: { label: "Cash", format: "currency" },
  payment_credit_card_wtd: { label: "CC", format: "currency" },
  payment_olo_doordash_wtd: { label: "DD", format: "currency" },
  payment_olo_ubereats_wtd: { label: "UE", format: "currency" },
  payment_olo_visa_wtd: { label: "OLO V", format: "currency" },
  payment_olo_mastercard_wtd: { label: "OLO MC", format: "currency" },
  payment_olo_prepaid_wtd: { label: "Prepaid", format: "currency" },
  payment_olo_giftcard_wtd: { label: "OLO GC", format: "currency" },
  payment_svs_giftcard_wtd: { label: "SVS GC", format: "currency" },
  payment_cash_wtd_pct: { label: "Cash%", format: "percent" },
  payment_credit_card_wtd_pct: { label: "CC%", format: "percent" },
  payment_olo_doordash_wtd_pct: { label: "DD%", format: "percent" },
  payment_olo_ubereats_wtd_pct: { label: "UE%", format: "percent" },
  payment_olo_visa_wtd_pct: { label: "V%", format: "percent" },
  payment_olo_mastercard_wtd_pct: { label: "MC%", format: "percent" },
  payment_olo_prepaid_wtd_pct: { label: "Pre%", format: "percent" },
  payment_olo_giftcard_wtd_pct: { label: "OGC%", format: "percent" },
  payment_svs_giftcard_wtd_pct: { label: "SGC%", format: "percent" },
  payment_cash_mtd: { label: "Cash", format: "currency" },
  payment_credit_card_mtd: { label: "CC", format: "currency" },
  payment_olo_doordash_mtd: { label: "DD", format: "currency" },
  payment_olo_ubereats_mtd: { label: "UE", format: "currency" },
  payment_olo_visa_mtd: { label: "OLO V", format: "currency" },
  payment_olo_mastercard_mtd: { label: "OLO MC", format: "currency" },
  payment_olo_prepaid_mtd: { label: "Prepaid", format: "currency" },
  payment_olo_giftcard_mtd: { label: "OLO GC", format: "currency" },
  payment_svs_giftcard_mtd: { label: "SVS GC", format: "currency" },
  payment_cash_mtd_pct: { label: "Cash%", format: "percent" },
  payment_credit_card_mtd_pct: { label: "CC%", format: "percent" },
  payment_olo_doordash_mtd_pct: { label: "DD%", format: "percent" },
  payment_olo_ubereats_mtd_pct: { label: "UE%", format: "percent" },
  payment_olo_visa_mtd_pct: { label: "V%", format: "percent" },
  payment_olo_mastercard_mtd_pct: { label: "MC%", format: "percent" },
  payment_olo_prepaid_mtd_pct: { label: "Pre%", format: "percent" },
  payment_olo_giftcard_mtd_pct: { label: "OGC%", format: "percent" },
  payment_svs_giftcard_mtd_pct: { label: "SGC%", format: "percent" },
  kds_ticket_time: { label: "KDS Time", format: "minutes" },
  kds_ticket_time_wtd: { label: "KDS WTD", format: "minutes" },
  kds_order_count: { label: "Orders", format: "number" },
  kds_late_pct: { label: "% Late", format: "percent" },
  kds_ontime_count: { label: "On Time", format: "number" },
  kds_caution_count: { label: "Caution", format: "number" },
  kds_late_count: { label: "Late", format: "number" },
  kiosk_sales_today: { label: "Kiosk $", format: "currency" },
  kiosk_check_count_today: { label: "Kiosk Qty", format: "number" },
  kiosk_avg_check: { label: "Kiosk Avg", format: "currency" },
  kiosk_avg_check_variance: { label: "Kiosk +/-", format: "currency_signed" },
  labor_percent: { label: "Labor%", format: "percent" },
  labor_cost: { label: "Labor$", format: "currency" },
  labor_hours: { label: "Hours", format: "hours" },
  sales_last_year: { label: "Last Wk", format: "currency" },
};

export function formatWatchValue(value: number | undefined | null, format: MetricFormat): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  const signed = format === 'currency_signed' || format === 'percent_signed';
  const sign = signed && value > 0 ? '+' : '';

  switch (format) {
    case 'currency':
    case 'currency_signed': {
      const abs = Math.abs(value);
      const compact = abs >= 10000
        ? `$${(value / 1000).toFixed(1)}k`
        : `$${Math.round(value).toLocaleString('en-US')}`;
      return `${sign}${compact}`;
    }
    case 'percent':
    case 'percent_signed':
      return `${sign}${value.toFixed(1)}%`;
    case 'hours':
      return `${value.toFixed(1)}h`;
    case 'minutes':
      return `${Math.round(value)}m`;
    case 'number':
    default:
      return Math.round(value).toLocaleString('en-US');
  }
}

/** Default theme accent hex values (mirrors useWatchSync THEME_ACCENT_HEX). */
export const THEME_ACCENT_HEX: Record<string, string> = {
  primary: '#2A8399',
  accent: '#EB7D3C',
  destructive: '#F42525',
  secondary: '#B7D4E2',
  muted: '#DFE2E9',
};

export function resolveAccentHex(color?: string | null): string {
  if (!color) return THEME_ACCENT_HEX.primary;
  if (color.startsWith('#')) return color;
  return THEME_ACCENT_HEX[color] || THEME_ACCENT_HEX.primary;
}
