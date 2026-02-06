import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Minus, Building2, ClipboardCheck, ChevronDown, ChevronRight, ExternalLink, AlertTriangle, AlertCircle, Info, Trophy, Star, MessageSquare } from 'lucide-react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface LocationSalesData {
  locationId: string;
  locationName: string;
  organizationName: string;
  actual: number;
  projected: number;
}

interface AuditData {
  id: string;
  locationId: string;
  locationName: string;
  auditDate: string;
  visitScore: string | null;
  managerName: string | null;
  auditUrl: string;
  firstPriorityItems: string[] | null;
  secondPriorityItems: string[] | null;
  thirdPriorityItems: string[] | null;
}

interface OvationScore {
  locationId: string;
  locationName: string;
  averageScore: number;
  totalResponses: number;
  nps?: number;
}

export default function FBCDashboard() {
  const { user } = useAuth();
  const [salesPeriod, setSalesPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [expandedAudits, setExpandedAudits] = useState<Set<string>>(new Set());

  // Fetch brand membership to determine which brand's locations to show
  const { data: brandMembership, isLoading: brandLoading } = useQuery({
    queryKey: ['fbc-brand-membership', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      
      // Check if super_admin (sees all)
      const { data: isSuperAdmin } = await supabase.rpc('is_super_admin', { _user_id: user.id });
      if (isSuperAdmin) {
        return { isSuperAdmin: true, brandId: null };
      }
      
      // Get brand membership
      const { data: membership } = await supabase
        .from('brand_members')
        .select('brand_id, brand_role')
        .eq('user_id', user.id)
        .single();
      
      return { isSuperAdmin: false, brandId: membership?.brand_id, brandRole: membership?.brand_role };
    },
    enabled: !!user?.id,
  });

  // Fetch locations based on brand access
  const { data: locations, isLoading: locationsLoading } = useQuery({
    queryKey: ['fbc-locations', brandMembership?.brandId, brandMembership?.isSuperAdmin],
    queryFn: async () => {
      let query = supabase
        .from('locations')
        .select(`
          id,
          name,
          organization_id,
          organizations!inner(id, name, brand_name, brand_id)
        `)
        .eq('location_type', 'standard');
      
      // If not super admin, filter by brand
      if (!brandMembership?.isSuperAdmin && brandMembership?.brandId) {
        query = query.eq('organizations.brand_id', brandMembership.brandId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!brandMembership,
  });

  // Fetch sales data for all locations
  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['fbc-sales-data', locations?.map(l => l.id), salesPeriod],
    queryFn: async () => {
      if (!locations?.length) return [];
      
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');
      const weekStart = startOfWeek(today, { weekStartsOn: 1 });
      const weekStartStr = format(weekStart, 'yyyy-MM-dd');
      const monthStart = startOfMonth(today);
      const monthStartStr = format(monthStart, 'yyyy-MM-dd');
      
      // Fetch sales for each location from QuBeyond
      const salesResults: LocationSalesData[] = [];
      
      for (const loc of locations) {
        const org = loc.organizations as any;
        
        // Try to fetch real sales data
        try {
          const { data: integrationData } = await supabase
            .from('location_integrations')
            .select('credentials')
            .eq('location_id', loc.id)
            .eq('integration_type', 'qubeyond')
            .eq('is_active', true)
            .single();
          
          if (integrationData?.credentials) {
            // Call QuBeyond API for this location
            const { data: salesResponse } = await supabase.functions.invoke('fetch-qubeyond-sales', {
              body: { 
                locationId: loc.id,
                includeProjections: true
              }
            });
            
          if (salesResponse) {
            let actual = 0;
            let projected = 0;
            
            if (salesPeriod === 'daily') {
              actual = typeof salesResponse.daily === 'number' ? salesResponse.daily : (salesResponse.daily?.total || 0);
              projected = salesResponse.projections?.todayProjected || salesResponse.projections?.todayPaceAdjusted || 0;
            } else if (salesPeriod === 'weekly') {
              actual = typeof salesResponse.weekly === 'number' ? salesResponse.weekly : (salesResponse.weekly?.total || 0);
              projected = salesResponse.projections?.weekProjected || 0;
            } else {
              actual = typeof salesResponse.monthly === 'number' ? salesResponse.monthly : (salesResponse.monthly?.total || 0);
              projected = salesResponse.projections?.monthProjected || 0;
            }
              
              salesResults.push({
                locationId: loc.id,
                locationName: loc.name,
                organizationName: org?.brand_name || org?.name || 'Unknown',
                actual,
                projected,
              });
              continue;
            }
          }
        } catch (err) {
          console.error(`Failed to fetch sales for ${loc.name}:`, err);
        }
        
        // Fallback: no data available
        salesResults.push({
          locationId: loc.id,
          locationName: loc.name,
          organizationName: org?.brand_name || org?.name || 'Unknown',
          actual: 0,
          projected: 0,
        });
      }
      
      // Sort by actual sales descending
      return salesResults.sort((a, b) => b.actual - a.actual);
    },
    enabled: !!locations?.length,
  });

  // Fetch recent audits for all locations
  const { data: audits, isLoading: auditsLoading } = useQuery({
    queryKey: ['fbc-audits', locations?.map(l => l.id)],
    queryFn: async () => {
      if (!locations?.length) return [];
      
      const locationIds = locations.map(l => l.id);
      
      const { data, error } = await supabase
        .from('food_safety_audits')
        .select(`
          id,
          location_id,
          audit_date,
          audit_url,
          visit_score,
          manager_name,
          first_priority_items,
          second_priority_items,
          third_priority_items,
          locations!inner(name)
        `)
        .in('location_id', locationIds)
        .order('visit_score', { ascending: false, nullsFirst: false })
        .limit(50);
      
      if (error) throw error;
      
      return (data || []).map(audit => ({
        id: audit.id,
        locationId: audit.location_id,
        locationName: (audit.locations as any)?.name || 'Unknown',
        auditDate: audit.audit_date,
        auditUrl: audit.audit_url,
        visitScore: audit.visit_score,
        managerName: audit.manager_name,
        firstPriorityItems: audit.first_priority_items as string[] | null,
        secondPriorityItems: audit.second_priority_items as string[] | null,
        thirdPriorityItems: audit.third_priority_items as string[] | null,
      }));
    },
    enabled: !!locations?.length,
  });

  // Fetch OvationUp scores
  const { data: ovationData, isLoading: ovationLoading, error: ovationError } = useQuery({
    queryKey: ['fbc-ovation-scores', brandMembership?.brandId, locations?.map(l => l.id)],
    queryFn: async () => {
      if (!brandMembership?.brandId && !brandMembership?.isSuperAdmin) return { scores: [], error: null };
      
      const { data, error } = await supabase.functions.invoke('data-sync-service?action=fetch-ovation-scores', {
        body: {
          brandId: brandMembership.brandId,
          locationIds: locations?.map(l => l.id) || [],
        }
      });
      
      if (error) {
        console.error('OvationUp fetch error:', error);
        return { scores: [], error: 'Failed to fetch OvationUp data' };
      }
      
      return data as { scores: OvationScore[]; error?: string; raw?: any };
    },
    enabled: !!brandMembership && !!locations?.length,
  });

  // Sort audits by score for leaderboard
  const sortedAudits = audits?.slice().sort((a, b) => {
    const scoreA = parseFloat(a.visitScore || '0');
    const scoreB = parseFloat(b.visitScore || '0');
    return scoreB - scoreA;
  });

  const isLoading = brandLoading || locationsLoading;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getVariancePercent = (actual: number, projected: number) => {
    if (projected === 0) return 0;
    return ((actual - projected) / projected) * 100;
  };

  const getVarianceIndicator = (actual: number, projected: number) => {
    const variance = actual - projected;
    const percentVariance = getVariancePercent(actual, projected).toFixed(1);
    
    if (variance > 0) {
      return (
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm font-medium">
          <TrendingUp className="h-3 w-3" />
          +{percentVariance}%
        </span>
      );
    } else if (variance < 0) {
      return (
        <span className="flex items-center gap-1 text-red-600 dark:text-red-400 text-sm font-medium">
          <TrendingDown className="h-3 w-3" />
          {percentVariance}%
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-muted-foreground text-sm">
        <Minus className="h-3 w-3" />
        0%
      </span>
    );
  };

  const getScoreBadgeVariant = (score: string | null) => {
    if (!score) return 'secondary';
    const numScore = parseFloat(score);
    if (numScore >= 90) return 'default';
    if (numScore >= 80) return 'secondary';
    return 'destructive';
  };

  const getBarWidth = (value: number, maxValue: number) => {
    if (maxValue === 0) return 0;
    return Math.min((value / maxValue) * 100, 100);
  };

  const maxSales = Math.max(
    ...(salesData?.map(s => Math.max(s.actual, s.projected)) || [1])
  );

  const getPeriodDateRange = () => {
    const today = new Date();
    if (salesPeriod === 'daily') {
      return format(today, 'MMMM d, yyyy');
    } else if (salesPeriod === 'weekly') {
      const weekStart = startOfWeek(today, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
      return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
    } else {
      return format(today, 'MMMM yyyy');
    }
  };

  const toggleExpanded = (auditId: string) => {
    setExpandedAudits(prev => {
      const next = new Set(prev);
      if (next.has(auditId)) {
        next.delete(auditId);
      } else {
        next.add(auditId);
      }
      return next;
    });
  };

  const hasSummary = (audit: AuditData) => {
    return audit.visitScore || 
           (audit.firstPriorityItems && audit.firstPriorityItems.length > 0) ||
           (audit.secondPriorityItems && audit.secondPriorityItems.length > 0) ||
           (audit.thirdPriorityItems && audit.thirdPriorityItems.length > 0);
  };

  const getRankIcon = (index: number) => {
    if (index === 0) return <Trophy className="h-5 w-5 text-yellow-500" />;
    if (index === 1) return <Trophy className="h-5 w-5 text-gray-400" />;
    if (index === 2) return <Trophy className="h-5 w-5 text-amber-600" />;
    return <span className="w-5 h-5 flex items-center justify-center text-sm font-bold text-muted-foreground">#{index + 1}</span>;
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Brand Dash</h1>
          <p className="text-muted-foreground">Brand-Level Overview Across Organizations</p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : (
          <Tabs defaultValue="sales" className="space-y-4">
            <TabsList>
              <TabsTrigger value="sales" className="gap-2">
                <Building2 className="h-4 w-4" />
                Sales by Location
              </TabsTrigger>
              <TabsTrigger value="audits" className="gap-2">
                <ClipboardCheck className="h-4 w-4" />
                Audit Leaderboard
              </TabsTrigger>
              <TabsTrigger value="ovation" className="gap-2">
                <Star className="h-4 w-4" />
                Guest Feedback
              </TabsTrigger>
            </TabsList>

            <TabsContent value="sales" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <CardTitle className="text-lg">Location Performance</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">{getPeriodDateRange()}</p>
                    </div>
                    <Tabs value={salesPeriod} onValueChange={(v) => setSalesPeriod(v as any)} className="w-auto">
                      <TabsList className="h-8">
                        <TabsTrigger value="daily" className="text-xs px-3 h-7">Daily</TabsTrigger>
                        <TabsTrigger value="weekly" className="text-xs px-3 h-7">Weekly</TabsTrigger>
                        <TabsTrigger value="monthly" className="text-xs px-3 h-7">Monthly</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </CardHeader>
                <CardContent>
                  {salesLoading ? (
                    <div className="space-y-4">
                      {[1, 2, 3].map(i => (
                        <Skeleton key={i} className="h-20 w-full" />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {salesData?.map((loc, index) => (
                        <div key={loc.locationId} className="border rounded-lg p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <div className="font-semibold">{loc.locationName}</div>
                              <div className="text-xs text-muted-foreground">{loc.organizationName}</div>
                            </div>
                            <div className="text-right">
                              {getVarianceIndicator(loc.actual, loc.projected)}
                            </div>
                          </div>
                          
                          {/* Projection Bar */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground w-16 shrink-0">Projected</span>
                              <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-blue-500/30 rounded-full transition-all duration-500"
                                  style={{ width: `${getBarWidth(loc.projected, maxSales)}%` }}
                                />
                              </div>
                              <span className="text-sm font-medium w-20 text-right">{formatCurrency(loc.projected)}</span>
                            </div>
                            
                            {/* Actual Bar */}
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground w-16 shrink-0">Actual</span>
                              <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                                <div 
                                  className={cn(
                                    "h-full rounded-full transition-all duration-500",
                                    loc.actual >= loc.projected ? "bg-green-500" : "bg-red-500"
                                  )}
                                  style={{ width: `${getBarWidth(loc.actual, maxSales)}%` }}
                                />
                              </div>
                              <span className="text-sm font-bold w-20 text-right">{formatCurrency(loc.actual)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      {(!salesData || salesData.length === 0) && (
                        <div className="py-8 text-center text-muted-foreground">
                          No locations found
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="audits" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-yellow-500" />
                    Food Safety Audit Leaderboard
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">Sorted by visit score</p>
                </CardHeader>
                <CardContent>
                  {auditsLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map(i => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sortedAudits?.map((audit, index) => (
                        <Collapsible
                          key={audit.id}
                          open={expandedAudits.has(audit.id)}
                          onOpenChange={() => toggleExpanded(audit.id)}
                        >
                          <CollapsibleTrigger className="w-full">
                            <div className={cn(
                              "flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors",
                              index === 0 && "border-yellow-500/50 bg-yellow-500/5",
                              index === 1 && "border-gray-400/50 bg-gray-400/5",
                              index === 2 && "border-amber-600/50 bg-amber-600/5"
                            )}>
                              {/* Rank */}
                              <div className="flex-shrink-0">
                                {getRankIcon(index)}
                              </div>
                              
                              {/* Location Name */}
                              <div className="flex-1 text-left">
                                <div className="font-medium">{audit.locationName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {format(new Date(audit.auditDate), 'MMM d, yyyy')}
                                  {audit.managerName && ` • ${audit.managerName}`}
                                </div>
                              </div>
                              
                              {/* Score */}
                              <div className="flex items-center gap-2">
                                {audit.visitScore ? (
                                  <Badge 
                                    variant={getScoreBadgeVariant(audit.visitScore)}
                                    className="text-lg px-3 py-1"
                                  >
                                    {audit.visitScore}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                                {hasSummary(audit) && (
                                  expandedAudits.has(audit.id) 
                                    ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          
                          <CollapsibleContent>
                            {hasSummary(audit) && (
                              <div className="p-4 border-x border-b rounded-b-lg bg-muted/30 space-y-4">
                                {/* Priority Items */}
                                {audit.firstPriorityItems && audit.firstPriorityItems.length > 0 && (
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                                      <AlertTriangle className="h-4 w-4" />
                                      1st Priority Items
                                    </div>
                                    <ul className="space-y-1 pl-6">
                                      {audit.firstPriorityItems.map((item, idx) => (
                                        <li key={idx} className="text-sm text-muted-foreground list-disc">
                                          {item}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                
                                {audit.secondPriorityItems && audit.secondPriorityItems.length > 0 && (
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-sm font-medium text-orange-600 dark:text-orange-400">
                                      <AlertCircle className="h-4 w-4" />
                                      2nd Priority Items
                                    </div>
                                    <ul className="space-y-1 pl-6">
                                      {audit.secondPriorityItems.map((item, idx) => (
                                        <li key={idx} className="text-sm text-muted-foreground list-disc">
                                          {item}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                
                                {audit.thirdPriorityItems && audit.thirdPriorityItems.length > 0 && (
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-sm font-medium text-yellow-600 dark:text-yellow-400">
                                      <Info className="h-4 w-4" />
                                      3rd Priority Items
                                    </div>
                                    <ul className="space-y-1 pl-6">
                                      {audit.thirdPriorityItems.map((item, idx) => (
                                        <li key={idx} className="text-sm text-muted-foreground list-disc">
                                          {item}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                
                                {/* View PDF Link */}
                                <a
                                  href={audit.auditUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  View Full Audit Report
                                </a>
                              </div>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                      {(!sortedAudits || sortedAudits.length === 0) && (
                        <div className="py-8 text-center text-muted-foreground">
                          No audits found
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ovation" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Star className="h-5 w-5 text-yellow-500" />
                    OvationUp Guest Feedback
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">Last 30 days survey scores</p>
                </CardHeader>
                <CardContent>
                  {ovationLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map(i => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : ovationData?.error ? (
                    <div className="py-8 text-center">
                      <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                      <p className="text-muted-foreground">{ovationData.error}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Configure OvationUp integration in Settings to see guest feedback data.
                      </p>
                    </div>
                  ) : ovationData?.scores && ovationData.scores.length > 0 ? (
                    <div className="space-y-2">
                      {ovationData.scores.map((score, index) => (
                        <div
                          key={score.locationId}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg border",
                            index === 0 && "border-yellow-500/50 bg-yellow-500/5",
                            index === 1 && "border-gray-400/50 bg-gray-400/5",
                            index === 2 && "border-amber-600/50 bg-amber-600/5"
                          )}
                        >
                          {/* Rank */}
                          <div className="flex-shrink-0">
                            {getRankIcon(index)}
                          </div>
                          
                          {/* Location Name */}
                          <div className="flex-1">
                            <div className="font-medium">{score.locationName}</div>
                            <div className="text-xs text-muted-foreground">
                              {score.totalResponses} responses
                            </div>
                          </div>
                          
                          {/* Score */}
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-2xl font-bold">{score.averageScore.toFixed(1)}</div>
                              <div className="text-xs text-muted-foreground">avg score</div>
                            </div>
                            {score.nps !== undefined && (
                              <div className="text-right pl-3 border-l">
                                <div className={cn(
                                  "text-lg font-semibold",
                                  score.nps >= 50 ? "text-green-600" : score.nps >= 0 ? "text-yellow-600" : "text-red-600"
                                )}>
                                  {score.nps > 0 ? '+' : ''}{score.nps}
                                </div>
                                <div className="text-xs text-muted-foreground">NPS</div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 text-center">
                      <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                      <p className="text-muted-foreground">No guest feedback data available</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Configure OvationUp integration to see guest feedback scores.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </Layout>
  );
}
