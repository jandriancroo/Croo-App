import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ClipboardList, Calendar, Plus, TrendingUp, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';

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
}

export default function Dashboard() {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [stats, setStats] = useState<Record<string, ChecklistStats>>({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch checklists
      const { data: checklistsData, error: checklistsError } = await supabase
        .from('checklists')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (checklistsError) throw checklistsError;
      setChecklists(checklistsData || []);

      // Fetch submissions for stats
      const { data: submissions, error: submissionsError } = await supabase
        .from('checklist_submissions')
        .select('checklist_id, submitted_at');

      if (submissionsError) throw submissionsError;

      // Calculate stats
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const statsMap: Record<string, ChecklistStats> = {};
      
      checklistsData?.forEach((checklist) => {
        const checklistSubmissions = submissions?.filter(
          (sub) => sub.checklist_id === checklist.id
        ) || [];

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
        };
      });

      setStats(statsMap);
    } catch (error: any) {
      toast.error('Failed to load checklists');
    } finally {
      setLoading(false);
    }
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

  const getChartData = () => {
    return checklists.map((checklist) => ({
      name: checklist.title.length > 20 
        ? checklist.title.substring(0, 20) + '...' 
        : checklist.title,
      'This Week': stats[checklist.id]?.submissions_this_week || 0,
      'This Month': stats[checklist.id]?.submissions_this_month || 0,
      'Total': stats[checklist.id]?.total_submissions || 0,
    }));
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

  const totalStats = getTotalStats();

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold">Dashboard</h2>
            <p className="text-muted-foreground">Manage your line check checklists</p>
          </div>
          <Button onClick={() => navigate('/create')} className="gap-2">
            <Plus className="h-4 w-4" />
            New Checklist
          </Button>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground">Loading checklists...</div>
        ) : checklists.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No checklists yet</h3>
              <p className="text-muted-foreground mb-4">Create your first checklist to get started</p>
              <Button onClick={() => navigate('/create')}>Create Checklist</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Stats Overview */}
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

            {/* Completion Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Completion Overview</CardTitle>
                <CardDescription>Submissions per checklist</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={getChartData()}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="name" 
                      className="text-xs"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis className="text-xs" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '0.5rem'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="This Week" fill="hsl(var(--accent))" />
                    <Bar dataKey="This Month" fill="hsl(var(--primary))" />
                    <Bar dataKey="Total" fill="hsl(var(--secondary))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Checklists Grid */}
            <div>
              <h3 className="text-xl font-semibold mb-4">Your Checklists</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {checklists.map((checklist) => {
                  const checklistStats = stats[checklist.id];
                  return (
                    <Card 
                      key={checklist.id} 
                      className="hover:shadow-lg transition-shadow cursor-pointer" 
                      onClick={() => navigate(`/complete/${checklist.id}`)}
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
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
