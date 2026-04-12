import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ChefHat, ClipboardCheck, Check, Settings2 } from 'lucide-react';
import { ChecklistCard } from '@/components/dashboard/ChecklistCard';
import { EditDashboardDialog, CubeConfig, SectionKey, getSectionOrder } from '@/components/dashboard/EditDashboardDialog';
import { MetricType, WidgetSize } from '@/components/dashboard/DashboardWidget';
import { CubeType } from '@/components/dashboard/AddWidgetDialog';
import { CashHandlingTasks } from '@/components/dashboard/CashHandlingTasks';
import { DailySpotCheckTask } from '@/components/dashboard/DailySpotCheckTask';
import { AssignedTemporaryTasks } from '@/components/dashboard/AssignedTemporaryTasks';
import { CateringOrdersAlert } from '@/components/dashboard/CateringOrdersAlert';
import { DataStreamTask } from '@/components/dashboard/DataStreamTask';
import { OpusBackgroundSync } from '@/components/dashboard/OpusBackgroundSync';

import { UnreadAnnouncementsAlert } from '@/components/dashboard/UnreadAnnouncementsAlert';
import { PendingDocumentsCard } from '@/components/dashboard/PendingDocumentsCard';
import { I9UploadCard } from '@/components/dashboard/I9UploadCard';
import { WidgetsSection } from '@/components/dashboard/WidgetsSection';
import { useDashboardSections } from '@/components/dashboard/DataCubesSection';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { useTeamSalesVisibility } from '@/hooks/useTeamSalesVisibility';
import { useShouldUseRoleCubes } from '@/hooks/useRoleDashboardCubes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getDayOfWeekInTimezone } from '@/utils/timezoneUtils';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { SalesDataForWidgets } from '@/components/dashboard/DashboardWidget';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CrowSplashAnimation from '@/components/CrowSplashAnimation';
import { usePersonalPayData } from '@/hooks/usePersonalPayData';
import { PullToRefresh } from '@/components/PullToRefresh';


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
interface ChecklistStats {
  checklist_id: string;
  total_submissions: number;
  last_submission: string | null;
  submissions_this_week: number;
  submissions_this_month: number;
  submissions_today: number;
}
export default function Dashboard() {
  // Beach theme background — only on dashboard
  useEffect(() => {
    document.body.classList.add('beach-dashboard');
    return () => document.body.classList.remove('beach-dashboard');
  }, []);
  const [completionData, setCompletionData] = useState<Record<string, {
    expected: number;
    completed: number;
  }>>({});
  const [selectedCateringOrder, setSelectedCateringOrder] = useState<CateringOrder | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [showWelcomeAnimation, setShowWelcomeAnimation] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isAdmin, isManager, isShiftManager, isGeneralManager
  } = useUserRole();
  const { canSeeSales } = useTeamSalesVisibility();
  const { user } = useAuth();
  const canCompleteCatering = isShiftManager || isGeneralManager || isManager || isAdmin;
  const { currentLocation, organizationId } = useAppLocation();
  const { getTodayInTimezone, timezone, getBusinessDateInTimezone, getBusinessDayRangeInTimezone, loading: timezoneLoading } = useLocationTimezone();
  const [salesOverviewData, setSalesOverviewData] = useState<SalesDataForWidgets | null>(null);
  const [isLoadingSales, setIsLoadingSales] = useState(true);
  const { isSectionVisible } = useDashboardSections();
  const [showAddCubeDialog, setShowAddCubeDialog] = useState(false);
  const [showEditDashboard, setShowEditDashboard] = useState(false);
  const [dashboardSectionOrder, setDashboardSectionOrder] = useState<SectionKey[]>(() => 
    currentLocation?.id ? getSectionOrder(currentLocation.id) : ['data-cubes', 'checklists', 'sales-chart']
  );
  const queryClient = useQueryClient();

  
  // Light DB reads — always refetch on pull
  const ALWAYS_REFRESH_KEYS = [
    ['user-checklists'],
    ['checklist-stats'],
    ['user-data-cubes'],
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
  
  // Role-based cubes for TM/SM/Manager (locked by Org Admin)
  const { shouldUseRoleCubes, roleCubes } = useShouldUseRoleCubes(organizationId);
  
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
    enabled: !!currentLocation?.id,
    staleTime: 5 * 60 * 1000,
  });
  
  // Combine sales data with personal data and KDS data (memoized to prevent recalc on every render)
  const combinedSalesData: SalesDataForWidgets | null = useMemo(() => {
    if (salesOverviewData) {
      return { ...salesOverviewData, personalData: personalPayData, kdsData };
    }
    if (personalPayData || kdsData) {
      return { personalData: personalPayData, kdsData };
    }
    return null;
  }, [salesOverviewData, personalPayData, kdsData]);

  // Use shared query for cubes (WidgetsSection fetches, we just read from cache)
  // This prevents duplicate network requests - same queryKey means shared cache
  const { data: dashboardCubes = [] } = useQuery({
    queryKey: ['user-data-cubes', user?.id, currentLocation?.id],
    queryFn: async () => {
      if (!user?.id || !currentLocation?.id) return [];

      const { data, error } = await supabase
        .from('user_dashboard_cubes')
        .select('*')
        .eq('user_id', user.id)
        .eq('location_id', currentLocation.id)
        .in('cube_type', ['data', 'data-3d', 'sales-chart'])
        .order('display_order');

      if (error) {
        console.error('Error fetching data cubes:', error);
        return [];
      }

      return (data || []).map(cube => ({
        id: cube.id,
        title: cube.title || '',
        size: (cube.widget_size as WidgetSize) || 'small',
        metrics: (cube.metrics as MetricType[]) || [],
        accentColor: cube.accent_color || '#8B5CF6',
        cubeType: (cube.cube_type as CubeType | 'data-3d') || 'data',
        faceMetrics: (cube.face_metrics as MetricType[][]) || [],
        faceTitles: (cube.face_titles as string[]) || [],
        numFaces: cube.num_faces || 1,
      })) as CubeConfig[];
    },
    enabled: !!user?.id && !!currentLocation?.id,
    staleTime: 30 * 1000, // 30s cache - prevent duplicate fetches on mount
    placeholderData: (previousData) => previousData, // Show previous data instantly while refetching
  });

  const handleUpdateCube = async (id: string, updates: Partial<CubeConfig>) => {
    try {
      const updateData: Record<string, any> = {
        title: updates.title,
        metrics: updates.metrics,
        accent_color: updates.accentColor,
      };
      
      // Include 3D cube specific fields if present
      if (updates.faceMetrics !== undefined) {
        updateData.face_metrics = updates.faceMetrics;
      }
      if (updates.faceTitles !== undefined) {
        updateData.face_titles = updates.faceTitles;
      }
      if (updates.numFaces !== undefined) {
        updateData.num_faces = updates.numFaces;
      }
      
      const { error } = await supabase
        .from('user_dashboard_cubes')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;
      
      toast.success('Widget updated');
      queryClient.invalidateQueries({ queryKey: ['user-data-cubes'] });
    } catch (error) {
      console.error('Error updating cube:', error);
      toast.error('Failed to update widget');
    }
  };

  const handleDeleteCube = async (id: string) => {
    try {
      const { error } = await supabase
        .from('user_dashboard_cubes')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Widget removed');
      queryClient.invalidateQueries({ queryKey: ['user-data-cubes'] });
    } catch (error) {
      console.error('Error deleting cube:', error);
      toast.error('Failed to remove widget');
    }
  };

  const handleReorderCubes = async (orderedIds: string[]) => {
    try {
      // Two-phase update to avoid unique constraint conflicts on display_order
      // Phase 1: Set all to temporary negative values (parallel)
      await Promise.all(orderedIds.map((id, i) =>
        supabase.from('user_dashboard_cubes').update({ display_order: -(1000000 + i) }).eq('id', id)
      ));
      // Phase 2: Set final values (parallel)
      await Promise.all(orderedIds.map((id, i) =>
        supabase.from('user_dashboard_cubes').update({ display_order: i }).eq('id', id)
      ));
      queryClient.invalidateQueries({ queryKey: ['user-data-cubes'] });
    } catch (error) {
      console.error('Error reordering cubes:', error);
      toast.error('Failed to save order');
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

  const formatCateringTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  // Checklists data with React Query (cached, instant on revisit)
  const { data: checklistData, isLoading: checklistsLoading } = useQuery({
    queryKey: ['dashboard-checklists', currentLocation?.id, timezone],
    staleTime: 2 * 60 * 1000, // 2 min cache
    placeholderData: (prev) => prev, // Keep previous data during refetch to prevent double-spinner
    queryFn: async () => {
      if (!currentLocation?.id) return { checklists: [], stats: {} };
      
      const currentDay = getDayOfWeekInTimezone(timezone);

      // Parallel fetch: checklists + submissions
      const [checklistsResult, submissionsResult] = await Promise.all([
        supabase.from('checklists').select(`
            *,
            checklist_items(id, days_of_week)
          `)
          .eq('is_active', true)
          .eq('location_id', currentLocation.id)
          .order('display_order', { ascending: true })
          .order('created_at', { ascending: false }),
        supabase.from('checklist_submissions')
          .select('checklist_id, submitted_at')
          .eq('location_id', currentLocation.id)
      ]);

      if (checklistsResult.error) throw checklistsResult.error;
      if (submissionsResult.error) throw submissionsResult.error;

      const checklistsData = checklistsResult.data || [];
      const submissions = submissionsResult.data || [];

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

      // Calculate stats
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const statsMap: Record<string, ChecklistStats> = {};
      checklistsData.forEach(checklist => {
        const checklistSubmissions = submissions.filter(sub => sub.checklist_id === checklist.id);
        const submissionsToday = checklistSubmissions.filter(sub => new Date(sub.submitted_at) >= startOfToday).length;
        const submissionsThisWeek = checklistSubmissions.filter(sub => new Date(sub.submitted_at) >= oneWeekAgo).length;
        const submissionsThisMonth = checklistSubmissions.filter(sub => new Date(sub.submitted_at) >= oneMonthAgo).length;
        const sortedSubmissions = [...checklistSubmissions].sort((a, b) => 
          new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
        );
        statsMap[checklist.id] = {
          checklist_id: checklist.id,
          total_submissions: checklistSubmissions.length,
          last_submission: sortedSubmissions[0]?.submitted_at || null,
          submissions_this_week: submissionsThisWeek,
          submissions_this_month: submissionsThisMonth,
          submissions_today: submissionsToday
        };
      });

      return { checklists: filteredChecklists as Checklist[], stats: statsMap };
    },
    enabled: !!currentLocation?.id,
  });

  const checklists = checklistData?.checklists || [];
  



  
  useEffect(() => {
    // Wait for timezone to load before calculating completion data.
    // NOTE: closeTime can legitimately be null (no hours row for that day);
    // in that case the business-day helpers fall back to the default cutoff.
    // Only run when timezone is ready and we have checklists + location
    if (!timezoneLoading && checklists.length > 0 && currentLocation?.id) {
      loadCompletionData();
    }
  }, [checklists.length, timezoneLoading, currentLocation?.id]);

  // Note: UserManagement prefetch removed — prefetchQuery without queryFn is a no-op

  const loadCompletionData = async () => {
    if (!checklists.length || !currentLocation?.id) return;
    
    // Use business date which accounts for late-night operations
    // (submissions before cutoff time count as previous day)
    const businessDateStr = getBusinessDateInTimezone();
    
    // Get current day of week using timezone-aware function (Mon=0, Sun=6)
    const currentDay = getDayOfWeekInTimezone(timezone);
    
    // Calculate business day period in location timezone
    // Business day runs from cutoff hour today to cutoff hour tomorrow
    const { start: periodStartBusiness, end: periodEndBusiness } = getBusinessDayRangeInTimezone(businessDateStr);
    
    
    // Monthly period
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    
    const checklistIds = checklists.map(c => c.id);
    
    // Separate checklists by frequency to avoid 1000-row limit truncation
    const dailyChecklistIds = checklists.filter(c => c.frequency !== 'monthly').map(c => c.id);
    const monthlyChecklistIds = checklists.filter(c => c.frequency === 'monthly').map(c => c.id);
    
    // ALL 3 QUERIES IN PARALLEL: items + daily responses + monthly responses
    const [
      { data: allChecklistItems },
      { data: dailyResponses },
      { data: monthlyResponses }
    ] = await Promise.all([
      // Query 1: All checklist items
      supabase
        .from('checklist_items')
        .select('id, checklist_id, days_of_week')
        .in('checklist_id', checklistIds),
      // Query 2: Daily responses (today's business day only)
      dailyChecklistIds.length > 0 
        ? supabase
            .from('checklist_responses')
            .select(`
              id,
              item_id,
              created_at,
              checklist_submissions!inner(id, checklist_id, location_id)
            `)
            .in('checklist_submissions.checklist_id', dailyChecklistIds)
            .eq('checklist_submissions.location_id', currentLocation.id)
            .gte('created_at', periodStartBusiness.toISOString())
            .lte('created_at', periodEndBusiness.toISOString())
        : Promise.resolve({ data: [] as any[] }),
      // Query 3: Monthly responses (this month only)
      monthlyChecklistIds.length > 0
        ? supabase
            .from('checklist_responses')
            .select(`
              id,
              item_id,
              created_at,
              checklist_submissions!inner(id, checklist_id, location_id)
            `)
            .in('checklist_submissions.checklist_id', monthlyChecklistIds)
            .eq('checklist_submissions.location_id', currentLocation.id)
            .gte('created_at', monthStart.toISOString())
            .lte('created_at', monthEnd.toISOString())
        : Promise.resolve({ data: [] as any[] }),
    ]);
    
    // Combine responses
    const allResponses = [...(dailyResponses || []), ...(monthlyResponses || [])];
    
    
    // Group items by checklist_id
    const itemsByChecklist = new Map<string, typeof allChecklistItems>();
    allChecklistItems?.forEach(item => {
      const existing = itemsByChecklist.get(item.checklist_id) || [];
      existing.push(item);
      itemsByChecklist.set(item.checklist_id, existing);
    });
    
    // Group responses by checklist_id
    const responsesByChecklist = new Map<string, typeof allResponses>();
    allResponses?.forEach((response: any) => {
      const checklistId = response.checklist_submissions?.checklist_id;
      if (checklistId) {
        const existing = responsesByChecklist.get(checklistId) || [];
        existing.push(response);
        responsesByChecklist.set(checklistId, existing);
      }
    });
    
    const dataMap: Record<string, { expected: number; completed: number }> = {};
    
    for (const checklist of checklists) {
      const checklistItems = itemsByChecklist.get(checklist.id) || [];
      let itemCount = checklistItems.length;
      
      if (checklist.template_type === 'dynamic') {
        itemCount = checklistItems.filter(item => item.days_of_week && item.days_of_week.includes(currentDay)).length;
      }

      // For monthly checklists, use start/end of month; otherwise use business day period
      const isMonthly = checklist.frequency === 'monthly';
      const periodStart = isMonthly ? monthStart : periodStartBusiness;
      const periodEnd = isMonthly ? monthEnd : periodEndBusiness;
      
      // Filter responses for this checklist and time period
      const responses = (responsesByChecklist.get(checklist.id) || []).filter((r: any) => {
        const createdAt = new Date(r.created_at);
        return createdAt >= periodStart && createdAt <= periodEnd;
      });
      
      // Count unique item_ids to avoid double-counting collaborative completions
      // For dynamic checklists, only count items scheduled for today
      const todayItemIds = checklist.template_type === 'dynamic'
        ? new Set(checklistItems.filter(item => item.days_of_week && item.days_of_week.includes(currentDay)).map(item => item.id))
        : null;
      
      const uniqueItemIds = new Set();
      responses.forEach((response: any) => {
        if (response.item_id) {
          // For dynamic checklists, only count if it's a today item
          if (todayItemIds === null || todayItemIds.has(response.item_id)) {
            uniqueItemIds.add(response.item_id);
          }
        }
      });
      
      dataMap[checklist.id] = {
        expected: itemCount,
        completed: uniqueItemIds.size
      };
    }
    setCompletionData(dataMap);
  };
  const getCompletionData = (checklistId: string) => {
    return completionData[checklistId] || {
      expected: 0,
      completed: 0
    };
  };


  // Quick tasks content - mounted at the top of the dashboard with scrollable area
  const quickTasksContent = (
    <div className="flex flex-col gap-2 w-full">
      {/* Unread Announcements - High priority */}
      <UnreadAnnouncementsAlert />
      
      {/* Pending Read & Sign Documents */}
      <PendingDocumentsCard />

      {/* Hiring Documents - Secure Document Requests */}
      <I9UploadCard />
      
      {/* OPUS Background Sync — keeps session warm + Theo's brain fresh */}
      <OpusBackgroundSync />

      {/* Assigned Temporary Tasks + Event Daily Tasks — cash handling inserted between events & tasks */}
      <AssignedTemporaryTasks
        compact 
        includeEventTasks 
        afterEventsContent={
          <>
            <CashHandlingTasks locationHours={locationSettings} timezone={timezone} />
            <DailySpotCheckTask locationHours={locationSettings} timezone={timezone} />
          </>
        }
      />
      

      {/* Data Stream Status — super admin only */}
      <DataStreamTask />

      {/* Catering Orders (Today + Tomorrow) */}
      <CateringOrdersAlert />
    </div>
  );

  // Checklists grid content - passed to WidgetsSection for unified drag & drop
  // Count remaining (incomplete) checklists
  const remainingCount = checklists.filter(cl => {
    const { expected, completed } = getCompletionData(cl.id);
    return expected === 0 || completed < expected;
  }).length;

  const checklistsGridContent = (
    <Card className="border-0 overflow-hidden p-0">
      {/* Unified header */}
      <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-tight">Checklists</h3>
        <span className="text-xs text-muted-foreground">
          {remainingCount === 0 ? 'All done ✓' : `${remainingCount} of ${checklists.length} remaining`}
        </span>
      </div>
      {/* Checklist rows */}
      <div className="divide-y divide-border/30">
        {(() => {
          // Compute current time in location timezone ONCE for all rows
          const now = new Date();
          const timeParts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            hourCycle: 'h23',
          }).formatToParts(now);
          const nowH = Number(timeParts.find(p => p.type === 'hour')?.value ?? '0');
          const nowM = Number(timeParts.find(p => p.type === 'minute')?.value ?? '0');
          const nowS = Number(timeParts.find(p => p.type === 'second')?.value ?? '0');
          const nowMinutes = nowH * 60 + nowM;
          const nowSeconds = nowH * 3600 + nowM * 60 + nowS;

          const formatLockTime = (time: string) => {
            const [hours, minutes] = time.split(':').map(Number);
            const period = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
          };

          return checklists.map(checklist => {
          const { expected, completed } = getCompletionData(checklist.id);
          const completionRate = expected > 0 ? Math.min(100, Math.round(completed / expected * 100)) : 0;
          const isComplete = completionRate === 100;

          const isOverdue = !isComplete && !!checklist.due_by_time && (() => {
            const [dueH, dueM] = checklist.due_by_time!.split(':').map(Number);
            return nowMinutes > dueH * 60 + dueM;
          })();

          const isLocked = !!checklist.lock_until_time && (() => {
            const [lH, lM, lS] = checklist.lock_until_time!.split(':').map(Number);
            return nowSeconds < lH * 3600 + lM * 60 + (lS || 0);
          })();
        
          return (
            <ChecklistCard
              key={checklist.id}
              checklistId={checklist.id}
              title={checklist.title}
              completed={completed}
              expected={expected}
              isOverdue={isOverdue}
              isLocked={isLocked}
              lockUntilTime={isLocked && checklist.lock_until_time ? formatLockTime(checklist.lock_until_time) : undefined}
              variant="row"
            />
          );
        });
        })()}
      </div>
    </Card>
  );

  // Catering dialogs rendered separately in the main return below
  const cateringDialogs = (
    <>
      {/* Catering Order Details Dialog */}
      <Dialog open={!!selectedCateringOrder} onOpenChange={() => setSelectedCateringOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChefHat className="h-5 w-5 text-orange-500" />
              Catering Order
            </DialogTitle>
          </DialogHeader>
          {selectedCateringOrder && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Customer</span>
                  <span className="font-medium">{selectedCateringOrder.customer_name}</span>
                </div>
                {selectedCateringOrder.order_number && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Order #</span>
                    <span>{selectedCateringOrder.order_number}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Pickup</span>
                  <span className="text-orange-500 font-medium">
                    Today at {formatCateringTime(selectedCateringOrder.pickup_time)}
                  </span>
                </div>
                {selectedCateringOrder.headcount && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Headcount</span>
                    <span>{selectedCateringOrder.headcount}</span>
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">Items</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {selectedCateringOrder.items.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm">
                      <span className="font-medium min-w-[24px]">{item.quantity}x</span>
                      <div>
                        <span>{item.item}</span>
                        {item.notes && (
                          <p className="text-xs text-muted-foreground">{item.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedCateringOrder.notes && (
                <div className="border-t pt-4">
                  <h4 className="font-medium mb-1">Notes</h4>
                  <p className="text-sm text-muted-foreground">{selectedCateringOrder.notes}</p>
                </div>
              )}

              {selectedCateringOrder.source_url && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setPdfPreviewUrl(selectedCateringOrder.source_url)}
                >
                  View Original
                </Button>
              )}

              {selectedCateringOrder.status === "completed" ? (
                <div className="w-full py-3 px-4 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center justify-center gap-2">
                  <Check className="h-5 w-5 text-green-500" />
                  <span className="text-green-600 font-medium">Order Completed</span>
                </div>
              ) : canCompleteCatering && (
                <Button
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                  size="lg"
                  onClick={() => handleCompleteCateringOrder(selectedCateringOrder)}
                >
                  <Check className="h-5 w-5 mr-2" />
                  Mark Completed
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PDF Preview Dialog */}
      <Dialog open={!!pdfPreviewUrl} onOpenChange={(open) => !open && setPdfPreviewUrl(null)}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle>Original Order</DialogTitle>
          </DialogHeader>
          <div className="flex-1 px-4 pb-4 min-h-0">
            {pdfPreviewUrl && (
              <iframe
                src={pdfPreviewUrl}
                className="w-full h-full rounded-md border bg-white"
                title="PDF Preview"
              />
            )}
          </div>
          {pdfPreviewUrl && (
            <div className="p-4 pt-0 flex justify-center">
              <Button asChild size="lg">
                <a
                  href={pdfPreviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open PDF in New Tab
                </a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );

  // Render WidgetsSection if:
  // 1. QuBeyond integration is active AND user can see sales, OR
  // 2. User wants to use personal metrics (always available)
  // For now, always show WidgetsSection since personal metrics are available to all
  const showWidgets = isSectionVisible('data-cubes') && (canSeeSales || !hasQuBeyondIntegration);
  
  const dashboardContent = showWidgets ? (
    <WidgetsSection 
      salesData={combinedSalesData} 
      isLoadingSales={isLoadingSales} 
      hasQuBeyondIntegration={hasQuBeyondIntegration} 
      showAddDialog={showAddCubeDialog} 
      onAddDialogChange={setShowAddCubeDialog} 
      locationSettings={locationSettings} 
      isReorderMode={false}
      checklistsContent={checklistsGridContent}
      onSalesDataChange={(data) => {
        setSalesOverviewData(data);
        setIsLoadingSales(false);
      }}
      roleCubes={roleCubes}
      useRoleCubes={shouldUseRoleCubes}
      sectionOrder={dashboardSectionOrder}
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
        <div className="space-y-2.5">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold">Dash</h1>
              </div>
              <div className="flex gap-2 items-center">
                {/* Hide edit button for role-based cube users (cubes locked by Org Admin) */}
                {!shouldUseRoleCubes && (
                  <Button onClick={() => setShowEditDashboard(true)} variant="ghost" size="icon" className="h-10 w-10" title="Edit Dashboard">
                    <Settings2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Edit Dashboard Dialog */}
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

          {checklistsLoading ? (
            <div className="space-y-3 animate-fade-in">
              {/* Match actual layout: vertical task cards + checklist card */}
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-[200px] rounded-xl" />
            </div>
          ) : checklists.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <ClipboardCheck className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No checklists yet</h3>
                <p className="text-muted-foreground mb-4">Go to Tasks to create your first checklist</p>
                <Button onClick={() => navigate('/tasks')}>Go to Tasks</Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {quickTasksContent}
              {dashboardContent}
            </>
          )}
        </div>
        
        {/* Welcome animation overlay */}
        {showWelcomeAnimation && (
          <CrowSplashAnimation onComplete={() => setShowWelcomeAnimation(false)} />
        )}
        {cateringDialogs}
      </PullToRefresh>
    </Layout>;
}