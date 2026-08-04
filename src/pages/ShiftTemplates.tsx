import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole, ASSIGNABLE_ROLE_OPTIONS } from '@/hooks/useUserRole';
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Copy, MoreVertical, Briefcase, X, Check } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatTime12Hour } from "@/lib/utils";
import { CopyShiftTemplatesDialog } from "@/components/schedule/CopyShiftTemplatesDialog";
import { StationsManagerCard } from "@/components/settings/StationsManagerCard";
import { BreakEditor } from "@/components/schedule/BreakEditor";
import { useBreakCoverageEnabled } from "@/hooks/useBreakCoverageEnabled";
import { ShiftBreak, normalizeBreaks } from "@/types/shiftBreak";

interface ShiftTemplate {
  id: string;
  template_name: string;
  start_time: string;
  end_time: string;
  role: string;
  color: string;
  position: string | null;
  days_of_week: number[] | null;
  allowed_roles: string[] | null;
}

export default function ShiftTemplates() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canManageTemplates, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const breakCoverageEnabled = useBreakCoverageEnabled(currentLocation?.id);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [customPosition, setCustomPosition] = useState("");
  const [showCustomPosition, setShowCustomPosition] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyTemplateId, setCopyTemplateId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    start_time: "09:00",
    end_time: "17:00",
    role: "team_member" as const,
    color: "#ef4444",
    position: "",
    days_of_week: [0, 1, 2, 3, 4, 5, 6] as number[],
    allowed_roles: ["team_member"] as string[],
    breaks: [] as import("@/types/shiftBreak").ShiftBreak[],
  });

  const resetForm = () => {
    setFormData({
      start_time: "09:00",
      end_time: "17:00",
      role: "team_member",
      color: "#ef4444",
      position: "",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      allowed_roles: ["team_member"],
      breaks: [],
    });
    setCustomPosition("");
    setShowCustomPosition(false);
    setEditingTemplate(null);
  };

  const openEditDialog = (template: ShiftTemplate) => {
    setEditingTemplate(template);
    const isPredefined = positions.includes(template.position || "");
    setShowCustomPosition(!isPredefined && !!template.position);
    setCustomPosition(!isPredefined ? template.position || "" : "");
    setFormData({
      start_time: template.start_time,
      end_time: template.end_time,
      role: template.role as any,
      color: template.color || "#ef4444",
      position: isPredefined ? template.position || "" : "",
      days_of_week: template.days_of_week || [0, 1, 2, 3, 4, 5, 6],
      allowed_roles: template.allowed_roles || [template.role || "team_member"],
      breaks: normalizeBreaks((template as any).breaks),
    });
    setDialogOpen(true);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  useEffect(() => {
    if (roleLoading) return;
    
    if (!canManageTemplates) {
      navigate("/");
      return;
    }
    if (currentLocation?.id) {
      fetchTemplates();
      fetchPositions();
    }
  }, [canManageTemplates, roleLoading, navigate, currentLocation?.id]);

  // Handle ?edit= query param to auto-open edit dialog
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (editId && templates.length > 0) {
      const templateToEdit = templates.find(t => t.id === editId);
      if (templateToEdit) {
        openEditDialog(templateToEdit);
        // Clear the query param after opening
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, templates]);

  const fetchPositions = async () => {
    if (!currentLocation?.id) return;
    
    try {
      // First get the organization_id for the current location
      const { data: locationData, error: locationError } = await supabase
        .from('locations')
        .select('organization_id')
        .eq('id', currentLocation.id)
        .single();

      if (locationError) throw locationError;

      if (!locationData?.organization_id) {
        // Fallback: just get positions from current location
        const { data, error } = await supabase
          .from('shift_templates')
          .select('position')
          .eq('location_id', currentLocation.id);

        if (error) throw error;

        const uniquePositions = new Set<string>();
        data?.forEach((template: any) => {
          if (template.position) {
            uniquePositions.add(template.position);
          }
        });
        setPositions(Array.from(uniquePositions).sort());
        return;
      }

      // Get all locations in this organization
      const { data: orgLocations, error: orgError } = await supabase
        .from('locations')
        .select('id')
        .eq('organization_id', locationData.organization_id);

      if (orgError) throw orgError;

      const locationIds = orgLocations?.map(l => l.id) || [];

      // Get positions only from templates in this organization's locations
      const { data, error } = await supabase
        .from('shift_templates')
        .select('position')
        .in('location_id', locationIds);

      if (error) throw error;

      const uniquePositions = new Set<string>();
      data?.forEach((template: any) => {
        if (template.position) {
          uniquePositions.add(template.position);
        }
      });

      setPositions(Array.from(uniquePositions).sort());
    } catch (error: any) {
      console.error('Error fetching positions:', error);
    }
  };

  const fetchTemplates = async () => {
    if (!currentLocation?.id) return;
    
    try {
      const { data, error } = await supabase
        .from("shift_templates")
        .select("*")
        .eq("location_id", currentLocation.id)
        .order("start_time", { ascending: true });

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
            allowed_roles: formData.allowed_roles,
            breaks: formData.breaks,
          } as any)
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
          allowed_roles: formData.allowed_roles,
          location_id: currentLocation?.id,
          breaks: formData.breaks,
        } as any);

        if (error) throw error;
        toast.success("Shift template created");
      }

      setDialogOpen(false);
      resetForm();
      fetchTemplates();
      fetchPositions(); // Refresh positions after creating/updating
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


  const [positionsOpen, setPositionsOpen] = useState(false);
  const [newPositionValue, setNewPositionValue] = useState('');
  const [addingPosition, setAddingPosition] = useState(false);

  const handleAddPosition = async () => {
    const trimmed = newPositionValue.trim();
    if (!trimmed || !currentLocation?.id) return;
    if (positions.includes(trimmed)) {
      toast.error('Position already exists');
      return;
    }
    setAddingPosition(true);
    try {
      // Create a placeholder template just to persist the position name
      // (positions live in shift_templates, so we store them there)
      setPositions(prev => [...prev, trimmed].sort());
      setNewPositionValue('');
      toast.success(`Position "${trimmed}" added`);
    } finally {
      setAddingPosition(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
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
        </div>

        {/* Stations (schedule grouping) */}
        {currentLocation?.id && (
          <StationsManagerCard locationId={currentLocation.id} />
        )}



        {/* Template create/edit dialog — lives outside the header row */}
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
                  <Label>Allowed Roles</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Select which roles can be assigned to this shift
                  </p>
                  <div className="space-y-2">
                    {ASSIGNABLE_ROLE_OPTIONS.map((roleOption) => (
                      <div key={roleOption.value} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`role-${roleOption.value}`}
                          checked={formData.allowed_roles.includes(roleOption.value)}
                          onChange={() => {
                            setFormData(prev => ({
                              ...prev,
                              allowed_roles: prev.allowed_roles.includes(roleOption.value)
                                ? prev.allowed_roles.filter(r => r !== roleOption.value)
                                : [...prev.allowed_roles, roleOption.value]
                            }));
                          }}
                          className="w-4 h-4 rounded border-input"
                        />
                        <label htmlFor={`role-${roleOption.value}`} className="text-sm cursor-pointer">
                          {roleOption.label}
                        </label>
                      </div>
                    ))}
                  </div>
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
                        {positions.map((pos) => (
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

                {breakCoverageEnabled && (
                  <BreakEditor
                    value={formData.breaks}
                    onChange={(b) => setFormData({ ...formData, breaks: b })}
                    shiftStart={formData.start_time}
                    shiftEnd={formData.end_time}
                  />
                )}

                <Button type="submit" className="w-full">
                  {editingTemplate ? "Update Template" : "Create Template"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

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
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(template.allowed_roles || [template.role]).map((r) => (
                      <span key={r} className="text-xs bg-muted px-1.5 py-0.5 rounded capitalize">
                        {r.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                  {template.days_of_week && template.days_of_week.length < 7 && (
                    <div className="mt-2">
                      <p className="text-xs text-muted-foreground">
                        {template.days_of_week.map(d => dayNames[d].slice(0, 3)).join(", ")}
                      </p>
                    </div>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEditDialog(template)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      setCopyTemplateId(template.id);
                      setCopyDialogOpen(true);
                    }}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy To...
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={() => handleDelete(template.id)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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

        {/* Positions Manager */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-base">Positions</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPositionsOpen(o => !o)}
            >
              {positionsOpen ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              <span className="ml-1 text-xs">{positionsOpen ? 'Done' : 'Manage'}</span>
            </Button>
          </div>

          {positions.length === 0 && !positionsOpen && (
            <p className="text-sm text-muted-foreground">
              No positions yet — positions are created when you add a shift template.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {positions.map(pos => (
              <div key={pos} className="flex items-center gap-1 bg-muted px-2.5 py-1 rounded-md text-sm">
                <span>{pos}</span>
                {positionsOpen && (
                  <button
                    onClick={async () => {
                      // Remove from local state (positions only exist within shift_templates)
                      setPositions(prev => prev.filter(p => p !== pos));
                      toast.success(`Removed "${pos}" from list`);
                    }}
                    className="ml-1 hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {positionsOpen && (
            <div className="flex gap-2 mt-3">
              <Input
                placeholder="New position name..."
                value={newPositionValue}
                onChange={e => setNewPositionValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddPosition()}
                className="flex-1 h-8 text-sm"
              />
              <Button size="sm" onClick={handleAddPosition} disabled={addingPosition || !newPositionValue.trim()}>
                <Check className="h-4 w-4" />
              </Button>
            </div>
          )}
        </Card>

        <CopyShiftTemplatesDialog
          open={copyDialogOpen}
          onOpenChange={(open) => {
            setCopyDialogOpen(open);
            if (!open) setCopyTemplateId(null);
          }}
          templateIds={copyTemplateId ? [copyTemplateId] : []}
          templateNames={templates
            .filter(t => t.id === copyTemplateId)
            .map(t => t.template_name)
          }
          onSuccess={() => {
            setCopyTemplateId(null);
          }}
        />
      </div>
    </Layout>
  );
}
