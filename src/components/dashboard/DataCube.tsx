import { Card } from "@/components/ui/card";
import { 
  MetricType, 
  MetricConfig, 
  METRIC_CONFIGS, 
  METRIC_GROUPS,
  SalesDataForWidgets 
} from "./DashboardWidget";
import { useIsOledTheme } from "@/hooks/useIsOledTheme";
import { TrendingUp, TrendingDown } from "lucide-react";

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
  
  const formatValue = (value: number | undefined, format: 'currency' | 'percent' | 'number' | 'hours'): string => {
    if (value === undefined || value === null) return '--';
    
    switch (format) {
      case 'currency':
        return `$${Math.round(value).toLocaleString()}`;
      case 'percent':
        return `${Math.round(value)}%`;
      case 'hours':
        return `${Math.round(value)}h`;
      case 'number':
        return Math.round(value).toLocaleString();
      default:
        return String(value);
    }
  };

  const getMetricValue = (metricType: MetricType): number | undefined => {
    if (!salesData) return undefined;
    
    switch (metricType) {
      // Daily sales
      case 'sales_today': return salesData.daily;
      case 'sales_pace': return salesData.projections?.todayPaceAdjusted;
      case 'sales_projected_today': return salesData.projections?.todayProjected;
      case 'sales_last_week':
      case 'sales_last_year': return salesData.comparison?.prevDayFullDay;
      case 'sales_last_year_day': return salesData.lastYear?.sameDay;
      case 'avg_ticket': return salesData.avgTicket;
      
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