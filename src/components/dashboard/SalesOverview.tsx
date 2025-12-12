import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronLeft, ChevronRight, ChevronDown, TrendingUp, TrendingDown, Package, Sparkles } from 'lucide-react';
import { ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { format, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, startOfWeek, endOfWeek, startOfMonth, isSameDay, isSameWeek, isSameMonth } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { formatTime12Hour } from '@/lib/utils';
import { setCachedProjections, getCachedProjections } from '@/utils/salesCache';
import { useIsMobile } from '@/hooks/use-mobile';

interface SalesData {
  daily: number;
  weekly?: number;
  monthly?: number;
  hourly?: Array<{ hour: string; sales: number; projected?: number; checksCount?: number }>;
  weeklyBreakdown?: Array<{ date: string; sales: number; projected?: number; guestCount?: number }>;
  monthlyBreakdown?: Array<{ date: string; sales: number; projected?: number; guestCount?: number }>;
  guestCount?: { daily: number; weekly: number; monthly: number };
  avgTicket?: number;
  comparison?: { prevDay: number; prevDayFullDay?: number; prevWeek: number; prevMonth: number };
  projections?: { todayProjected: number; weekProjected: number; monthProjected: number };
  currentHour?: number;
  productMix?: Array<{ name: string; quantity: number; sales: number; category: string }>;
  dateRange?: { today: string; weekStart: string; monthStart: string };
  labor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number } | null;
}

interface LocationSettings {
  hours_open?: string;
  hours_close?: string;
}

interface SalesOverviewProps {
  locationSettings?: LocationSettings | null;
}

export function SalesOverview({ locationSettings }: SalesOverviewProps) {
  const { currentLocation } = useAppLocation();
  const [targetDate, setTargetDate] = useState<Date>(new Date());
  const [showProductMix, setShowProductMix] = useState(false);
  const isMobile = useIsMobile();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatCurrencyDecimal = (amount: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const getDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isToday = isSameDay(targetDate, new Date());

  const { data: rawSalesData, isLoading, refetch } = useQuery({
    queryKey: ["qubeyond-sales", currentLocation?.id, getDateString(targetDate)],
    queryFn: async () => {
      const dateStr = getDateString(targetDate);
      const isTodayCheck = isSameDay(targetDate, new Date());
      
      // Check cache INSIDE the query function to get fresh values
      const cachedProjections = isTodayCheck && currentLocation?.id 
        ? getCachedProjections(currentLocation.id) 
        : null;
      
      const hasValidDailyCache = cachedProjections?.todayProjected !== undefined;
      const hasValidWeeklyMonthlyCache = cachedProjections?.weekProjected !== undefined && cachedProjections?.monthProjected !== undefined;
      const skipProjections = isTodayCheck && hasValidDailyCache && hasValidWeeklyMonthlyCache;
      
      const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", {
        body: { 
          locationId: currentLocation?.id,
          targetDate: dateStr,
          skipProjections
        }
      });
      if (error) {
        console.error("Error fetching sales data:", error);
        return null;
      }
      
      const salesData = data as SalesData;
      
      // If we skipped projections but have cached ones, merge them in
      if (skipProjections && cachedProjections && salesData) {
        salesData.projections = {
          todayProjected: cachedProjections.todayProjected || 0,
          weekProjected: cachedProjections.weekProjected,
          monthProjected: cachedProjections.monthProjected
        };
      }
      
      // Cache new projections if we fetched them fresh
      if (isTodayCheck && !skipProjections && salesData?.projections && currentLocation?.id) {
        const todayProjected = salesData.projections.todayProjected;
        const weekProjected = salesData.projections.weekProjected;
        const monthProjected = salesData.projections.monthProjected;
        const weeklySales = salesData?.weekly || 0;
        const monthlySales = salesData?.monthly || 0;
        
        // Sanity check: projections must be >= actual sales
        if (weekProjected >= weeklySales && monthProjected >= monthlySales && weekProjected > 0 && monthProjected > 0) {
          setCachedProjections(currentLocation.id, { 
            todayProjected: todayProjected > 0 ? todayProjected : undefined,
            weekProjected, 
            monthProjected 
          });
        }
      }
      
      return salesData;
    },
    enabled: !!currentLocation?.id,
    staleTime: 60000, // Consider data fresh for 1 minute to reduce refetches
    refetchOnWindowFocus: false // Don't refetch just because user switched tabs
  });

  // Convert hourly data to 12-hour format and filter to business hours only
  const salesData = useMemo(() => {
    if (!rawSalesData) return rawSalesData;
    
    // Only show hourly breakdown if business hours are configured
    if (locationSettings?.hours_open && locationSettings?.hours_close && rawSalesData.hourly) {
      const openHour = parseInt(locationSettings.hours_open.split(':')[0]);
      const closeHour = parseInt(locationSettings.hours_close.split(':')[0]);
      
      const completeHourly: Array<{ hour: string; sales: number; projected?: number }> = [];
      for (let hour = openHour; hour < closeHour; hour++) {
        const hourStr24 = `${hour.toString().padStart(2, '0')}:00`;
        const existingData = rawSalesData.hourly?.find(item => {
          // Handle both 24-hour and 12-hour formats from API
          const itemHour = item.hour.includes('AM') || item.hour.includes('PM')
            ? parseInt(item.hour) + (item.hour.includes('PM') && !item.hour.startsWith('12') ? 12 : 0)
            : parseInt(item.hour.split(':')[0]);
          return itemHour === hour;
        });
        
        completeHourly.push({
          hour: formatTime12Hour(hourStr24),
          sales: existingData?.sales || 0,
          projected: existingData?.projected || 0
        });
      }

      return { ...rawSalesData, hourly: completeHourly };
    }
    
    // If no business hours configured, don't show hourly breakdown
    return { ...rawSalesData, hourly: undefined };
  }, [rawSalesData, locationSettings]);

  // Aggregate monthly breakdown into weekly buckets (Mon-Sun) for mobile view
  const monthlyWeeklyAggregated = useMemo(() => {
    if (!salesData?.monthlyBreakdown || salesData.monthlyBreakdown.length === 0) return [];
    
    // Group by Monday-Sunday weeks
    const weeklyBuckets: Array<{ weekStart: Date; sales: number; projected: number; startDate: string; endDate: string }> = [];
    
    salesData.monthlyBreakdown.forEach(day => {
      const date = new Date(day.date + 'T00:00:00');
      const weekStart = startOfWeek(date, { weekStartsOn: 1 }); // Monday
      
      // Find existing bucket or create new one
      let bucket = weeklyBuckets.find(b => b.weekStart.getTime() === weekStart.getTime());
      if (!bucket) {
        const weekEnd = endOfWeek(date, { weekStartsOn: 1 }); // Sunday
        bucket = { 
          weekStart, 
          sales: 0, 
          projected: 0, 
          startDate: format(weekStart, 'MMM d'),
          endDate: format(weekEnd, 'MMM d')
        };
        weeklyBuckets.push(bucket);
      }
      bucket.sales += day.sales;
      bucket.projected += (day.projected || 0);
    });
    
    // Sort by week start date
    return weeklyBuckets
      .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
      .map((bucket, index) => ({
        label: `Week ${index + 1}`,
        sales: bucket.sales,
        projected: bucket.projected,
        dateRange: `${bucket.startDate} - ${bucket.endDate}`
      }));
  }, [salesData?.monthlyBreakdown]);

  const navigateDay = (direction: 'prev' | 'next') => {
    setTargetDate(prev => direction === 'prev' ? subDays(prev, 1) : addDays(prev, 1));
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    setTargetDate(prev => direction === 'prev' ? subWeeks(prev, 1) : addWeeks(prev, 1));
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setTargetDate(prev => direction === 'prev' ? subMonths(prev, 1) : addMonths(prev, 1));
  };

  const getChangePercent = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  const ComparisonBadge = ({ current, previous, label }: { current: number; previous: number; label: string }) => {
    const change = getChangePercent(current, previous);
    const isPositive = change >= 0;
    
    return (
      <div className="flex items-center gap-1 text-xs whitespace-nowrap">
        {isPositive ? (
          <TrendingUp className="h-3 w-3 text-green-500 flex-shrink-0" />
        ) : (
          <TrendingDown className="h-3 w-3 text-red-500 flex-shrink-0" />
        )}
        <span className={isPositive ? "text-green-500" : "text-red-500"}>
          {isPositive ? "+" : ""}{change.toFixed(1)}%
        </span>
        <span className="text-muted-foreground hidden sm:inline">vs {label}</span>
      </div>
    );
  };

  const DateNavigator = ({ 
    onPrev, 
    onNext, 
    label, 
    canGoNext 
  }: { 
    onPrev: () => void; 
    onNext: () => void; 
    label: string;
    canGoNext: boolean;
  }) => (
    <div className="flex items-center justify-between mb-2">
      <Button variant="ghost" size="sm" onClick={onPrev} className="h-7 px-2">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={onNext} 
        disabled={!canGoNext}
        className="h-7 px-2"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div>
        <h3 className="text-xl font-semibold mb-4">Sales Overview</h3>
        <Card>
          <CardContent className="pt-4">
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              Loading sales data...
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasLaborData = salesData?.labor && salesData.labor.laborPercent > 0;

  return (
    <div>
      <h3 className="text-xl font-semibold mb-4">
        {hasLaborData ? 'Sales & Labor Overview' : 'Sales Overview'}
      </h3>
      <Card>
        <CardContent className="pt-4">
          <Tabs defaultValue="today" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="week">This Week</TabsTrigger>
              <TabsTrigger value="month">This Month</TabsTrigger>
            </TabsList>
            
            {/* TODAY TAB */}
            <TabsContent value="today" className="space-y-4">
              <DateNavigator 
                onPrev={() => navigateDay('prev')}
                onNext={() => navigateDay('next')}
                label={isToday ? 'Today' : format(targetDate, 'EEEE, MMM d')}
                canGoNext={!isToday}
              />
              
              <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
              <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Sales</p>
                  <p className="text-lg sm:text-2xl font-bold">
                    {salesData?.daily ? formatCurrency(salesData.daily) : "--"}
                  </p>
                  {salesData?.comparison?.prevDay !== undefined && salesData.daily !== undefined && (
                    <ComparisonBadge 
                      current={salesData.daily} 
                      previous={salesData.comparison.prevDay} 
                      label={`same time last ${format(targetDate, 'EEEE').slice(0, 3)}`}
                    />
                  )}
                </div>
                <div className="text-center min-w-0">
                  <p className="text-xs text-muted-foreground">Guests</p>
                  <p className="text-lg sm:text-2xl font-bold">
                    {salesData?.guestCount?.daily ?? "--"}
                  </p>
                </div>
                <div className="text-right min-w-0">
                  <p className="text-xs text-muted-foreground">Avg Ticket</p>
                  <p className="text-lg sm:text-2xl font-bold">
                    {salesData?.avgTicket ? formatCurrencyDecimal(salesData.avgTicket) : "--"}
                  </p>
                </div>
              </div>

              {/* Croo AI Projection for Today */}
              {salesData?.projections?.todayProjected !== undefined && salesData.projections.todayProjected > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-primary/10 to-purple-500/10 border border-primary/20 mb-2">
                  <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex-shrink-0">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs sm:text-sm text-muted-foreground">Croo AI Projected EOD:</span>
                    <span className="text-sm sm:text-base font-semibold text-primary">
                      {formatCurrency(salesData.projections.todayProjected)}
                    </span>
                  </div>
                </div>
              )}

              {/* Live Labor from Qu */}
              {hasLaborData && salesData?.labor && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-orange-500/10 to-amber-500/10 border border-orange-500/20 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex-shrink-0">
                      <span className="text-xs font-bold text-white">%</span>
                    </div>
                    <span className="text-xs sm:text-sm text-muted-foreground">Live Labor</span>
                  </div>
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="text-right">
                      <p className="text-lg sm:text-xl font-bold text-orange-500">{salesData.labor.laborPercent.toFixed(1)}%</p>
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-muted-foreground">Cost</p>
                      <p className="text-sm font-medium">{formatCurrency(salesData.labor.laborCost)}</p>
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-muted-foreground">Hours</p>
                      <p className="text-sm font-medium">{salesData.labor.hoursWorked.toFixed(1)}h</p>
                    </div>
                  </div>
                </div>
              )}
              
              {salesData?.hourly ? (
                <ResponsiveContainer width="100%" height={200} className="md:h-[280px]">
                  <BarChart data={salesData.hourly} barCategoryGap="15%">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="hour" className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} />
                    <YAxis className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} tickFormatter={value => `$${value}`} />
                    <Tooltip 
                      formatter={(value, name) => [formatCurrency(value as number), name === 'projected' ? 'Projected' : 'Actual']} 
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px'
                      }} 
                    />
                    <Legend 
                      formatter={(value) => value === 'projected' ? 'Projected' : 'Actual'}
                      wrapperStyle={{ fontSize: '12px' }}
                    />
                    <Bar dataKey="projected" fill="hsl(var(--muted-foreground))" radius={[8, 8, 0, 0]} opacity={0.4} />
                    <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] md:h-[280px] flex items-center justify-center text-muted-foreground">
                  No sales data available
                </div>
              )}

              {/* Product Mix Section */}
              {salesData?.productMix && salesData.productMix.length > 0 && (
                <Collapsible open={showProductMix} onOpenChange={setShowProductMix}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between h-9 text-sm">
                      <span className="flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        Product Mix ({salesData.productMix.length} items)
                      </span>
                      <ChevronDown className={`h-4 w-4 transition-transform ${showProductMix ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <div className="max-h-[300px] overflow-y-auto space-y-1">
                      {salesData.productMix.map((product, idx) => (
                        <div key={idx} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{product.name}</p>
                            <p className="text-xs text-muted-foreground">{product.category}</p>
                          </div>
                          <div className="text-right ml-2">
                            <p className="text-sm font-medium">{product.quantity}</p>
                            <p className="text-xs text-muted-foreground">{formatCurrency(product.sales)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </TabsContent>
            
            {/* WEEK TAB */}
            <TabsContent value="week" className="space-y-4">
              <DateNavigator 
                onPrev={() => navigateWeek('prev')}
                onNext={() => navigateWeek('next')}
                label={salesData?.dateRange?.weekStart 
                  ? `Week of ${format(new Date(salesData.dateRange.weekStart + 'T00:00:00'), 'MMM d, yyyy')}`
                  : 'This Week'
                }
                canGoNext={!isSameWeek(targetDate, new Date(), { weekStartsOn: 1 })}
              />
              
              <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
              <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">WTD</p>
                  <p className="text-lg sm:text-2xl font-bold">
                    {salesData?.weekly !== undefined ? formatCurrency(salesData.weekly) : "--"}
                  </p>
                  {salesData?.comparison?.prevWeek !== undefined && salesData.weekly !== undefined && (
                    <ComparisonBadge 
                      current={salesData.weekly} 
                      previous={salesData.comparison.prevWeek} 
                      label="last week"
                    />
                  )}
                </div>
                <div className="text-center min-w-0">
                  <p className="text-xs text-muted-foreground">Guests</p>
                  <p className="text-lg sm:text-2xl font-bold">
                    {salesData?.guestCount?.weekly ?? "--"}
                  </p>
                </div>
                <div className="text-right min-w-0">
                  <p className="text-xs text-muted-foreground">Avg Ticket</p>
                  <p className="text-lg sm:text-2xl font-bold">
                    {salesData?.guestCount?.weekly && salesData?.weekly 
                      ? formatCurrencyDecimal(salesData.weekly / salesData.guestCount.weekly) 
                      : "--"}
                  </p>
                </div>
              </div>

              {/* Croo AI Projection for Week */}
              {salesData?.projections?.weekProjected && salesData.projections.weekProjected > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-primary/10 to-purple-500/10 border border-primary/20 mb-2">
                  <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-primary to-purple-500">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Croo AI Projected Week Total:</span>
                    <span className="text-sm font-semibold text-primary">
                      {formatCurrency(salesData.projections.weekProjected)}
                    </span>
                  </div>
                </div>
              )}
              
              {salesData?.weeklyBreakdown && salesData.weeklyBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={200} className="md:h-[280px]">
                  <BarChart data={salesData.weeklyBreakdown.map(d => ({
                    ...d,
                    label: format(new Date(d.date + 'T00:00:00'), 'EEE')
                  }))} barCategoryGap="15%">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} />
                    <YAxis className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} tickFormatter={value => `$${value}`} />
                    <Tooltip 
                      formatter={(value, name) => [formatCurrency(value as number), name === 'projected' ? 'Projected' : 'Actual']}
                      labelFormatter={(label, payload) => {
                        if (payload?.[0]?.payload?.date) {
                          return format(new Date(payload[0].payload.date + 'T00:00:00'), 'EEEE, MMM d');
                        }
                        return label;
                      }}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px'
                      }} 
                    />
                    <Legend 
                      formatter={(value) => value === 'projected' ? 'Projected' : 'Actual'}
                      wrapperStyle={{ fontSize: '12px' }}
                    />
                    <Bar dataKey="projected" fill="hsl(var(--muted-foreground))" radius={[8, 8, 0, 0]} opacity={0.4} />
                    <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] md:h-[280px] flex items-center justify-center text-muted-foreground">
                  No weekly data available
                </div>
              )}
            </TabsContent>
            
            {/* MONTH TAB */}
            <TabsContent value="month" className="space-y-4">
              <DateNavigator 
                onPrev={() => navigateMonth('prev')}
                onNext={() => navigateMonth('next')}
                label={salesData?.dateRange?.monthStart 
                  ? format(new Date(salesData.dateRange.monthStart + 'T00:00:00'), 'MMMM yyyy')
                  : 'This Month'
                }
                canGoNext={!isSameMonth(targetDate, new Date())}
              />
              
              <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
              <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">MTD</p>
                  <p className="text-lg sm:text-2xl font-bold">
                    {salesData?.monthly !== undefined ? formatCurrency(salesData.monthly) : "--"}
                  </p>
                  {salesData?.comparison?.prevMonth !== undefined && salesData.monthly !== undefined && (
                    <ComparisonBadge 
                      current={salesData.monthly} 
                      previous={salesData.comparison.prevMonth} 
                      label="last month"
                    />
                  )}
                </div>
                <div className="text-center min-w-0">
                  <p className="text-xs text-muted-foreground">Guests</p>
                  <p className="text-lg sm:text-2xl font-bold">
                    {salesData?.guestCount?.monthly ?? "--"}
                  </p>
                </div>
                <div className="text-right min-w-0">
                  <p className="text-xs text-muted-foreground">Avg Ticket</p>
                  <p className="text-lg sm:text-2xl font-bold">
                    {salesData?.guestCount?.monthly && salesData?.monthly 
                      ? formatCurrencyDecimal(salesData.monthly / salesData.guestCount.monthly) 
                      : "--"}
                  </p>
                </div>
              </div>

              {/* Croo AI Projection for Month */}
              {salesData?.projections?.monthProjected && salesData.projections.monthProjected > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-primary/10 to-purple-500/10 border border-primary/20 mb-2">
                  <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-primary to-purple-500">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Croo AI Projected Month Total:</span>
                    <span className="text-sm font-semibold text-primary">
                      {formatCurrency(salesData.projections.monthProjected)}
                    </span>
                  </div>
                </div>
              )}
              
              {/* Mobile: Show weekly aggregated view, Desktop: Show daily view */}
              {isMobile ? (
                // Mobile weekly aggregated view
                monthlyWeeklyAggregated.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={monthlyWeeklyAggregated} barCategoryGap="15%">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} />
                      <YAxis className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} tickFormatter={value => `$${value}`} />
                      <Tooltip 
                        formatter={(value, name) => [formatCurrency(value as number), name === 'projected' ? 'Projected' : 'Actual']}
                        labelFormatter={(label, payload) => {
                          if (payload?.[0]?.payload?.dateRange) {
                            return payload[0].payload.dateRange;
                          }
                          return label;
                        }}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '6px'
                        }} 
                      />
                      <Legend 
                        formatter={(value) => value === 'projected' ? 'Projected' : 'Actual'}
                        wrapperStyle={{ fontSize: '12px' }}
                      />
                      <Bar dataKey="projected" fill="hsl(var(--muted-foreground))" radius={[8, 8, 0, 0]} opacity={0.4} />
                      <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    No monthly data available
                  </div>
                )
              ) : (
                // Desktop daily view
                salesData?.monthlyBreakdown && salesData.monthlyBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={salesData.monthlyBreakdown.map(d => ({
                      ...d,
                      label: format(new Date(d.date + 'T00:00:00'), 'd')
                    }))} barCategoryGap="5%">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} interval={2} />
                      <YAxis className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} tickFormatter={value => `$${value}`} />
                      <Tooltip 
                        formatter={(value, name) => [formatCurrency(value as number), name === 'projected' ? 'Projected' : 'Actual']}
                        labelFormatter={(label, payload) => {
                          if (payload?.[0]?.payload?.date) {
                            return format(new Date(payload[0].payload.date + 'T00:00:00'), 'EEEE, MMM d');
                          }
                          return label;
                        }}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '6px'
                        }} 
                      />
                      <Legend 
                        formatter={(value) => value === 'projected' ? 'Projected' : 'Actual'}
                        wrapperStyle={{ fontSize: '12px' }}
                      />
                      <Bar dataKey="projected" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} opacity={0.4} />
                      <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                    No monthly data available
                  </div>
                )
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}