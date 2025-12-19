import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { 
  LayoutGrid, 
  TableIcon, 
  Users, 
  ClipboardCheck, 
  Clock,
  AlertTriangle,
  Building2,
  TrendingUp,
  TrendingDown,
  Minus
} from 'lucide-react';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from 'recharts';

interface ChecklistMetric {
  id: string;
  title: string;
  completedCount: number;
  totalPossible: number;
  percent: number;
}

interface LocationSalesData {
  daily: { actual: number; projected: number; pacing: number };
  weekly: { actual: number; projected: number; pacing: number };
  monthly: { actual: number; projected: number; pacing: number };
}

interface LocationMetrics {
  id: string;
  name: string;
  store_number: string | null;
  organization_name: string | null;
  // Sales
  sales: LocationSalesData;
  hasQuBeyond: boolean;
  // Tasks
  checklists: ChecklistMetric[];
  // Staffing
  clockedInCount: number;
  scheduledCount: number;
  openShifts: number;
}

export default function MultiLocationDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [locations, setLocations] = useState<LocationMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    checkAccessAndFetchData();
  }, [user?.id]);

  const checkAccessAndFetchData = async () => {
    if (!user?.id) return;

    try {
      // Check if user has multi-location access
      const { data: isSuperAdmin } = await supabase.rpc('is_super_admin', { _user_id: user.id });
      
      const { data: orgMemberships } = await supabase
        .from('organization_members')
        .select('organization_id, org_role')
        .eq('user_id', user.id)
        .eq('org_role', 'admin');

      const { data: brandMemberships } = await supabase
        .from('brand_members')
        .select('brand_id, brand_role')
        .eq('user_id', user.id)
        .eq('brand_role', 'admin');

      const hasMultiAccess = isSuperAdmin || 
        (orgMemberships && orgMemberships.length > 0) || 
        (brandMemberships && brandMemberships.length > 0);

      setHasAccess(hasMultiAccess);

      if (!hasMultiAccess) {
        setLoading(false);
        return;
      }

      // Fetch all accessible locations
      let locationsQuery = supabase
        .from('locations')
        .select(`
          id,
          name,
          store_number,
          organization_id,
          organizations(name)
        `)
        .neq('location_type', 'checklist_only')
        .order('name');

      if (!isSuperAdmin) {
        const orgIds = orgMemberships?.map(m => m.organization_id) || [];
        
        if (brandMemberships && brandMemberships.length > 0) {
          const brandIds = brandMemberships.map(b => b.brand_id);
          const { data: brandOrgs } = await supabase
            .from('organizations')
            .select('id')
            .in('brand_id', brandIds);
          
          if (brandOrgs) {
            orgIds.push(...brandOrgs.map(o => o.id));
          }
        }

        if (orgIds.length > 0) {
          locationsQuery = locationsQuery.in('organization_id', orgIds);
        }
      }

      const { data: locationsData } = await locationsQuery;

      if (!locationsData || locationsData.length === 0) {
        setLoading(false);
        return;
      }

      // Fetch metrics for each location
      const locationMetrics = await Promise.all(
        locationsData.map(async (loc) => {
          const today = new Date();
          const todayStr = format(today, 'yyyy-MM-dd');
          const startOfToday = startOfDay(today).toISOString();
          const endOfToday = endOfDay(today).toISOString();
          const weekStart = startOfWeek(today, { weekStartsOn: 1 });
          const monthStart = startOfMonth(today);

          // Check if location has QuBeyond integration
          const { data: integration } = await supabase
            .from('location_integrations')
            .select('id')
            .eq('location_id', loc.id)
            .eq('integration_type', 'qubeyond')
            .eq('is_active', true)
            .single();

          const hasQuBeyond = !!integration;

          // Fetch sales data if QuBeyond is connected
          let salesData: LocationSalesData = {
            daily: { actual: 0, projected: 0, pacing: 0 },
            weekly: { actual: 0, projected: 0, pacing: 0 },
            monthly: { actual: 0, projected: 0, pacing: 0 }
          };

          if (hasQuBeyond) {
            try {
              const { data: salesResponse } = await supabase.functions.invoke('fetch-qubeyond-sales', {
                body: { locationId: loc.id, targetDate: todayStr }
              });

              if (salesResponse) {
                salesData = {
                  daily: {
                    actual: salesResponse.daily || 0,
                    projected: salesResponse.projections?.todayProjected || 0,
                    pacing: salesResponse.projections?.todayPaceAdjusted || salesResponse.projections?.todayProjected || 0
                  },
                  weekly: {
                    actual: salesResponse.weekly || 0,
                    projected: salesResponse.projections?.weekProjected || 0,
                    pacing: calculatePacing(salesResponse.weekly, salesResponse.projections?.weekProjected, weekStart, today)
                  },
                  monthly: {
                    actual: salesResponse.monthly || 0,
                    projected: salesResponse.projections?.monthProjected || 0,
                    pacing: calculatePacing(salesResponse.monthly, salesResponse.projections?.monthProjected, monthStart, today)
                  }
                };
              }
            } catch (error) {
              console.error(`Error fetching sales for ${loc.name}:`, error);
            }
          }

          // Get clocked in status
          const { data: clockedIn } = await supabase
            .from('time_punches')
            .select('user_id')
            .eq('location_id', loc.id)
            .eq('punch_type', 'clock_in')
            .gte('punch_time', startOfToday)
            .lte('punch_time', endOfToday);

          const { data: clockedOut } = await supabase
            .from('time_punches')
            .select('user_id')
            .eq('location_id', loc.id)
            .eq('punch_type', 'clock_out')
            .gte('punch_time', startOfToday)
            .lte('punch_time', endOfToday);

          const clockedOutIds = new Set(clockedOut?.map(p => p.user_id) || []);
          const currentlyClockedIn = clockedIn?.filter(p => !clockedOutIds.has(p.user_id)) || [];

          // Get scheduled shifts
          let scheduledCount = 0;
          try {
            const result = await (supabase.from('scheduled_shifts' as any).select('id').eq('location_id', loc.id).eq('shift_date', todayStr) as any);
            scheduledCount = result.data?.length || 0;
          } catch (e) {}

          // Get checklists and their completion status for today (excluding temporary tasks)
          const { data: checklists } = await supabase
            .from('checklists')
            .select('id, title, frequency')
            .eq('location_id', loc.id)
            .eq('is_active', true)
            .is('template_type', null); // Exclude templates (temporary tasks use these)

          // Get today's submissions
          const { data: submissions } = await supabase
            .from('checklist_submissions')
            .select('id, checklist_id')
            .eq('location_id', loc.id)
            .gte('submitted_at', startOfToday)
            .lte('submitted_at', endOfToday);

          const submissionCountByChecklist = new Map<string, number>();
          submissions?.forEach(sub => {
            const count = submissionCountByChecklist.get(sub.checklist_id) || 0;
            submissionCountByChecklist.set(sub.checklist_id, count + 1);
          });

          const checklistMetrics: ChecklistMetric[] = (checklists || []).map(cl => {
            const completedCount = submissionCountByChecklist.get(cl.id) || 0;
            // For daily checklists, expected is 1 per day
            // For other frequencies, this is a simplification
            const totalPossible = cl.frequency === 'daily' ? 1 : 1;
            const percent = totalPossible > 0 ? Math.min(100, (completedCount / totalPossible) * 100) : 0;
            
            return {
              id: cl.id,
              title: cl.title,
              completedCount,
              totalPossible,
              percent
            };
          });

          return {
            id: loc.id,
            name: loc.name,
            store_number: loc.store_number,
            organization_name: (loc.organizations as any)?.name || null,
            sales: salesData,
            hasQuBeyond,
            checklists: checklistMetrics,
            clockedInCount: currentlyClockedIn.length,
            scheduledCount,
            openShifts: Math.max(0, scheduledCount - currentlyClockedIn.length),
          };
        })
      );

      setLocations(locationMetrics);
    } catch (error) {
      console.error('Error fetching multi-location data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculatePacing = (actual: number, projected: number, periodStart: Date, now: Date) => {
    if (!projected || projected === 0) return actual;
    const periodEnd = endOfMonth(periodStart);
    const totalDays = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
    const elapsedDays = Math.ceil((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
    const expectedPercent = elapsedDays / totalDays;
    return (actual / expectedPercent);
  };

  const formatLocationName = (name: string, storeNumber: string | null) => {
    return storeNumber ? `${name} - ${storeNumber}` : name;
  };

  const formatCurrency = (amount: number) => {
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(1)}K`;
    }
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getCompletionColor = (percent: number) => {
    if (percent >= 100) return 'text-green-600';
    if (percent >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  const getProgressColor = (percent: number) => {
    if (percent >= 100) return 'bg-green-500';
    if (percent >= 50) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const getSalesTrendIcon = (actual: number, projected: number) => {
    if (projected === 0) return <Minus className="h-3 w-3 text-muted-foreground" />;
    const diff = ((actual - projected) / projected) * 100;
    if (diff >= 0) return <TrendingUp className="h-3 w-3 text-green-500" />;
    return <TrendingDown className="h-3 w-3 text-red-500" />;
  };

  const LocationSalesChart = ({ sales, period }: { sales: LocationSalesData; period: 'daily' | 'weekly' | 'monthly' }) => {
    const data = sales[period];
    const chartData = [
      { name: 'Actual', value: data.actual, fill: 'hsl(var(--primary))' },
      { name: 'Projected', value: data.projected, fill: 'hsl(var(--muted-foreground))' },
      { name: 'Pacing', value: data.pacing, fill: 'hsl(142 76% 36%)' }
    ];

    return (
      <div className="h-[120px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 10 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 11 }} />
            <Tooltip 
              formatter={(value: number) => formatCurrency(value)}
              contentStyle={{ 
                backgroundColor: 'hsl(var(--background))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px'
              }}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // Calculate totals
  const totals = locations.reduce(
    (acc, loc) => ({
      clockedIn: acc.clockedIn + loc.clockedInCount,
      scheduled: acc.scheduled + loc.scheduledCount,
      checklistsCompleted: acc.checklistsCompleted + loc.checklists.filter(c => c.percent >= 100).length,
      totalChecklists: acc.totalChecklists + loc.checklists.length,
    }),
    { clockedIn: 0, scheduled: 0, checklistsCompleted: 0, totalChecklists: 0 }
  );

  if (loading) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-[400px]" />
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  if (!hasAccess) {
    return (
      <Layout>
        <Card>
          <CardContent className="p-6 text-center">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Multi-Location Dashboard</h2>
            <p className="text-muted-foreground">
              This dashboard is only available to organization administrators and brand managers.
            </p>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Multi-Location Overview</h1>
            <p className="text-muted-foreground">
              {format(new Date(), 'EEEE, MMMM d, yyyy')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'cards' ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setViewMode('cards')}
            >
              <LayoutGrid className="h-4 w-4 mr-2" />
              Cards
            </Button>
            <Button
              variant={viewMode === 'table' ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setViewMode('table')}
            >
              <TableIcon className="h-4 w-4 mr-2" />
              Table
            </Button>
          </div>
        </div>

        {/* Summary Cards - Removed location count */}
        <div className="grid gap-4 grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Users className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Clocked In</p>
                  <p className="text-2xl font-bold">{totals.clockedIn}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <Clock className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Scheduled</p>
                  <p className="text-2xl font-bold">{totals.scheduled}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <ClipboardCheck className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Checklists Done</p>
                  <p className="text-2xl font-bold">{totals.checklistsCompleted}/{totals.totalChecklists}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Card View */}
        {viewMode === 'cards' && (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {locations.map((loc) => (
              <Card 
                key={loc.id} 
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => navigate(`/location/${loc.id}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">
                        {formatLocationName(loc.name, loc.store_number)}
                      </CardTitle>
                      {loc.organization_name && (
                        <p className="text-xs text-muted-foreground">{loc.organization_name}</p>
                      )}
                    </div>
                    <Badge variant={loc.clockedInCount > 0 ? 'default' : 'secondary'}>
                      {loc.clockedInCount > 0 ? 'Active' : 'Idle'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Sales Chart */}
                  {loc.hasQuBeyond && (
                    <div>
                      <Tabs defaultValue="daily" className="w-full">
                        <TabsList className="grid w-full grid-cols-3 h-8">
                          <TabsTrigger value="daily" className="text-xs">Day</TabsTrigger>
                          <TabsTrigger value="weekly" className="text-xs">Week</TabsTrigger>
                          <TabsTrigger value="monthly" className="text-xs">Month</TabsTrigger>
                        </TabsList>
                        <TabsContent value="daily" className="mt-2">
                          <LocationSalesChart sales={loc.sales} period="daily" />
                        </TabsContent>
                        <TabsContent value="weekly" className="mt-2">
                          <LocationSalesChart sales={loc.sales} period="weekly" />
                        </TabsContent>
                        <TabsContent value="monthly" className="mt-2">
                          <LocationSalesChart sales={loc.sales} period="monthly" />
                        </TabsContent>
                      </Tabs>
                    </div>
                  )}

                  {!loc.hasQuBeyond && (
                    <div className="text-center py-4 text-sm text-muted-foreground border rounded-lg bg-muted/20">
                      No sales integration
                    </div>
                  )}

                  {/* Checklists */}
                  {loc.checklists.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">Checklists</p>
                      {loc.checklists.map((cl) => (
                        <div key={cl.id} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="truncate flex-1 mr-2">{cl.title}</span>
                            <span className={`font-medium ${getCompletionColor(cl.percent)}`}>
                              {cl.percent.toFixed(0)}%
                            </span>
                          </div>
                          <Progress 
                            value={cl.percent} 
                            className="h-1.5"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Staffing */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Staffing</span>
                    </div>
                    <span className="font-medium">
                      {loc.clockedInCount}/{loc.scheduledCount}
                    </span>
                  </div>

                  {/* Open Shifts Alert */}
                  {loc.openShifts > 0 && (
                    <div className="flex items-center gap-2 text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded-md px-2 py-1">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm">{loc.openShifts} open shift{loc.openShifts !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Table View */}
        {viewMode === 'table' && (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-right">Daily Sales</TableHead>
                      <TableHead className="text-right">Weekly Sales</TableHead>
                      <TableHead className="text-right">Monthly Sales</TableHead>
                      <TableHead className="text-center">Checklists</TableHead>
                      <TableHead className="text-center">Staffing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locations.map((loc) => {
                      const checklistPercent = loc.checklists.length > 0
                        ? loc.checklists.filter(c => c.percent >= 100).length / loc.checklists.length * 100
                        : 0;

                      return (
                        <TableRow 
                          key={loc.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => navigate(`/location/${loc.id}`)}
                        >
                          <TableCell>
                            <div>
                              <p className="font-medium">{formatLocationName(loc.name, loc.store_number)}</p>
                              {loc.organization_name && (
                                <p className="text-xs text-muted-foreground">{loc.organization_name}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={loc.clockedInCount > 0 ? 'default' : 'secondary'}>
                              {loc.clockedInCount > 0 ? 'Active' : 'Idle'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {loc.hasQuBeyond ? (
                              <div className="flex items-center justify-end gap-1">
                                {getSalesTrendIcon(loc.sales.daily.actual, loc.sales.daily.projected)}
                                <span>{formatCurrency(loc.sales.daily.actual)}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">--</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {loc.hasQuBeyond ? (
                              <div className="flex items-center justify-end gap-1">
                                {getSalesTrendIcon(loc.sales.weekly.actual, loc.sales.weekly.projected)}
                                <span>{formatCurrency(loc.sales.weekly.actual)}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">--</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {loc.hasQuBeyond ? (
                              <div className="flex items-center justify-end gap-1">
                                {getSalesTrendIcon(loc.sales.monthly.actual, loc.sales.monthly.projected)}
                                <span>{formatCurrency(loc.sales.monthly.actual)}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">--</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={getCompletionColor(checklistPercent)}>
                              {loc.checklists.filter(c => c.percent >= 100).length}/{loc.checklists.length}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={loc.openShifts > 0 ? 'text-amber-600' : ''}>
                              {loc.clockedInCount}/{loc.scheduledCount}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
