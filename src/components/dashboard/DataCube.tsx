import { Card, CardContent } from "@/components/ui/card";
import { 
  MetricType, 
  MetricConfig, 
  METRIC_CONFIGS, 
  METRIC_GROUPS,
  SalesDataForWidgets 
} from "./DashboardWidget";

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
      case 'sales_last_year': return salesData.comparison?.prevDayFullDay;
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
      case 'sales_projected_week': return salesData.projections?.weekProjected;
      case 'sales_pace_week': return salesData.projections?.weekProjected;
      
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
      case 'sales_projected_month': return salesData.projections?.monthProjected;
      
      // Monthly guests/products
      case 'guest_count_mtd': return salesData.guestCount?.monthly;
      case 'pizza_count_mtd':
        return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.monthly : undefined;
      
      default: return undefined;
    }
  };

  // Limit to 3 metrics
  const displayMetrics = metrics.slice(0, 3);
  const isSingleMetric = displayMetrics.length === 1;
  const isDoubleMetric = displayMetrics.length === 2;
  
  // Get the icon for the first metric to show in the corner accent
  const firstMetricConfig = displayMetrics[0] ? METRIC_CONFIGS[displayMetrics[0]] : null;
  const CornerIcon = firstMetricConfig?.icon;

  return (
    <Card 
      className="aspect-square overflow-hidden cursor-pointer hover:shadow-lg transition-all relative"
      onClick={onClick}
    >
      {/* Colored header with title */}
      <div 
        className="px-3 py-2 flex items-center"
        style={{ backgroundColor: accentColor }}
      >
        <span className="text-xs font-semibold text-white truncate">
          {title || 'Data'}
        </span>
      </div>
      
      <CardContent className="p-3 h-[calc(100%-32px)] flex flex-col justify-between">
        
        {/* Metrics */}
        <div className={`flex-1 flex flex-col ${isSingleMetric ? 'justify-center' : 'justify-around'}`}>
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-6 bg-muted animate-pulse rounded" />
              <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
            </div>
          ) : (
            displayMetrics.map((metricType, index) => {
              const config = METRIC_CONFIGS[metricType];
              if (!config) return null;
              
              const value = getMetricValue(metricType);
              const IconComponent = config.icon;
              const isFirst = index === 0;
              
              return (
                <div 
                  key={metricType} 
                  className={`flex items-center gap-2 ${isSingleMetric ? 'flex-col text-center' : ''}`}
                >
                  {isSingleMetric && (
                    <div 
                      className="p-1.5 rounded-full"
                      style={{ backgroundColor: `${accentColor}15` }}
                    >
                      <IconComponent 
                        className="shrink-0 h-4 w-4" 
                        color={accentColor}
                      />
                    </div>
                  )}
                  <div className={`min-w-0 ${isSingleMetric ? 'text-center' : 'flex-1'}`}>
                    <div 
                      className={`font-extrabold truncate ${
                        isSingleMetric 
                          ? 'text-3xl' 
                          : isDoubleMetric 
                            ? (isFirst ? 'text-2xl' : 'text-xl') 
                            : (isFirst ? 'text-xl' : 'text-lg')
                      }`}
                      style={{ color: accentColor }}
                    >
                      {formatValue(value, config.format)}
                    </div>
                    <div className={`text-muted-foreground truncate font-medium ${
                      isSingleMetric ? 'text-xs' : 'text-[10px]'
                    }`}>
                      {isSingleMetric ? config.label : config.shortLabel}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        
        {/* Corner accent with icon */}
        <div 
          className="absolute bottom-0 right-0 w-12 h-12 rounded-tl-full flex items-end justify-end"
          style={{ backgroundColor: accentColor }}
        >
          {CornerIcon && (
            <CornerIcon className="w-4 h-4 text-white mr-2 mb-2" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
