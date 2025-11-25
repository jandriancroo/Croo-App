import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ClipboardList, Calendar, Plus, TrendingUp, CheckCircle2, Edit, DollarSign, Clock, Settings } from 'lucide-react';
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

interface Checklist {
  id: string;
  title: string;
  description: string | null;
  frequency: string;
  created_at: string;
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
  hourly: Array<{ hour: string; sales: number }>;
  daily: number;
  weekly: number;
};

const DEFAULT_SECTION_ORDER = [
  'alerts',
  'stats-overview',
  'sales-overview',
  'completion-overview',
  'checklists-grid',
];

const STORAGE_KEY = 'dashboard-section-order';

export default function Dashboard() {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [stats, setStats] = useState<Record<string, ChecklistStats>>({});
  const [loading, setLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_SECTION_ORDER;
  });
  const navigate = useNavigate();
  const { isAdmin } = useUserRole();

  const { data: salesData, refetch: refetchSales } = useQuery({
    queryKey: ["qubeyond-sales"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", {
        body: { period: "today" },
      });

      if (error) {
        console.error("Error fetching sales data:", error);
        return null;
      }

      return data as SalesData;
    },
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const currentDay = new Date().getDay();
      
      // Fetch all active checklists
      const { data: checklistsData, error: checklistsError } = await supabase
        .from('checklists')
        .select(`
          *,
          checklist_items(id, days_of_week)
        `)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (checklistsError) throw checklistsError;
      
      // Filter checklists - exclude dynamic templates with no items for today
      const filteredChecklists = (checklistsData || []).filter(checklist => {
        if (checklist.template_type === 'dynamic') {
          const todayItems = checklist.checklist_items?.filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          );
          return todayItems && todayItems.length > 0;
        }
        return true;
      });
      
      setChecklists(filteredChecklists);

      // Fetch submissions for stats
      const { data: submissions, error: submissionsError } = await supabase
        .from('checklist_submissions')
        .select('checklist_id, submitted_at');

      if (submissionsError) throw submissionsError;

      // Calculate stats
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const statsMap: Record<string, ChecklistStats> = {};
      
      checklistsData?.forEach((checklist) => {
        const checklistSubmissions = submissions?.filter(
          (sub) => sub.checklist_id === checklist.id
        ) || [];

        const submissionsToday = checklistSubmissions.filter(
          (sub) => new Date(sub.submitted_at) >= startOfToday
        ).length;

        const submissionsThisWeek = checklistSubmissions.filter(
          (sub) => new Date(sub.submitted_at) >= oneWeekAgo
        ).length;

        const submissionsThisMonth = checklistSubmissions.filter(
          (sub) => new Date(sub.submitted_at) >= oneMonthAgo
        ).length;

        const sortedSubmissions = checklistSubmissions.sort(
          (a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
        );

        statsMap[checklist.id] = {
          checklist_id: checklist.id,
          total_submissions: checklistSubmissions.length,
          last_submission: sortedSubmissions[0]?.submitted_at || null,
          submissions_this_week: submissionsThisWeek,
          submissions_this_month: submissionsThisMonth,
          submissions_today: submissionsToday,
        };
      });

      setStats(statsMap);
    } catch (error: any) {
      toast.error('Failed to load checklists');
    } finally {
      setLoading(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSectionOrder((items) => {
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

  const getCompletionData = (checklist: Checklist, stats: ChecklistStats | undefined) => {
    switch (checklist.frequency) {
      case 'daily':
        return {
          expected: 1,
          completed: stats?.submissions_today || 0,
          period: 'today',
        };
      case 'weekly':
        return {
          expected: 1,
          completed: stats?.submissions_this_week || 0,
          period: 'this week',
        };
      case 'monthly':
        return {
          expected: 1,
          completed: stats?.submissions_this_month || 0,
          period: 'this month',
        };
      default:
        return {
          expected: 1,
          completed: stats?.submissions_today || 0,
          period: 'today',
        };
    }
  };

  const COLORS = {
    completed: 'hsl(var(--primary))',
    remaining: 'hsl(var(--muted))',
  };

  const getTotalStats = () => {
    const totalSubmissions = Object.values(stats).reduce(
      (sum, stat) => sum + stat.total_submissions,
      0
    );
    const submissionsThisWeek = Object.values(stats).reduce(
      (sum, stat) => sum + stat.submissions_this_week,
      0
    );
    const activeChecklists = checklists.length;

    return { totalSubmissions, submissionsThisWeek, activeChecklists };
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const totalStats = getTotalStats();

  // Define all dashboard sections as components
  const sections = {
    'alerts': (
      <div className="space-y-6">
        <ChecklistCompletionAlerts />
        <LogBookAlerts />
        <CertificationAlerts />
      </div>
    ),
    'stats-overview': (
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Checklists</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.activeChecklists}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">This Week</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.submissionsThisWeek}</div>
            <p className="text-xs text-muted-foreground">submissions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Completions</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStats.totalSubmissions}</div>
            <p className="text-xs text-muted-foreground">all time</p>
          </CardContent>
        </Card>
      </div>
    ),
    'sales-overview': (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">Sales Overview</h3>
          <Button onClick={() => refetchSales()} size="sm" variant="outline">
            Refresh
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Today's Sales</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {salesData ? formatCurrency(salesData.daily) : "--"}
              </div>
              <p className="text-xs text-muted-foreground">Current day total</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Weekly Sales</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {salesData ? formatCurrency(salesData.weekly) : "--"}
              </div>
              <p className="text-xs text-muted-foreground">This week's total</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Average per Hour</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {salesData
                  ? formatCurrency(
                      salesData.hourly.reduce((sum, h) => sum + h.sales, 0) /
                        salesData.hourly.length
                    )
                  : "--"}
              </div>
              <p className="text-xs text-muted-foreground">Based on today</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Hourly Sales Breakdown</CardTitle>
            <CardDescription>Sales performance by hour</CardDescription>
          </CardHeader>
          <CardContent>
            {salesData?.hourly ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={salesData.hourly}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="hour" 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--foreground))' }}
                  />
                  <YAxis 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--foreground))' }}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip
                    formatter={(value) => formatCurrency(value as number)}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                    }}
                  />
                  <Bar 
                    dataKey="sales" 
                    fill="hsl(var(--primary))" 
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No sales data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    ),
    'completion-overview': (
      <Card>
        <CardHeader>
          <CardTitle>Completion Overview</CardTitle>
          <CardDescription>Current period completion status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {checklists.map((checklist) => {
              const checklistStats = stats[checklist.id];
              const { expected, completed, period } = getCompletionData(checklist, checklistStats);
              const remaining = Math.max(0, expected - completed);
              const completionRate = expected > 0 ? Math.min(100, Math.round((completed / expected) * 100)) : 0;

              const chartData = [
                { name: 'Completed', value: Math.min(completed, expected) },
                { name: 'Remaining', value: remaining },
              ];

              return (
                <div key={checklist.id} className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        <Cell fill={COLORS.completed} />
                        <Cell fill={COLORS.remaining} />
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '0.5rem',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="text-center mt-2">
                    <h4 className="font-semibold text-sm truncate max-w-[200px]">
                      {checklist.title}
                    </h4>
                    <p className="text-2xl font-bold text-primary mt-1">
                      {completionRate}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {completed} of {expected} {period}
                    </p>
                    <Badge variant="secondary" className="mt-1 text-xs capitalize">
                      {checklist.frequency}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    ),
    'checklists-grid': (
      <div>
        <h3 className="text-xl font-semibold mb-4">Your Checklists</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {checklists.map((checklist) => {
            const checklistStats = stats[checklist.id];
            return (
              <Card 
                key={checklist.id} 
                className="hover:shadow-lg transition-shadow" 
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <ClipboardList className="h-8 w-8 text-primary" />
                    <Badge className={getFrequencyColor(checklist.frequency)}>
                      {checklist.frequency}
                    </Badge>
                  </div>
                  <CardTitle className="mt-4">{checklist.title}</CardTitle>
                  {checklist.description && (
                    <CardDescription>{checklist.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total completions:</span>
                    <span className="font-semibold">{checklistStats?.total_submissions || 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">This week:</span>
                    <span className="font-semibold">{checklistStats?.submissions_this_week || 0}</span>
                  </div>
                  {checklistStats?.last_submission && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                      <Calendar className="h-3 w-3" />
                      <span>
                        Last: {new Date(checklistStats.last_submission).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  <Button 
                    className="w-full mt-4" 
                    onClick={() => navigate(`/complete/${checklist.id}`)}
                  >
                    Complete Checklist
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    ),
  };

  return (
    <Layout>
      <div className={`space-y-6 ${isEditMode ? 'pl-12' : ''}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold">Dashboard</h2>
            <p className="text-muted-foreground">Manage your line check checklists</p>
          </div>
          <div className="flex gap-2 items-center">
            <LocationSelector />
            {isEditMode && (
              <Button onClick={resetLayout} variant="outline" size="sm">
                Reset Layout
              </Button>
            )}
            <Button
              onClick={toggleEditMode}
              variant={isEditMode ? 'default' : 'outline'}
              size="icon"
              title={isEditMode ? "Save Layout" : "Edit Layout"}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground">Loading checklists...</div>
        ) : checklists.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No checklists yet</h3>
              <p className="text-muted-foreground mb-4">Go to Tasks to create your first checklist</p>
              <Button onClick={() => navigate('/tasks')}>Go to Tasks</Button>
            </CardContent>
          </Card>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
              {sectionOrder.map((sectionId) => (
                <DashboardSection
                  key={sectionId}
                  id={sectionId}
                  isEditMode={isEditMode}
                >
                  {sections[sectionId as keyof typeof sections]}
                </DashboardSection>
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </Layout>
  );
}
