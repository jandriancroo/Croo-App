import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Calendar, Clock } from "lucide-react";
import { formatTime12Hour } from "@/lib/utils";

interface ShiftTemplate {
  id: string;
  template_name: string;
  start_time: string;
  end_time: string;
  role: string;
  color: string;
  position: string | null;
  days_of_week: number[] | null;
}

interface WeekTemplate {
  id: string;
  template_name: string;
  description: string | null;
  created_at: string;
  assignment_count?: number;
}

export default function ScheduleTemplates() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { canManageTemplates, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);
  const [weekTemplates, setWeekTemplates] = useState<WeekTemplate[]>([]);
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "shifts");

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  useEffect(() => {
    if (roleLoading) return;
    
    if (!canManageTemplates) {
      navigate("/schedule");
      return;
    }
    if (currentLocation?.id) {
      fetchTemplates();
    }
  }, [canManageTemplates, roleLoading, navigate, currentLocation?.id]);

  const fetchTemplates = async () => {
    if (!currentLocation?.id) return;

    try {
      // Fetch shift templates
      const { data: shiftData, error: shiftError } = await supabase
        .from("shift_templates")
        .select("*")
        .eq("location_id", currentLocation.id)
        .order("start_time", { ascending: true });

      if (shiftError) throw shiftError;
      setShiftTemplates(shiftData || []);

      // Fetch week templates with assignment count
      const { data: weekData, error: weekError } = await supabase
        .from("week_templates")
        .select(`
          *,
          week_template_assignments(id)
        `)
        .eq("location_id", currentLocation.id)
        .order("created_at", { ascending: false });

      if (weekError) throw weekError;
      
      const weekTemplatesWithCount = (weekData || []).map(wt => ({
        ...wt,
        assignment_count: wt.week_template_assignments?.length || 0
      }));
      setWeekTemplates(weekTemplatesWithCount);
    } catch (error: any) {
      console.error("Error fetching templates:", error);
      toast.error("Failed to load templates");
    }
  };

  const handleDeleteShiftTemplate = async (id: string) => {
    if (!confirm("Are you sure you want to delete this shift template?")) return;

    try {
      const { error } = await supabase.from("shift_templates").delete().eq("id", id);
      if (error) throw error;
      toast.success("Shift template deleted");
      fetchTemplates();
    } catch (error: any) {
      console.error("Error deleting template:", error);
      toast.error("Failed to delete template");
    }
  };

  const handleDeleteWeekTemplate = async (id: string) => {
    if (!confirm("Are you sure you want to delete this week template?")) return;

    try {
      const { error } = await supabase.from("week_templates").delete().eq("id", id);
      if (error) throw error;
      toast.success("Week template deleted");
      fetchTemplates();
    } catch (error: any) {
      console.error("Error deleting template:", error);
      toast.error("Failed to delete template");
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate("/schedule")}>
              ← Back to Schedule
            </Button>
            <h1 className="text-3xl font-bold">Schedule Templates</h1>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="shifts" className="gap-2">
              <Clock className="h-4 w-4" />
              Shift Templates
            </TabsTrigger>
            <TabsTrigger value="weeks" className="gap-2">
              <Calendar className="h-4 w-4" />
              Week Templates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="shifts" className="space-y-4 mt-4">
            <div className="flex justify-between items-center">
              <p className="text-muted-foreground">
                Create reusable shift templates for quick scheduling
              </p>
              <Button onClick={() => navigate("/shift-templates")}>
                <Plus className="h-4 w-4 mr-2" />
                New Shift Template
              </Button>
            </div>

            {shiftTemplates.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {shiftTemplates.map((template) => (
                  <Card key={template.id} className="p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <div
                            className="w-4 h-4 rounded"
                            style={{ backgroundColor: template.color }}
                          />
                          <h3 className="font-semibold text-lg">{template.position}</h3>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {formatTime12Hour(template.start_time)} - {formatTime12Hour(template.end_time)}
                        </p>
                        <p className="text-sm text-muted-foreground capitalize mt-1">
                          {template.role.replace("_", " ")}
                        </p>
                        {template.days_of_week && template.days_of_week.length < 7 && (
                          <div className="mt-2">
                            <p className="text-xs text-muted-foreground">
                              {template.days_of_week.map(d => dayNames[d]).join(", ")}
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate("/shift-templates")}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteShiftTemplate(template.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="p-12 text-center">
                <h3 className="text-lg font-semibold mb-2">No Shift Templates Yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create shift templates to use in week templates and for quick scheduling.
                </p>
                <Button onClick={() => navigate("/shift-templates")}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Shift Template
                </Button>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="weeks" className="space-y-4 mt-4">
            <div className="flex justify-between items-center">
              <p className="text-muted-foreground">
                Build weekly schedules from shift templates for auto-scheduling
              </p>
              <Button onClick={() => navigate("/week-template/new")}>
                <Plus className="h-4 w-4 mr-2" />
                New Week Template
              </Button>
            </div>

            {weekTemplates.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {weekTemplates.map((template) => (
                  <Card key={template.id} className="p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-1">{template.template_name}</h3>
                        {template.description && (
                          <p className="text-sm text-muted-foreground mb-2">
                            {template.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {template.assignment_count} shift{template.assignment_count !== 1 ? 's' : ''} assigned
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/week-template/${template.id}`)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteWeekTemplate(template.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="p-12 text-center">
                <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Week Templates Yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create week templates by assigning shift templates to days of the week.
                </p>
                {shiftTemplates.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-amber-500">
                      You need to create shift templates first
                    </p>
                    <Button onClick={() => navigate("/shift-templates")}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Shift Templates
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => navigate("/week-template/new")}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create First Week Template
                  </Button>
                )}
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
