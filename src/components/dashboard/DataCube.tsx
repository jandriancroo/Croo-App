import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Users, Clock, Target, Pizza, Calendar, LucideIcon } from "lucide-react";

// All available metric types that can be shown in a cube
export type MetricType = 
  | 'sales_today'
  | 'sales_wtd'
  | 'sales_mtd'
  | 'sales_last_year'
  | 'sales_projected_today'
  | 'sales_projected_week'
  | 'sales_projected_month'
  | 'sales_pace'
  | 'labor_percent'
  | 'labor_cost'
  | 'labor_hours'
  | 'guest_count_today'
  | 'guest_count_wtd'
  | 'guest_count_mtd'
  | 'pizza_count_today'
  | 'pizza_count_wtd'
  | 'avg_ticket';

export interface MetricConfig {
  type: MetricType;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  format: 'currency' | 'percent' | 'number' | 'hours';
  category: 'sales' | 'labor' | 'guests' | 'projections';
}

export const METRIC_CONFIGS: Record<MetricType, MetricConfig> = {
  sales_today: { type: 'sales_today', label: 'Today Sales', shortLabel: 'Today', icon: DollarSign, format: 'currency', category: 'sales' },
  sales_wtd: { type: 'sales_wtd', label: 'Week-to-Date', shortLabel: 'WTD', icon: DollarSign, format: 'currency', category: 'sales' },
  sales_mtd: { type: 'sales_mtd', label: 'Month-to-Date', shortLabel: 'MTD', icon: DollarSign, format: 'currency', category: 'sales' },
  sales_last_year: { type: 'sales_last_year', label: 'Last Year Today', shortLabel: 'LY', icon: Calendar, format: 'currency', category: 'sales' },
  sales_projected_today: { type: 'sales_projected_today', label: 'Projected Today', shortLabel: 'Proj', icon: Target, format: 'currency', category: 'projections' },
  sales_projected_week: { type: 'sales_projected_week', label: 'Projected Week', shortLabel: 'Proj Wk', icon: Target, format: 'currency', category: 'projections' },
  sales_projected_month: { type: 'sales_projected_month', label: 'Projected Month', shortLabel: 'Proj Mo', icon: Target, format: 'currency', category: 'projections' },
  sales_pace: { type: 'sales_pace', label: 'Today Pace', shortLabel: 'Pace', icon: TrendingUp, format: 'currency', category: 'projections' },
  labor_percent: { type: 'labor_percent', label: 'Labor %', shortLabel: 'Labor%', icon: Users, format: 'percent', category: 'labor' },
  labor_cost: { type: 'labor_cost', label: 'Labor Cost', shortLabel: 'Labor$', icon: DollarSign, format: 'currency', category: 'labor' },
  labor_hours: { type: 'labor_hours', label: 'Hours Worked', shortLabel: 'Hours', icon: Clock, format: 'hours', category: 'labor' },
  guest_count_today: { type: 'guest_count_today', label: 'Guests Today', shortLabel: 'Guests', icon: Users, format: 'number', category: 'guests' },
  guest_count_wtd: { type: 'guest_count_wtd', label: 'Guests WTD', shortLabel: 'WTD', icon: Users, format: 'number', category: 'guests' },
  guest_count_mtd: { type: 'guest_count_mtd', label: 'Guests MTD', shortLabel: 'MTD', icon: Users, format: 'number', category: 'guests' },
  pizza_count_today: { type: 'pizza_count_today', label: 'Pizzas Today', shortLabel: 'Pizzas', icon: Pizza, format: 'number', category: 'guests' },
  pizza_count_wtd: { type: 'pizza_count_wtd', label: 'Pizzas WTD', shortLabel: 'WTD', icon: Pizza, format: 'number', category: 'guests' },
  avg_ticket: { type: 'avg_ticket', label: 'Avg Ticket', shortLabel: 'Avg $', icon: DollarSign, format: 'currency', category: 'sales' },
};

export interface SalesDataForCubes {
  daily?: number;
  weekly?: number;
  monthly?: number;
  guestCount?: { daily: number; weekly: number; monthly: number };
  pizzaCount?: number | { daily: number; weekly: number; monthly: number };
  avgTicket?: number;
  comparison?: { prevDay: number; prevDayFullDay?: number; prevWeek: number; prevMonth: number };
  projections?: { todayProjected: number; todayPaceAdjusted?: number; weekProjected: number; monthProjected: number };
  labor?: { laborPercent: number; laborCost: number; hoursWorked: number } | null;
}

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
      case 'sales_today':
        return salesData.daily;
      case 'sales_wtd':
        return salesData.weekly;
      case 'sales_mtd':
        return salesData.monthly;
      case 'sales_last_year':
        return salesData.comparison?.prevDayFullDay;
      case 'sales_projected_today':
        return salesData.projections?.todayProjected;
      case 'sales_projected_week':
        return salesData.projections?.weekProjected;
      case 'sales_projected_month':
        return salesData.projections?.monthProjected;
      case 'sales_pace':
        return salesData.projections?.todayPaceAdjusted;
      case 'labor_percent':
        return salesData.labor?.laborPercent;
      case 'labor_cost':
        return salesData.labor?.laborCost;
      case 'labor_hours':
        return salesData.labor?.hoursWorked;
      case 'guest_count_today':
        return salesData.guestCount?.daily;
      case 'guest_count_wtd':
        return salesData.guestCount?.weekly;
      case 'guest_count_mtd':
        return salesData.guestCount?.monthly;
      case 'pizza_count_today':
        return typeof salesData.pizzaCount === 'number' 
          ? salesData.pizzaCount 
          : salesData.pizzaCount?.daily;
      case 'pizza_count_wtd':
        return typeof salesData.pizzaCount === 'object' 
          ? salesData.pizzaCount?.weekly 
          : undefined;
      case 'avg_ticket':
        return salesData.avgTicket;
      default:
        return undefined;
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

// Grouped options for the metric selector
export const METRIC_GROUPS = [
  {
    label: 'Sales',
    metrics: ['sales_today', 'sales_wtd', 'sales_mtd', 'sales_last_year', 'avg_ticket'] as MetricType[],
  },
  {
    label: 'Projections',
    metrics: ['sales_projected_today', 'sales_pace', 'sales_projected_week', 'sales_projected_month'] as MetricType[],
  },
  {
    label: 'Labor',
    metrics: ['labor_percent', 'labor_cost', 'labor_hours'] as MetricType[],
  },
  {
    label: 'Guests & Products',
    metrics: ['guest_count_today', 'guest_count_wtd', 'guest_count_mtd', 'pizza_count_today', 'pizza_count_wtd'] as MetricType[],
  },
];
