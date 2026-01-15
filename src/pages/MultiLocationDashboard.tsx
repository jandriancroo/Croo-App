import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2, TrendingUp, TrendingDown, Minus, ExternalLink, FileText, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useAuth } from '@/lib/auth';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { resolveProjection } from '@/hooks/useResolvedProjection';
import { ChecklistCard } from '@/components/dashboard/ChecklistCard';
import { SalesSummaryChart } from '@/components/dashboard/SalesSummaryChart';
import { getDayOfWeekInTimezone } from '@/utils/timezoneUtils';

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
  const { user } = useAuth();

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

  // Fetch sales data for all locations (today's data from sales_cache)
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const { data: salesDataMap = {}, isLoading: salesLoading } = useQuery({
    queryKey: ['org-sales-data', locations.map(l => l.id), todayStr],
    queryFn: async () => {
      if (locations.length === 0) return {};
      
      const locationIds = locations.map(l => l.id);
      
      // Fetch today's sales + hourly data from sales_cache for all locations
      const { data: salesData, error } = await supabase
        .from('sales_cache')
        .select('location_id, net_sales, hourly_data, projected_sales, initial_projection, living_projection, override_projection')
        .in('location_id', locationIds)
        .eq('sale_date', todayStr);
      
      if (error) throw error;
      
      const result: Record<string, LocationSalesData> = {};
      
      for (const loc of locations) {
        const row = salesData?.find(s => s.location_id === loc.id);
        const sales = row ? Number(row.net_sales) || 0 : 0;
        
        // Use projection resolution: override > living > initial > legacy
        const resolved = resolveProjection(row as any);
        const goal = resolved.value || 0;
        
        // Calculate pace: where we should be vs where we are
        const currentHour = new Date().getHours();
        const hourlyData = row?.hourly_data as Array<{ hour: string; sales: number; projected?: number }> || [];
        
        // Sum projected sales up to current hour to get expected progress
        let expectedSoFar = 0;
        for (const h of hourlyData) {
          const hourNum = parseInt(h.hour.split(':')[0]);
          if (hourNum <= currentHour) {
            expectedSoFar += (h.projected || 0);
          }
        }
        
        // Calculate pace-adjusted projection
        const progressRate = expectedSoFar > 0 ? sales / expectedSoFar : (sales > 0 ? 1 : 0);
        const paceAdjusted = goal > 0 ? Math.round(goal * progressRate) : sales;
        
        // Determine status
        let status: 'ahead' | 'behind' | 'on-track' = 'on-track';
        if (goal > 0 && expectedSoFar > 0) {
          const pacePercent = (sales / expectedSoFar) * 100;
          if (pacePercent >= 103) status = 'ahead';
          else if (pacePercent <= 97) status = 'behind';
        }
        
        result[loc.id] = {
          sales,
          goal,
          pace: paceAdjusted,
          status,
          hourlyData,
        };
      }
      
      return result;
    },
    enabled: locations.length > 0,
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch checklist data for all locations
  const { data: checklistDataMap = {}, isLoading: checklistsLoading } = useQuery({
    queryKey: ['org-checklists', locations.map(l => l.id), todayStr],
    queryFn: async () => {
      if (locations.length === 0) return {};
      
      const locationIds = locations.map(l => l.id);
      
      // Get all active checklists for these locations
      const { data: checklists, error: checklistError } = await supabase
        .from('checklists')
        .select('id, title, location_id, frequency, template_type, checklist_items(id, days_of_week)')
        .in('location_id', locationIds)
        .eq('is_active', true);
      
      if (checklistError) throw checklistError;
      
      // Get today's submissions for all locations
      // Use business day logic: 4 AM today to 4 AM tomorrow
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
          
          // For dynamic checklists, only count items scheduled for today
          let expectedCount = items.length;
          let todayItemIds: Set<string> | null = null;
          
          if (checklist.template_type === 'dynamic') {
            const todayItems = items.filter((item: any) => 
              item.days_of_week && item.days_of_week.includes(currentDay)
            );
            expectedCount = todayItems.length;
            todayItemIds = new Set(todayItems.map((item: any) => item.id));
            
            // Skip if no items for today
            if (expectedCount === 0) continue;
          }
          
          // Count completed items
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
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch latest Steritech audit for all locations
  const { data: auditDataMap = {}, isLoading: auditsLoading } = useQuery({
    queryKey: ['org-audits', locations.map(l => l.id)],
    queryFn: async () => {
      if (locations.length === 0) return {};
      
      const locationIds = locations.map(l => l.id);
      
      // Get most recent audit for each location
      const { data: audits, error } = await supabase
        .from('food_safety_audits')
        .select('id, location_id, audit_date, visit_score, manager_name, audit_url')
        .in('location_id', locationIds)
        .order('audit_date', { ascending: false });
      
      if (error) throw error;
      
      const result: Record<string, LocationAuditData> = {};
      
      // Group by location, take first (most recent)
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
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'behind':
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      default:
        return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: 'ahead' | 'behind' | 'on-track') => {
    switch (status) {
      case 'ahead':
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/30">Ahead</Badge>;
      case 'behind':
        return <Badge className="bg-red-500/20 text-red-500 border-red-500/30">Behind</Badge>;
      default:
        return <Badge className="bg-muted text-muted-foreground">On Track</Badge>;
    }
  };

  if (!organizationId) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <Card className="max-w-md mx-auto">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Building2 className="h-16 w-16 text-muted-foreground mb-4" />
              <h1 className="text-2xl font-bold mb-2">No Organization</h1>
              <p className="text-muted-foreground">
                You need to be part of an organization to view this dashboard.
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-6">Org Dashboard</h1>
        
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="p-4">
                <div className="flex gap-4">
                  <Skeleton className="h-24 w-48" />
                  <Skeleton className="h-24 flex-1" />
                  <Skeleton className="h-24 w-48" />
                  <Skeleton className="h-24 w-48" />
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {locations.map((location) => {
              const salesData = salesDataMap[location.id];
              const checklists = checklistDataMap[location.id] || [];
              const audit = auditDataMap[location.id];
              
              return (
                <Card key={location.id} className="p-4 overflow-hidden">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Column 1: Store Info */}
                    <div className="flex flex-col justify-between">
                      <div>
                        <h2 className="text-lg font-bold">{location.name}</h2>
                        {location.store_number && (
                          <p className="text-sm text-muted-foreground">#{location.store_number}</p>
                        )}
                      </div>
                      
                      {salesData ? (
                        <div className="mt-3 space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Sales</span>
                            <span className="font-semibold">{formatCurrency(salesData.sales)}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Live AI Goal</span>
                            <span className="font-semibold">{formatCurrency(salesData.goal)}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Pace</span>
                            <span className="font-semibold">{formatCurrency(salesData.pace)}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            {getStatusIcon(salesData.status)}
                            {getStatusBadge(salesData.status)}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 text-sm text-muted-foreground">No sales data</div>
                      )}
                    </div>
                    
                    {/* Column 2: Sales Chart */}
                    <div className="h-32 md:h-auto">
                      {salesData && salesData.hourlyData.length > 0 ? (
                        <SalesSummaryChart
                          period="daily"
                          hourly={salesData.hourlyData.map(h => ({
                            hour: h.hour,
                            sales: h.sales,
                            projected: h.projected,
                          }))}
                          compact
                        />
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-muted-foreground bg-muted/30 rounded-lg">
                          No chart data
                        </div>
                      )}
                    </div>
                    
                    {/* Column 3: Checklists */}
                    <div>
                      {checklists.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {checklists.slice(0, 4).map((checklist) => (
                            <ChecklistCard
                              key={checklist.id}
                              checklistId={checklist.id}
                              title={checklist.title}
                              completed={checklist.completed}
                              expected={checklist.expected}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-muted-foreground bg-muted/30 rounded-lg p-4">
                          No checklists
                        </div>
                      )}
                    </div>
                    
                    {/* Column 4: Steritech Audit */}
                    <div>
                      {audit ? (
                        <a
                          href={audit.audit_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block h-full"
                        >
                          <Card className="h-full p-3 hover:bg-muted/50 transition-colors cursor-pointer border-dashed">
                            <div className="flex items-start gap-2 mb-2">
                              <FileText className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                              <span className="text-sm font-medium">Steritech Audit</span>
                              <ExternalLink className="h-3 w-3 text-muted-foreground ml-auto" />
                            </div>
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Date</span>
                                <span>{format(new Date(audit.audit_date), 'MMM d, yyyy')}</span>
                              </div>
                              {audit.visit_score && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Score</span>
                                  <span className="font-semibold">{audit.visit_score}</span>
                                </div>
                              )}
                              {audit.manager_name && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Manager</span>
                                  <span className="truncate max-w-[100px]">{audit.manager_name}</span>
                                </div>
                              )}
                            </div>
                          </Card>
                        </a>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-sm text-muted-foreground bg-muted/30 rounded-lg p-4">
                          <AlertTriangle className="h-5 w-5 mb-1 text-yellow-500" />
                          No audit data
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
