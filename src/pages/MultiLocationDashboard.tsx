import { useState, useMemo } from 'react';
import { Layout } from '@/components/Layout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Building2, TrendingUp, TrendingDown, Minus, ExternalLink, FileText, AlertTriangle, Check, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { resolveProjection } from '@/hooks/useResolvedProjection';
import { SalesSummaryChart } from '@/components/dashboard/SalesSummaryChart';
import { getDayOfWeekInTimezone } from '@/utils/timezoneUtils';
import { useNavigate } from 'react-router-dom';

interface LocationRow {
  id: string;
  name: string;
  store_number: string | null;
}

interface LocationSalesData {
  // Daily data
  sales: number;
  goal: number;
  pace: number;
  status: 'ahead' | 'behind' | 'on-track';
  hourlyData: Array<{ hour: string; sales: number; projected?: number }>;
  // Weekly totals
  weeklySales: number;
  weeklyGoal: number;
  weeklyStatus: 'ahead' | 'behind' | 'on-track';
  weeklyBreakdown: Array<{ date: string; sales: number; projected: number }>;
  // Monthly totals
  monthlySales: number;
  monthlyGoal: number;
  monthlyStatus: 'ahead' | 'behind' | 'on-track';
  monthlyBreakdown: Array<{ date: string; sales: number; projected: number }>;
}

interface LocationChecklistData {
  id: string;
  title: string;
  expected: number;
  completed: number;
}

interface LocationAuditData {
  id: string;
  audit_date: string;
  visit_score: string | null;
  manager_name: string | null;
  audit_url: string;
}

export default function MultiLocationDashboard() {
  const { organizationId } = useAppLocation();
  const navigate = useNavigate();
  const [chartPeriod, setChartPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch all locations in the organization
  const { data: locations = [], isLoading: locationsLoading } = useQuery({
    queryKey: ['org-locations', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, store_number')
        .eq('organization_id', organizationId)
        .order('name');
      
      if (error) throw error;
      return data as LocationRow[];
    },
    enabled: !!organizationId,
  });

  // Date ranges
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
  const monthStart = startOfMonth(new Date());
  const monthEnd = endOfMonth(new Date());
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
  const monthStartStr = format(monthStart, 'yyyy-MM-dd');
  const monthEndStr = format(monthEnd, 'yyyy-MM-dd');

  // Fetch sales data using the SAME edge function as SalesSummary (fetch-qubeyond-sales)
  // This ensures all data (sales, pace, projections, hourly) matches exactly.
  const { data: salesDataMap = {}, isLoading: salesLoading } = useQuery({
    queryKey: ['org-sales-data', locations.map(l => l.id), todayStr],
    queryFn: async () => {
      if (locations.length === 0) return {};
      
      // Call the edge function for each location in parallel — same source as SalesSummary
      const results = await Promise.all(
        locations.map(async (loc) => {
          try {
            const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", {
              body: { 
                locationId: loc.id,
                targetDate: todayStr,
                skipProjections: false,
                fastMode: false
              }
            });
            
            if (error || !data) {
              console.warn(`[OrgDash] Failed to fetch sales for ${loc.name}:`, error);
              return { locationId: loc.id, data: null };
            }
            
            return { locationId: loc.id, data };
          } catch (e) {
            console.warn(`[OrgDash] Exception fetching sales for ${loc.name}:`, e);
            return { locationId: loc.id, data: null };
          }
        })
      );
      
      const result: Record<string, LocationSalesData> = {};
      
      for (const { locationId, data: salesData } of results) {
        if (!salesData) {
          // No data — set defaults
          result[locationId] = {
            sales: 0,
            goal: 0,
            pace: 0,
            status: 'on-track',
            hourlyData: [],
            weeklySales: 0,
            weeklyGoal: 0,
            weeklyStatus: 'on-track',
            weeklyBreakdown: [],
            monthlySales: 0,
            monthlyGoal: 0,
            monthlyStatus: 'on-track',
            monthlyBreakdown: [],
          };
          continue;
        }
        
        // Extract data directly from edge function response — identical to SalesSummary
        const daily = salesData.daily || 0;
        const goal = salesData.projections?.todayProjected || 0;
        const pace = salesData.projections?.todayPaceAdjusted || 0;
        
        // Use hourly data directly from edge function (includes projected values)
        const hourlyData = (salesData.hourly || []) as Array<{ hour: string; sales: number; projected?: number }>;
        
        // Status calculation using pace vs goal
        let status: 'ahead' | 'behind' | 'on-track' = 'on-track';
        if (goal > 0 && pace > 0) {
          const pacePercent = (pace / goal) * 100;
          if (pacePercent >= 103) status = 'ahead';
          else if (pacePercent <= 97) status = 'behind';
        }
        
        // Weekly data from edge function
        const weeklySales = salesData.weekly || 0;
        const weeklyGoal = salesData.projections?.weekProjected || 0;
        const weeklyBreakdown = (salesData.weeklyBreakdown || []).map((d: any) => ({
          date: d.date,
          sales: d.sales || 0,
          projected: d.projected || 0,
        }));
        const weeklyStatus: 'ahead' | 'behind' | 'on-track' = weeklyGoal > 0 
          ? (weeklySales / weeklyGoal >= 1.03 ? 'ahead' : weeklySales / weeklyGoal <= 0.97 ? 'behind' : 'on-track')
          : 'on-track';
        
        // Monthly data from edge function
        const monthlySales = salesData.monthly || 0;
        const monthlyGoal = salesData.projections?.monthProjected || 0;
        const monthlyBreakdown = (salesData.monthlyBreakdown || []).map((d: any) => ({
          date: d.date,
          sales: d.sales || 0,
          projected: d.projected || 0,
        }));
        const monthlyStatus: 'ahead' | 'behind' | 'on-track' = monthlyGoal > 0 
          ? (monthlySales / monthlyGoal >= 1.03 ? 'ahead' : monthlySales / monthlyGoal <= 0.97 ? 'behind' : 'on-track')
          : 'on-track';
        
        result[locationId] = {
          sales: daily,
          goal,
          pace,
          status,
          hourlyData,
          weeklySales,
          weeklyGoal,
          weeklyStatus,
          weeklyBreakdown,
          monthlySales,
          monthlyGoal,
          monthlyStatus,
          monthlyBreakdown,
        };
      }
      
      return result;
    },
    enabled: locations.length > 0,
    refetchInterval: 60000,
  });

  // Fetch checklist data
  const { data: checklistDataMap = {}, isLoading: checklistsLoading } = useQuery({
    queryKey: ['org-checklists', locations.map(l => l.id), todayStr],
    queryFn: async () => {
      if (locations.length === 0) return {};
      
      const locationIds = locations.map(l => l.id);
      
      const { data: checklists, error: checklistError } = await supabase
        .from('checklists')
        .select('id, title, location_id, frequency, template_type, checklist_items(id, days_of_week)')
        .in('location_id', locationIds)
        .eq('is_active', true);
      
      if (checklistError) throw checklistError;
      
      const now = new Date();
      const cutoffHour = 4;
      const businessDayStart = new Date(now);
      businessDayStart.setHours(cutoffHour, 0, 0, 0);
      if (now.getHours() < cutoffHour) {
        businessDayStart.setDate(businessDayStart.getDate() - 1);
      }
      const businessDayEnd = new Date(businessDayStart);
      businessDayEnd.setDate(businessDayEnd.getDate() + 1);
      
      const { data: responses, error: responseError } = await supabase
        .from('checklist_responses')
        .select(`
          id,
          item_id,
          created_at,
          checklist_submissions!inner(id, checklist_id, location_id)
        `)
        .in('checklist_submissions.location_id', locationIds)
        .gte('created_at', businessDayStart.toISOString())
        .lte('created_at', businessDayEnd.toISOString());
      
      if (responseError) throw responseError;
      
      const result: Record<string, LocationChecklistData[]> = {};
      
      for (const loc of locations) {
        const locChecklists = checklists?.filter(c => c.location_id === loc.id) || [];
        const currentDay = getDayOfWeekInTimezone('America/Los_Angeles');
        
        const checklistData: LocationChecklistData[] = [];
        
        for (const checklist of locChecklists) {
          const items = checklist.checklist_items || [];
          let expectedCount = items.length;
          let todayItemIds: Set<string> | null = null;
          
          if (checklist.template_type === 'dynamic') {
            const todayItems = items.filter((item: any) => 
              item.days_of_week && item.days_of_week.includes(currentDay)
            );
            expectedCount = todayItems.length;
            todayItemIds = new Set(todayItems.map((item: any) => item.id));
            if (expectedCount === 0) continue;
          }
          
          const locResponses = responses?.filter((r: any) => 
            r.checklist_submissions?.checklist_id === checklist.id &&
            r.checklist_submissions?.location_id === loc.id
          ) || [];
          
          const uniqueItemIds = new Set<string>();
          locResponses.forEach((response: any) => {
            if (response.item_id) {
              if (todayItemIds === null || todayItemIds.has(response.item_id)) {
                uniqueItemIds.add(response.item_id);
              }
            }
          });
          
          checklistData.push({
            id: checklist.id,
            title: checklist.title,
            expected: expectedCount,
            completed: uniqueItemIds.size,
          });
        }
        
        result[loc.id] = checklistData;
      }
      
      return result;
    },
    enabled: locations.length > 0,
    refetchInterval: 30000,
  });

  // Fetch audits
  const { data: auditDataMap = {}, isLoading: auditsLoading } = useQuery({
    queryKey: ['org-audits', locations.map(l => l.id)],
    queryFn: async () => {
      if (locations.length === 0) return {};
      
      const locationIds = locations.map(l => l.id);
      
      const { data: audits, error } = await supabase
        .from('food_safety_audits')
        .select('id, location_id, audit_date, visit_score, manager_name, audit_url')
        .in('location_id', locationIds)
        .order('audit_date', { ascending: false });
      
      if (error) throw error;
      
      const result: Record<string, LocationAuditData> = {};
      for (const audit of audits || []) {
        if (!result[audit.location_id]) {
          result[audit.location_id] = {
            id: audit.id,
            audit_date: audit.audit_date,
            visit_score: audit.visit_score,
            manager_name: audit.manager_name,
            audit_url: audit.audit_url,
          };
        }
      }
      
      return result;
    },
    enabled: locations.length > 0,
  });

  const isLoading = locationsLoading || salesLoading || checklistsLoading || auditsLoading;

  // Filter locations based on search query
  const filteredLocations = useMemo(() => {
    if (!searchQuery.trim()) return locations;
    const query = searchQuery.toLowerCase();
    return locations.filter(loc => {
      const audit = auditDataMap[loc.id];
      const matchesName = loc.name.toLowerCase().includes(query);
      const matchesStoreNumber = loc.store_number?.toLowerCase().includes(query);
      const matchesManager = audit?.manager_name?.toLowerCase().includes(query);
      return matchesName || matchesStoreNumber || matchesManager;
    });
  }, [locations, searchQuery, auditDataMap]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusIcon = (status: 'ahead' | 'behind' | 'on-track') => {
    switch (status) {
      case 'ahead':
        return <TrendingUp className="h-3.5 w-3.5 text-green-500" />;
      case 'behind':
        return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
      default:
        return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: 'ahead' | 'behind' | 'on-track') => {
    switch (status) {
      case 'ahead':
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/30 text-xs px-1.5 py-0">Ahead</Badge>;
      case 'behind':
        return <Badge className="bg-red-500/20 text-red-500 border-red-500/30 text-xs px-1.5 py-0">Behind</Badge>;
      default:
        return <Badge className="bg-muted text-muted-foreground text-xs px-1.5 py-0">On Track</Badge>;
    }
  };

  // Compact checklist row component with card styling
  const ChecklistRow = ({ checklist }: { checklist: LocationChecklistData }) => {
    const completionRate = checklist.expected > 0 
      ? Math.min(100, Math.round((checklist.completed / checklist.expected) * 100)) 
      : 0;
    const isComplete = completionRate === 100;
    
    return (
      <button
        onClick={() => navigate(`/complete/${checklist.id}`)}
        className={`flex items-center gap-2 p-2 rounded-md border transition-colors w-full text-left ${
          isComplete 
            ? 'bg-green-500/10 border-green-500/30 hover:bg-green-500/20' 
            : 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20'
        }`}
      >
        <div className={`flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 ${
          isComplete ? 'bg-green-500' : 'bg-red-500'
        }`}>
          {isComplete ? (
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          ) : (
            <span className="text-white text-xs font-bold">✕</span>
          )}
        </div>
        <span className="text-xs truncate flex-1">{checklist.title}</span>
        <span className={`text-xs font-medium ${isComplete ? 'text-green-600' : 'text-red-600'}`}>
          {completionRate}%
        </span>
      </button>
    );
  };

  if (!organizationId) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <Card className="max-w-md mx-auto p-8">
            <div className="flex flex-col items-center justify-center text-center">
              <Building2 className="h-16 w-16 text-muted-foreground mb-4" />
              <h1 className="text-2xl font-bold mb-2">No Organization</h1>
              <p className="text-muted-foreground">
                You need to be part of an organization to view this dashboard.
              </p>
            </div>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-4">
        {/* Header with title, search, and period selector */}
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Org Dashboard</h1>
            <Tabs value={chartPeriod} onValueChange={(v) => setChartPeriod(v as any)}>
              <TabsList className="h-8">
                <TabsTrigger value="daily" className="text-xs px-2 sm:px-3 h-7">Today</TabsTrigger>
                <TabsTrigger value="weekly" className="text-xs px-2 sm:px-3 h-7">Week</TabsTrigger>
                <TabsTrigger value="monthly" className="text-xs px-2 sm:px-3 h-7">Month</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search locations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 w-full text-sm"
            />
          </div>
        </div>
        
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="p-4">
                <div className="flex gap-4">
                  <Skeleton className="h-24 w-48" />
                  <Skeleton className="h-24 flex-1" />
                  <Skeleton className="h-24 w-40" />
                  <Skeleton className="h-24 w-36" />
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredLocations.map((location) => {
              const salesData = salesDataMap[location.id];
              const checklists = checklistDataMap[location.id] || [];
              const audit = auditDataMap[location.id];
              
              return (
                <Card key={location.id} className="p-3 overflow-hidden">
                  <div className="flex flex-col gap-4 md:grid md:grid-cols-[180px_minmax(200px,1fr)_220px_180px] md:gap-3">
                    {/* Column 1: Store Info + Sales - Compact */}
                    <div className="flex flex-col gap-1.5">
                      {/* Location tag - name on one line, number below */}
                      <div className="flex flex-col bg-primary/10 border border-primary/20 rounded-md px-2 py-1 w-fit">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-primary" />
                          <span className="text-sm font-semibold">{location.name}</span>
                        </div>
                        {location.store_number && (
                          <span className="text-xs text-muted-foreground ml-5">#{location.store_number}</span>
                        )}
                      </div>
                      
                      {/* Sales info - period-aware */}
                      {salesData ? (() => {
                        const displaySales = chartPeriod === 'daily' ? salesData.sales 
                          : chartPeriod === 'weekly' ? salesData.weeklySales 
                          : salesData.monthlySales;
                        const displayGoal = chartPeriod === 'daily' ? salesData.goal 
                          : chartPeriod === 'weekly' ? salesData.weeklyGoal 
                          : salesData.monthlyGoal;
                        const displayStatus = chartPeriod === 'daily' ? salesData.status 
                          : chartPeriod === 'weekly' ? salesData.weeklyStatus 
                          : salesData.monthlyStatus;
                        // Pace only makes sense for daily
                        const showPace = chartPeriod === 'daily';
                        
                        return (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs text-muted-foreground">Sales</span>
                              <span className="text-base font-bold">{formatCurrency(displaySales)}</span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs text-muted-foreground">AI Goal</span>
                              <span className="text-sm font-semibold text-muted-foreground">{formatCurrency(displayGoal)}</span>
                            </div>
                            {showPace && (
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-xs text-muted-foreground">Pace</span>
                                <span className="text-sm font-semibold">{formatCurrency(salesData.pace)}</span>
                              </div>
                            )}
                            {/* Status badge */}
                            <div className="flex items-center gap-1 mt-0.5">
                              {getStatusIcon(displayStatus)}
                              {getStatusBadge(displayStatus)}
                            </div>
                          </div>
                        );
                      })() : (
                        <div className="text-sm text-muted-foreground">No sales data</div>
                      )}
                    </div>
                    
                    {/* Column 2: Sales Chart */}
                    <div className="h-48 md:h-32">
                      {salesData ? (
                        <SalesSummaryChart
                          period={chartPeriod}
                          hourly={chartPeriod === 'daily' ? salesData.hourlyData : undefined}
                          weeklyBreakdown={chartPeriod === 'weekly' ? salesData.weeklyBreakdown : undefined}
                          monthlyBreakdown={chartPeriod === 'monthly' ? salesData.monthlyBreakdown : undefined}
                          compact
                        />
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-muted-foreground bg-muted/30 rounded-lg">
                          No chart data
                        </div>
                      )}
                    </div>
                    
                    {/* Column 3: Checklists - Card styling per item */}
                    <div className="flex flex-col gap-1.5">
                      {checklists.length > 0 ? (
                        checklists.map((checklist) => (
                          <ChecklistRow key={checklist.id} checklist={checklist} />
                        ))
                      ) : (
                        <div className="flex items-center justify-center text-sm text-muted-foreground bg-muted/30 rounded-lg py-4">
                          No checklists
                        </div>
                      )}
                    </div>
                    
                    {/* Column 4: Steritech Audit */}
                    <div className="rounded-lg border bg-card p-2.5">
                      {audit ? (
                        <a
                          href={audit.audit_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <div className="flex flex-col hover:bg-muted/30 -m-2.5 p-2.5 rounded-lg transition-colors">
                            <div className="flex items-center gap-2 mb-2">
                              <FileText className="h-3.5 w-3.5 text-primary" />
                              <span className="font-medium text-xs">Steritech Audit</span>
                              <ExternalLink className="h-3 w-3 text-muted-foreground ml-auto" />
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">Date</span>
                                <span className="font-medium">{format(new Date(audit.audit_date), 'MMM d, yyyy')}</span>
                              </div>
                              {audit.visit_score && (
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Score</span>
                                  <span className="text-sm font-bold text-primary">{audit.visit_score}</span>
                                </div>
                              )}
                              {audit.manager_name && (
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Manager</span>
                                  <span className="font-medium truncate max-w-[100px]">{audit.manager_name}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </a>
                      ) : (
                        <div className="flex flex-col items-center justify-center text-xs text-muted-foreground py-3">
                          <AlertTriangle className="h-4 w-4 mb-1 text-yellow-500" />
                          No audit
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
            
            {filteredLocations.length === 0 && (
              <Card className="p-8">
                <div className="flex flex-col items-center justify-center text-center">
                  <Search className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-lg font-medium">No locations found</p>
                  <p className="text-sm text-muted-foreground">Try adjusting your search query</p>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
