import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Pause } from 'lucide-react';
import { MetricType, METRIC_CONFIGS, SalesDataForWidgets } from './DashboardWidget';
import { format, subYears, getWeek } from 'date-fns';
import { ThemeColorKey, migrateAccentColor, getThemeColorClass, getThemeTextClass, isThemeColorKey } from '@/utils/themeColors';

// Pacing display mode: 'arrow' (current icons), 'text-color' (colored text), or 'background-arrow' (large faint arrow behind)
export type PacingDisplayMode = 'arrow' | 'text-color' | 'background-arrow';

interface CubeFace {
  metrics: MetricType[];
  title?: string;
}

interface DataCube3DProps {
  title?: string; // Legacy single title for all faces
  faces: CubeFace[];
  accentColor?: string;
  autoRotateInterval?: number;
  className?: string;
  salesData?: SalesDataForWidgets | null;
  isLoading?: boolean;
  pacingDisplay?: PacingDisplayMode;
  useDemoData?: boolean; // Temporarily show demo data for testing
}

function formatValue(value: number | undefined, format: 'currency' | 'percent' | 'percent_signed' | 'number' | 'hours' | 'minutes'): string {
  if (value === undefined || value === null) return '--';
  
  switch (format) {
    case 'currency':
      return `$${Math.round(value).toLocaleString()}`;
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'percent_signed': {
      const arrow = value >= 0 ? '▲' : '▼';
      return `${arrow} ${Math.abs(value).toFixed(1)}%`;
    }
    case 'hours':
      return `${Math.round(value)}h`;
    case 'minutes':
      return `${value.toFixed(1)}m`;
    case 'number':
    default:
      return Math.round(value).toLocaleString();
  }
}

// Category prefix removed - labels now come directly from METRIC_CONFIGS

// Generate dynamic labels for metrics with actual date references
// Handles: SDLY + date, SWLY + Wk#, Month + Pace
function getDynamicLabel(metricType: MetricType, manualPrefix?: string): string {
  const config = METRIC_CONFIGS[metricType];
  if (!config) return '';
  
  const now = new Date();
  const lastYear = subYears(now, 1);
  
  let baseLabel: string;
  switch (metricType) {
    case 'sales_last_year_day':
      // SDLY + numerical date with slash (e.g., "SDLY 1/10")
      baseLabel = `SDLY ${format(lastYear, 'M/d')}`;
      break;
    case 'sales_last_year_week':
      // SWLY + Wk# (e.g., "SWLY Wk2")
      baseLabel = `SWLY Wk${getWeek(lastYear)}`;
      break;
    case 'sales_pace_month':
      // 3 letter month name + Pace (e.g., "Jan Pace")
      baseLabel = `${format(now, 'MMM')} Pace`;
      break;
    default:
      baseLabel = config.shortLabel;
  }
  
  // Only use manual prefix if explicitly provided (no auto-prefix from category)
  if (manualPrefix) {
    const prefixLower = manualPrefix.toLowerCase();
    const labelLower = baseLabel.toLowerCase();
    if (!labelLower.includes(prefixLower)) {
      return `${manualPrefix} ${baseLabel}`;
    }
  }
  
  return baseLabel;
}

// Check if metric is a pace metric (only these show background triangles)
function isPaceMetric(metricType: MetricType): boolean {
  return metricType === 'sales_pace' || metricType === 'sales_pace_week' || metricType === 'sales_pace_month';
}

// Get pacing status indicator for a metric (compares pace to goal)
// Returns: 'up' if pace > goal, 'down' if pace < goal, null if not applicable
function getPacingStatus(metricType: MetricType, salesData?: SalesDataForWidgets | null): 'up' | 'down' | null {
  if (!salesData) return null;
  
  const config = METRIC_CONFIGS[metricType];
  if (!config) return null;
  
  // Only show for sales metrics (not labor, guests, etc.)
  if (!metricType.startsWith('sales_')) return null;
  
  // Get pace and goal based on category
  let pace: number | undefined;
  let goal: number | undefined;
  
  switch (config.category) {
    case 'daily':
      pace = salesData.projections?.todayPaceAdjusted;
      goal = salesData.projections?.todayProjected;
      break;
    case 'weekly':
      pace = salesData.projections?.weekPaceAdjusted ?? salesData.projections?.weekProjected;
      goal = salesData.projections?.weekProjected;
      break;
    case 'monthly':
      pace = salesData.projections?.monthPaceAdjusted ?? salesData.projections?.monthProjected;
      goal = salesData.projections?.monthProjected;
      break;
    default:
      return null;
  }
  
  if (pace === undefined || goal === undefined || goal === 0) return null;
  
  // Only show if there's a meaningful difference (more than 1%)
  const percentDiff = ((pace - goal) / goal) * 100;
  if (Math.abs(percentDiff) < 1) return null;
  
  return pace >= goal ? 'up' : 'down';
}

function getPaymentsForPeriod(
  salesData: SalesDataForWidgets,
  period: 'daily' | 'weekly' | 'monthly'
): Array<{ paymentType: string; amount: number }> | undefined {
  const paymentsAny = (salesData as any).payments;
  if (!paymentsAny) return undefined;
  if (Array.isArray(paymentsAny)) return paymentsAny;
  if (typeof paymentsAny === 'object') return paymentsAny?.[period] ?? undefined;
  return undefined;
}

function getPaymentAmount(
  payments: Array<{ paymentType: string; amount: number }> | undefined,
  typePatterns: string[]
): number | undefined {
  if (!payments || payments.length === 0) return undefined;
  for (const pattern of typePatterns) {
    const found = payments.find((p) => p.paymentType.toLowerCase().includes(pattern.toLowerCase()));
    if (found) return found.amount;
  }
  return undefined;
}

function getPaymentPercent(
  payments: Array<{ paymentType: string; amount: number }> | undefined,
  typePatterns: string[]
): number | undefined {
  if (!payments || payments.length === 0) return undefined;
  const amount = getPaymentAmount(payments, typePatterns);
  if (amount === undefined) return undefined;
  const total = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  if (total === 0) return 0;
  return (amount / total) * 100;
}

function getMetricValue(metricType: MetricType, salesData?: SalesDataForWidgets | null): number | undefined {
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
    case 'kds_ticket_time': return salesData.kdsData?.ticketTimeToday;
    case 'kds_ticket_time_wtd': return salesData.kdsData?.ticketTimeWtd;
    case 'kds_order_count': return salesData.kdsData?.orderCount;
    case 'kds_late_pct': return salesData.kdsData?.latePct;
    case 'kds_ontime_count': return salesData.kdsData?.onTimeCount;
    case 'kds_caution_count': return salesData.kdsData?.cautionCount;
    case 'kds_late_count': return salesData.kdsData?.lateCount;
    case 'guest_count_today': return salesData.guestCount?.daily;
    case 'pizza_count_today': return typeof salesData.pizzaCount === 'number' ? salesData.pizzaCount : salesData.pizzaCount?.daily;
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
    case 'pizza_count_wtd': return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.weekly : undefined;
    case 'labor_percent_wtd': return salesData.weeklyLabor?.laborPercent;
    case 'labor_cost_wtd': return salesData.weeklyLabor?.laborCost;
    case 'labor_hours_wtd': return salesData.weeklyLabor?.hoursWorked;
    case 'sales_mtd': return salesData.monthly;
    case 'sales_pace_month': return salesData.projections?.monthPaceAdjusted ?? salesData.projections?.monthProjected;
    case 'sales_projected_month': return salesData.projections?.monthProjected;
    case 'sales_prev_month': return salesData.comparison?.prevMonthFullMonth ?? salesData.comparison?.prevMonth;
    case 'sales_last_year_month': return salesData.lastYear?.sameMonth;
    case 'guest_count_mtd': return salesData.guestCount?.monthly;
    case 'pizza_count_mtd': return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.monthly : undefined;
    case 'labor_percent_mtd': return salesData.monthlyLabor?.laborPercent;
    case 'labor_cost_mtd': return salesData.monthlyLabor?.laborCost;
    case 'labor_hours_mtd': return salesData.monthlyLabor?.hoursWorked;
    case 'personal_hours_week': return salesData.personalData?.hoursWeek;
    case 'personal_hours_payroll': return salesData.personalData?.hoursPayroll;
    case 'personal_pay_week': return salesData.personalData?.payWeek;
    case 'personal_pay_payroll': return salesData.personalData?.payPayroll;
    // Payment metrics
    case 'payment_cash_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['cash']);
    case 'payment_credit_card_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo visa']);
    case 'payment_olo_mastercard_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['svs gift card', 'svs giftcard']);
    // Combined OLO (sum of Visa, MC, Prepaid, GC)
    case 'payment_olo_combined_today': {
      const payments = getPaymentsForPeriod(salesData, 'daily');
      if (!payments) return undefined;
      const visa = getPaymentAmount(payments, ['olo visa']) ?? 0;
      const mc = getPaymentAmount(payments, ['olo mastercard', 'olo mc']) ?? 0;
      const prepaid = getPaymentAmount(payments, ['olo prepaid', 'prepaid']) ?? 0;
      const gc = getPaymentAmount(payments, ['olo gift card', 'olo giftcard']) ?? 0;
      const total = visa + mc + prepaid + gc;
      return total > 0 ? total : undefined;
    }
    case 'payment_cash_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['cash']);
    case 'payment_credit_card_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo visa']);
    case 'payment_olo_mastercard_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['svs gift card', 'svs giftcard']);
    // Combined OLO percent
    case 'payment_olo_combined_today_pct': {
      const payments = getPaymentsForPeriod(salesData, 'daily');
      if (!payments) return undefined;
      const visa = getPaymentPercent(payments, ['olo visa']) ?? 0;
      const mc = getPaymentPercent(payments, ['olo mastercard', 'olo mc']) ?? 0;
      const prepaid = getPaymentPercent(payments, ['olo prepaid', 'prepaid']) ?? 0;
      const gc = getPaymentPercent(payments, ['olo gift card', 'olo giftcard']) ?? 0;
      const total = visa + mc + prepaid + gc;
      return total > 0 ? total : undefined;
    }
    case 'payment_cash_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['cash']);
    case 'payment_credit_card_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo visa']);
    case 'payment_olo_mastercard_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['svs gift card', 'svs giftcard']);
    case 'payment_cash_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['cash']);
    case 'payment_credit_card_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo visa']);
    case 'payment_olo_mastercard_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['svs gift card', 'svs giftcard']);
    case 'payment_cash_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['cash']);
    case 'payment_credit_card_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo visa']);
    case 'payment_olo_mastercard_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['svs gift card', 'svs giftcard']);
    case 'payment_cash_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['cash']);
    case 'payment_credit_card_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo visa']);
    case 'payment_olo_mastercard_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['svs gift card', 'svs giftcard']);
    // Pace vs Last Year variance (computed %)
    case 'pace_vs_ly_day': {
      const pace = salesData.projections?.todayPaceAdjusted;
      const ly = salesData.lastYear?.sameDay;
      if (pace != null && ly != null && ly > 0) return ((pace - ly) / ly) * 100;
      return undefined;
    }
    case 'pace_vs_ly_week': {
      const pace = salesData.projections?.weekPaceAdjusted ?? salesData.projections?.weekProjected;
      const ly = salesData.lastYear?.sameWeek;
      if (pace != null && ly != null && ly > 0) return ((pace - ly) / ly) * 100;
      return undefined;
    }
    case 'pace_vs_ly_month': {
      const pace = salesData.projections?.monthPaceAdjusted ?? salesData.projections?.monthProjected;
      const ly = salesData.lastYear?.sameMonth;
      if (pace != null && ly != null && ly > 0) return ((pace - ly) / ly) * 100;
      return undefined;
    }
    default: return undefined;
  }
}

export function DataCube3D({
  title,
  faces,
  accentColor = 'primary',
  autoRotateInterval = 8000,
  className,
  salesData,
  isLoading = false,
  pacingDisplay = 'background-arrow', // Default to option 2 for demo
  useDemoData = false,
}: DataCube3DProps) {
  const [currentFace, setCurrentFace] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [cubeDepth, setCubeDepth] = useState(60);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  
  // Demo data for testing when no real data is available
  const demoSalesData: SalesDataForWidgets = {
    daily: 4825, weekly: 28450, monthly: 112380, avgTicket: 18.50,
    guestCount: { daily: 261, weekly: 1538, monthly: 6075 },
    pizzaCount: { daily: 142, weekly: 836, monthly: 3305 },
    labor: { laborCost: 892, laborPercent: 18.5, hoursWorked: 48.5 },
    weeklyLabor: { laborCost: 5245, laborPercent: 18.4, hoursWorked: 285 },
    monthlyLabor: { laborCost: 20870, laborPercent: 18.6, hoursWorked: 1135 },
    projections: { todayPaceAdjusted: 5120, todayProjected: 4950, weekPaceAdjusted: 31200, weekProjected: 30500, monthPaceAdjusted: 125000, monthProjected: 122000 },
    comparison: { prevDay: 4680, prevDayFullDay: 4680, prevWeek: 27890, prevWeekFullWeek: 27890, prevMonth: 108500, prevMonthFullMonth: 108500 },
    lastYear: { sameDay: 4520, sameWeek: 26800, sameMonth: 105200 },
    payments: {
      daily: [{ paymentType: 'Cash', amount: 965 }, { paymentType: 'Credit Card', amount: 2895 }, { paymentType: 'DoorDash', amount: 482 }, { paymentType: 'UberEats', amount: 289 }, { paymentType: 'OLO Visa', amount: 145 }, { paymentType: 'OLO Mastercard', amount: 49 }],
      weekly: [{ paymentType: 'Cash', amount: 5690 }, { paymentType: 'Credit Card', amount: 17070 }, { paymentType: 'DoorDash', amount: 2845 }, { paymentType: 'UberEats', amount: 1704 }],
      monthly: [{ paymentType: 'Cash', amount: 22476 }, { paymentType: 'Credit Card', amount: 67428 }, { paymentType: 'DoorDash', amount: 11238 }, { paymentType: 'UberEats', amount: 6734 }],
    },
  };
  
  const effectiveSalesData = useDemoData ? demoSalesData : salesData;
  const totalFaces = Math.min(faces.length, 4);
  
  const themeColorKey: ThemeColorKey = isThemeColorKey(accentColor) 
    ? accentColor 
    : migrateAccentColor(accentColor);
  
  // Calculate cube depth based on container width
  useEffect(() => {
    const updateDepth = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        setCubeDepth(width / 2);
      }
    };
    updateDepth();
    window.addEventListener('resize', updateDepth);
    return () => window.removeEventListener('resize', updateDepth);
  }, []);
  
  const rotateTo = useCallback((faceIndex: number) => {
    if (isAnimating || faceIndex === currentFace) return;
    setIsAnimating(true);
    setCurrentFace(faceIndex);
    setTimeout(() => setIsAnimating(false), 800);
  }, [isAnimating, currentFace]);
  
  const rotateNext = useCallback(() => {
    const nextFace = (currentFace + 1) % totalFaces;
    rotateTo(nextFace);
  }, [currentFace, totalFaces, rotateTo]);
  
  // Auto-rotate (respects frozen state)
  useEffect(() => {
    if (totalFaces <= 1 || isFrozen) return;
    
    const interval = setInterval(() => {
      rotateNext();
    }, autoRotateInterval);
    
    return () => clearInterval(interval);
  }, [rotateNext, autoRotateInterval, totalFaces, isFrozen]);
  
  // Long-press handlers for freeze toggle
  const handlePointerDown = useCallback(() => {
    isLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      setIsFrozen(prev => !prev);
    }, 500);
  }, []);
  
  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    // If it wasn't a long press, treat as normal tap
    if (!isLongPressRef.current && totalFaces > 1) {
      rotateNext();
      // Resume auto-rotate on tap
      if (isFrozen) {
        setIsFrozen(false);
      }
    }
  }, [totalFaces, rotateNext, isFrozen]);
  
  const handlePointerCancel = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  // Calculate 3D rotation based on current face
  const getRotationY = () => {
    return currentFace * -90;
  };

  return (
    <div className={cn("relative group h-full", className)}>
      {/* 3D Cube Container - fills parent, uses perspective */}
      <div 
        ref={containerRef}
        className="relative w-full h-full cursor-pointer overflow-visible select-none"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          perspective: `${cubeDepth * 4}px`,
          perspectiveOrigin: 'center center',
          touchAction: 'manipulation',
        }}
      >
        {/* The actual 3D rotating cube */}
        <div
          className="relative w-full h-full transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{
            transformStyle: 'preserve-3d',
            transform: `translateZ(-${cubeDepth}px) rotateY(${getRotationY()}deg)`,
          }}
        >
          {/* Render all 4 faces of the cube */}
          {[0, 1, 2, 3].map((faceIndex) => {
            const face = faces[faceIndex % faces.length];
            const rotateY = faceIndex * 90;
            const faceTitle = face?.title;
            
            return (
              <CubeFaceComponent
                key={faceIndex}
                face={face}
                themeColorKey={themeColorKey}
                salesData={effectiveSalesData}
                isLoading={isLoading}
                totalFaces={totalFaces}
                currentFace={currentFace}
                faceIndex={faceIndex}
                onIndicatorClick={rotateTo}
                title={faceTitle}
                rotateY={rotateY}
                cubeDepth={cubeDepth}
                pacingDisplay={pacingDisplay}
              />
            );
          })}
        </div>
      </div>
      
      {/* Subtle pause icon - bottom right, low opacity teal */}
      {isFrozen && totalFaces > 1 && (
        <div className="absolute bottom-1.5 right-1.5 pointer-events-none z-10">
          <Pause className="h-3 w-3 text-teal-400/40" fill="currentColor" />
        </div>
      )}
    </div>
  );
}

// Pacing indicator component (for 'arrow' mode)
function PacingIndicator({ status, isLightBg, mode }: { status: 'up' | 'down' | null; isLightBg: boolean; mode: PacingDisplayMode }) {
  if (!status || mode !== 'arrow') return null;
  
  return status === 'up' ? (
    <TrendingUp className={cn("h-3 w-3 flex-shrink-0", isLightBg ? "text-green-600" : "text-green-400")} />
  ) : (
    <TrendingDown className={cn("h-3 w-3 flex-shrink-0", isLightBg ? "text-red-600" : "text-red-400")} />
  );
}

// Small triangle indicator below label for pace metrics only
function PaceTriangleIndicator({ status, isLightBg }: { status: 'up' | 'down' | null; isLightBg: boolean }) {
  if (!status) return null;
  
  // Green for up, red for down - more visible than before
  const colorClass = status === 'up' 
    ? (isLightBg ? "text-green-600" : "text-green-400")
    : (isLightBg ? "text-red-600" : "text-red-400");
  
  return (
    <svg 
      viewBox="0 0 24 24" 
      className={cn(
        "w-3 h-3 md:w-4 md:h-4 fill-current mx-auto mt-0.5",
        colorClass
      )}
    >
      {status === 'up' ? (
        <polygon points="12,4 22,20 2,20" />
      ) : (
        <polygon points="12,20 22,4 2,4" />
      )}
    </svg>
  );
}

// Get text color class based on pacing status for 'text-color' mode
function getPacingTextColor(status: 'up' | 'down' | null, isLightBg: boolean, mode: PacingDisplayMode): string {
  if (!status || mode !== 'text-color') return '';
  
  if (status === 'up') {
    return isLightBg ? 'text-green-600' : 'text-green-400';
  } else {
    return isLightBg ? 'text-red-600' : 'text-red-400';
  }
}

interface CubeFaceComponentProps {
  face?: CubeFace;
  themeColorKey: ThemeColorKey;
  salesData?: SalesDataForWidgets | null;
  isLoading?: boolean;
  totalFaces: number;
  currentFace: number;
  faceIndex: number;
  onIndicatorClick: (index: number) => void;
  title?: string;
  rotateY: number;
  cubeDepth: number;
  pacingDisplay: PacingDisplayMode;
}

function CubeFaceComponent({ 
  face, 
  themeColorKey, 
  salesData, 
  isLoading, 
  totalFaces,
  currentFace,
  faceIndex,
  onIndicatorClick,
  title,
  rotateY,
  cubeDepth,
  pacingDisplay,
}: CubeFaceComponentProps) {
  // Use theme color classes for solid background with white text
  const bgClass = getThemeColorClass(themeColorKey);
  const textClass = getThemeTextClass(themeColorKey);
  const isLightBg = themeColorKey === 'secondary' || themeColorKey === 'muted';
  
  // Allow up to 5 metrics per face (4 corners + 1 center)
  const displayMetrics = face?.metrics?.slice(0, 5) || [];
  const metricCount = displayMetrics.length;
  const hasCenterMetric = metricCount === 5;
  const cornerMetrics = hasCenterMetric ? displayMetrics.slice(0, 4) : displayMetrics;
  const centerMetric = hasCenterMetric ? displayMetrics[4] : null;
  

  if (!face || displayMetrics.length === 0) {
    return (
      <div
        className={cn(
          "absolute inset-0 rounded-[8px] shadow-lg flex items-center justify-center backface-hidden",
          bgClass
        )}
        style={{
          transform: `rotateY(${rotateY}deg) translateZ(${cubeDepth}px)`,
          backfaceVisibility: 'hidden',
        }}
      >
        <span className={cn("text-xs", isLightBg ? "text-muted-foreground" : "text-white/75")}>No metrics</span>
      </div>
    );
  }
  
  return (
    <div
      className={cn(
        "absolute inset-0 rounded-[8px] overflow-hidden flex flex-col",
        bgClass
      )}
      style={{
        transform: `rotateY(${rotateY}deg) translateZ(${cubeDepth}px)`,
        backfaceVisibility: 'hidden',
        // Flat neumorphic shadow - no gradients
        boxShadow: `
          6px 6px 14px rgba(0,0,0,0.12),
          -3px -3px 10px rgba(255,255,255,0.08),
          inset 0 1px 0 rgba(255,255,255,0.1)
        `,
      }}
    >
      {/* Removed gradient overlay - flat solid color now */}
      
      {/* Title */}
      {title && (
        <div 
          className={cn(
            "text-sm md:text-base font-bold px-2.5 md:px-3 pt-2 md:pt-2.5 truncate uppercase tracking-wide relative z-10",
            isLightBg ? "text-foreground" : "text-white"
          )}
        >
          {title}
        </div>
      )}
      
      {/* Content - positioned layout for metrics */}
      <div className={cn(
        "flex-1 relative z-10",
        (metricCount === 4 || metricCount === 5) ? "p-2 md:p-3" : "px-2.5 md:px-3 py-1"
      )}>
        {(metricCount === 4 || metricCount === 5) ? (
          // 4 or 5 metrics: 2x2 grid layout with optional center metric
          <div className="relative h-full">
            {/* Quadrant glow dividers - fade towards center when 5th metric exists */}
            <div 
              className="absolute left-1/2 top-2 bottom-2 w-px pointer-events-none"
              style={{
                background: hasCenterMetric 
                  ? 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.2) 15%, rgba(255,255,255,0.2) 25%, transparent 40%, transparent 60%, rgba(255,255,255,0.2) 75%, rgba(255,255,255,0.2) 85%, transparent 100%)'
                  : 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.2) 20%, rgba(255,255,255,0.2) 80%, transparent 100%)',
                boxShadow: '0 0 8px rgba(255,255,255,0.15)',
              }}
            />
            <div 
              className="absolute top-1/2 left-2 right-2 h-px pointer-events-none"
              style={{
                background: hasCenterMetric
                  ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 15%, rgba(255,255,255,0.2) 25%, transparent 40%, transparent 60%, rgba(255,255,255,0.2) 75%, rgba(255,255,255,0.2) 85%, transparent 100%)'
                  : 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 20%, rgba(255,255,255,0.2) 80%, transparent 100%)',
                boxShadow: '0 0 8px rgba(255,255,255,0.15)',
              }}
            />
            
            <div className="grid grid-cols-2 grid-rows-2 h-full gap-1">
              {cornerMetrics.map((metricType, index) => {
                const config = METRIC_CONFIGS[metricType];
                if (!config) return null;
                
                const value = getMetricValue(metricType, salesData);
                const formattedValue = formatValue(value, config.format);
                const pacingStatus = getPacingStatus(metricType, salesData);
                
                // Align: 0=left, 1=right, 2=left, 3=right
                const isRight = index % 2 === 1;
                const textColorClass = getPacingTextColor(pacingStatus, isLightBg, pacingDisplay);
                
                return (
                    <div key={index} className={cn("flex flex-col justify-center min-w-0", isRight && "items-end text-right")}>
                      <div className={cn("flex items-center gap-1", isRight && "flex-row-reverse")}>
                        <div 
                          className={cn(
                            "font-bold leading-none truncate text-base md:text-lg",
                            isLoading && "animate-pulse bg-white/30 rounded w-12 h-5",
                            textColorClass || (isLightBg ? "text-foreground" : "text-white")
                          )}
                        >
                          {!isLoading && formattedValue}
                        </div>
                        {!isLoading && <PacingIndicator status={pacingStatus} isLightBg={isLightBg} mode={pacingDisplay} />}
                      </div>
                      <div 
                        className={cn(
                          "flex items-center gap-1 text-[10px] md:text-xs font-semibold truncate -mt-0.5",
                          isRight && "flex-row-reverse",
                          isLightBg ? "text-muted-foreground" : "text-white/70"
                        )}
                      >
                        {getDynamicLabel(metricType)}
                        {pacingDisplay === 'background-arrow' && !isLoading && isPaceMetric(metricType) && (
                          <PaceTriangleIndicator status={pacingStatus} isLightBg={isLightBg} />
                        )}
                      </div>
                    </div>
                );
              })}
            </div>
            
            {/* Center metric (5th metric) */}
            {centerMetric && (() => {
              const config = METRIC_CONFIGS[centerMetric];
              if (!config) return null;
              
              const value = getMetricValue(centerMetric, salesData);
              const formattedValue = formatValue(value, config.format);
              const pacingStatus = getPacingStatus(centerMetric, salesData);
              const textColorClass = getPacingTextColor(pacingStatus, isLightBg, pacingDisplay);
              
              return (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div 
                    className={cn(
                      "flex flex-col items-center text-center px-2 py-1 rounded-lg",
                      isLightBg ? "bg-black/10" : "bg-black/10"
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <div 
                        className={cn(
                          "font-bold leading-none truncate text-sm md:text-base",
                          isLoading && "animate-pulse bg-white/30 rounded w-10 h-4",
                          textColorClass || (isLightBg ? "text-foreground" : "text-white")
                        )}
                      >
                        {!isLoading && formattedValue}
                      </div>
                      {!isLoading && <PacingIndicator status={pacingStatus} isLightBg={isLightBg} mode={pacingDisplay} />}
                    </div>
                    <div 
                      className={cn(
                        "flex items-center gap-1 text-[9px] md:text-[10px] font-semibold truncate -mt-0.5",
                        isLightBg ? "text-muted-foreground" : "text-white/70"
                      )}
                    >
                      {getDynamicLabel(centerMetric)}
                      {pacingDisplay === 'background-arrow' && !isLoading && isPaceMetric(centerMetric) && (
                        <PaceTriangleIndicator status={pacingStatus} isLightBg={isLightBg} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : metricCount === 3 ? (
          // 3 metrics: top-left, top-right, bottom row layout with dividers
          <div className="relative h-full">
            {/* Vertical divider for top row */}
            <div 
              className="absolute left-1/2 top-2 h-[45%] w-px pointer-events-none"
              style={{
                background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.2) 20%, rgba(255,255,255,0.2) 80%, transparent 100%)',
                boxShadow: '0 0 8px rgba(255,255,255,0.15)',
              }}
            />
            {/* Horizontal divider between top and bottom */}
            <div 
              className="absolute top-1/2 left-2 right-2 h-px pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 20%, rgba(255,255,255,0.2) 80%, transparent 100%)',
                boxShadow: '0 0 8px rgba(255,255,255,0.15)',
              }}
            />
            
            <div className="h-full flex flex-col">
              {/* Top row: 2 items */}
              <div className="flex-1 grid grid-cols-2 gap-1">
                {displayMetrics.slice(0, 2).map((metricType, index) => {
                  const config = METRIC_CONFIGS[metricType];
                  if (!config) return null;
                  
                  const value = getMetricValue(metricType, salesData);
                  const formattedValue = formatValue(value, config.format);
                  const pacingStatus = getPacingStatus(metricType, salesData);
                  const isRight = index === 1;
                  const textColorClass = getPacingTextColor(pacingStatus, isLightBg, pacingDisplay);
                  
                  return (
                    <div key={index} className={cn("flex flex-col justify-center min-w-0", isRight && "items-end text-right")}>
                      <div className={cn("flex items-center gap-1", isRight && "flex-row-reverse")}>
                      <div 
                        className={cn(
                          "font-bold leading-none truncate text-base md:text-lg",
                          isLoading && "animate-pulse bg-white/30 rounded w-12 h-5",
                          textColorClass || (isLightBg ? "text-foreground" : "text-white")
                          )}
                        >
                          {!isLoading && formattedValue}
                        </div>
                        {!isLoading && <PacingIndicator status={pacingStatus} isLightBg={isLightBg} mode={pacingDisplay} />}
                      </div>
                      <div 
                        className={cn(
                          "flex items-center gap-1 text-[10px] md:text-xs font-semibold truncate -mt-0.5",
                          isRight && "flex-row-reverse",
                          isLightBg ? "text-muted-foreground" : "text-white/70"
                        )}
                      >
                        {getDynamicLabel(metricType)}
                        {pacingDisplay === 'background-arrow' && !isLoading && isPaceMetric(metricType) && (
                          <PaceTriangleIndicator status={pacingStatus} isLightBg={isLightBg} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Bottom row: 1 item centered */}
              <div className="flex-1 flex items-center justify-center">
                {displayMetrics.slice(2, 3).map((metricType, index) => {
                  const config = METRIC_CONFIGS[metricType];
                  if (!config) return null;
                  
                  const value = getMetricValue(metricType, salesData);
                  const formattedValue = formatValue(value, config.format);
                  const pacingStatus = getPacingStatus(metricType, salesData);
                  const textColorClass = getPacingTextColor(pacingStatus, isLightBg, pacingDisplay);
                  
                  return (
                    <div key={index} className="flex flex-col items-center text-center min-w-0">
                      <div className="flex items-center gap-1">
                        <div 
                          className={cn(
                            "font-bold leading-none truncate text-base md:text-lg",
                            isLoading && "animate-pulse bg-white/30 rounded w-12 h-5",
                            textColorClass || (isLightBg ? "text-foreground" : "text-white")
                          )}
                        >
                          {!isLoading && formattedValue}
                        </div>
                        {!isLoading && <PacingIndicator status={pacingStatus} isLightBg={isLightBg} mode={pacingDisplay} />}
                      </div>
                      <div 
                        className={cn(
                          "flex items-center justify-center gap-1 text-[10px] md:text-xs font-semibold truncate -mt-0.5",
                          isLightBg ? "text-muted-foreground" : "text-white/70"
                        )}
                      >
                        {getDynamicLabel(metricType)}
                        {pacingDisplay === 'background-arrow' && !isLoading && isPaceMetric(metricType) && (
                          <PaceTriangleIndicator status={pacingStatus} isLightBg={isLightBg} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : metricCount === 2 ? (
          // 2 metrics: left/right split with vertical divider
          <div className="relative h-full">
            {/* Vertical divider */}
            <div 
              className="absolute left-1/2 top-2 bottom-2 w-px pointer-events-none"
              style={{
                background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.2) 20%, rgba(255,255,255,0.2) 80%, transparent 100%)',
                boxShadow: '0 0 8px rgba(255,255,255,0.15)',
              }}
            />
            
            <div className="grid grid-cols-2 h-full gap-1">
              {displayMetrics.map((metricType, index) => {
                const config = METRIC_CONFIGS[metricType];
                if (!config) return null;
                
                const value = getMetricValue(metricType, salesData);
                const formattedValue = formatValue(value, config.format);
                const pacingStatus = getPacingStatus(metricType, salesData);
                const isRight = index === 1;
                const textColorClass = getPacingTextColor(pacingStatus, isLightBg, pacingDisplay);
                
                return (
                  <div key={index} className={cn("flex flex-col justify-center min-w-0", isRight && "items-end text-right")}>
                    <div className={cn("flex items-center gap-1", isRight && "flex-row-reverse")}>
                      <div 
                        className={cn(
                          "font-bold leading-none truncate text-base md:text-lg",
                          isLoading && "animate-pulse bg-white/30 rounded w-12 h-5",
                          textColorClass || (isLightBg ? "text-foreground" : "text-white")
                        )}
                      >
                        {!isLoading && formattedValue}
                      </div>
                      {!isLoading && <PacingIndicator status={pacingStatus} isLightBg={isLightBg} mode={pacingDisplay} />}
                    </div>
                    <div 
                      className={cn(
                        "flex items-center gap-1 text-[10px] md:text-xs font-semibold truncate -mt-0.5",
                        isRight && "flex-row-reverse",
                        isLightBg ? "text-muted-foreground" : "text-white/70"
                      )}
                    >
                      {getDynamicLabel(metricType)}
                      {pacingDisplay === 'background-arrow' && !isLoading && isPaceMetric(metricType) && (
                        <PaceTriangleIndicator status={pacingStatus} isLightBg={isLightBg} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          // 1 metric: centered
          <div className="h-full flex items-center justify-center">
            {displayMetrics.map((metricType, index) => {
              const config = METRIC_CONFIGS[metricType];
              if (!config) return null;
              
              const value = getMetricValue(metricType, salesData);
              const formattedValue = formatValue(value, config.format);
              const pacingStatus = getPacingStatus(metricType, salesData);
              const textColorClass = getPacingTextColor(pacingStatus, isLightBg, pacingDisplay);
              
              return (
                <div key={index} className="flex flex-col items-center text-center min-w-0">
                  <div className="flex items-center gap-1">
                    <div 
                      className={cn(
                        "font-bold leading-none truncate text-xl md:text-2xl",
                        isLoading && "animate-pulse bg-white/30 rounded w-16 h-6",
                        textColorClass || (isLightBg ? "text-foreground" : "text-white")
                      )}
                    >
                      {!isLoading && formattedValue}
                    </div>
                    {!isLoading && <PacingIndicator status={pacingStatus} isLightBg={isLightBg} mode={pacingDisplay} />}
                  </div>
                  <div 
                    className={cn(
                      "flex items-center justify-center gap-1 text-xs md:text-sm font-semibold truncate",
                      isLightBg ? "text-muted-foreground" : "text-white/70"
                    )}
                  >
                    {getDynamicLabel(metricType)}
                    {pacingDisplay === 'background-arrow' && !isLoading && isPaceMetric(metricType) && (
                      <PaceTriangleIndicator status={pacingStatus} isLightBg={isLightBg} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* Face Indicator dots */}
      {totalFaces > 1 && (
        <div className="flex justify-center items-center gap-1 pb-1.5 md:pb-2">
          {Array.from({ length: totalFaces }).map((_, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.stopPropagation();
                onIndicatorClick(index);
              }}
              className={cn(
                "w-1 h-1 md:w-1.5 md:h-1.5 rounded-full transition-all duration-300",
                index === currentFace 
                  ? (isLightBg ? "bg-foreground" : "bg-white") 
                  : (isLightBg ? "bg-foreground/30" : "bg-white/40")
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

