import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { 
  LayoutGrid, 
  TableIcon, 
  MapPin, 
  DollarSign, 
  Users, 
  ClipboardCheck, 
  TrendingUp, 
  Clock,
  AlertTriangle,
  CheckCircle2,
  Building2
} from 'lucide-react';
import { format, startOfDay, endOfDay, subDays } from 'date-fns';
import { getTodayInTimezone } from '@/utils/timezoneUtils';

interface LocationMetrics {
  id: string;
  name: string;
  store_number: string | null;
  organization_name: string | null;
  // Sales & Labor
  todaySales: number;
  laborCost: number;
  laborPercent: number;
  // Tasks
  tasksCompleted: number;
  totalTasks: number;
  overdueChecklists: number;
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
      // Check if user has multi-location access (org_admin, brand_admin, or super_admin)
      const { data: isSuperAdmin } = await supabase.rpc('is_super_admin', { _user_id: user.id });
      
      // Get organization memberships with admin role
      const { data: orgMemberships } = await supabase
        .from('organization_members')
        .select('organization_id, org_role')
        .eq('user_id', user.id)
        .eq('org_role', 'admin');

      // Get brand memberships with admin role
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

      // If not super admin, filter by org/brand access
      if (!isSuperAdmin) {
        const orgIds = orgMemberships?.map(m => m.organization_id) || [];
        
        // Get org IDs from brand memberships
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

          // Get today's sales (from daily_tips or cache)
          const { data: salesData } = await supabase
            .from('daily_tips')
            .select('total_cc_tips, total_cash_tips')
            .eq('location_id', loc.id)
            .eq('tip_date', todayStr)
            .single();

          // Get current labor (clocked in employees)
          const { data: clockedIn } = await supabase
            .from('time_punches')
            .select('user_id, punch_time')
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

          // Get today's checklist completions
          const { data: submissions } = await supabase
            .from('checklist_submissions')
            .select('id, checklist_id')
            .eq('location_id', loc.id)
            .gte('submitted_at', startOfToday)
            .lte('submitted_at', endOfToday);

          // Get total active checklists for location
          const { data: checklists } = await supabase
            .from('checklists')
            .select('id')
            .eq('location_id', loc.id)
            .eq('is_active', true);

          // Get scheduled shifts for today - using rpc to avoid type issues
          let scheduledCount = 0;
          try {
            const query = supabase.from('scheduled_shifts' as any).select('id').eq('location_id', loc.id).eq('shift_date', todayStr);
            const result = await query;
            scheduledCount = (result.data as any[])?.length || 0;
          } catch (e) {
            // Ignore if table doesn't exist
          }

          // Calculate metrics
          const todaySales = 0; // Would need POS integration
          const laborCost = currentlyClockedIn.length * 15 * 4; // Rough estimate
          const laborPercent = todaySales > 0 ? (laborCost / todaySales) * 100 : 0;

          return {
            id: loc.id,
            name: loc.name,
            store_number: loc.store_number,
            organization_name: (loc.organizations as any)?.name || null,
            todaySales,
            laborCost,
            laborPercent,
            tasksCompleted: submissions?.length || 0,
            totalTasks: checklists?.length || 0,
            overdueChecklists: 0, // Would need due time logic
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

  const formatLocationName = (name: string, storeNumber: string | null) => {
    return storeNumber ? `${name} - ${storeNumber}` : name;
  };

  const getTaskCompletionColor = (completed: number, total: number) => {
    if (total === 0) return 'text-muted-foreground';
    const percent = (completed / total) * 100;
    if (percent >= 80) return 'text-green-600';
    if (percent >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  const getStaffingColor = (clockedIn: number, scheduled: number) => {
    if (scheduled === 0) return 'text-muted-foreground';
    const percent = (clockedIn / scheduled) * 100;
    if (percent >= 90) return 'text-green-600';
    if (percent >= 70) return 'text-amber-600';
    return 'text-red-600';
  };

  if (loading) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-48" />
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

  // Calculate totals
  const totals = locations.reduce(
    (acc, loc) => ({
      clockedIn: acc.clockedIn + loc.clockedInCount,
      scheduled: acc.scheduled + loc.scheduledCount,
      tasksCompleted: acc.tasksCompleted + loc.tasksCompleted,
      totalTasks: acc.totalTasks + loc.totalTasks,
    }),
    { clockedIn: 0, scheduled: 0, tasksCompleted: 0, totalTasks: 0 }
  );

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Multi-Location Overview</h1>
            <p className="text-muted-foreground">
              {locations.length} location{locations.length !== 1 ? 's' : ''} • {format(new Date(), 'EEEE, MMMM d, yyyy')}
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
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <MapPin className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Locations</p>
                  <p className="text-2xl font-bold">{locations.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
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
                  <p className="text-sm text-muted-foreground">Tasks Done</p>
                  <p className="text-2xl font-bold">{totals.tasksCompleted}/{totals.totalTasks}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Card View */}
        {viewMode === 'cards' && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
                  {/* Staffing */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Staffing</span>
                    </div>
                    <span className={`font-medium ${getStaffingColor(loc.clockedInCount, loc.scheduledCount)}`}>
                      {loc.clockedInCount}/{loc.scheduledCount}
                    </span>
                  </div>

                  {/* Tasks */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Tasks</span>
                    </div>
                    <span className={`font-medium ${getTaskCompletionColor(loc.tasksCompleted, loc.totalTasks)}`}>
                      {loc.tasksCompleted}/{loc.totalTasks}
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
                      <TableHead className="text-center">Clocked In</TableHead>
                      <TableHead className="text-center">Scheduled</TableHead>
                      <TableHead className="text-center">Tasks</TableHead>
                      <TableHead className="text-center">Open Shifts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locations.map((loc) => (
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
                        <TableCell className="text-center">
                          <span className={`font-medium ${getStaffingColor(loc.clockedInCount, loc.scheduledCount)}`}>
                            {loc.clockedInCount}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">{loc.scheduledCount}</TableCell>
                        <TableCell className="text-center">
                          <span className={`font-medium ${getTaskCompletionColor(loc.tasksCompleted, loc.totalTasks)}`}>
                            {loc.tasksCompleted}/{loc.totalTasks}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {loc.openShifts > 0 ? (
                            <Badge variant="outline" className="text-amber-600 border-amber-300">
                              {loc.openShifts}
                            </Badge>
                          ) : (
                            <CheckCircle2 className="h-4 w-4 mx-auto text-green-600" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
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
