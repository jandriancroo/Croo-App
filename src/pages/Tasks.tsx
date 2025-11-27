import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Clock, FileCheck, Plus, Pencil, MoreVertical, Trash2, EyeOff, ChevronLeft, ChevronRight, AlertCircle, GripVertical } from "lucide-react";
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
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableChecklistItem } from '@/components/tasks/SortableChecklistItem';

export default function Tasks() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const queryClient = useQueryClient();
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [historyDate, setHistoryDate] = useState(new Date());
  const [isReordering, setIsReordering] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = checklists.findIndex((c: any) => c.id === active.id);
    const newIndex = checklists.findIndex((c: any) => c.id === over.id);
    
    const reorderedChecklists = arrayMove(checklists, oldIndex, newIndex);
    
    // Update display_order for all affected checklists
    const updates = reorderedChecklists.map((checklist: any, index: number) => ({
      id: checklist.id,
      display_order: index,
    }));

    try {
      for (const update of updates) {
        await supabase
          .from('checklists')
          .update({ display_order: update.display_order })
          .eq('id', update.id);
      }
      
      toast.success("Checklist order updated");
      queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
      queryClient.invalidateQueries({ queryKey: ['checklists'] });
    } catch (error) {
      toast.error("Failed to update order");
    }
  };

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
        .order('display_order', { ascending: true });

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
      // Get start and end of day in user's local timezone
      const startOfDay = new Date(historyDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(historyDate);
      endOfDay.setHours(23, 59, 59, 999);
      
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
        .eq('is_active', true)
        .order('display_order', { ascending: true });

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

          // Check submissions and responses on this date (using local timezone)
          const { data: submissions } = await supabase
            .from('checklist_submissions')
            .select(`
              id,
              submitted_by,
              profiles(full_name, profile_photo_url)
            `)
            .eq('checklist_id', checklist.id)
            .gte('submitted_at', startOfDay.toISOString())
            .lte('submitted_at', endOfDay.toISOString());

          // Get completed responses (those with completed_by set)
          const submissionIds = submissions?.map(s => s.id) || [];
          let completedCount = 0;
          let uniqueContributorIds = new Set<string>();
          
          if (submissionIds.length > 0) {
            const { data: completedResponses } = await supabase
              .from('checklist_responses')
              .select('id, completed_by')
              .in('submission_id', submissionIds)
              .not('completed_by', 'is', null);
            
            completedCount = completedResponses?.length || 0;
            
            // Collect unique user IDs who completed items
            completedResponses?.forEach((resp: any) => {
              if (resp.completed_by) {
                uniqueContributorIds.add(resp.completed_by);
              }
            });
          }
          
          // Fetch profiles for unique contributors
          let contributors: Array<{ name: string; photo: string | null }> = [];
          if (uniqueContributorIds.size > 0) {
            const { data: profilesData } = await supabase
              .from('profiles')
              .select('id, full_name, profile_photo_url')
              .in('id', Array.from(uniqueContributorIds));
            
            contributors = profilesData?.map((profile: any) => ({
              name: profile.full_name,
              photo: profile.profile_photo_url
            })) || [];
          }
          
          // Cap completed count at item count and completion rate at 100%
          const cappedCompletedCount = Math.min(completedCount, itemCount);
          const completionRate = itemCount > 0 ? Math.min(cappedCompletedCount / itemCount, 1) : 0;
          
          return {
            id: checklist.id,
            title: checklist.title,
            completed: completionRate === 1,
            completionRate,
            itemCount,
            completedCount: cappedCompletedCount,
            contributors
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
      <div className="space-y-6">
        <Tabs defaultValue="active" className="w-full">
          <div className="flex justify-between items-start sm:items-center flex-col sm:flex-row gap-4">
            <div>
              <h1 className="text-3xl font-bold">Tasks</h1>
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
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Available Checklists</CardTitle>
                    <CardDescription>Select a checklist to complete</CardDescription>
                  </div>
                  {isAdmin && checklists.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsReordering(!isReordering)}
                    >
                      {isReordering ? "Done" : "Reorder"}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {checklists.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No checklists available for today</p>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={checklists.map((c: any) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {checklists.map((checklist: any) => {
                          const isDynamic = checklist.template_type === 'dynamic';
                          return (
                            <SortableChecklistItem
                              key={checklist.id}
                              checklist={checklist}
                              isDynamic={isDynamic}
                              isReordering={isReordering}
                              isAdmin={isAdmin}
                              currentDay={currentDay}
                              dayNames={dayNames}
                              onNavigate={navigate}
                              onDeactivate={handleDeactivate}
                              onDelete={handleDelete}
                            />
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
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
                  <div className="space-y-4">
                    {historyStats.map((stat: any) => {
                      const completionPercent = stat.completionRate * 100;
                      const isComplete = stat.completionRate === 1;
                      const isPartial = stat.completionRate > 0 && stat.completionRate < 1;
                      const barColor = isComplete ? 'bg-green-500' : isPartial ? 'bg-yellow-500' : 'bg-red-500';
                      
                      return (
                        <div 
                          key={stat.id} 
                          className="p-4 rounded-lg border space-y-3 cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => navigate(`/complete-checklist/${stat.id}?date=${format(historyDate, 'yyyy-MM-dd')}`)}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{stat.title}</span>
                            <div className="text-xl">
                              {isComplete ? '🎉' : isPartial ? '😕' : '😞'}
                            </div>
                          </div>
                          
                          {/* Progress bar */}
                          <div className="space-y-1">
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>{stat.completedCount} of {stat.itemCount} items</span>
                              <span>{completionPercent.toFixed(0)}%</span>
                            </div>
                            <div className="h-3 bg-secondary rounded-full overflow-hidden">
                              <div 
                                className={`h-full ${barColor} transition-all`}
                                style={{ width: `${completionPercent}%` }}
                              />
                            </div>
                          </div>
                          
                          {/* Contributors */}
                          {stat.contributors.length > 0 && (
                            <div className="flex items-center gap-2 pt-2 border-t">
                              <span className="text-xs text-muted-foreground">Completed by:</span>
                              <div className="flex -space-x-2">
                                {stat.contributors.slice(0, 5).map((contributor: any, idx: number) => (
                                  <div
                                    key={idx}
                                    className="h-8 w-8 rounded-full border-2 border-background overflow-hidden bg-muted"
                                    title={contributor.name}
                                  >
                                    {contributor.photo ? (
                                      <img 
                                        src={contributor.photo} 
                                        alt={contributor.name}
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      <div className="h-full w-full flex items-center justify-center text-xs font-medium">
                                        {contributor.name?.charAt(0)}
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {stat.contributors.length > 5 && (
                                  <div className="h-8 w-8 rounded-full border-2 border-background bg-muted flex items-center justify-center text-xs">
                                    +{stat.contributors.length - 5}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
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