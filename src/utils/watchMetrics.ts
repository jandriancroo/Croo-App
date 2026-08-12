import type { MetricType, SalesDataForWidgets } from '@/components/dashboard/DashboardWidget';

/**
 * Read-only mirror of the Data Cube metric resolver used for the Apple Watch
 * snapshot. This never writes anything and never changes cube behaviour on the
 * phone — it only reads the same salesData object the cubes already render.
 */

type PaymentRow = { paymentType: string; amount: number };

function paymentsForPeriod(
  salesData: SalesDataForWidgets,
  period: 'daily' | 'weekly' | 'monthly'
): PaymentRow[] | undefined {
  return salesData.payments?.[period];
}

function matches(row: PaymentRow, patterns: string[]) {
  const t = (row.paymentType || '').toLowerCase();
  return patterns.some(p => t.includes(p));
}

function paymentAmount(rows: PaymentRow[] | undefined, patterns: string[]): number | undefined {
  if (!rows || rows.length === 0) return undefined;
  const total = rows.filter(r => matches(r, patterns)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return total;
}

function paymentPercent(rows: PaymentRow[] | undefined, patterns: string[]): number | undefined {
  if (!rows || rows.length === 0) return undefined;
  const amount = paymentAmount(rows, patterns);
  if (amount === undefined) return undefined;
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  if (!total) return 0;
  return (amount / total) * 100;
}

const PAYMENT_PATTERNS: Record<string, string[]> = {
  cash: ['cash'],
  credit_card: ['credit card', 'creditcard'],
  olo_doordash: ['doordash', 'door dash'],
  olo_ubereats: ['ubereats', 'uber eats'],
  olo_visa: ['olo visa'],
  olo_mastercard: ['olo mastercard', 'olo mc'],
  olo_prepaid: ['olo prepaid', 'prepaid'],
  olo_giftcard: ['olo gift card', 'olo giftcard'],
  svs_giftcard: ['svs gift card', 'svs giftcard'],
};

const OLO_COMBINED = ['olo_visa', 'olo_mastercard', 'olo_prepaid', 'olo_giftcard'];

function resolvePaymentMetric(metric: string, salesData: SalesDataForWidgets): number | undefined {
  const m = /^payment_(.+?)_(today|wtd|mtd)(_pct)?$/.exec(metric);
  if (!m) return undefined;
  const [, key, periodKey, pct] = m;
  const period = periodKey === 'today' ? 'daily' : periodKey === 'wtd' ? 'weekly' : 'monthly';
  const rows = paymentsForPeriod(salesData, period);
  const read = pct ? paymentPercent : paymentAmount;

  if (key === 'olo_combined') {
    const total = OLO_COMBINED.reduce((sum, k) => sum + (read(rows, PAYMENT_PATTERNS[k]) ?? 0), 0);
    return total > 0 ? total : undefined;
  }
  const patterns = PAYMENT_PATTERNS[key];
  if (!patterns) return undefined;
  return read(rows, patterns);
}

export function resolveWatchMetricValue(
  metricType: MetricType,
  salesData?: SalesDataForWidgets | null
): number | undefined {
  if (!salesData) return undefined;

  switch (metricType) {
    case 'sales_today': return salesData.daily;
    case 'sales_pace': {
      const pace = salesData.projections?.todayPaceAdjusted;
      return pace != null ? Math.max(pace, salesData.daily || 0) : undefined;
    }
    case 'sales_projected_today': return salesData.projections?.todayProjected;
    case 'sales_last_week':
    case 'sales_last_year': return salesData.comparison?.prevDayFullDay;
    case 'sales_last_year_day': return salesData.lastYear?.sameDay;
    case 'avg_ticket': return salesData.avgTicket;
    case 'guest_count_today': return salesData.guestCount?.daily;
    case 'pizza_count_today':
      return typeof salesData.pizzaCount === 'number' ? salesData.pizzaCount : salesData.pizzaCount?.daily;
    case 'labor_percent_today':
    case 'labor_percent': return salesData.labor?.laborPercent;
    case 'labor_cost_today':
    case 'labor_cost': return salesData.labor?.laborCost;
    case 'labor_hours_today':
    case 'labor_hours': return salesData.labor?.hoursWorked;

    case 'sales_wtd': return salesData.weekly;
    case 'sales_pace_week': return salesData.projections?.weekPaceAdjusted ?? salesData.projections?.weekProjected;
    case 'sales_projected_week': return salesData.projections?.weekProjected;
    case 'sales_prev_week': return salesData.comparison?.prevWeekFullWeek ?? salesData.comparison?.prevWeek;
    case 'sales_last_year_week': return salesData.lastYear?.sameWeek;
    case 'guest_count_wtd': return salesData.guestCount?.weekly;
    case 'pizza_count_wtd':
      return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.weekly : undefined;
    case 'labor_percent_wtd': return salesData.weeklyLabor?.laborPercent;
    case 'labor_cost_wtd': return salesData.weeklyLabor?.laborCost;
    case 'labor_hours_wtd': return salesData.weeklyLabor?.hoursWorked;

    case 'sales_mtd': return salesData.monthly;
    case 'sales_pace_month': return salesData.projections?.monthPaceAdjusted ?? salesData.projections?.monthProjected;
    case 'sales_projected_month': return salesData.projections?.monthProjected;
    case 'sales_prev_month': return salesData.comparison?.prevMonthFullMonth ?? salesData.comparison?.prevMonth;
    case 'sales_last_year_month': return salesData.lastYear?.sameMonth;
    case 'guest_count_mtd': return salesData.guestCount?.monthly;
    case 'pizza_count_mtd':
      return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.monthly : undefined;
    case 'labor_percent_mtd': return salesData.monthlyLabor?.laborPercent;
    case 'labor_cost_mtd': return salesData.monthlyLabor?.laborCost;
    case 'labor_hours_mtd': return salesData.monthlyLabor?.hoursWorked;

    case 'kds_ticket_time': return salesData.kdsData?.ticketTimeToday;
    case 'kds_ticket_time_wtd': return salesData.kdsData?.ticketTimeWtd;
    case 'kds_order_count': return salesData.kdsData?.orderCount;
    case 'kds_late_pct': return salesData.kdsData?.latePct;
    case 'kds_ontime_count': return salesData.kdsData?.onTimeCount;
    case 'kds_caution_count': return salesData.kdsData?.cautionCount;
    case 'kds_late_count': return salesData.kdsData?.lateCount;

    case 'kiosk_sales_today': return salesData.kioskData?.kioskSales;
    case 'kiosk_check_count_today': return salesData.kioskData?.kioskCheckCount;
    case 'kiosk_avg_check': return salesData.kioskData?.kioskAvgCheck;
    case 'kiosk_avg_check_variance': return salesData.kioskData?.avgCheckVariance;

    case 'personal_hours_week': return salesData.personalData?.hoursWeek;
    case 'personal_hours_payroll': return salesData.personalData?.hoursPayroll;
    case 'personal_pay_week': return salesData.personalData?.payWeek;
    case 'personal_pay_payroll': return salesData.personalData?.payPayroll;

    default:
      return resolvePaymentMetric(metricType as string, salesData);
  }
}

export function formatWatchValue(
  value: number | undefined,
  format: 'currency' | 'currency_signed' | 'percent' | 'percent_signed' | 'number' | 'hours' | 'minutes'
): string {
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
