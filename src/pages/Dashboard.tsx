import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { FEATURE_FLAGS } from '@/config/featureFlags';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ClipboardCheck, Settings2 } from 'lucide-react';
import { MetricType, WidgetSize } from '@/components/dashboard/DashboardWidget';
import { CubeType, TrackerDisplayMode, TrackerRankMetric, TrackerScopeType } from '@/components/dashboard/AddWidgetDialog';
import { WidgetsSection } from '@/components/dashboard/WidgetsSection';
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets';
import { updateDashboardWidget, deleteDashboardWidget, buildWidgetConfigJson } from '@/lib/dashboardWidgetsClient';
import { useDashboardSections } from '@/components/dashboard/DataCubesSection';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { useTeamSalesVisibility } from '@/hooks/useTeamSalesVisibility';
// useShouldUseRoleCubes removed — unified dashboard_widgets handles role visibility via RLS
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getDayOfWeekInTimezone } from '@/utils/timezoneUtils';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { SalesDataForWidgets } from '@/components/dashboard/DashboardWidget';
import { usePersonalPayData } from '@/hooks/usePersonalPayData';
import { PullToRefresh } from '@/components/PullToRefresh';
import { QuickTasksSection } from '@/components/dashboard/QuickTasksSection';
import { ChecklistsGrid } from '@/components/dashboard/ChecklistsGrid';
import { TrainingAssignmentsSection } from '@/components/dashboard/TrainingAssignmentsSection';
import { CateringOrderDialog } from '@/components/dashboard/CateringOrderDialog';
import { useChecklistCompletion } from '@/hooks/useChecklistCompletion';
import type { CubeConfig, SectionKey } from '@/components/dashboard/EditDashboardDialog';
import { getSectionOrder } from '@/components/dashboard/EditDashboardDialog';
import { BillingActivationBanner } from '@/components/billing/BillingActivationBanner';
import { PageTitle } from '@/components/PageTitle';


// Lazy-loaded components (only needed conditionally)
const CrowSplashAnimation = lazy(() => import('@/components/CrowSplashAnimation'));
const EditDashboardDialog = lazy(() => import('@/components/dashboard/EditDashboardDialog').then(m => ({ default: m.EditDashboardDialog })));


interface CateringOrder {
  id: string;
  order_number: string | null;
  customer_name: string;
  pickup_date: string;
  pickup_time: string;
  headcount: number | null;
  items: { quantity: number; item: string; notes?: string }[];
  notes: string | null;
  source_url: string | null;
  status: string;
}
interface Checklist {
  id: string;
  title: string;
  description: string | null;
  frequency: string;
  created_at: string;
  template_type: string | null;
  visible_days_before_month_end: number | null;
  due_by_time: string | null;
  lock_until_time: string | null;
}
export default function Dashboard() {
  // Themed dashboard backgrounds (beach + playa)
  useEffect(() => {
    document.body.classList.add('beach-dashboard', 'playa-dashboard', 'blaze-dashboard');
    return () => document.body.classList.remove('beach-dashboard', 'playa-dashboard', 'blaze-dashboard');
  }, []);
  const [selectedCateringOrder, setSelectedCateringOrder] = useState<CateringOrder | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [showWelcomeAnimation, setShowWelcomeAnimation] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isAdmin, isManager, isShiftManager, isGeneralManager
  } = useUserRole();
  const { canSeeSales, loading: salesVisibilityLoading } = useTeamSalesVisibility();
  const { user } = useAuth();
  const canCompleteCatering = isShiftManager || isGeneralManager || isManager || isAdmin;
  const { currentLocation, organizationId } = useAppLocation();
  const { getTodayInTimezone, timezone } = useLocationTimezone();
  const { isSectionVisible } = useDashboardSections();
  const [showAddCubeDialog, setShowAddCubeDialog] = useState(false);
  const [showEditDashboard, setShowEditDashboard] = useState(false);
  const [dashboardSectionOrder, setDashboardSectionOrder] = useState<SectionKey[]>(() => 
    currentLocation?.id ? getSectionOrder(currentLocation.id) : ['data-cubes', 'checklists', 'sales-chart']
  );
  const queryClient = useQueryClient();

  // Sales data from shared cache — SalesSummary is the MASTER WRITER via setQueryData.
  // Using useQuery subscribes to cache updates so Dashboard re-renders when data arrives.
  // No queryFn needed — SalesSummary populates the cache; we just read it.
  const { data: salesOverviewData = null } = useQuery<SalesDataForWidgets | null>({
    queryKey: ['dashboard-sales-enriched', currentLocation?.id],
    queryFn: () => queryClient.getQueryData(['dashboard-sales-enriched', currentLocation?.id]) ?? null,
    enabled: !!currentLocation?.id,
    staleTime: Infinity, // Never refetch — SalesSummary manages updates via setQueryData
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const isLoadingSales = salesOverviewData === null;

  
  // Light DB reads — always refetch on pull
  const ALWAYS_REFRESH_KEYS = [
    ['user-checklists'],
    
    ['dashboard-widgets'],
    ['catering-orders'],
    ['temporary-tasks'],
    ['location-hours-today'],
  ];
  
  // Heavy API/edge function calls — cooldown-gated
  const COOLDOWN_KEYS = [
    ['sales-cache'],
    ['labor-cache'],
    ['daily-tips'],
  ];
  
  // Handle pull-to-refresh (no-op callback, PullToRefresh handles invalidation)
  const handleRefresh = useCallback(() => {}, []);
  
  // Role-based cubes deprecated — unified dashboard_widgets handles role visibility via RLS
  const shouldUseRoleCubes = false;
  const roleCubes: any[] = [];
  
  // Fetch personal pay data for personal metrics
  const { data: personalPayData } = usePersonalPayData();
  
  // Fetch KDS data for current location
  const { data: kdsData } = useQuery({
    queryKey: ['kds-cache', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return null;
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('kds_cache')
        .select('*')
        .eq('location_id', currentLocation.id)
        .gte('metric_date', weekAgo)
        .lte('metric_date', today)
        .order('metric_date', { ascending: false });
      
      if (error || !data || data.length === 0) return null;
      
      const todayRow = data[0]; // Most recent
      const wtdAvg = data.reduce((s, r) => s + (r.avg_ticket_time || 0), 0) / data.filter(r => (r.avg_ticket_time || 0) > 0).length || 0;
      const totalOrders = todayRow.orders_total || 0;
      const latePct = totalOrders > 0 ? ((todayRow.orders_slow || 0) / totalOrders) * 100 : 0;
      
      return {
        ticketTimeToday: todayRow.avg_ticket_time || undefined,
        ticketTimeWtd: wtdAvg > 0 ? Math.round(wtdAvg * 100) / 100 : undefined,
        orderCount: totalOrders || undefined,
        latePct: totalOrders > 0 ? Math.round(latePct * 10) / 10 : undefined,
        onTimeCount: todayRow.orders_fast || 0,
        cautionCount: todayRow.orders_medium || 0,
        lateCount: todayRow.orders_slow || 0,
      };
    },
    enabled: FEATURE_FLAGS.KDS_ENABLED && !!currentLocation?.id,
    staleTime: 5 * 60 * 1000,
  });
  
  // Fetch Kiosk metrics for current location (only relevant for stores with a kiosk)
  const { data: kioskData } = useQuery({
    queryKey: ['kiosk-metrics', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return null;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return null;
      const { data, error } = await supabase.functions.invoke('kiosk-metrics', {
        body: { location_id: currentLocation.id },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) return null;
      return data ?? null;
    },

    enabled: !!currentLocation?.id,
    staleTime: 5 * 60 * 1000,
    // Only keep polling for locations that actually returned kiosk data.
    // Stores without a kiosk stop after the first call instead of polling forever.
    refetchInterval: (query) => (query.state.data ? 5 * 60 * 1000 : false),

  });

  // Combine sales data with personal data and KDS data (memoized to prevent recalc on every render)
  const combinedSalesData: SalesDataForWidgets | null = useMemo(() => {
    if (salesOverviewData) {
      return { ...salesOverviewData, personalData: personalPayData, kdsData, kioskData };
    }
    if (personalPayData || kdsData || kioskData) {
      return { personalData: personalPayData, kdsData, kioskData };
    }
    return null;
  }, [salesOverviewData, personalPayData, kdsData, kioskData]);

  // Read from the unified dashboard_widgets table via the shared hook
  // (same query key as WidgetsSection, so no duplicate fetch).
  const { data: unifiedWidgets = [] } = useDashboardWidgets(currentLocation?.id);
  const dashboardCubes: CubeConfig[] = useMemo(() => unifiedWidgets.map(w => ({
    id: w.id,
    title: w.title,
    size: w.size,
    metrics: w.metrics,
    accentColor: w.accentColor,
    cubeType: w.cubeType,
    faceMetrics: w.faceMetrics,
    faceTitles: w.faceTitles,
    numFaces: w.numFaces,
    trackerScope: w.trackerScope,
    trackerDisplayMode: w.trackerDisplayMode,
    trackerItemRefs: w.trackerItemRefs,
    trackerPromoStart: w.trackerPromoStart,
    trackerPromoEnd: w.trackerPromoEnd,
    trackerPromoImageUrl: w.trackerPromoImageUrl,
    trackerLocationRefs: w.trackerLocationRefs,
    trackerRankMetrics: w.trackerRankMetrics,
    trackerLocationScope: w.trackerLocationScope,
    authorityScope: w.authorityScope,
    audienceRoles: (w.audienceRoles ?? null) as any,
    brandId: w.brandId,
    organizationId: w.organizationId,
    locationId: w.locationId,
    hiddenForSelf: w.hiddenForSelf,
    hiddenForLocation: w.hiddenForLocation,
    trackerExcludedLocationIds: w.trackerExcludedLocationIds,
    createdBy: w.createdBy,
  })), [unifiedWidgets]);

  const handleUpdateCube = async (id: string, updates: Partial<CubeConfig>) => {
    try {
      // Build the JSONB config patch. We MUST resolve against the existing widget
      // because update_dashboard_widget replaces the whole `config` blob.
      const existing = unifiedWidgets.find(w => w.id === id);
      const mergedConfig = buildWidgetConfigJson({
        metrics: updates.metrics ?? existing?.metrics,
        faceMetrics: updates.faceMetrics ?? existing?.faceMetrics,
        faceTitles: updates.faceTitles ?? existing?.faceTitles,
        numFaces: updates.numFaces ?? existing?.numFaces,
        trackerScope: updates.trackerScope ?? existing?.trackerScope,
        trackerDisplayMode: updates.trackerDisplayMode ?? existing?.trackerDisplayMode,
        trackerItemRefs: updates.trackerItemRefs ?? existing?.trackerItemRefs,
        trackerPromoStart: updates.trackerPromoStart ?? existing?.trackerPromoStart,
        trackerPromoEnd: updates.trackerPromoEnd ?? existing?.trackerPromoEnd,
        trackerPromoImageUrl: updates.trackerPromoImageUrl ?? existing?.trackerPromoImageUrl,
        trackerLocationRefs: updates.trackerLocationRefs ?? existing?.trackerLocationRefs,
        trackerRankMetrics: updates.trackerRankMetrics ?? existing?.trackerRankMetrics,
        trackerLocationScope: updates.trackerLocationScope ?? existing?.trackerLocationScope,
        trackerExcludedLocationIds: (updates as any).trackerExcludedLocationIds ?? existing?.trackerExcludedLocationIds,
      });

      const scopeChanged = updates.authorityScope !== undefined && updates.authorityScope !== existing?.authorityScope;

      await updateDashboardWidget({
        widget_id: id,
        title: updates.title ?? null,
        accent_color: updates.accentColor ?? null,
        config: mergedConfig,
        // Visibility — only forwarded when explicitly provided in `updates`.
        authority_scope: updates.authorityScope ?? null,
        audience_roles: updates.audienceRoles === undefined ? null : (updates.audienceRoles as any),
        // When scope changes, send the matching FK and null out the others
        // so the RPC re-anchors the widget. Otherwise leave all null (no-op).
        location_id: scopeChanged
          ? (updates.authorityScope === 'location' ? (updates.locationId ?? null) : null)
          : null,
        organization_id: scopeChanged
          ? (updates.authorityScope === 'org' ? (updates.organizationId ?? null) : null)
          : null,
        brand_id: scopeChanged
          ? (updates.authorityScope === 'brand' ? (updates.brandId ?? null) : null)
          : null,
      });

      toast.success('Widget updated');
      queryClient.invalidateQueries({ queryKey: ['dashboard-widgets'] });
    } catch (error: any) {
      console.error('Error updating cube:', error);
      toast.error(error?.message || 'Failed to update widget');
    }
  };

  const handleDeleteCube = async (id: string) => {
    try {
      await deleteDashboardWidget(id);
      toast.success('Widget removed');
      queryClient.invalidateQueries({ queryKey: ['dashboard-widgets'] });
    } catch (error: any) {
      console.error('Error deleting cube:', error);
      toast.error(error?.message || 'Failed to remove widget');
    }
  };

  const handleReorderCubes = async (orderedIds: string[]) => {
    try {
      // Two-phase via RPC to avoid unique-order conflicts
      await Promise.all(orderedIds.map((id, i) =>
        supabase.rpc('update_dashboard_widget', { _widget_id: id, _display_order: -(1000000 + i) })
      ));
      await Promise.all(orderedIds.map((id, i) =>
        supabase.rpc('update_dashboard_widget', { _widget_id: id, _display_order: i })
      ));
      queryClient.invalidateQueries({ queryKey: ['dashboard-widgets'] });
    } catch (error: any) {
      console.error('Error reordering cubes:', error);
      toast.error(error?.message || 'Failed to save order');
    }
  };

  useEffect(() => {
    if (location.state?.showWelcomeAnimation) {
      setShowWelcomeAnimation(true);
      // Clear the state so it doesn't show again on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);
  
  // Fetch location hours for current day of week (in location's timezone)
  const { data: locationSettings } = useQuery({
    queryKey: ["location-hours-today", currentLocation?.id, timezone],
    staleTime: 10 * 60 * 1000, // 10 min cache - store hours don't change mid-day
    queryFn: async () => {
      if (!currentLocation) return null;
      // Get current day of week in the location's timezone, not the user's browser timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short'
      });
      const weekdayName = formatter.format(new Date());
      const weekdayMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
      const dayOfWeek = weekdayMap[weekdayName] ?? new Date().getDay();
      
      const { data, error } = await supabase
        .from('location_hours')
        .select('open_time, close_time, is_closed')
        .eq('location_id', currentLocation.id)
        .eq('day_of_week', dayOfWeek)
        .maybeSingle();
      
      if (error) {
        console.error("Error fetching location hours:", error);
        return null;
      }
      
      if (!data || data.is_closed) return null;
      
      // Map to expected format
      return {
        hours_open: data.open_time,
        hours_close: data.close_time
      };
    },
    enabled: !!currentLocation,
    // No refetchInterval - store hours don't change mid-day, saves battery/network
  });

  // Check if location has active QuBeyond integration
  // Uses backend RPC to avoid exposing integration credentials to non-admin roles
  const { data: hasQuBeyondIntegration } = useQuery({
    queryKey: ["qubeyond-integration-check", currentLocation?.id],
    staleTime: 10 * 60 * 1000, // 10 min cache - rarely changes
    queryFn: async () => {
      if (!currentLocation) return false;

      const { data, error } = await supabase.rpc('has_active_location_integration', {
        _location_id: currentLocation.id,
        _integration_type: 'qubeyond',
      });

      if (error) {
        console.error("Error checking integration:", error);
        return false;
      }

      return !!data;
    },
    enabled: !!currentLocation,
  });
  // Catering orders with React Query (cached, instant on revisit)
  useQuery({
    queryKey: ['todays-catering-orders', currentLocation?.id, getTodayInTimezone()],
    staleTime: 2 * 60 * 1000, // 2 min cache
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      const today = getTodayInTimezone();
      
      const { data, error } = await supabase
        .from("catering_orders")
        .select("*")
        .eq("location_id", currentLocation.id)
        .eq("pickup_date", today)
        .in("status", ["pending", "completed"])
        .order("pickup_time", { ascending: true });

      if (error) throw error;
      return (data || []).map(order => ({
        ...order,
        items: order.items as unknown as { quantity: number; item: string; notes?: string }[]
      })) as CateringOrder[];
    },
    enabled: !!currentLocation?.id,
  });

  const handleCompleteCateringOrder = async (order: CateringOrder) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("catering_orders")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          completed_by: user.id,
        })
        .eq("id", order.id);

      if (error) throw error;

      toast.success("Catering order completed!");
      setSelectedCateringOrder(null);
      queryClient.invalidateQueries({ queryKey: ['todays-catering-orders'] });
    } catch (error) {
      console.error("Error completing order:", error);
      toast.error("Failed to complete order");
    }
  };


  // Checklists data with React Query (cached, instant on revisit)
  const { data: checklistData, isLoading: checklistsLoading } = useQuery({
    queryKey: ['dashboard-checklists', currentLocation?.id, timezone],
    staleTime: 2 * 60 * 1000, // 2 min cache
    placeholderData: (prev) => prev, // Keep previous data during refetch to prevent double-spinner
    queryFn: async () => {
      if (!currentLocation?.id) return { checklists: [] };
      
      const currentDay = getDayOfWeekInTimezone(timezone);

      // Only the checklist definitions are needed here — the dashboard renders
      // today's list and pulls completion counts from useChecklistCompletion.
      const checklistsResult = await supabase.from('checklists').select(`
            *,
            checklist_items(id, days_of_week)
          `)
        .eq('is_active', true)
        .neq('template_type', 'training')
        .eq('location_id', currentLocation.id)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (checklistsResult.error) throw checklistsResult.error;

      const checklistsData = checklistsResult.data || [];

      // Filter checklists
      const filteredChecklists = checklistsData.filter(checklist => {
        if (checklist.template_type === 'dynamic') {
          const todayItems = checklist.checklist_items?.filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          );
          return todayItems && todayItems.length > 0;
        }
        
        if (checklist.frequency === 'monthly' && checklist.visible_days_before_month_end) {
          const today = new Date();
          const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          const daysUntilMonthEnd = lastDayOfMonth.getDate() - today.getDate();
          return daysUntilMonthEnd < checklist.visible_days_before_month_end;
        }
        
        return true;
      });

      return { checklists: filteredChecklists as Checklist[] };
    },

    enabled: !!currentLocation?.id,
  });

  const checklists = checklistData?.checklists || [];


  // Checklist completion data (cached via React Query)
  const { getCompletionData } = useChecklistCompletion(checklists, currentLocation?.id);

  const quickTasksContent = (
    <QuickTasksSection locationSettings={locationSettings} timezone={timezone} />
  );

  const checklistsGridContent = (
    <>
      <TrainingAssignmentsSection
        locationId={currentLocation?.id}
        userId={user?.id}
        timezone={timezone}
        canApprove={isAdmin || isManager || isShiftManager || isGeneralManager}
      />
      <ChecklistsGrid
        checklists={checklists}
        getCompletionData={getCompletionData}
        timezone={timezone}
      />
    </>
  );


  const cateringDialogs = (
    <CateringOrderDialog
      selectedOrder={selectedCateringOrder}
      onClose={() => setSelectedCateringOrder(null)}
      canComplete={canCompleteCatering}
      onComplete={handleCompleteCateringOrder}
      pdfPreviewUrl={pdfPreviewUrl}
      onPdfPreviewChange={setPdfPreviewUrl}
    />
  );


  // Render WidgetsSection if:
  // 1. QuBeyond integration is active AND user can see sales, OR
  // 2. User wants to use personal metrics (always available)
  // For now, always show WidgetsSection since personal metrics are available to all
  // While role/permissions are still loading, treat sales as visible to avoid
  // a flash of "No checklists yet"/missing widgets caused by the role hook
  // resolving slower than location/checklist data on first load.
  const showWidgets = isSectionVisible('data-cubes') && (salesVisibilityLoading || canSeeSales || !hasQuBeyondIntegration);
  // When sales are hidden but the user still has trackers published to them
  // (promo rank widgets), render WidgetsSection in trackers-only mode so the
  // tracker still shows alongside checklists.
  const hasVisibleTracker = dashboardCubes.some(c => c.cubeType === 'tracker' && !(c as any).hiddenForSelf && !(c as any).hiddenForLocation);
  const showTrackersOnly = !showWidgets && hasVisibleTracker;

  const dashboardContent = (showWidgets || showTrackersOnly) ? (
    <WidgetsSection 
      salesData={combinedSalesData} 
      isLoadingSales={isLoadingSales} 
      hasQuBeyondIntegration={hasQuBeyondIntegration} 
      showAddDialog={showAddCubeDialog} 
      onAddDialogChange={setShowAddCubeDialog} 
      locationSettings={locationSettings} 
      isReorderMode={false}
      checklistsContent={checklistsGridContent}
      onSalesDataChange={undefined}
      roleCubes={roleCubes}
      useRoleCubes={shouldUseRoleCubes}
      sectionOrder={dashboardSectionOrder}
      trackersOnly={showTrackersOnly}
    />
  ) : (
    // If section not visible, just render the checklists grid directly
    checklistsGridContent
  );
  return <Layout>
      <PullToRefresh
        alwaysRefreshKeys={ALWAYS_REFRESH_KEYS}
        cooldownKeys={COOLDOWN_KEYS}
        cooldownMs={2 * 60 * 1000}
        onRefresh={handleRefresh}
      >
          <div className="space-y-1">
            <PageTitle
              color="teal"
              action={
                !shouldUseRoleCubes && (
                  <Button
                    onClick={() => setShowEditDashboard(true)}
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10"
                    title="Edit Dashboard"
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                )
              }
            >
              Dash
            </PageTitle>

            <BillingActivationBanner />



          {/* Edit Dashboard Dialog - lazy loaded */}
          <Suspense fallback={null}>
            <EditDashboardDialog
              open={showEditDashboard}
              onOpenChange={setShowEditDashboard}
              cubes={dashboardCubes}
              onUpdateCube={handleUpdateCube}
              onDeleteCube={handleDeleteCube}
              onAddCube={() => setShowAddCubeDialog(true)}
              onReorderCubes={handleReorderCubes}
              onSectionOrderChange={setDashboardSectionOrder}
            />
          </Suspense>

          {checklistsLoading ? (
            <div className="space-y-3 animate-fade-in">
              {/* Match actual layout: vertical task cards + checklist card */}
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-[200px] rounded-xl" />
            </div>
          ) : checklists.length === 0 && dashboardCubes.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <ClipboardCheck className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No checklists yet</h3>
                <p className="text-muted-foreground mb-4">Go to Tasks to create your first checklist</p>
                <Button onClick={() => navigate('/tasks')}>Go to Tasks</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {quickTasksContent}
              {dashboardContent}
            </div>
          )}
        </div>
        
        {/* Welcome animation overlay */}
        {showWelcomeAnimation && (
          <Suspense fallback={null}>
            <CrowSplashAnimation onComplete={() => setShowWelcomeAnimation(false)} />
          </Suspense>
        )}
        {cateringDialogs}
      </PullToRefresh>
    </Layout>;
}