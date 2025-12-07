import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

export default function ShiftTemplates() {
  const navigate = useNavigate();
  const { isAdmin, isManager, loading: roleLoading } = useUserRole();
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [customPosition, setCustomPosition] = useState("");
  const [showCustomPosition, setShowCustomPosition] = useState(false);
  const [formData, setFormData] = useState({
    start_time: "09:00",
    end_time: "17:00",
    role: "team_member" as const,
    color: "#ef4444",
    position: "",
    days_of_week: [0, 1, 2, 3, 4, 5, 6] as number[],
  });

  const resetForm = () => {
    setFormData({
      start_time: "09:00",
      end_time: "17:00",
      role: "team_member",
      color: "#ef4444",
      position: "",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
    });
    setCustomPosition("");
    setShowCustomPosition(false);
    setEditingTemplate(null);
  };

  const openEditDialog = (template: ShiftTemplate) => {
    setEditingTemplate(template);
    const isPredefined = predefinedPositions.includes(template.position || "");
    setShowCustomPosition(!isPredefined && !!template.position);
    setCustomPosition(!isPredefined ? template.position || "" : "");
    setFormData({
      start_time: template.start_time,
      end_time: template.end_time,
      role: template.role as any,
      color: template.color || "#ef4444",
      position: isPredefined ? template.position || "" : "",
      days_of_week: template.days_of_week || [0, 1, 2, 3, 4, 5, 6],
    });
    setDialogOpen(true);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const predefinedPositions = [
    "Pizza Smith",
    "Dough",
    "Line",
    "Prep",
    "Dishwasher",
    "Front Counter",
    "Delivery Driver",
  ];

  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  useEffect(() => {
    if (roleLoading) return;
    
    if (!isAdmin && !isManager) {
      navigate("/");
      return;
    }
    fetchTemplates();
  }, [isAdmin, isManager, roleLoading, navigate]);

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from("shift_templates")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error: any) {
      console.error("Error fetching templates:", error);
      toast.error("Failed to load shift templates");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const positionValue = showCustomPosition ? customPosition : formData.position;

    if (!positionValue.trim()) {
      toast.error("Please select or enter a position");
      return;
    }

    try {
      // Auto-generate template name from position and time
      const templateName = `${positionValue} ${formatTime12Hour(formData.start_time)} - ${formatTime12Hour(formData.end_time)}`;
      
      if (editingTemplate) {
        // Update existing template
        const { error } = await supabase.from("shift_templates")
          .update({
            template_name: templateName,
            start_time: formData.start_time,
            end_time: formData.end_time,
            role: formData.role,
            color: formData.color,
            position: positionValue,
            days_of_week: formData.days_of_week,
          })
          .eq("id", editingTemplate.id);

        if (error) throw error;
        toast.success("Shift template updated");
      } else {
        // Create new template
        const { error } = await supabase.from("shift_templates").insert({
          template_name: templateName,
          start_time: formData.start_time,
          end_time: formData.end_time,
          role: formData.role,
          color: formData.color,
          position: positionValue,
          days_of_week: formData.days_of_week,
        });

        if (error) throw error;
        toast.success("Shift template created");
      }

      setDialogOpen(false);
      resetForm();
      fetchTemplates();
    } catch (error: any) {
      console.error("Error saving template:", error);
      toast.error(editingTemplate ? "Failed to update shift template" : "Failed to create shift template");
    }
  };

  const toggleDay = (dayIndex: number) => {
    setFormData(prev => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(dayIndex)
        ? prev.days_of_week.filter(d => d !== dayIndex)
        : [...prev.days_of_week, dayIndex].sort()
    }));
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this template?")) return;

    try {
      const { error } = await supabase.from("shift_templates").delete().eq("id", id);

      if (error) throw error;
      toast.success("Template deleted");
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
            <h1 className="text-3xl font-bold">Shift Templates</h1>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingTemplate ? "Edit Shift Template" : "Create Shift Template"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="start_time">Start Time</Label>
                    <Input
                      id="start_time"
                      type="time"
                      value={formData.start_time}
                      onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="end_time">End Time</Label>
                    <Input
                      id="end_time"
                      type="time"
                      value={formData.end_time}
                      onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="role">Role</Label>
                  <Select value={formData.role} onValueChange={(value: any) => setFormData({ ...formData, role: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="team_member">Team Member</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="position">Position</Label>
                  {!showCustomPosition ? (
                    <Select 
                      value={formData.position} 
                      onValueChange={(value) => {
                        if (value === "custom") {
                          setShowCustomPosition(true);
                          setFormData({ ...formData, position: "" });
                        } else {
                          setFormData({ ...formData, position: value });
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a position" />
                      </SelectTrigger>
                      <SelectContent>
                        {predefinedPositions.map((pos) => (
                          <SelectItem key={pos} value={pos}>
                            {pos}
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">+ Add Custom Position</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="space-y-2">
                      <Input
                        id="position"
                        value={customPosition}
                        onChange={(e) => setCustomPosition(e.target.value)}
                        placeholder="Enter custom position"
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowCustomPosition(false);
                          setCustomPosition("");
                        }}
                      >
                        ← Back to list
                      </Button>
                    </div>
                  )}
                </div>

                <div>
                  <Label>Days of Week</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {dayNames.map((day, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`day-${index}`}
                          checked={formData.days_of_week.includes(index)}
                          onChange={() => toggleDay(index)}
                          className="w-4 h-4 rounded border-input"
                        />
                        <label htmlFor={`day-${index}`} className="text-sm cursor-pointer">
                          {day}
                        </label>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Select which days this template should be available for
                  </p>
                </div>

                <div>
                  <Label htmlFor="color">Color</Label>
                  <Input
                    id="color"
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="h-10"
                  />
                </div>

                <Button type="submit" className="w-full">
                  {editingTemplate ? "Update Template" : "Create Template"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {templates.length > 0 && (
          <Card className="p-4 bg-muted/50 border-primary/20">
            <p className="text-sm text-muted-foreground">
              <strong>How to use:</strong> Create templates for your common shifts (Morning, Evening, etc.). 
              Go to the Schedule page and drag these templates onto employee rows to quickly assign shifts for the week.
            </p>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
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
                          {template.days_of_week.map(d => dayNames[d].slice(0, 3)).join(", ")}
                        </p>
                      </div>
                    )}
                  </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(template)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(template.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {templates.length === 0 && (
          <Card className="p-12 text-center">
            <h3 className="text-lg font-semibold mb-2">No Shift Templates Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create shift templates to quickly assign recurring shifts. Once created, you can drag templates onto employees in the schedule view.
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Template
            </Button>
          </Card>
        )}
      </div>
    </Layout>
  );
}
