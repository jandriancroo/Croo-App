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
  sales: number;
  goal: number;
  pace: number;
  status: 'ahead' | 'behind' | 'on-track';
  hourlyData: Array<{ hour: string; sales: number; projected?: number }>;
  weeklyBreakdown: Array<{ date: string; sales: number; projected: number }>;
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

  const { data: salesDataMap = {}, isLoading: salesLoading } = useQuery({
    queryKey: ['org-sales-data', locations.map(l => l.id), todayStr],
    queryFn: async () => {
      if (locations.length === 0) return {};
      
      const locationIds = locations.map(l => l.id);
      
      // Fetch sales data for today, week, and month
      const [todayResult, weekResult, monthResult] = await Promise.all([
        supabase
          .from('sales_cache')
          .select('location_id, net_sales, hourly_data, projected_sales, initial_projection, living_projection, override_projection')
          .in('location_id', locationIds)
          .eq('sale_date', todayStr),
        supabase
          .from('sales_cache')
          .select('location_id, sale_date, net_sales, projected_sales, initial_projection, living_projection, override_projection')
          .in('location_id', locationIds)
          .gte('sale_date', weekStartStr)
          .lte('sale_date', weekEndStr),
        supabase
          .from('sales_cache')
          .select('location_id, sale_date, net_sales, projected_sales, initial_projection, living_projection, override_projection')
          .in('location_id', locationIds)
          .gte('sale_date', monthStartStr)
          .lte('sale_date', monthEndStr),
      ]);
      
      if (todayResult.error) throw todayResult.error;
      
      const result: Record<string, LocationSalesData> = {};
      
      for (const loc of locations) {
        const todayRow = todayResult.data?.find(s => s.location_id === loc.id);
        const sales = todayRow ? Number(todayRow.net_sales) || 0 : 0;
        
        // Use projection resolution
        const resolved = resolveProjection(todayRow as any);
        const goal = resolved.value || 0;
        
        const currentHour = new Date().getHours();
        const hourlyData = todayRow?.hourly_data as Array<{ hour: string; sales: number; projected?: number }> || [];
        
        let expectedSoFar = 0;
        for (const h of hourlyData) {
          const hourNum = parseInt(h.hour.split(':')[0]);
          if (hourNum <= currentHour) {
            expectedSoFar += (h.projected || 0);
          }
        }
        
        const progressRate = expectedSoFar > 0 ? sales / expectedSoFar : (sales > 0 ? 1 : 0);
        const paceAdjusted = goal > 0 ? Math.round(goal * progressRate) : sales;
        
        let status: 'ahead' | 'behind' | 'on-track' = 'on-track';
        if (goal > 0 && expectedSoFar > 0) {
          const pacePercent = (sales / expectedSoFar) * 100;
          if (pacePercent >= 103) status = 'ahead';
          else if (pacePercent <= 97) status = 'behind';
        }
        
        // Build weekly breakdown
        const weekData = weekResult.data?.filter(s => s.location_id === loc.id) || [];
        const weeklyBreakdown: { date: string; sales: number; projected: number }[] = [];
        for (let i = 0; i < 7; i++) {
          const dayDate = new Date(weekStart);
          dayDate.setDate(dayDate.getDate() + i);
          const dayStr = format(dayDate, 'yyyy-MM-dd');
          const dayData = weekData.find(d => d.sale_date === dayStr);
          const dayResolved = resolveProjection(dayData as any);
          weeklyBreakdown.push({
            date: dayStr,
            sales: dayData ? Number(dayData.net_sales) || 0 : 0,
            projected: dayResolved.value || 0,
          });
        }
        
        // Build monthly breakdown
        const monthData = monthResult.data?.filter(s => s.location_id === loc.id) || [];
        const daysInMonth = monthEnd.getDate();
        const monthlyBreakdown: { date: string; sales: number; projected: number }[] = [];
        for (let day = 1; day <= daysInMonth; day++) {
          const dayDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
          const dayStr = format(dayDate, 'yyyy-MM-dd');
          const dayData = monthData.find(d => d.sale_date === dayStr);
          const dayResolved = resolveProjection(dayData as any);
          monthlyBreakdown.push({
            date: dayStr,
            sales: dayData ? Number(dayData.net_sales) || 0 : 0,
            projected: dayResolved.value || 0,
          });
        }
        
        result[loc.id] = {
          sales,
          goal,
          pace: paceAdjusted,
          status,
          hourlyData,
          weeklyBreakdown,
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h1 className="text-xl font-bold">Org Dashboard</h1>
          <div className="flex items-center gap-3">
            <Tabs value={chartPeriod} onValueChange={(v) => setChartPeriod(v as any)}>
              <TabsList className="h-8">
                <TabsTrigger value="daily" className="text-xs px-3 h-7">Today</TabsTrigger>
                <TabsTrigger value="weekly" className="text-xs px-3 h-7">Week</TabsTrigger>
                <TabsTrigger value="monthly" className="text-xs px-3 h-7">Month</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search locations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 w-48 text-sm"
              />
            </div>
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
                  <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_180px_180px] gap-3">
                    {/* Column 1: Store Info + Sales - Compact */}
                    <div className="flex flex-col gap-1.5">
                      {/* Location tag */}
                      <div className="inline-flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-md px-2 py-1 w-fit">
                        <Building2 className="h-3.5 w-3.5 text-primary" />
                        <span className="text-sm font-semibold">{location.name}</span>
                        {location.store_number && (
                          <span className="text-xs text-muted-foreground">#{location.store_number}</span>
                        )}
                      </div>
                      
                      {/* Sales info - tighter spacing */}
                      {salesData ? (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-muted-foreground">Sales</span>
                            <span className="text-base font-bold">{formatCurrency(salesData.sales)}</span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-muted-foreground">AI Goal</span>
                            <span className="text-sm font-semibold text-muted-foreground">{formatCurrency(salesData.goal)}</span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-muted-foreground">Pace</span>
                            <span className="text-sm font-semibold">{formatCurrency(salesData.pace)}</span>
                          </div>
                          {/* Status badge */}
                          <div className="flex items-center gap-1 mt-0.5">
                            {getStatusIcon(salesData.status)}
                            {getStatusBadge(salesData.status)}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No sales data</div>
                      )}
                    </div>
                    
                    {/* Column 2: Sales Chart */}
                    <div className="h-36 md:h-32">
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
