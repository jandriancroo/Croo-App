import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Clock, FileCheck, Plus, Pencil, MoreVertical, Trash2, EyeOff, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TemplateTypeDialog } from "@/components/TemplateTypeDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { format, addDays, subDays } from "date-fns";

export default function Tasks() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const queryClient = useQueryClient();
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [historyDate, setHistoryDate] = useState(new Date());

  const handleDeactivate = async (checklistId: string) => {
    const { error } = await supabase
      .from('checklists')
      .update({ is_active: false })
      .eq('id', checklistId);

    if (error) {
      toast.error("Failed to deactivate checklist");
      return;
    }

    toast.success("Checklist deactivated");
    queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
  };

  const handleDelete = async (checklistId: string) => {
    const { error } = await supabase
      .from('checklists')
      .delete()
      .eq('id', checklistId);

    if (error) {
      toast.error("Failed to delete checklist");
      return;
    }

    toast.success("Checklist deleted");
    queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
  };

  // Fetch checklists for user's role
  const { data: checklists = [], isLoading: checklistsLoading } = useQuery({
    queryKey: ['user-checklists', user?.id, isAdmin],
    queryFn: async () => {
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user!.id);

      const userRole = userRoles?.[0]?.role;

      const { data, error } = await supabase
        .from('checklists')
        .select(`
          *,
          checklist_role_tags(role),
          checklist_items(id, days_of_week)
        `)
        .eq('is_active', true)
        .order('due_by_time', { ascending: true, nullsFirst: false });

      if (error) throw error;

      // Filter checklists based on role tags and current day
      const currentDay = new Date().getDay();
      return data.filter(checklist => {
        const roleTags = checklist.checklist_role_tags;
        const roleMatch = roleTags.length === 0 || roleTags.some((tag: any) => tag.role === userRole);
        
        if (!roleMatch) return false;
        
        // For dynamic checklists
        if (checklist.template_type === 'dynamic') {
          // Admins always see dynamic checklists (for editing)
          if (isAdmin) return true;
          
          // Non-admins only see if there are items for today
          const todayItems = checklist.checklist_items?.filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          );
          return todayItems && todayItems.length > 0;
        }
        
        return true;
      });
    },
    enabled: !!user,
  });

  // Fetch submission stats
  const { data: submissionStats, isLoading: statsLoading } = useQuery({
    queryKey: ['submission-stats', user?.id],
    queryFn: async () => {
      const today = new Date();
      const thisWeekStart = new Date(today);
      thisWeekStart.setDate(today.getDate() - today.getDay());
      
      const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      const [todayResult, weekResult, monthResult] = await Promise.all([
        supabase
          .from('checklist_submissions')
          .select('id', { count: 'exact' })
          .eq('submitted_by', user!.id)
          .gte('submitted_at', today.toISOString().split('T')[0]),
        supabase
          .from('checklist_submissions')
          .select('id', { count: 'exact' })
          .eq('submitted_by', user!.id)
          .gte('submitted_at', thisWeekStart.toISOString()),
        supabase
          .from('checklist_submissions')
          .select('id', { count: 'exact' })
          .eq('submitted_by', user!.id)
          .gte('submitted_at', thisMonthStart.toISOString()),
      ]);

      return {
        today: todayResult.count || 0,
        thisWeek: weekResult.count || 0,
        thisMonth: monthResult.count || 0,
      };
    },
    enabled: !!user,
  });

  // Fetch completion history for selected date
  const { data: historyStats } = useQuery({
    queryKey: ['completion-history', format(historyDate, 'yyyy-MM-dd'), user?.id],
    queryFn: async () => {
      const dateStr = format(historyDate, 'yyyy-MM-dd');
      const currentDay = historyDate.getDay();

      // Get all checklists
      const { data: checklistsData } = await supabase
        .from('checklists')
        .select(`
          id,
          title,
          template_type,
          checklist_items(id, days_of_week)
        `)
        .eq('is_active', true);

      if (!checklistsData) return [];

      // For each checklist, check completion status for the history date
      const results = await Promise.all(
        checklistsData.map(async (checklist) => {
          // For dynamic checklists, count only items for that day
          let itemCount = checklist.checklist_items?.length || 0;
          if (checklist.template_type === 'dynamic') {
            itemCount = checklist.checklist_items?.filter((item: any) => 
              item.days_of_week && item.days_of_week.includes(currentDay)
            ).length || 0;
          }

          if (itemCount === 0) return null;

          // Check if completed on this date
          const { data: submissions } = await supabase
            .from('checklist_submissions')
            .select('id')
            .eq('checklist_id', checklist.id)
            .eq('submitted_by', user!.id)
            .gte('submitted_at', dateStr)
            .lt('submitted_at', format(addDays(historyDate, 1), 'yyyy-MM-dd'));

          return {
            id: checklist.id,
            title: checklist.title,
            completed: (submissions?.length || 0) > 0,
            itemCount,
          };
        })
      );

      return results.filter(r => r !== null);
    },
    enabled: !!user,
  });

  const currentDay = new Date().getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  if (checklistsLoading || statsLoading) {
    return (
      <Layout>
        <div className="container max-w-6xl mx-auto p-6">
          <div className="text-center py-8">Loading...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container max-w-6xl mx-auto p-6 space-y-6">
        <Tabs defaultValue="active" className="w-full">
          <div className="flex justify-between items-start sm:items-center flex-col sm:flex-row gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-4">Tasks</h1>
              <TabsList>
                <TabsTrigger value="active">Active Tasks</TabsTrigger>
                <TabsTrigger value="history">Completion History</TabsTrigger>
              </TabsList>
            </div>
            {isAdmin && (
              <Button onClick={() => setShowTemplateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Checklist
              </Button>
            )}
          </div>

          <TabsContent value="active" className="space-y-6">
            {/* Completion Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Today</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                    <div className="text-2xl font-bold">{submissionStats?.today || 0}</div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Completed today</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">This Week</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Clock className="h-8 w-8 text-blue-500" />
                    <div className="text-2xl font-bold">{submissionStats?.thisWeek || 0}</div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Completed this week</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">This Month</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <FileCheck className="h-8 w-8 text-purple-500" />
                    <div className="text-2xl font-bold">{submissionStats?.thisMonth || 0}</div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Completed this month</p>
                </CardContent>
              </Card>
            </div>

            {/* Available Checklists */}
            <Card>
              <CardHeader>
                <CardTitle>Available Checklists</CardTitle>
                <CardDescription>Select a checklist to complete</CardDescription>
              </CardHeader>
              <CardContent>
                {checklists.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No checklists available for today</p>
                ) : (
                  <div className="space-y-2">
                    {checklists.map((checklist: any) => {
                      const isDynamic = checklist.template_type === 'dynamic';
                      return (
                        <div key={checklist.id} className="flex gap-2">
                          <Button
                            variant="outline"
                            className="flex-1 justify-start"
                            onClick={() => navigate(`/complete-checklist/${checklist.id}`)}
                          >
                            <FileCheck className="h-4 w-4 mr-2" />
                            <div className="flex-1 text-left">
                              <div className="font-medium">
                                {checklist.title}
                                {isDynamic && (
                                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    ({dayNames[currentDay]})
                                  </span>
                                )}
                              </div>
                              {checklist.description && (
                                <div className="text-xs text-muted-foreground">{checklist.description}</div>
                              )}
                            </div>
                          </Button>
                          {isAdmin && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  if (isDynamic) {
                                    navigate(`/dynamic-checklist/${checklist.id}`);
                                  } else {
                                    navigate(`/edit-checklist/${checklist.id}`);
                                  }
                                }}
                                title="Edit checklist"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleDeactivate(checklist.id)}>
                                    <EyeOff className="h-4 w-4 mr-2" />
                                    Make Inactive
                                  </DropdownMenuItem>
                                  <DropdownMenuItem 
                                    onClick={() => handleDelete(checklist.id)}
                                    className="text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryDate(subDays(historyDate, 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <CardTitle className="text-center">
                    {format(historyDate, 'EEEE, MMMM d, yyyy')}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryDate(addDays(historyDate, 1))}
                    disabled={format(historyDate, 'yyyy-MM-dd') >= format(new Date(), 'yyyy-MM-dd')}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {historyStats && historyStats.length > 0 ? (
                  <div className="space-y-2">
                    {historyStats.map((stat: any) => (
                      <div
                        key={stat.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                      >
                        <span className="font-medium">{stat.title}</span>
                        <div className="flex items-center gap-2">
                          {stat.completed ? (
                            <>
                              <CheckCircle2 className="h-5 w-5 text-green-600" />
                              <span className="text-sm text-green-600 font-medium">Completed</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-5 w-5 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">Not Completed</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      No checklists available for this date.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      <TemplateTypeDialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog} />
    </Layout>
  );
}