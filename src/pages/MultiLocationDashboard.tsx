import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
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
  Minus,
  FileText,
  ChevronRight
} from 'lucide-react';
import { format, startOfDay, endOfDay, startOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, LabelList } from 'recharts';

interface ChecklistMetric {
  id: string;
  title: string;
  completedCount: number;
  totalCount: number;
  percent: number;
}

interface LocationSalesData {
  daily: { actual: number; projected: number; pacing: number };
  weekly: { actual: number; projected: number; pacing: number };
  monthly: { actual: number; projected: number; pacing: number };
}

interface AuditSummary {
  id: string;
  audit_date: string;
  visit_score: string | null;
  manager_name: string | null;
}

interface LocationMetrics {
  id: string;
  name: string;
  store_number: string | null;
  organization_name: string | null;
  sales: LocationSalesData;
  hasQuBeyond: boolean;
  checklists: ChecklistMetric[];
  clockedInCount: number;
  scheduledCount: number;
  openShifts: number;
  latestAudit: AuditSummary | null;
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

      const locationMetrics = await Promise.all(
        locationsData.map(async (loc) => {
          const today = new Date();
          const todayStr = format(today, 'yyyy-MM-dd');
          const startOfToday = startOfDay(today).toISOString();
          const endOfToday = endOfDay(today).toISOString();
          const weekStart = startOfWeek(today, { weekStartsOn: 1 });
          const monthStart = startOfMonth(today);

          const { data: integration } = await supabase
            .from('location_integrations')
            .select('id')
            .eq('location_id', loc.id)
            .eq('integration_type', 'qubeyond')
            .eq('is_active', true)
            .single();

          const hasQuBeyond = !!integration;

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

          let scheduledCount = 0;
          try {
            const result = await (supabase.from('scheduled_shifts' as any).select('id').eq('location_id', loc.id).eq('shift_date', todayStr) as any);
            scheduledCount = result.data?.length || 0;
          } catch (e) {}

          // Get checklists with their items count - include all active checklists
          const { data: checklists } = await supabase
            .from('checklists')
            .select('id, title, frequency')
            .eq('location_id', loc.id)
            .eq('is_active', true);

          // Get today's submissions with response counts
          const { data: submissions } = await supabase
            .from('checklist_submissions')
            .select(`
              id, 
              checklist_id,
              checklist_responses(id)
            `)
            .eq('location_id', loc.id)
            .gte('submitted_at', startOfToday)
            .lte('submitted_at', endOfToday);

          // Get checklist items counts
          const checklistIds = checklists?.map(c => c.id) || [];
          const { data: checklistItems } = await supabase
            .from('checklist_items')
            .select('id, checklist_id')
            .in('checklist_id', checklistIds);

          const itemCountByChecklist = new Map<string, number>();
          checklistItems?.forEach(item => {
            const count = itemCountByChecklist.get(item.checklist_id) || 0;
            itemCountByChecklist.set(item.checklist_id, count + 1);
          });

          const submissionByChecklist = new Map<string, { completed: number; total: number }>();
          submissions?.forEach(sub => {
            const responseCount = (sub.checklist_responses as any[])?.length || 0;
            const totalItems = itemCountByChecklist.get(sub.checklist_id) || 0;
            submissionByChecklist.set(sub.checklist_id, { completed: responseCount, total: totalItems });
          });

          const checklistMetrics: ChecklistMetric[] = (checklists || []).map(cl => {
            const submission = submissionByChecklist.get(cl.id);
            const totalCount = itemCountByChecklist.get(cl.id) || 0;
            const completedCount = submission?.completed || 0;
            const percent = totalCount > 0 ? Math.min(100, (completedCount / totalCount) * 100) : 0;
            
            return {
              id: cl.id,
              title: cl.title,
              completedCount,
              totalCount,
              percent
            };
          });

          const { data: auditData } = await supabase
            .from('food_safety_audits')
            .select('id, audit_date, visit_score, manager_name')
            .eq('location_id', loc.id)
            .order('audit_date', { ascending: false })
            .limit(1)
            .single();

          let latestAudit: AuditSummary | null = null;
          if (auditData) {
            latestAudit = {
              id: auditData.id,
              audit_date: auditData.audit_date,
              visit_score: auditData.visit_score,
              manager_name: auditData.manager_name
            };
          }

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
            latestAudit,
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
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatCurrencyCompact = (amount: number) => {
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 100000) {
      return `$${Math.round(amount / 1000)}K`;
    }
    if (amount >= 10000) {
      return `$${(amount / 1000).toFixed(1)}K`;
    }
    return formatCurrency(amount);
  };

  const getCompletionColor = (percent: number) => {
    if (percent >= 100) return 'text-green-600';
    if (percent >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  const getSalesTrendIcon = (actual: number, projected: number) => {
    if (projected === 0) return <Minus className="h-3 w-3 text-muted-foreground" />;
    const diff = ((actual - projected) / projected) * 100;
    if (diff >= 0) return <TrendingUp className="h-3 w-3 text-green-500" />;
    return <TrendingDown className="h-3 w-3 text-red-500" />;
  };

  // Daily chart - includes pacing
  const DailySalesChart = ({ sales }: { sales: LocationSalesData }) => {
    const data = sales.daily;
    const chartData = [
      { name: 'Actual', value: data.actual, fill: 'hsl(var(--primary))', label: formatCurrency(data.actual) },
      { name: 'Projected', value: data.projected, fill: 'hsl(var(--muted-foreground))', label: formatCurrency(data.projected) },
      { name: 'Pacing', value: data.pacing, fill: 'hsl(142 76% 36%)', label: formatCurrency(data.pacing) }
    ];

    return (
      <div className="h-[80px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 5 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={55} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
              <LabelList dataKey="label" position="insideRight" style={{ fontSize: 9, fill: '#fff', fontWeight: 500 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // Weekly/Monthly chart - no pacing
  const PeriodSalesChart = ({ sales, period }: { sales: LocationSalesData; period: 'weekly' | 'monthly' }) => {
    const data = sales[period];
    const chartData = [
      { name: 'Actual', value: data.actual, fill: 'hsl(var(--primary))', label: formatCurrency(data.actual) },
      { name: 'Projected', value: data.projected, fill: 'hsl(var(--muted-foreground))', label: formatCurrency(data.projected) }
    ];

    return (
      <div className="h-[56px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 5 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={55} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
              <LabelList dataKey="label" position="insideRight" style={{ fontSize: 9, fill: '#fff', fontWeight: 500 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const navigateToAudit = (locationId: string) => {
    navigate(`/location/${locationId}#audits`);
  };

  const totals = locations.reduce(
    (acc, loc) => ({
      clockedIn: acc.clockedIn + (loc.clockedInCount || 0),
      scheduled: acc.scheduled + (loc.scheduledCount || 0),
      checklistsCompleted: acc.checklistsCompleted + (loc.checklists?.filter(c => c.percent >= 100).length || 0),
      totalChecklists: acc.totalChecklists + (loc.checklists?.length || 0),
    }),
    { clockedIn: 0, scheduled: 0, checklistsCompleted: 0, totalChecklists: 0 }
  );

  if (loading) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[200px]" />
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

        {/* Summary Cards */}
        <div className="flex flex-wrap gap-3">
          <Card className="flex-1 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-green-500/10">
                  <Users className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Clocked In</p>
                  <p className="text-xl font-bold">{totals.clockedIn}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/10">
                  <Clock className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Scheduled</p>
                  <p className="text-xl font-bold">{totals.scheduled}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10">
                  <ClipboardCheck className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Checklists</p>
                  <p className="text-xl font-bold">{totals.checklistsCompleted}/{totals.totalChecklists}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Card View - Horizontal Cards */}
        {viewMode === 'cards' && (
          <div className="space-y-4">
            {locations.map((loc) => (
              <Card 
                key={loc.id} 
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => navigate(`/location/${loc.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                    {/* Location Header */}
                    <div className="lg:w-48 flex-shrink-0">
                      <div className="flex items-center justify-between lg:flex-col lg:items-start gap-2">
                        <div>
                          <h3 className="font-semibold text-lg">
                            {formatLocationName(loc.name, loc.store_number)}
                          </h3>
                          {loc.organization_name && (
                            <p className="text-xs text-muted-foreground">{loc.organization_name}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={loc.clockedInCount > 0 ? 'default' : 'secondary'} className="text-xs">
                            {loc.clockedInCount > 0 ? 'Active' : 'Idle'}
                          </Badge>
                          <div className="flex items-center gap-1 text-sm">
                            <Users className="h-3 w-3 text-muted-foreground" />
                            <span>{loc.clockedInCount}/{loc.scheduledCount}</span>
                          </div>
                        </div>
                      </div>
                      {loc.openShifts > 0 && (
                        <div className="flex items-center gap-1 text-amber-600 text-xs mt-2">
                          <AlertTriangle className="h-3 w-3" />
                          <span>{loc.openShifts} open shift{loc.openShifts !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </div>

                    {/* Sales Section */}
                    {loc.hasQuBeyond && (
                      <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <Tabs defaultValue="daily" className="w-full">
                          <TabsList className="h-7 mb-2">
                            <TabsTrigger value="daily" className="text-xs px-3 h-6">Day</TabsTrigger>
                            <TabsTrigger value="weekly" className="text-xs px-3 h-6">Week</TabsTrigger>
                            <TabsTrigger value="monthly" className="text-xs px-3 h-6">Month</TabsTrigger>
                          </TabsList>
                          <TabsContent value="daily" className="mt-0">
                            <DailySalesChart sales={loc.sales} />
                          </TabsContent>
                          <TabsContent value="weekly" className="mt-0">
                            <PeriodSalesChart sales={loc.sales} period="weekly" />
                          </TabsContent>
                          <TabsContent value="monthly" className="mt-0">
                            <PeriodSalesChart sales={loc.sales} period="monthly" />
                          </TabsContent>
                        </Tabs>
                      </div>
                    )}

                    {!loc.hasQuBeyond && (
                      <div className="flex-1 flex items-center justify-center py-4 text-sm text-muted-foreground border rounded-lg bg-muted/20">
                        No sales integration
                      </div>
                    )}

                    {/* Checklists Section */}
                    <div className="lg:w-64 flex-shrink-0 space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <ClipboardCheck className="h-3 w-3" />
                        Checklists
                      </p>
                      {(loc.checklists?.length || 0) > 0 ? (
                        <div className="space-y-1">
                          {loc.checklists?.map((cl) => (
                            <div key={cl.id} className="flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="truncate">{cl.title}</span>
                                  <span className={`font-medium ml-1 ${getCompletionColor(cl.percent)}`}>
                                    {cl.completedCount}/{cl.totalCount} ({cl.percent.toFixed(0)}%)
                                  </span>
                                </div>
                                <Progress value={cl.percent} className="h-1 mt-0.5" />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No checklists</p>
                      )}
                    </div>

                    {/* Audit Section */}
                    <div 
                      className="lg:w-40 flex-shrink-0 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateToAudit(loc.id);
                      }}
                    >
                      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                        <FileText className="h-3 w-3" />
                        Latest Audit
                      </p>
                      {loc.latestAudit ? (
                        <div className="bg-muted/30 rounded-lg p-2 hover:bg-muted/50 transition-colors">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(loc.latestAudit.audit_date), 'MMM d, yyyy')}
                            </span>
                            {loc.latestAudit.visit_score && (
                              <Badge variant="outline" className="font-bold text-xs">
                                {loc.latestAudit.visit_score}
                              </Badge>
                            )}
                          </div>
                          {loc.latestAudit.manager_name && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              MOD: {loc.latestAudit.manager_name}
                            </p>
                          )}
                          <div className="flex items-center justify-end mt-1">
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No audits</p>
                      )}
                    </div>
                  </div>
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
                      <TableHead className="text-center">Latest Audit</TableHead>
                      <TableHead className="text-center">Staffing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locations.map((loc) => {
                      const checklistPercent = (loc.checklists?.length || 0) > 0
                        ? (loc.checklists?.filter(c => c.percent >= 100).length || 0) / loc.checklists.length * 100
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
                              {loc.checklists?.filter(c => c.percent >= 100).length || 0}/{loc.checklists?.length || 0}
                            </span>
                          </TableCell>
                          <TableCell 
                            className="text-center cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateToAudit(loc.id);
                            }}
                          >
                            {loc.latestAudit ? (
                              <div className="flex flex-col items-center hover:text-primary">
                                {loc.latestAudit.visit_score && (
                                  <Badge variant="outline" className="font-bold text-xs">
                                    {loc.latestAudit.visit_score}
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  {format(new Date(loc.latestAudit.audit_date), 'M/d/yy')}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">--</span>
                            )}
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
