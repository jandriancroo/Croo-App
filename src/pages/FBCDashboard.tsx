import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Minus, Building2, ClipboardCheck } from 'lucide-react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface LocationSalesData {
  locationId: string;
  locationName: string;
  organizationName: string;
  daily: { actual: number; projected: number };
  weekly: { actual: number; projected: number };
  monthly: { actual: number; projected: number };
}

interface AuditData {
  id: string;
  locationId: string;
  locationName: string;
  auditDate: string;
  visitScore: string | null;
  managerName: string | null;
}

export default function FBCDashboard() {
  const { user } = useAuth();

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
    queryKey: ['fbc-sales-data', locations?.map(l => l.id)],
    queryFn: async () => {
      if (!locations?.length) return [];
      
      const today = new Date();
      const weekStart = startOfWeek(today, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
      const monthStart = startOfMonth(today);
      const monthEnd = endOfMonth(today);
      
      // For each location, we'd ideally fetch from QuBeyond
      // For now, return placeholder data - in production this would call the sales API
      const salesResults: LocationSalesData[] = locations.map(loc => {
        const org = loc.organizations as any;
        return {
          locationId: loc.id,
          locationName: loc.name,
          organizationName: org?.brand_name || org?.name || 'Unknown',
          daily: { 
            actual: Math.floor(Math.random() * 3000) + 1500, 
            projected: Math.floor(Math.random() * 3000) + 1500 
          },
          weekly: { 
            actual: Math.floor(Math.random() * 20000) + 10000, 
            projected: Math.floor(Math.random() * 20000) + 10000 
          },
          monthly: { 
            actual: Math.floor(Math.random() * 80000) + 40000, 
            projected: Math.floor(Math.random() * 80000) + 40000 
          },
        };
      });
      
      return salesResults;
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
          visit_score,
          manager_name,
          locations!inner(name)
        `)
        .in('location_id', locationIds)
        .order('audit_date', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      
      return (data || []).map(audit => ({
        id: audit.id,
        locationId: audit.location_id,
        locationName: (audit.locations as any)?.name || 'Unknown',
        auditDate: audit.audit_date,
        visitScore: audit.visit_score,
        managerName: audit.manager_name,
      }));
    },
    enabled: !!locations?.length,
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

  const getVarianceIndicator = (actual: number, projected: number) => {
    const variance = actual - projected;
    const percentVariance = projected > 0 ? ((variance / projected) * 100).toFixed(1) : '0';
    
    if (variance > 0) {
      return (
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm">
          <TrendingUp className="h-3 w-3" />
          +{percentVariance}%
        </span>
      );
    } else if (variance < 0) {
      return (
        <span className="flex items-center gap-1 text-red-600 dark:text-red-400 text-sm">
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

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">FBC Dashboard</h1>
          <p className="text-muted-foreground">Franchise Business Consultant Overview</p>
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
                Recent Audits
              </TabsTrigger>
            </TabsList>

            <TabsContent value="sales" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Location Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  {salesLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map(i => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b text-left text-sm text-muted-foreground">
                            <th className="pb-3 font-medium">Location</th>
                            <th className="pb-3 font-medium text-right">Daily</th>
                            <th className="pb-3 font-medium text-center">Var</th>
                            <th className="pb-3 font-medium text-right">Weekly</th>
                            <th className="pb-3 font-medium text-center">Var</th>
                            <th className="pb-3 font-medium text-right">Monthly</th>
                            <th className="pb-3 font-medium text-center">Var</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {salesData?.map(loc => (
                            <tr key={loc.locationId} className="hover:bg-muted/50">
                              <td className="py-3">
                                <div>
                                  <div className="font-medium">{loc.locationName}</div>
                                  <div className="text-xs text-muted-foreground">{loc.organizationName}</div>
                                </div>
                              </td>
                              <td className="py-3 text-right">
                                <div className="font-medium">{formatCurrency(loc.daily.actual)}</div>
                                <div className="text-xs text-muted-foreground">proj: {formatCurrency(loc.daily.projected)}</div>
                              </td>
                              <td className="py-3 text-center">
                                {getVarianceIndicator(loc.daily.actual, loc.daily.projected)}
                              </td>
                              <td className="py-3 text-right">
                                <div className="font-medium">{formatCurrency(loc.weekly.actual)}</div>
                                <div className="text-xs text-muted-foreground">proj: {formatCurrency(loc.weekly.projected)}</div>
                              </td>
                              <td className="py-3 text-center">
                                {getVarianceIndicator(loc.weekly.actual, loc.weekly.projected)}
                              </td>
                              <td className="py-3 text-right">
                                <div className="font-medium">{formatCurrency(loc.monthly.actual)}</div>
                                <div className="text-xs text-muted-foreground">proj: {formatCurrency(loc.monthly.projected)}</div>
                              </td>
                              <td className="py-3 text-center">
                                {getVarianceIndicator(loc.monthly.actual, loc.monthly.projected)}
                              </td>
                            </tr>
                          ))}
                          {(!salesData || salesData.length === 0) && (
                            <tr>
                              <td colSpan={7} className="py-8 text-center text-muted-foreground">
                                No locations found
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="audits" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Recent Food Safety Audits</CardTitle>
                </CardHeader>
                <CardContent>
                  {auditsLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map(i => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b text-left text-sm text-muted-foreground">
                            <th className="pb-3 font-medium">Location</th>
                            <th className="pb-3 font-medium">Audit Date</th>
                            <th className="pb-3 font-medium">Manager</th>
                            <th className="pb-3 font-medium text-right">Score</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {audits?.map(audit => (
                            <tr key={audit.id} className="hover:bg-muted/50">
                              <td className="py-3 font-medium">{audit.locationName}</td>
                              <td className="py-3 text-muted-foreground">
                                {format(new Date(audit.auditDate), 'MMM d, yyyy')}
                              </td>
                              <td className="py-3 text-muted-foreground">
                                {audit.managerName || '—'}
                              </td>
                              <td className="py-3 text-right">
                                {audit.visitScore ? (
                                  <Badge variant={getScoreBadgeVariant(audit.visitScore)}>
                                    {audit.visitScore}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                          {(!audits || audits.length === 0) && (
                            <tr>
                              <td colSpan={4} className="py-8 text-center text-muted-foreground">
                                No audits found
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
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
