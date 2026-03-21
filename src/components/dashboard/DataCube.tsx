import { Card } from "@/components/ui/card";
import { 
  MetricType, 
  MetricConfig, 
  METRIC_CONFIGS, 
  METRIC_GROUPS,
  SalesDataForWidgets 
} from "./DashboardWidget";
import { useIsOledTheme } from "@/hooks/useIsOledTheme";


// Re-export types for backwards compatibility
export type { MetricType, MetricConfig };
export { METRIC_CONFIGS, METRIC_GROUPS };

// Alias for backwards compatibility
export type SalesDataForCubes = SalesDataForWidgets;

interface DataCubeProps {
  title?: string;
  metrics: MetricType[];
  accentColor?: string;
  salesData: SalesDataForCubes | null;
  isLoading?: boolean;
  onClick?: () => void;
}

export function DataCube({ 
  title, 
  metrics, 
  accentColor = '#8B5CF6', 
  salesData,
  isLoading = false,
  onClick
}: DataCubeProps) {
  const isOled = useIsOledTheme();
  
  const formatValue = (value: number | undefined, format: 'currency' | 'percent' | 'percent_signed' | 'number' | 'hours' | 'minutes'): string => {
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
        return Math.round(value).toLocaleString();
      default:
        return String(value);
    }
  };

  // Helper to get payment amount by type from payments array
  const getPaymentAmount = (payments: Array<{ paymentType: string; amount: number }> | undefined, typePatterns: string[]): number | undefined => {
    if (!payments || payments.length === 0) return undefined;
    for (const pattern of typePatterns) {
      const found = payments.find(p => p.paymentType.toLowerCase().includes(pattern.toLowerCase()));
      if (found) return found.amount;
    }
    return undefined;
  };
  
  // Helper to get payment percentage
  const getPaymentPercent = (payments: Array<{ paymentType: string; amount: number }> | undefined, typePatterns: string[]): number | undefined => {
    if (!payments || payments.length === 0) return undefined;
    const amount = getPaymentAmount(payments, typePatterns);
    if (amount === undefined) return undefined;
    const total = payments.reduce((sum, p) => sum + p.amount, 0);
    if (total === 0) return 0;
    return (amount / total) * 100;
  };

  const getMetricValue = (metricType: MetricType): number | undefined => {
    if (!salesData) return undefined;
    
    switch (metricType) {
      // Daily sales
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
      
      // Daily guests/products
      case 'guest_count_today': return salesData.guestCount?.daily;
      case 'pizza_count_today': 
        return typeof salesData.pizzaCount === 'number' ? salesData.pizzaCount : salesData.pizzaCount?.daily;
      
      // Daily labor
      case 'labor_percent_today':
      case 'labor_percent': return salesData.labor?.laborPercent;
      case 'labor_cost_today':
      case 'labor_cost': return salesData.labor?.laborCost;
      case 'labor_hours_today':
      case 'labor_hours': return salesData.labor?.hoursWorked;
      
      // Weekly sales
      case 'sales_wtd': return salesData.weekly;
      case 'sales_pace_week': return salesData.projections?.weekPaceAdjusted ?? salesData.projections?.weekProjected;
      case 'sales_projected_week': return salesData.projections?.weekProjected;
      case 'sales_prev_week': return salesData.comparison?.prevWeekFullWeek ?? salesData.comparison?.prevWeek;
      case 'sales_last_year_week': return salesData.lastYear?.sameWeek;
      
      // Weekly guests/products  
      case 'guest_count_wtd': return salesData.guestCount?.weekly;
      case 'pizza_count_wtd':
        return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.weekly : undefined;
      
      // Weekly labor
      case 'labor_percent_wtd': return salesData.weeklyLabor?.laborPercent;
      case 'labor_cost_wtd': return salesData.weeklyLabor?.laborCost;
      case 'labor_hours_wtd': return salesData.weeklyLabor?.hoursWorked;
      
      // Monthly sales
      case 'sales_mtd': return salesData.monthly;
      case 'sales_pace_month': return salesData.projections?.monthPaceAdjusted ?? salesData.projections?.monthProjected;
      case 'sales_projected_month': return salesData.projections?.monthProjected;
      case 'sales_prev_month': return salesData.comparison?.prevMonthFullMonth ?? salesData.comparison?.prevMonth;
      case 'sales_last_year_month': return salesData.lastYear?.sameMonth;
      
      // Monthly guests/products
      case 'guest_count_mtd': return salesData.guestCount?.monthly;
      case 'pizza_count_mtd':
        return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.monthly : undefined;
      
      // Monthly labor
      case 'labor_percent_mtd': return salesData.monthlyLabor?.laborPercent;
      case 'labor_cost_mtd': return salesData.monthlyLabor?.laborCost;
      case 'labor_hours_mtd': return salesData.monthlyLabor?.hoursWorked;
      
      // Payment type metrics - Daily (amount)
      case 'payment_cash_today': return getPaymentAmount(salesData.payments?.daily, ['cash']);
      case 'payment_credit_card_today': return getPaymentAmount(salesData.payments?.daily, ['credit card', 'creditcard']);
      case 'payment_olo_doordash_today': return getPaymentAmount(salesData.payments?.daily, ['doordash', 'door dash']);
      case 'payment_olo_ubereats_today': return getPaymentAmount(salesData.payments?.daily, ['ubereats', 'uber eats']);
      case 'payment_olo_visa_today': return getPaymentAmount(salesData.payments?.daily, ['olo visa']);
      case 'payment_olo_mastercard_today': return getPaymentAmount(salesData.payments?.daily, ['olo mastercard', 'olo mc']);
      case 'payment_olo_prepaid_today': return getPaymentAmount(salesData.payments?.daily, ['olo prepaid', 'prepaid']);
      case 'payment_olo_giftcard_today': return getPaymentAmount(salesData.payments?.daily, ['olo gift card', 'olo giftcard']);
      case 'payment_svs_giftcard_today': return getPaymentAmount(salesData.payments?.daily, ['svs gift card', 'svs giftcard']);
      // Combined OLO (sum of Visa, MC, Prepaid, GC)
      case 'payment_olo_combined_today': {
        const payments = salesData.payments?.daily;
        if (!payments) return undefined;
        const visa = getPaymentAmount(payments, ['olo visa']) ?? 0;
        const mc = getPaymentAmount(payments, ['olo mastercard', 'olo mc']) ?? 0;
        const prepaid = getPaymentAmount(payments, ['olo prepaid', 'prepaid']) ?? 0;
        const gc = getPaymentAmount(payments, ['olo gift card', 'olo giftcard']) ?? 0;
        const total = visa + mc + prepaid + gc;
        return total > 0 ? total : undefined;
      }
      // Daily (percent)
      case 'payment_cash_today_pct': return getPaymentPercent(salesData.payments?.daily, ['cash']);
      case 'payment_credit_card_today_pct': return getPaymentPercent(salesData.payments?.daily, ['credit card', 'creditcard']);
      case 'payment_olo_doordash_today_pct': return getPaymentPercent(salesData.payments?.daily, ['doordash', 'door dash']);
      case 'payment_olo_ubereats_today_pct': return getPaymentPercent(salesData.payments?.daily, ['ubereats', 'uber eats']);
      case 'payment_olo_visa_today_pct': return getPaymentPercent(salesData.payments?.daily, ['olo visa']);
      case 'payment_olo_mastercard_today_pct': return getPaymentPercent(salesData.payments?.daily, ['olo mastercard', 'olo mc']);
      case 'payment_olo_prepaid_today_pct': return getPaymentPercent(salesData.payments?.daily, ['olo prepaid', 'prepaid']);
      case 'payment_olo_giftcard_today_pct': return getPaymentPercent(salesData.payments?.daily, ['olo gift card', 'olo giftcard']);
      case 'payment_svs_giftcard_today_pct': return getPaymentPercent(salesData.payments?.daily, ['svs gift card', 'svs giftcard']);
      // Combined OLO percent
      case 'payment_olo_combined_today_pct': {
        const payments = salesData.payments?.daily;
        if (!payments) return undefined;
        const visa = getPaymentPercent(payments, ['olo visa']) ?? 0;
        const mc = getPaymentPercent(payments, ['olo mastercard', 'olo mc']) ?? 0;
        const prepaid = getPaymentPercent(payments, ['olo prepaid', 'prepaid']) ?? 0;
        const gc = getPaymentPercent(payments, ['olo gift card', 'olo giftcard']) ?? 0;
        const total = visa + mc + prepaid + gc;
        return total > 0 ? total : undefined;
      }
      
      // Payment type metrics - Weekly (amount)
      case 'payment_cash_wtd': return getPaymentAmount(salesData.payments?.weekly, ['cash']);
      case 'payment_credit_card_wtd': return getPaymentAmount(salesData.payments?.weekly, ['credit card', 'creditcard']);
      case 'payment_olo_doordash_wtd': return getPaymentAmount(salesData.payments?.weekly, ['doordash', 'door dash']);
      case 'payment_olo_ubereats_wtd': return getPaymentAmount(salesData.payments?.weekly, ['ubereats', 'uber eats']);
      case 'payment_olo_visa_wtd': return getPaymentAmount(salesData.payments?.weekly, ['olo visa']);
      case 'payment_olo_mastercard_wtd': return getPaymentAmount(salesData.payments?.weekly, ['olo mastercard', 'olo mc']);
      case 'payment_olo_prepaid_wtd': return getPaymentAmount(salesData.payments?.weekly, ['olo prepaid', 'prepaid']);
      case 'payment_olo_giftcard_wtd': return getPaymentAmount(salesData.payments?.weekly, ['olo gift card', 'olo giftcard']);
      case 'payment_svs_giftcard_wtd': return getPaymentAmount(salesData.payments?.weekly, ['svs gift card', 'svs giftcard']);
      // Weekly (percent)
      case 'payment_cash_wtd_pct': return getPaymentPercent(salesData.payments?.weekly, ['cash']);
      case 'payment_credit_card_wtd_pct': return getPaymentPercent(salesData.payments?.weekly, ['credit card', 'creditcard']);
      case 'payment_olo_doordash_wtd_pct': return getPaymentPercent(salesData.payments?.weekly, ['doordash', 'door dash']);
      case 'payment_olo_ubereats_wtd_pct': return getPaymentPercent(salesData.payments?.weekly, ['ubereats', 'uber eats']);
      case 'payment_olo_visa_wtd_pct': return getPaymentPercent(salesData.payments?.weekly, ['olo visa']);
      case 'payment_olo_mastercard_wtd_pct': return getPaymentPercent(salesData.payments?.weekly, ['olo mastercard', 'olo mc']);
      case 'payment_olo_prepaid_wtd_pct': return getPaymentPercent(salesData.payments?.weekly, ['olo prepaid', 'prepaid']);
      case 'payment_olo_giftcard_wtd_pct': return getPaymentPercent(salesData.payments?.weekly, ['olo gift card', 'olo giftcard']);
      case 'payment_svs_giftcard_wtd_pct': return getPaymentPercent(salesData.payments?.weekly, ['svs gift card', 'svs giftcard']);
      
      // Payment type metrics - Monthly (amount)
      case 'payment_cash_mtd': return getPaymentAmount(salesData.payments?.monthly, ['cash']);
      case 'payment_credit_card_mtd': return getPaymentAmount(salesData.payments?.monthly, ['credit card', 'creditcard']);
      case 'payment_olo_doordash_mtd': return getPaymentAmount(salesData.payments?.monthly, ['doordash', 'door dash']);
      case 'payment_olo_ubereats_mtd': return getPaymentAmount(salesData.payments?.monthly, ['ubereats', 'uber eats']);
      case 'payment_olo_visa_mtd': return getPaymentAmount(salesData.payments?.monthly, ['olo visa']);
      case 'payment_olo_mastercard_mtd': return getPaymentAmount(salesData.payments?.monthly, ['olo mastercard', 'olo mc']);
      case 'payment_olo_prepaid_mtd': return getPaymentAmount(salesData.payments?.monthly, ['olo prepaid', 'prepaid']);
      case 'payment_olo_giftcard_mtd': return getPaymentAmount(salesData.payments?.monthly, ['olo gift card', 'olo giftcard']);
      case 'payment_svs_giftcard_mtd': return getPaymentAmount(salesData.payments?.monthly, ['svs gift card', 'svs giftcard']);
      // Monthly (percent)
      case 'payment_cash_mtd_pct': return getPaymentPercent(salesData.payments?.monthly, ['cash']);
      case 'payment_credit_card_mtd_pct': return getPaymentPercent(salesData.payments?.monthly, ['credit card', 'creditcard']);
      case 'payment_olo_doordash_mtd_pct': return getPaymentPercent(salesData.payments?.monthly, ['doordash', 'door dash']);
      case 'payment_olo_ubereats_mtd_pct': return getPaymentPercent(salesData.payments?.monthly, ['ubereats', 'uber eats']);
      case 'payment_olo_visa_mtd_pct': return getPaymentPercent(salesData.payments?.monthly, ['olo visa']);
      case 'payment_olo_mastercard_mtd_pct': return getPaymentPercent(salesData.payments?.monthly, ['olo mastercard', 'olo mc']);
      case 'payment_olo_prepaid_mtd_pct': return getPaymentPercent(salesData.payments?.monthly, ['olo prepaid', 'prepaid']);
      case 'payment_olo_giftcard_mtd_pct': return getPaymentPercent(salesData.payments?.monthly, ['olo gift card', 'olo giftcard']);
      case 'payment_svs_giftcard_mtd_pct': return getPaymentPercent(salesData.payments?.monthly, ['svs gift card', 'svs giftcard']);
      
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
  };

  // Limit to 3 metrics
  const displayMetrics = metrics.slice(0, 3);
  const isSingleMetric = displayMetrics.length === 1;
  const isDoubleMetric = displayMetrics.length === 2;
  
  // Get the icon for the first metric
  const firstMetricConfig = displayMetrics[0] ? METRIC_CONFIGS[displayMetrics[0]] : null;
  const MainIcon = firstMetricConfig?.icon;

  return (
    <Card 
      className="aspect-square md:aspect-[2/1] overflow-hidden cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all duration-200 relative group"
      onClick={onClick}
      style={{
        background: isOled 
          ? 'hsl(var(--card))' 
          : `linear-gradient(135deg, ${accentColor}08 0%, ${accentColor}15 100%)`,
        borderColor: isOled ? undefined : `${accentColor}25`,
      }}
    >
      {/* Subtle gradient overlay */}
      <div 
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background: `linear-gradient(135deg, ${accentColor}05 0%, transparent 50%)`,
        }}
      />
      
      {/* Content */}
      <div className="relative z-10 h-full flex flex-col p-3 md:p-4">
        {/* Header with icon and title */}
        <div className="flex items-center gap-2 mb-2 md:mb-3">
          {MainIcon && (
            <div 
              className="flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-lg"
              style={{ 
                backgroundColor: isOled ? 'hsl(var(--muted))' : `${accentColor}20`,
              }}
            >
              <MainIcon 
                className="h-4 w-4 md:h-5 md:w-5" 
                style={{ color: isOled ? 'hsl(var(--muted-foreground))' : accentColor }}
              />
            </div>
          )}
          <span 
            className="text-xs md:text-sm font-semibold truncate"
            style={{ color: isOled ? 'hsl(var(--muted-foreground))' : accentColor }}
          >
            {title || 'Data'}
          </span>
        </div>
        
        {/* Metrics */}
        <div className={`flex-1 flex ${isSingleMetric ? 'flex-col justify-center' : 'flex-col justify-around'} md:flex-row md:items-center md:justify-around`}>
          {isLoading ? (
            <div className="space-y-2 w-full">
              <div className="h-8 bg-muted animate-pulse rounded-lg" />
              <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
            </div>
          ) : (
            displayMetrics.map((metricType, index) => {
              const config = METRIC_CONFIGS[metricType];
              if (!config) return null;
              
              const value = getMetricValue(metricType);
              const isFirst = index === 0;
              
              return (
                <div 
                  key={metricType} 
                  className={`flex flex-col ${isSingleMetric ? 'items-center text-center' : 'items-start'} md:items-center md:text-center`}
                >
                  <div 
                    className={`font-black tracking-tight ${
                      isSingleMetric 
                        ? 'text-3xl md:text-4xl' 
                        : isDoubleMetric 
                          ? (isFirst ? 'text-2xl md:text-3xl' : 'text-xl md:text-2xl') 
                          : (isFirst ? 'text-xl md:text-2xl' : 'text-lg md:text-xl')
                    }`}
                    style={{ color: isOled ? 'hsl(var(--foreground))' : accentColor }}
                  >
                    {formatValue(value, config.format)}
                  </div>
                  <div className={`text-muted-foreground font-medium ${
                    isSingleMetric ? 'text-xs md:text-sm' : 'text-[10px] md:text-xs'
                  }`}>
                    {isSingleMetric ? config.label : config.shortLabel}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      
      {/* Decorative corner accent */}
      <div 
        className="absolute -bottom-4 -right-4 w-16 h-16 md:w-20 md:h-20 rounded-full opacity-20 group-hover:opacity-30 transition-opacity"
        style={{ backgroundColor: isOled ? 'hsl(var(--muted))' : accentColor }}
      />
    </Card>
  );
}