import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChefHat, ClipboardCheck, Calendar, Plus, Edit, Clock, ArrowUpDown, Banknote, Sparkles, Check, Users } from 'lucide-react';
import { CashHandlingTasks } from '@/components/dashboard/CashHandlingTasks';
import { AssignedTemporaryTasks } from '@/components/dashboard/AssignedTemporaryTasks';
import { EventDailyTasks } from '@/components/dashboard/EventDailyTasks';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { useQuery } from '@tanstack/react-query';
import { LogBookAlerts } from '@/components/dashboard/LogBookAlerts';
import { CertificationAlerts } from '@/components/dashboard/CertificationAlerts';
import { ChecklistCompletionAlerts } from '@/components/dashboard/ChecklistCompletionAlerts';

import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DashboardSection } from '@/components/dashboard/DashboardSection';
import { SalesOverview } from '@/components/dashboard/SalesOverview';
import { format } from 'date-fns';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatTime12Hour } from '@/lib/utils';
import { useCrooCashAnimation } from '@/contexts/CrooCashAnimationContext';
import { FEATURE_FLAGS } from '@/config/featureFlags';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
}
interface ChecklistStats {
  checklist_id: string;
  total_submissions: number;
  last_submission: string | null;
  submissions_this_week: number;
  submissions_this_month: number;
  submissions_today: number;
}
const DEFAULT_SECTION_ORDER = ['alerts', 'checklists-grid', 'sales-overview'];
const STORAGE_KEY = 'dashboard-section-order';
export default function Dashboard() {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [stats, setStats] = useState<Record<string, ChecklistStats>>({});
  const [completionData, setCompletionData] = useState<Record<string, {
    expected: number;
    completed: number;
  }>>({});
  const [loading, setLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [todaysCateringOrders, setTodaysCateringOrders] = useState<CateringOrder[]>([]);
  const [selectedCateringOrder, setSelectedCateringOrder] = useState<CateringOrder | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Filter to only include valid sections
      const validSections = parsed.filter((id: string) => DEFAULT_SECTION_ORDER.includes(id));
      // Add any missing sections
      DEFAULT_SECTION_ORDER.forEach(id => {
        if (!validSections.includes(id)) validSections.push(id);
      });
      return validSections;
    }
    return DEFAULT_SECTION_ORDER;
  });
  const [crooCashBalance, setCrooCashBalance] = useState<number>(0);
  const [userName, setUserName] = useState<string>('');
  const navigate = useNavigate();
  const {
    isAdmin, isManager, isShiftManager, isGeneralManager
  } = useUserRole();
  const canCompleteCatering = isShiftManager || isGeneralManager || isManager || isAdmin;
  const { currentLocation, isChecklistOnlyLocation } = useAppLocation();
  const { getTodayInTimezone } = useLocationTimezone();
  const { animationAmount } = useCrooCashAnimation();
  const isMobile = useIsMobile();
  
  // Fetch location hours for current day of week
  const { data: locationSettings } = useQuery({
    queryKey: ["location-hours-today", currentLocation?.id],
    staleTime: 5 * 60 * 1000, // 5 min cache - show instantly
    queryFn: async () => {
      if (!currentLocation) return null;
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
      
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
    refetchInterval: 15000, // Refresh every 15 seconds
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
  const fetchTodaysCateringOrders = async () => {
    if (!currentLocation?.id) return;
    try {
      // Get today's date in location's timezone
      const today = getTodayInTimezone();
      
      
      const { data, error } = await supabase
        .from("catering_orders")
        .select("*")
        .eq("location_id", currentLocation.id)
        .eq("pickup_date", today)
        .in("status", ["pending", "completed"])
        .order("pickup_time", { ascending: true });

      if (error) throw error;
      setTodaysCateringOrders((data || []).map(order => ({
        ...order,
        items: order.items as unknown as { quantity: number; item: string; notes?: string }[]
      })) as CateringOrder[]);
    } catch (error) {
      console.error("Error fetching today's catering orders:", error);
    }
  };

  const handleCompleteCateringOrder = async (order: CateringOrder) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

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
      fetchTodaysCateringOrders();
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

  useEffect(() => {
    if (currentLocation?.id) {
      fetchData();
      fetchTodaysCateringOrders();
    }
    fetchCrooCashBalance();
    fetchUserName();
  }, [currentLocation?.id]);

  const fetchUserName = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single();

      if (error) throw error;
      const firstName = data?.full_name?.split(' ')[0] || '';
      setUserName(firstName);
    } catch (error) {
      console.error("Error fetching user name:", error);
    }
  };
  
  useEffect(() => {
    if (checklists.length > 0) {
      loadCompletionData();
    }
  }, [checklists]);

  const fetchCrooCashBalance = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("croo_cash_balance")
        .eq("id", user.id)
        .single();

      if (error) throw error;
      setCrooCashBalance(data?.croo_cash_balance || 0);

      // Set up real-time subscription for balance updates
      const channel = supabase
        .channel(`croo-cash-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${user.id}`
          },
          (payload: any) => {
            setCrooCashBalance(payload.new.croo_cash_balance || 0);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } catch (error) {
      console.error("Error fetching Croo Cash balance:", error);
    }
  };
  const loadCompletionData = async () => {
    const today = new Date();
    // Convert JS getDay() (Sun=0..Sat=6) to calendar index (Mon=0..Sun=6)
    const jsDay = today.getDay();
    const currentDay = jsDay === 0 ? 6 : jsDay - 1;
    const startOfToday = new Date(today);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);
    const dataMap: Record<string, {
      expected: number;
      completed: number;
    }> = {};
    for (const checklist of checklists) {
      // Get checklist items
      const {
        data: checklistItems
      } = await supabase.from('checklist_items').select('id, days_of_week').eq('checklist_id', checklist.id);
      let itemCount = checklistItems?.length || 0;
      if (checklist.template_type === 'dynamic' && checklistItems) {
        itemCount = checklistItems.filter(item => item.days_of_week && item.days_of_week.includes(currentDay)).length;
      }

      // Get submissions and count unique completed items for today (location-filtered)
      const {
        data: submissions
      } = await supabase.from('checklist_submissions').select(`
          id,
          checklist_responses(id, item_id)
        `)
        .eq('checklist_id', checklist.id)
        .eq('location_id', currentLocation?.id)
        .gte('submitted_at', startOfToday.toISOString())
        .lte('submitted_at', endOfToday.toISOString());
      
      // Count unique item_ids to avoid double-counting collaborative completions
      const uniqueItemIds = new Set();
      submissions?.forEach((sub: any) => {
        sub.checklist_responses?.forEach((response: any) => {
          if (response.item_id) {
            uniqueItemIds.add(response.item_id);
          }
        });
      });
      const completedCount = uniqueItemIds.size;
      dataMap[checklist.id] = {
        expected: itemCount,
        completed: completedCount
      };
    }
    setCompletionData(dataMap);
  };
  const fetchData = async () => {
    if (!currentLocation?.id) return;
    
    try {
      // Convert JS getDay() (Sun=0..Sat=6) to calendar index (Mon=0..Sun=6)
      const jsDay = new Date().getDay();
      const currentDay = jsDay === 0 ? 6 : jsDay - 1;

      // Fetch all active checklists for this location
      const {
        data: checklistsData,
        error: checklistsError
      } = await supabase.from('checklists').select(`
          *,
          checklist_items(id, days_of_week)
        `)
        .eq('is_active', true)
        .eq('location_id', currentLocation.id)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (checklistsError) throw checklistsError;

      // Filter checklists - exclude dynamic templates with no items for today
      // and monthly checklists that shouldn't be visible yet
      const filteredChecklists = (checklistsData || []).filter(checklist => {
        // Filter dynamic templates by day
        if (checklist.template_type === 'dynamic') {
          const todayItems = checklist.checklist_items?.filter((item: any) => item.days_of_week && item.days_of_week.includes(currentDay));
          return todayItems && todayItems.length > 0;
        }
        
        // Filter monthly checklists by visibility window
        if (checklist.frequency === 'monthly' && checklist.visible_days_before_month_end) {
          const today = new Date();
          const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          const daysUntilMonthEnd = lastDayOfMonth.getDate() - today.getDate();
          // Show if we're within the visibility window (e.g., last 7 days)
          return daysUntilMonthEnd < checklist.visible_days_before_month_end;
        }
        
        return true;
      });
      setChecklists(filteredChecklists);

      // Fetch submissions for stats (location-filtered)
      const {
        data: submissions,
        error: submissionsError
      } = await supabase.from('checklist_submissions')
        .select('checklist_id, submitted_at')
        .eq('location_id', currentLocation.id);
      if (submissionsError) throw submissionsError;

      // Calculate stats
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const statsMap: Record<string, ChecklistStats> = {};
      checklistsData?.forEach(checklist => {
        const checklistSubmissions = submissions?.filter(sub => sub.checklist_id === checklist.id) || [];
        const submissionsToday = checklistSubmissions.filter(sub => new Date(sub.submitted_at) >= startOfToday).length;
        const submissionsThisWeek = checklistSubmissions.filter(sub => new Date(sub.submitted_at) >= oneWeekAgo).length;
        const submissionsThisMonth = checklistSubmissions.filter(sub => new Date(sub.submitted_at) >= oneMonthAgo).length;
        const sortedSubmissions = checklistSubmissions.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
        statsMap[checklist.id] = {
          checklist_id: checklist.id,
          total_submissions: checklistSubmissions.length,
          last_submission: sortedSubmissions[0]?.submitted_at || null,
          submissions_this_week: submissionsThisWeek,
          submissions_this_month: submissionsThisMonth,
          submissions_today: submissionsToday
        };
      });
      setStats(statsMap);
    } catch (error: any) {
      toast.error('Failed to load checklists');
    } finally {
      setLoading(false);
    }
  };
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates
  }));
  const handleDragEnd = (event: DragEndEvent) => {
    const {
      active,
      over
    } = event;
    if (over && active.id !== over.id) {
      setSectionOrder(items => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newOrder));
        return newOrder;
      });
    }
  };
  const toggleEditMode = () => {
    setIsEditMode(!isEditMode);
    if (isEditMode) {
      toast.success('Layout saved');
    }
  };
  const resetLayout = () => {
    setSectionOrder(DEFAULT_SECTION_ORDER);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SECTION_ORDER));
    toast.success('Layout reset to default');
  };
  const getFrequencyColor = (frequency: string) => {
    switch (frequency) {
      case 'daily':
        return 'bg-accent text-accent-foreground';
      case 'weekly':
        return 'bg-primary text-primary-foreground';
      case 'monthly':
        return 'bg-violet-500 text-white';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };
  const getCompletionData = (checklistId: string) => {
    return completionData[checklistId] || {
      expected: 0,
      completed: 0
    };
  };
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  // Define all dashboard sections as components
  // For checklist-only locations, only show checklists-grid
  const checklistOnlySections = {
    'checklists-grid': null // Will be defined below
  };

  const standardSections: Record<string, JSX.Element | null> = {
    // Alerts disabled on dashboard - view them on the Alerts page
    'alerts': null,
    'sales-overview': hasQuBeyondIntegration ? <SalesOverview locationSettings={locationSettings} /> : null,
    'checklists-grid': <div>
        <h3 className="text-xl font-semibold mb-4">Tasks</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Assigned Temporary Tasks */}
          <AssignedTemporaryTasks />
          
          {/* Event Daily Task Cards */}
          {currentLocation?.id && <EventDailyTasks locationId={currentLocation.id} />}
          
          {/* Cash Handling Task Cards */}
          <CashHandlingTasks locationHours={locationSettings} />
          
          {/* Catering Order Cards */}
          {todaysCateringOrders.map(order => {
            const isCompleted = order.status === "completed";
            const ORANGE_COLOR = "#f97316";
            const GREEN_COLOR = "#22c55e";
            const accentColor = isCompleted ? GREEN_COLOR : ORANGE_COLOR;
            
            return (
              <Card 
                key={`catering-${order.id}`}
                className={`overflow-hidden ${isCompleted ? "opacity-75" : ""}`}
                style={{ borderLeft: `4px solid ${accentColor}` }}
              >
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="p-2 rounded-lg"
                      style={{ backgroundColor: `${accentColor}20` }}
                    >
                      {isCompleted ? (
                        <Check className="h-4 w-4" style={{ color: accentColor }} />
                      ) : (
                        <ChefHat className="h-4 w-4" style={{ color: accentColor }} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{order.customer_name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        {formatCateringTime(order.pickup_time)}
                        {order.headcount && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {order.headcount}
                          </span>
                        )}
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                        >
                          {order.items.length} items
                        </span>
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setSelectedCateringOrder(order)}
                  >
                    {isCompleted ? "View" : "View Order"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
          
          {/* Checklist Cards */}
          {checklists.map(checklist => {
          const {
            expected,
            completed
          } = getCompletionData(checklist.id);
          const completionRate = expected > 0 ? Math.min(100, Math.round(completed / expected * 100)) : 0;
          const isComplete = completionRate === 100;
          return <Card key={checklist.id} className="hover:shadow-lg transition-shadow overflow-hidden p-0 flex flex-col">
                  {/* Header Section - Original style */}
                  <CardHeader className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="h-5 w-5 text-primary flex-shrink-0" />
                      <CardTitle className="text-base font-semibold flex-1 truncate">{checklist.title}</CardTitle>
                      <Badge className={`text-xs px-2 py-0.5 flex-shrink-0 ${getFrequencyColor(checklist.frequency)}`}>
                        {checklist.frequency}
                      </Badge>
                    </div>
                  </CardHeader>

                  {/* Middle Section - Stats */}
                  <CardContent className="py-2 px-3 pt-0 flex-1">
                    <div className="flex items-center justify-between">
                      <div className="text-base text-muted-foreground font-medium">
                        {completed}/{expected}
                      </div>
                      {isComplete ? (
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/15">
                          <Check className="h-5 w-5 text-primary" />
                        </div>
                      ) : (
                        <div className="text-lg font-bold text-primary">
                          {completionRate}%
                        </div>
                      )}
                    </div>
                  </CardContent>

                  {/* Bottom Button - Contoured to card shape */}
                  <Button 
                    className="w-full h-10 text-sm rounded-none rounded-b-lg mt-auto"
                    onClick={() => navigate(`/complete/${checklist.id}`)}
                  >
                    {isComplete ? 'Review' : 'Complete'}
                  </Button>
                </Card>;
        })}
        </div>

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
      </div>
  };

  // Use appropriate sections based on location type
  const sections = isChecklistOnlyLocation 
    ? { 
        ...(hasQuBeyondIntegration ? { 'sales-overview': standardSections['sales-overview'] } : {}),
        'checklists-grid': standardSections['checklists-grid'] 
      }
    : standardSections;
  return <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Dash</h1>
          <div className="flex gap-2 items-center">
            {/* Hide Croo Cash for checklist-only locations or when feature is disabled */}
            {FEATURE_FLAGS.CROO_CASH_ENABLED && !isChecklistOnlyLocation && (
              <div className="flex flex-col items-center justify-center px-3 py-1 h-10 rounded-full bg-primary/10 text-primary border border-primary/20 relative">
                {userName && <span className="text-[10px] font-medium leading-none">{userName}</span>}
                <div className="flex items-center gap-1">
                  <Banknote className="h-3 w-3" style={{ transform: 'rotate(90deg) rotate(-10deg)' }} />
                  <span className="text-xs font-bold leading-none">${(crooCashBalance / 100).toFixed(2)}</span>
                </div>
                
                {/* Celebration Animation */}
                {animationAmount !== null && (
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 pointer-events-none animate-bounce z-50">
                    <div className="flex items-center gap-1 text-2xl font-black text-green-500 whitespace-nowrap" style={{
                      textShadow: '0 0 20px rgba(34, 197, 94, 0.8)',
                      fontFamily: 'Comic Sans MS, cursive',
                      animation: 'bounce 0.8s ease-in-out 3, fade-out 0.5s ease-out 2.5s forwards'
                    }}>
                      +${(animationAmount / 100).toFixed(2)}
                      <Sparkles className="h-6 w-6 animate-spin" style={{
                        filter: 'drop-shadow(0 0 10px rgba(34, 197, 94, 0.8))'
                      }} />
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {isEditMode && <Button onClick={resetLayout} variant="outline" size="icon" className="h-10 w-10">
                <ArrowUpDown className="h-4 w-4" />
              </Button>}
            <Button onClick={toggleEditMode} variant={isEditMode ? 'default' : 'outline'} size="icon" className="h-10 w-10" title={isEditMode ? "Save Layout" : "Edit Layout"}>
              {isEditMode ? <Check className="h-4 w-4" /> : <ArrowUpDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {loading ? <PageSkeleton variant="grid" /> : checklists.length === 0 ? <Card className="text-center py-12">
            <CardContent>
              <ClipboardCheck className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No checklists yet</h3>
              <p className="text-muted-foreground mb-4">Go to Tasks to create your first checklist</p>
              <Button onClick={() => navigate('/tasks')}>Go to Tasks</Button>
            </CardContent>
          </Card> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sectionOrder.filter(id => sections[id as keyof typeof sections])} strategy={verticalListSortingStrategy}>
              {sectionOrder
                .filter(sectionId => sections[sectionId as keyof typeof sections])
                .map(sectionId => <DashboardSection key={sectionId} id={sectionId} isEditMode={isEditMode}>
                  {sections[sectionId as keyof typeof sections]}
                </DashboardSection>)}
            </SortableContext>
          </DndContext>}
      </div>
    </Layout>;
}