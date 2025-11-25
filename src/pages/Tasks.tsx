import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Clock, FileCheck, Plus, Pencil, MoreVertical, Trash2, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TemplateTypeDialog } from "@/components/TemplateTypeDialog";

export default function Tasks() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const queryClient = useQueryClient();
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);

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
    queryKey: ['user-checklists', user?.id],
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
          checklist_role_tags(role)
        `)
        .eq('is_active', true)
        .eq('template_type', 'standard')
        .order('due_by_time', { ascending: true, nullsFirst: false });

      if (error) throw error;

      // Filter checklists based on role tags
      return data.filter(checklist => {
        const roleTags = checklist.checklist_role_tags;
        return roleTags.length === 0 || roleTags.some((tag: any) => tag.role === userRole);
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
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Tasks</h1>
            <p className="text-muted-foreground">Manage your checklists and completions</p>
          </div>
          {isAdmin && (
            <Button onClick={() => setShowTemplateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Checklist
            </Button>
          )}
        </div>

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
              <p className="text-center text-muted-foreground py-8">No checklists available</p>
            ) : (
              <div className="space-y-2">
                {checklists.map((checklist: any) => (
                  <div key={checklist.id} className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 justify-start"
                      onClick={() => navigate(`/complete-checklist/${checklist.id}`)}
                    >
                      <FileCheck className="h-4 w-4 mr-2" />
                      <div className="flex-1 text-left">
                        <div className="font-medium">{checklist.title}</div>
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
                          onClick={() => navigate(`/edit-checklist/${checklist.id}`)}
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
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <TemplateTypeDialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog} />
    </Layout>
  );
}
