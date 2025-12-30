import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, DollarSign, Users, Clock, Target, Pizza, Calendar, LucideIcon, Sparkles, GripVertical } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { format } from 'date-fns';
import { useIsOledTheme } from "@/hooks/useIsOledTheme";

// Widget size types
export type WidgetSize = 'small' | 'medium' | 'large';

// All available metric types - organized by time period
// Order: Sales, Pace, Projected, LW, LY, Guests, Pizzas, Avg Ticket, Labor%, Labor$, Hours
export type MetricType = 
  // Daily metrics
  | 'sales_today'
  | 'sales_pace'
  | 'sales_projected_today'
  | 'sales_last_week'      // Same day last week
  | 'sales_last_year_day'  // Actual last year same day
  | 'guest_count_today'
  | 'pizza_count_today'
  | 'avg_ticket'
  | 'labor_percent_today'
  | 'labor_cost_today'
  | 'labor_hours_today'
  // Weekly metrics (same order)
  | 'sales_wtd'
  | 'sales_pace_week'
  | 'sales_projected_week'
  | 'sales_prev_week'       // Previous full week
  | 'sales_last_year_week'  // Actual last year same week
  | 'guest_count_wtd'
  | 'pizza_count_wtd'
  | 'labor_percent_wtd'
  | 'labor_cost_wtd'
  | 'labor_hours_wtd'
  // Monthly metrics (same order)
  | 'sales_mtd'
  | 'sales_pace_month'
  | 'sales_projected_month'
  | 'sales_prev_month'       // Previous full month
  | 'sales_last_year_month'  // Actual last year same month
  | 'guest_count_mtd'
  | 'pizza_count_mtd'
  | 'labor_percent_mtd'
  | 'labor_cost_mtd'
  | 'labor_hours_mtd'
  // Legacy aliases (for backwards compatibility)
  | 'labor_percent'
  | 'labor_cost'
  | 'labor_hours'
  | 'sales_last_year';  // Legacy alias for sales_last_week

export interface MetricConfig {
  type: MetricType;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  format: 'currency' | 'percent' | 'number' | 'hours';
  category: 'daily' | 'weekly' | 'monthly';
}

export const METRIC_CONFIGS: Record<MetricType, MetricConfig> = {
  // Daily metrics - Order: Sales, Pace, Projected, LW, LY, Guests, Pizzas, Avg Ticket, Labor%, Labor$, Hours
  sales_today: { type: 'sales_today', label: 'Sales', shortLabel: 'Sales', icon: DollarSign, format: 'currency', category: 'daily' },
  sales_pace: { type: 'sales_pace', label: 'Pace', shortLabel: 'Pace', icon: TrendingUp, format: 'currency', category: 'daily' },
  sales_projected_today: { type: 'sales_projected_today', label: 'Projected', shortLabel: 'Proj', icon: Target, format: 'currency', category: 'daily' },
  sales_last_week: { type: 'sales_last_week', label: 'Last Week', shortLabel: 'LW', icon: Calendar, format: 'currency', category: 'daily' },
  sales_last_year_day: { type: 'sales_last_year_day', label: 'Last Year', shortLabel: 'LY', icon: Calendar, format: 'currency', category: 'daily' },
  guest_count_today: { type: 'guest_count_today', label: 'Guests', shortLabel: 'Guests', icon: Users, format: 'number', category: 'daily' },
  pizza_count_today: { type: 'pizza_count_today', label: 'Pizzas', shortLabel: 'Pizzas', icon: Pizza, format: 'number', category: 'daily' },
  avg_ticket: { type: 'avg_ticket', label: 'Avg Ticket', shortLabel: 'Avg $', icon: DollarSign, format: 'currency', category: 'daily' },
  labor_percent_today: { type: 'labor_percent_today', label: 'Labor %', shortLabel: 'Labor%', icon: Users, format: 'percent', category: 'daily' },
  labor_cost_today: { type: 'labor_cost_today', label: 'Labor Cost', shortLabel: 'Labor$', icon: DollarSign, format: 'currency', category: 'daily' },
  labor_hours_today: { type: 'labor_hours_today', label: 'Hours', shortLabel: 'Hours', icon: Clock, format: 'hours', category: 'daily' },
  
  // Weekly metrics - Same order: Sales, Pace, Projected, Prev, LY, Guests, Pizzas, Labor%, Labor$, Hours
  sales_wtd: { type: 'sales_wtd', label: 'Sales WTD', shortLabel: 'WTD', icon: DollarSign, format: 'currency', category: 'weekly' },
  sales_pace_week: { type: 'sales_pace_week', label: 'Week Pace', shortLabel: 'Pace', icon: TrendingUp, format: 'currency', category: 'weekly' },
  sales_projected_week: { type: 'sales_projected_week', label: 'Projected', shortLabel: 'Proj Wk', icon: Target, format: 'currency', category: 'weekly' },
  sales_prev_week: { type: 'sales_prev_week', label: 'Prev Week', shortLabel: 'Prev', icon: Calendar, format: 'currency', category: 'weekly' },
  sales_last_year_week: { type: 'sales_last_year_week', label: 'Last Year', shortLabel: 'LY', icon: Calendar, format: 'currency', category: 'weekly' },
  guest_count_wtd: { type: 'guest_count_wtd', label: 'Guests WTD', shortLabel: 'Guests', icon: Users, format: 'number', category: 'weekly' },
  pizza_count_wtd: { type: 'pizza_count_wtd', label: 'Pizzas WTD', shortLabel: 'Pizzas', icon: Pizza, format: 'number', category: 'weekly' },
  labor_percent_wtd: { type: 'labor_percent_wtd', label: 'Labor % WTD', shortLabel: 'Labor%', icon: Users, format: 'percent', category: 'weekly' },
  labor_cost_wtd: { type: 'labor_cost_wtd', label: 'Labor Cost WTD', shortLabel: 'Labor$', icon: DollarSign, format: 'currency', category: 'weekly' },
  labor_hours_wtd: { type: 'labor_hours_wtd', label: 'Hours WTD', shortLabel: 'Hours', icon: Clock, format: 'hours', category: 'weekly' },
  
  // Monthly metrics - Same order: Sales, Pace, Projected, Prev, LY, Guests, Pizzas, Labor%, Labor$, Hours
  sales_mtd: { type: 'sales_mtd', label: 'Sales MTD', shortLabel: 'MTD', icon: DollarSign, format: 'currency', category: 'monthly' },
  sales_pace_month: { type: 'sales_pace_month', label: 'Month Pace', shortLabel: 'Pace', icon: TrendingUp, format: 'currency', category: 'monthly' },
  sales_projected_month: { type: 'sales_projected_month', label: 'Projected', shortLabel: 'Proj Mo', icon: Target, format: 'currency', category: 'monthly' },
  sales_prev_month: { type: 'sales_prev_month', label: 'Prev Month', shortLabel: 'Prev', icon: Calendar, format: 'currency', category: 'monthly' },
  sales_last_year_month: { type: 'sales_last_year_month', label: 'Last Year', shortLabel: 'LY', icon: Calendar, format: 'currency', category: 'monthly' },
  guest_count_mtd: { type: 'guest_count_mtd', label: 'Guests MTD', shortLabel: 'Guests', icon: Users, format: 'number', category: 'monthly' },
  pizza_count_mtd: { type: 'pizza_count_mtd', label: 'Pizzas MTD', shortLabel: 'Pizzas', icon: Pizza, format: 'number', category: 'monthly' },
  labor_percent_mtd: { type: 'labor_percent_mtd', label: 'Labor % MTD', shortLabel: 'Labor%', icon: Users, format: 'percent', category: 'monthly' },
  labor_cost_mtd: { type: 'labor_cost_mtd', label: 'Labor Cost MTD', shortLabel: 'Labor$', icon: DollarSign, format: 'currency', category: 'monthly' },
  labor_hours_mtd: { type: 'labor_hours_mtd', label: 'Hours MTD', shortLabel: 'Hours', icon: Clock, format: 'hours', category: 'monthly' },
  
  // Legacy aliases (map to equivalents for backwards compatibility)
  labor_percent: { type: 'labor_percent', label: 'Labor %', shortLabel: 'Labor%', icon: Users, format: 'percent', category: 'daily' },
  labor_cost: { type: 'labor_cost', label: 'Labor Cost', shortLabel: 'Labor$', icon: DollarSign, format: 'currency', category: 'daily' },
  labor_hours: { type: 'labor_hours', label: 'Hours', shortLabel: 'Hours', icon: Clock, format: 'hours', category: 'daily' },
  sales_last_year: { type: 'sales_last_year', label: 'Last Week', shortLabel: 'LW', icon: Calendar, format: 'currency', category: 'daily' }, // Legacy alias
};

// Consistent order across all time periods: Sales, Pace, Projected, LW/Prev, LY, Guests, Pizzas, [Avg Ticket daily only], Labor%, Labor$, Hours
export const METRIC_GROUPS = [
  { 
    label: 'Daily', 
    metrics: [
      'sales_today', 'sales_pace', 'sales_projected_today', 'sales_last_week', 'sales_last_year_day',
      'guest_count_today', 'pizza_count_today', 'avg_ticket',
      'labor_percent_today', 'labor_cost_today', 'labor_hours_today'
    ] as MetricType[] 
  },
  { 
    label: 'Weekly', 
    metrics: [
      'sales_wtd', 'sales_pace_week', 'sales_projected_week', 'sales_prev_week', 'sales_last_year_week',
      'guest_count_wtd', 'pizza_count_wtd',
      'labor_percent_wtd', 'labor_cost_wtd', 'labor_hours_wtd'
    ] as MetricType[] 
  },
  { 
    label: 'Monthly', 
    metrics: [
      'sales_mtd', 'sales_pace_month', 'sales_projected_month', 'sales_prev_month', 'sales_last_year_month',
      'guest_count_mtd', 'pizza_count_mtd',
      'labor_percent_mtd', 'labor_cost_mtd', 'labor_hours_mtd'
    ] as MetricType[] 
  },
];

export interface SalesDataForWidgets {
  daily?: number;
  weekly?: number;
  monthly?: number;
  guestCount?: { daily: number; weekly: number; monthly: number };
  pizzaCount?: number | { daily: number; weekly: number; monthly: number };
  avgTicket?: number;
  comparison?: { prevDay: number; prevDayFullDay?: number; prevWeek: number; prevWeekFullWeek?: number; prevMonth: number; prevMonthFullMonth?: number };
  lastYear?: { sameDay?: number; sameWeek?: number; sameMonth?: number };
  projections?: { todayProjected: number; todayPaceAdjusted?: number; weekProjected: number; weekPaceAdjusted?: number; monthProjected: number; monthPaceAdjusted?: number };
  labor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours?: number; overtimeHours?: number } | null;
  weeklyLabor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours?: number; overtimeHours?: number } | null;
  monthlyLabor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours?: number; overtimeHours?: number } | null;
  hourly?: Array<{ hour: string; sales: number; projected?: number }>;
  weeklyBreakdown?: Array<{ date: string; sales: number; projected?: number }>;
}

interface DashboardWidgetProps {
  title?: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor?: string;
  salesData: SalesDataForWidgets | null;
  isLoading?: boolean;
  onClick?: () => void;
  isDragging?: boolean;
  dragHandleProps?: any;
}

export function DashboardWidget({ 
  title, 
  size,
  metrics, 
  accentColor = '#8B5CF6', 
  salesData,
  isLoading = false,
  onClick,
  isDragging = false,
  dragHandleProps,
}: DashboardWidgetProps) {
  const isOled = useIsOledTheme();
  
  // Use primary color for OLED theme instead of custom accent colors
  const effectiveColor = isOled ? 'hsl(215, 30%, 18%)' : accentColor;
  const formatValue = (value: number | undefined, formatType: 'currency' | 'percent' | 'number' | 'hours'): string => {
    if (value === undefined || value === null) return '--';
    
    switch (formatType) {
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
      case 'sales_last_year': return salesData.comparison?.prevDayFullDay; // Legacy alias
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

  const displayMetrics = metrics.slice(0, size === 'small' ? 3 : size === 'medium' ? 4 : 6);
  const firstMetricConfig = displayMetrics[0] ? METRIC_CONFIGS[displayMetrics[0]] : null;
  const CornerIcon = firstMetricConfig?.icon;

  // Small widget - square on mobile, horizontal rectangle on tablet/desktop
  if (size === 'small') {
    const isSingleMetric = displayMetrics.length === 1;
    
    return (
      <Card 
        className={`aspect-square md:aspect-[2/1] overflow-hidden cursor-pointer hover:shadow-lg transition-all relative ${isDragging ? 'opacity-50 shadow-2xl' : ''}`}
        onClick={onClick}
      >
        {/* Colored header */}
        <div className="px-3 py-1.5 md:py-2 flex items-center" style={{ backgroundColor: effectiveColor }}>
          <span className="text-xs md:text-sm font-semibold text-white truncate flex-1">{title || 'Data'}</span>
          {dragHandleProps && (
            <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing ml-1">
              <GripVertical className="h-3 w-3 text-white/70" />
            </div>
          )}
        </div>
        
        <CardContent className="p-3 md:p-4 h-[calc(100%-28px)] md:h-[calc(100%-36px)] flex flex-col justify-center">
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-6 bg-muted animate-pulse rounded" />
              <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
            </div>
          ) : (
            <div className={`flex ${isSingleMetric ? 'flex-col items-center text-center md:flex-row md:items-center md:justify-center md:gap-4' : 'flex-col gap-1 md:flex-row md:gap-6 md:justify-around'}`}>
              {displayMetrics.map((metricType, index) => {
                const config = METRIC_CONFIGS[metricType];
                if (!config) return null;
                const value = getMetricValue(metricType);
                
                return (
                  <div key={metricType} className={`${isSingleMetric ? 'text-center' : ''} md:flex-1 md:text-center`}>
                    <div 
                      className={`font-extrabold truncate ${isSingleMetric ? 'text-3xl md:text-4xl' : 'text-lg md:text-2xl'} ${isOled ? 'text-muted-foreground' : ''}`}
                      style={isOled ? undefined : { color: effectiveColor }}
                    >
                      {formatValue(value, config.format)}
                    </div>
                    <div className={`truncate font-medium ${isSingleMetric ? 'text-xs md:text-sm' : 'text-[10px] md:text-xs'} ${isOled ? 'text-white/70' : 'text-muted-foreground'}`}>
                      {isSingleMetric ? config.label : config.shortLabel}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Corner accent with icon - smaller on desktop */}
          <div 
            className="absolute bottom-0 right-0 w-10 h-10 md:w-8 md:h-8 rounded-tl-full flex items-end justify-end"
            style={{ backgroundColor: effectiveColor }}
          >
            {CornerIcon && <CornerIcon className="w-3 h-3 md:w-3 md:h-3 text-white mr-1.5 mb-1.5" />}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Medium widget (2x1) - wide card with metrics side by side
  if (size === 'medium') {
    return (
      <Card 
        className={`overflow-hidden cursor-pointer hover:shadow-lg transition-all relative ${isDragging ? 'opacity-50 shadow-2xl' : ''}`}
        onClick={onClick}
      >
        {/* Colored header */}
        <div className="px-4 py-2 flex items-center" style={{ backgroundColor: effectiveColor }}>
          <span className="text-sm font-semibold text-white truncate flex-1">{title || 'Data'}</span>
          {dragHandleProps && (
            <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing ml-2">
              <GripVertical className="h-4 w-4 text-white/70" />
            </div>
          )}
        </div>
        
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex-1 space-y-2">
                  <div className="h-6 bg-muted animate-pulse rounded" />
                  <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-4 justify-between">
              {displayMetrics.slice(0, 4).map((metricType) => {
                const config = METRIC_CONFIGS[metricType];
                if (!config) return null;
                const value = getMetricValue(metricType);
                const IconComponent = config.icon;
                
                return (
                  <div key={metricType} className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      <IconComponent className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground truncate">{config.shortLabel}</span>
                    </div>
                    <div className="text-xl font-bold truncate" style={{ color: effectiveColor }}>
                      {formatValue(value, config.format)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Large widget (2x2) - full card with chart (like Sales Overview)
  return (
    <Card 
      className={`overflow-hidden cursor-pointer hover:shadow-lg transition-all ${isDragging ? 'opacity-50 shadow-2xl' : ''}`}
      onClick={onClick}
    >
      {/* Colored header */}
      <div className="px-4 py-3 flex items-center" style={{ backgroundColor: effectiveColor }}>
        <span className="text-sm font-semibold text-white truncate flex-1">{title || 'Sales Overview'}</span>
        {dragHandleProps && (
          <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing ml-2">
            <GripVertical className="h-4 w-4 text-white/70" />
          </div>
        )}
      </div>
      
      <CardContent className="p-4 space-y-4">
        {isLoading ? (
          <>
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="space-y-2">
                  <div className="h-4 bg-muted animate-pulse rounded w-16" />
                  <div className="h-8 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
            <div className="h-[150px] bg-muted animate-pulse rounded" />
          </>
        ) : (
          <>
            {/* Main metrics row */}
            <div className="grid grid-cols-3 gap-4">
              {displayMetrics.slice(0, 3).map((metricType, index) => {
                const config = METRIC_CONFIGS[metricType];
                if (!config) return null;
                const value = getMetricValue(metricType);
                
                return (
                  <div key={metricType} className={index === 1 ? 'text-center' : index === 2 ? 'text-right' : ''}>
                    <p className="text-xs text-muted-foreground">{config.label}</p>
                    <p className="text-2xl font-bold" style={{ color: effectiveColor }}>
                      {formatValue(value, config.format)}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Projection badge if available */}
            {salesData?.projections?.todayProjected && salesData.projections.todayProjected > 0 && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-primary/10 via-purple-500/10 to-amber-500/10 border border-primary/20">
                <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex-shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-[10px] text-muted-foreground">Target EOD</p>
                  <p className="text-sm font-bold">${Math.round(salesData.projections.todayProjected).toLocaleString()}</p>
                </div>
                {salesData.projections.todayPaceAdjusted && (
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">Pacing</p>
                    <p className="text-sm font-bold">${Math.round(salesData.projections.todayPaceAdjusted).toLocaleString()}</p>
                  </div>
                )}
              </div>
            )}

            {/* Chart */}
            {salesData?.hourly && salesData.hourly.length > 0 && (
              <div className="h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={salesData.hourly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="hour" 
                      tick={{ fontSize: 10 }}
                      tickFormatter={(h) => h.replace(':00', '')}
                    />
                    <YAxis 
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip 
                      formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                    />
                    <Bar dataKey="sales" fill={effectiveColor} radius={[4, 4, 0, 0]} />
                    {salesData.hourly.some(h => h.projected) && (
                      <Line 
                        type="monotone" 
                        dataKey="projected" 
                        stroke="hsl(var(--muted-foreground))" 
                        strokeDasharray="5 5"
                        dot={false}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Size picker options for the add widget dialog
export const WIDGET_SIZE_OPTIONS = [
  { 
    size: 'small' as WidgetSize, 
    label: 'Small', 
    description: '1-3 metrics',
    gridClass: 'col-span-1',
    previewClass: 'aspect-square w-16 h-16',
  },
  { 
    size: 'medium' as WidgetSize, 
    label: 'Medium', 
    description: 'Wide with 4 metrics',
    gridClass: 'col-span-2',
    previewClass: 'w-32 h-16',
  },
  { 
    size: 'large' as WidgetSize, 
    label: 'Large', 
    description: 'Full card with chart',
    gridClass: 'col-span-2',
    previewClass: 'w-32 h-32',
  },
];
