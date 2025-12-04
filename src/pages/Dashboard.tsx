import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClipboardCheck, Calendar, Plus, TrendingUp, Edit, DollarSign, Clock, ArrowUpDown, Banknote, Sparkles, Check } from 'lucide-react';
import { toast } from 'sonner';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useUserRole } from '@/hooks/useUserRole';
import { useQuery } from '@tanstack/react-query';
import { LogBookAlerts } from '@/components/dashboard/LogBookAlerts';
import { CertificationAlerts } from '@/components/dashboard/CertificationAlerts';
import { ChecklistCompletionAlerts } from '@/components/dashboard/ChecklistCompletionAlerts';
import { LocationSelector } from '@/components/LocationSelector';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DashboardSection } from '@/components/dashboard/DashboardSection';
import { format, addDays } from 'date-fns';
import { useLocation } from '@/hooks/useLocation';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatTime12Hour } from '@/lib/utils';
import { useCrooCashAnimation } from '@/contexts/CrooCashAnimationContext';
interface Checklist {
  id: string;
  title: string;
  description: string | null;
  frequency: string;
  created_at: string;
  template_type: string | null;
}
interface ChecklistStats {
  checklist_id: string;
  total_submissions: number;
  last_submission: string | null;
  submissions_this_week: number;
  submissions_this_month: number;
  submissions_today: number;
}
type SalesData = {
  hourly: Array<{
    hour: string;
    sales: number;
  }>;
  daily: number;
  weekly: number;
};
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
    isAdmin
  } = useUserRole();
  const { currentLocation } = useLocation();
  const { animationAmount } = useCrooCashAnimation();
  const isMobile = useIsMobile();
  
  // Fetch location settings for business hours
  const { data: locationSettings } = useQuery({
    queryKey: ["location-settings", currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return null;
      const { data, error } = await supabase
        .from('location_settings')
        .select('hours_open, hours_close')
        .eq('location_id', currentLocation.id)
        .maybeSingle();
      if (error) {
        console.error("Error fetching location settings:", error);
        return null;
      }
      return data;
    },
    enabled: !!currentLocation,
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  // Generate simulated sales data for 30 days
  const generateSimulatedSalesData = () => {
    const today = new Date();
    const dailyData = [];
    
    // Generate 30 days of data
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayOfWeek = date.getDay();
      
      // Weekend sales are typically higher
      const baseAmount = dayOfWeek === 5 || dayOfWeek === 6 ? 2500 : 1800;
      const variance = Math.random() * 600 - 300; // ±300 variance
      
      dailyData.push({
        date: format(date, 'MMM d'),
        fullDate: date,
        sales: Math.max(1000, baseAmount + variance)
      });
    }
    
    return dailyData;
  };

  // Aggregate daily data into weekly buckets for mobile view
  const aggregateIntoWeeks = (dailyData: Array<{ date: string; fullDate: Date; sales: number }>) => {
    const weeks: Array<{ week: string; sales: number }> = [];
    let currentWeek: { week: string; sales: number } | null = null;
    let weekStart: Date | null = null;
    
    dailyData.forEach((day, index) => {
      const dayOfWeek = day.fullDate.getDay();
      
      // Start a new week on Sunday (0) or if it's the first day
      if (dayOfWeek === 0 || index === 0) {
        if (currentWeek) {
          weeks.push(currentWeek);
        }
        weekStart = day.fullDate;
        currentWeek = {
          week: `Wk ${weeks.length + 1}`,
          sales: day.sales
        };
      } else if (currentWeek) {
        currentWeek.sales += day.sales;
      }
    });
    
    // Push the last week
    if (currentWeek) {
      weeks.push(currentWeek);
    }
    
    return weeks;
  };

  const simulatedMonthlyData = generateSimulatedSalesData();
  const weeklyAggregatedData = aggregateIntoWeeks(simulatedMonthlyData);
  
  const {
    data: rawSalesData,
    refetch: refetchSales
  } = useQuery({
    queryKey: ["qubeyond-sales"],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.functions.invoke("fetch-qubeyond-sales", {
        body: {
          period: "today"
        }
      });
      if (error) {
        console.error("Error fetching sales data:", error);
        return null;
      }
      return data as SalesData;
    }
  });

  // Filter and fill sales data based on business hours
  const salesData = rawSalesData && locationSettings?.hours_open && locationSettings?.hours_close
    ? (() => {
        const openHour = parseInt(locationSettings.hours_open.split(':')[0]);
        const closeHour = parseInt(locationSettings.hours_close.split(':')[0]);
        
        // Create a complete array of business hours with data or zeros
        const completeHourly = [];
        for (let hour = openHour; hour < closeHour; hour++) {
          const hourStr24 = `${hour.toString().padStart(2, '0')}:00`;
          const existingData = rawSalesData.hourly.find(item => {
            const itemHour = parseInt(item.hour.split(':')[0]);
            return itemHour === hour;
          });
          
          completeHourly.push({
            hour: formatTime12Hour(hourStr24),
            sales: existingData?.sales || 0
          });
        }

        const filteredDaily = completeHourly.reduce((sum, h) => sum + h.sales, 0);

        return {
          hourly: completeHourly,
          daily: filteredDaily,
          weekly: rawSalesData.weekly
        };
      })()
    : rawSalesData;
  
  // Calculate weekly data from simulated monthly data (last 7 days)
  const weeklyData = simulatedMonthlyData.slice(-7);
  const weeklyTotal = weeklyData.reduce((sum, day) => sum + day.sales, 0);
  
  // Calculate monthly totals
  const monthlyTotal = simulatedMonthlyData.reduce((sum, day) => sum + day.sales, 0);
  useEffect(() => {
    fetchData();
    fetchCrooCashBalance();
    fetchUserName();
  }, []);

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
    const currentDay = today.getDay();
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

      // Get submissions and count unique completed items for today
      const {
        data: submissions
      } = await supabase.from('checklist_submissions').select(`
          id,
          checklist_responses(id, item_id)
        `)
        .eq('checklist_id', checklist.id)
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
    try {
      const currentDay = new Date().getDay();

      // Fetch all active checklists
      const {
        data: checklistsData,
        error: checklistsError
      } = await supabase.from('checklists').select(`
          *,
          checklist_items(id, days_of_week)
        `).eq('is_active', true).order('display_order', {
        ascending: true
      }).order('created_at', {
        ascending: false
      });
      if (checklistsError) throw checklistsError;

      // Filter checklists - exclude dynamic templates with no items for today
      const filteredChecklists = (checklistsData || []).filter(checklist => {
        if (checklist.template_type === 'dynamic') {
          const todayItems = checklist.checklist_items?.filter((item: any) => item.days_of_week && item.days_of_week.includes(currentDay));
          return todayItems && todayItems.length > 0;
        }
        return true;
      });
      setChecklists(filteredChecklists);

      // Fetch submissions for stats
      const {
        data: submissions,
        error: submissionsError
      } = await supabase.from('checklist_submissions').select('checklist_id, submitted_at');
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
        return 'bg-accent';
      case 'weekly':
        return 'bg-primary';
      case 'monthly':
        return 'bg-secondary';
      default:
        return 'bg-muted';
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
  const sections = {
    'alerts': <div className="space-y-6">
        <ChecklistCompletionAlerts />
        <LogBookAlerts />
        <CertificationAlerts />
      </div>,
    'sales-overview': <Card>
        <CardHeader className="pb-3 md:pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl md:text-2xl">Sales Overview</CardTitle>
            <Button onClick={() => refetchSales()} size="sm" variant="outline">
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Tabs defaultValue="today" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="week">This Week</TabsTrigger>
              <TabsTrigger value="month">This Month</TabsTrigger>
            </TabsList>
            
            <TabsContent value="today" className="space-y-4">
              <div className="grid grid-cols-2 gap-6 mb-4">
                <div className="space-y-1">
                  <p className="text-xs md:text-sm text-muted-foreground">Total Sales</p>
                  <p className="text-lg md:text-2xl font-bold break-words">
                    {salesData ? formatCurrency(salesData.daily) : "--"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs md:text-sm text-muted-foreground">Avg/Hour</p>
                  <p className="text-lg md:text-2xl font-bold break-words">
                    {salesData ? formatCurrency(salesData.hourly.reduce((sum, h) => sum + h.sales, 0) / salesData.hourly.length) : "--"}
                  </p>
                </div>
              </div>
              {salesData?.hourly ? <ResponsiveContainer width="100%" height={200} className="md:h-[280px]">
                  <BarChart data={salesData.hourly}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="hour" className="text-xs" tick={{
                  fill: 'hsl(var(--foreground))'
                }} />
                    <YAxis className="text-xs" tick={{
                  fill: 'hsl(var(--foreground))'
                }} tickFormatter={value => `$${value}`} />
                    <Tooltip formatter={value => formatCurrency(value as number)} contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px'
                }} />
                    <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer> : <div className="h-[200px] md:h-[280px] flex items-center justify-center text-muted-foreground">
                  No sales data available
                </div>}
            </TabsContent>
            
            <TabsContent value="week" className="space-y-4">
              <div className="grid grid-cols-2 gap-6 mb-4">
                <div className="space-y-1">
                  <p className="text-xs md:text-sm text-muted-foreground">Total Sales</p>
                  <p className="text-lg md:text-2xl font-bold break-words">
                    {formatCurrency(weeklyTotal)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs md:text-sm text-muted-foreground">Daily Avg</p>
                  <p className="text-lg md:text-2xl font-bold break-words">
                    {formatCurrency(weeklyTotal / 7)}
                  </p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200} className="md:h-[280px]">
                <BarChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" tick={{
                fill: 'hsl(var(--foreground))'
              }} />
                  <YAxis className="text-xs" tick={{
                fill: 'hsl(var(--foreground))'
              }} tickFormatter={value => `$${value}`} />
                  <Tooltip formatter={value => formatCurrency(value as number)} contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px'
              }} />
                  <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </TabsContent>
            
            <TabsContent value="month" className="space-y-4">
              <div className="grid grid-cols-2 gap-6 mb-4">
                <div className="space-y-1">
                  <p className="text-xs md:text-sm text-muted-foreground">Total Sales</p>
                  <p className="text-lg md:text-2xl font-bold break-words">{formatCurrency(monthlyTotal)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs md:text-sm text-muted-foreground">Daily Avg</p>
                  <p className="text-lg md:text-2xl font-bold break-words">{formatCurrency(monthlyTotal / 30)}</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200} className="md:h-[280px]">
                <BarChart data={isMobile ? weeklyAggregatedData : simulatedMonthlyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey={isMobile ? "week" : "date"} className="text-xs" tick={{
                fill: 'hsl(var(--foreground))'
              }} interval={isMobile ? 0 : 4} />
                  <YAxis className="text-xs" tick={{
                fill: 'hsl(var(--foreground))'
              }} tickFormatter={value => `$${value}`} />
                  <Tooltip formatter={value => formatCurrency(value as number)} contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px'
              }} />
                  <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>,
    'checklists-grid': <div>
        <h3 className="text-xl font-semibold mb-4">Tasks</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {checklists.map(checklist => {
          const {
            expected,
            completed
          } = getCompletionData(checklist.id);
          const completionRate = expected > 0 ? Math.min(100, Math.round(completed / expected * 100)) : 0;
          const isComplete = completionRate === 100;
          return <div key={checklist.id} className="relative">
                <Card className="hover:shadow-lg transition-shadow overflow-hidden">
                <div className={isComplete ? 'blur-[2px]' : ''}>
                  <CardHeader className="py-2 md:py-3">
                    <div className="flex items-start justify-between">
                      <ClipboardCheck className="h-5 w-5 md:h-6 md:w-6 text-primary" />
                      <Badge className={getFrequencyColor(checklist.frequency)}>
                        {checklist.frequency}
                      </Badge>
                    </div>
                    <CardTitle className="mt-1 md:mt-2 text-base md:text-lg">{checklist.title}</CardTitle>
                    {checklist.description && <CardDescription className="text-sm">{checklist.description}</CardDescription>}
                  </CardHeader>
                  <CardContent className="space-y-2 py-2 md:py-3 pb-14">
                    <div className="flex items-center justify-between">
                      <div className="text-base md:text-lg font-semibold text-muted-foreground">
                        {completed} out of {expected}
                      </div>
                      <div className="text-xl md:text-2xl font-bold text-primary">
                        {completionRate}%
                      </div>
                    </div>
                  </CardContent>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-3 pt-0">
                  <Button className="w-full" size="sm" onClick={() => navigate(`/complete/${checklist.id}`)}>
                    {isComplete ? 'Review' : 'Complete Checklist'}
                  </Button>
                </div>
              </Card>
                {isComplete && (
                  <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none" style={{ bottom: '50px' }}>
                    <div 
                      className="flex flex-col items-center justify-center text-green-600 dark:text-green-500"
                      style={{
                        width: '90px',
                        height: '90px',
                        border: '4px solid currentColor',
                        borderRadius: '50%',
                        backgroundColor: 'rgba(255,255,255,0.95)',
                        transform: 'rotate(-8deg)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      }}
                    >
                      <svg className="w-7 h-7 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-[10px] font-bold uppercase tracking-wide">Complete</span>
                    </div>
                  </div>
                )}
              </div>;
        })}
        </div>
      </div>
  };
  return <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Dash</h1>
          <div className="flex gap-2 items-center">
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
            <LocationSelector />
            {isEditMode && <Button onClick={resetLayout} variant="outline" size="icon" className="h-10 w-10">
                <ArrowUpDown className="h-4 w-4" />
              </Button>}
            <Button onClick={toggleEditMode} variant={isEditMode ? 'default' : 'outline'} size="icon" className="h-10 w-10" title={isEditMode ? "Save Layout" : "Edit Layout"}>
              {isEditMode ? <Check className="h-4 w-4" /> : <ArrowUpDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {loading ? <div className="text-center text-muted-foreground">Loading checklists...</div> : checklists.length === 0 ? <Card className="text-center py-12">
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