import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole, ASSIGNABLE_ROLE_OPTIONS } from '@/hooks/useUserRole';
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { toast } from "sonner";
import { Plus, Calendar, Clock, MoreVertical, Pencil, Copy, Trash2, Briefcase, X, Check, Tag } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTime12Hour } from "@/lib/utils";
import { CopyShiftTemplatesDialog } from "@/components/schedule/CopyShiftTemplatesDialog";
import { StationsManagerCard } from "@/components/settings/StationsManagerCard";
import { CopyEventCategoriesDialog } from "@/components/schedule/CopyEventCategoriesDialog";

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

interface WeekTemplate {
  id: string;
  template_name: string;
  description: string | null;
  created_at: string;
  assignment_count?: number;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function ScheduleTemplates() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { canManageTemplates, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);
  const [weekTemplates, setWeekTemplates] = useState<WeekTemplate[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "shifts");
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyTemplateId, setCopyTemplateId] = useState<string | null>(null);

  // Shift template dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [formData, setFormData] = useState({
    start_time: "09:00",
    end_time: "17:00",
    color: "#ef4444",
    position: "",
    days_of_week: [0, 1, 2, 3, 4, 5, 6] as number[],
    allowed_roles: ["team_member"] as string[],
  });

  // Positions panel state
  const [positionsOpen, setPositionsOpen] = useState(false);
  const [newPositionValue, setNewPositionValue] = useState('');
  const [editingPositionName, setEditingPositionName] = useState<string | null>(null);
  const [editPositionValue, setEditPositionValue] = useState('');

  // Event categories state
  const [eventCategories, setEventCategories] = useState<{ id: string; name: string; color: string }[]>([]);
  const [copyCategoriesDialogOpen, setCopyCategoriesDialogOpen] = useState(false);
  useEffect(() => {
    if (roleLoading) return;
    if (!canManageTemplates) { navigate("/schedule"); return; }
    if (currentLocation?.id) { fetchTemplates(); fetchPositions(); fetchEventCategories(); }
  }, [canManageTemplates, roleLoading, navigate, currentLocation?.id]);

  const fetchTemplates = async () => {
    if (!currentLocation?.id) return;
    try {
      const { data: shiftData, error: shiftError } = await supabase
        .from("shift_templates").select("*")
        .eq("location_id", currentLocation.id)
        .order("start_time", { ascending: true });
      if (shiftError) throw shiftError;
      setShiftTemplates(shiftData || []);

      const { data: weekData, error: weekError } = await supabase
        .from("week_templates")
        .select("*, week_template_assignments(id)")
        .eq("location_id", currentLocation.id)
        .order("created_at", { ascending: false });
      if (weekError) throw weekError;
      setWeekTemplates((weekData || []).map(wt => ({
        ...wt,
        assignment_count: wt.week_template_assignments?.length || 0
      })));
    } catch (error: any) {
      console.error("Error fetching templates:", error);
      toast.error("Failed to load templates");
    }
  };

  const fetchPositions = async () => {
    const orgId = currentLocation?.organization_id;
    if (!orgId) return;
    try {
      const { data, error } = await supabase
        .from("organization_positions").select("name")
        .eq("organization_id", orgId)
        .order("name");
      if (error) throw error;
      setPositions((data || []).map((p: any) => p.name));
    } catch (error: any) {
      console.error("Error fetching positions:", error);
    }
  };
  const fetchEventCategories = async () => {
    if (!currentLocation?.id) return;
    const { data, error } = await supabase
      .from('event_categories')
      .select('id, name, color')
      .eq('location_id', currentLocation.id)
      .order('name');
    if (!error && data) setEventCategories(data);
  };


    const resetForm = () => {
    setEditingTemplate(null);
  };

  const openCreateDialog = () => { resetForm(); setDialogOpen(true); };

  const openEditDialog = (template: ShiftTemplate) => {
    setEditingTemplate(template);
    setFormData({
      start_time: template.start_time,
      end_time: template.end_time,
      color: template.color || "#ef4444",
      position: template.position || "",
      days_of_week: template.days_of_week || [0,1,2,3,4,5,6],
      allowed_roles: (template.allowed_roles || [template.role]).filter(Boolean),
    });
    setDialogOpen(true);
  };

  const toggleDay = (i: number) => {
    setFormData(prev => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(i)
        ? prev.days_of_week.filter(d => d !== i)
        : [...prev.days_of_week, i].sort()
    }));
  };

  const handleRenamePosition = async (oldName: string, newName: string) => {
    if (!newName.trim() || newName.trim() === oldName) { setEditingPositionName(null); return; }
    const orgId = currentLocation?.organization_id;
    if (!orgId) return;
    try {
      // Update the organization_positions table
      const { error } = await supabase
        .from('organization_positions')
        .update({ name: newName.trim() })
        .eq('organization_id', orgId)
        .eq('name', oldName);
      if (error) throw error;
      // Also update shift_templates that reference the old name
      await supabase
        .from('shift_templates')
        .update({ position: newName.trim() })
        .eq('position', oldName)
        .eq('location_id', currentLocation?.id);
      toast.success(`Renamed "${oldName}" to "${newName.trim()}"`);
      setEditingPositionName(null);
      setEditPositionValue('');
      fetchTemplates();
      fetchPositions();
    } catch (error: any) {
      toast.error('Failed to rename position');
    }
  };

  const handleAddPosition = async () => {
    const trimmed = newPositionValue.trim();
    if (!trimmed) return;
    const orgId = currentLocation?.organization_id;
    if (!orgId) return;
    if (positions.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('Position already exists');
      return;
    }
    try {
      const { error } = await supabase
        .from('organization_positions')
        .insert({ organization_id: orgId, name: trimmed });
      if (error) throw error;
      toast.success(`Position "${trimmed}" added`);
      setNewPositionValue('');
      fetchPositions();
    } catch {
      toast.error('Failed to add position');
    }
  };

  const handleDeletePosition = async (posName: string) => {
    const orgId = currentLocation?.organization_id;
    if (!orgId) return;
    try {
      const { error } = await supabase
        .from('organization_positions')
        .delete()
        .eq('organization_id', orgId)
        .eq('name', posName);
      if (error) throw error;
      await supabase
        .from('shift_templates')
        .update({ position: null })
        .eq('position', posName)
        .eq('location_id', currentLocation?.id);
      toast.success(`Position "${posName}" removed`);
      fetchPositions();
    } catch {
      toast.error('Failed to delete position');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const positionValue = formData.position;
    if (!positionValue.trim()) { toast.error("Please select a position"); return; }

    try {
      const templateName = `${positionValue} ${formatTime12Hour(formData.start_time)} - ${formatTime12Hour(formData.end_time)}`;
      const role = (formData.allowed_roles[0] || "team_member") as "admin" | "brand_admin" | "fbc" | "general_manager" | "manager" | "org_admin" | "shift_manager" | "super_admin" | "team_member";
      const payload = {
        template_name: templateName,
        start_time: formData.start_time,
        end_time: formData.end_time,
        role,
        color: formData.color,
        position: positionValue,
        days_of_week: formData.days_of_week,
        allowed_roles: formData.allowed_roles,
      };

      if (editingTemplate) {
        const { error } = await supabase.from("shift_templates").update(payload).eq("id", editingTemplate.id);
        if (error) throw error;
        toast.success("Shift template updated");
      } else {
        const insertPayload = { ...payload, location_id: currentLocation?.id };
        const { error } = await supabase.from("shift_templates").insert([insertPayload]);
        if (error) throw error;
        toast.success("Shift template created");
      }

      setDialogOpen(false);
      resetForm();
      fetchTemplates();
      fetchPositions();
    } catch (error: any) {
      console.error("Error saving template:", error);
      toast.error(editingTemplate ? "Failed to update" : "Failed to create");
    }
  };

  const handleDeleteShiftTemplate = async (id: string) => {
    if (!confirm("Are you sure you want to delete this shift template?")) return;
    try {
      const { error } = await supabase.from("shift_templates").delete().eq("id", id);
      if (error) throw error;
      toast.success("Shift template deleted");
      fetchTemplates();
      fetchPositions();
    } catch (error: any) {
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
      toast.error("Failed to delete template");
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate("/schedule")}>
            ← Back to Schedule
          </Button>
          <h1 className="text-3xl font-bold">Schedule Templates</h1>
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
            {currentLocation?.id && (
              <StationsManagerCard locationId={currentLocation.id} />
            )}
            <div className="flex justify-between items-center">
              <p className="text-muted-foreground">Create reusable shift templates for quick scheduling</p>
              <div className="flex items-center gap-2">
                {shiftTemplates.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => {
                    setCopyTemplateId(null);
                    setCopyDialogOpen(true);
                  }}>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy All
                  </Button>
                )}
                <Button onClick={openCreateDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Shift Template
                </Button>
              </div>
            </div>

            {shiftTemplates.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                {shiftTemplates.map((template) => (
                  <Card key={template.id} className="p-2.5">
                    <div className="flex justify-between items-start gap-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: template.color }} />
                          <h3 className="font-semibold text-sm truncate">{template.position}</h3>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatTime12Hour(template.start_time)} – {formatTime12Hour(template.end_time)}
                        </p>
                        <p className="text-[11px] text-muted-foreground capitalize">
                          {template.role.replace("_", " ")}
                        </p>
                        {template.days_of_week && template.days_of_week.length < 7 && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {template.days_of_week.map(d => DAY_NAMES[d].slice(0, 3)).join(", ")}
                          </p>
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1 -mt-1"><MoreVertical className="h-3.5 w-3.5" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(template)}>
                            <Pencil className="h-4 w-4 mr-2" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setCopyTemplateId(template.id); setCopyDialogOpen(true); }}>
                            <Copy className="h-4 w-4 mr-2" />Copy To...
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDeleteShiftTemplate(template.id)} className="text-destructive focus:text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Card>
                ))}
              </div>

            ) : (
              <Card className="p-12 text-center">
                <h3 className="text-lg font-semibold mb-2">No Shift Templates Yet</h3>
                <p className="text-muted-foreground mb-4">Create shift templates to use in week templates and for quick scheduling.</p>
                <Button onClick={openCreateDialog}>
                  <Plus className="h-4 w-4 mr-2" />Create First Shift Template
                </Button>
              </Card>
            )}

            {/* Positions panel */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-semibold text-base">Positions</h2>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setPositionsOpen(o => !o)}>
                  {positionsOpen ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                  <span className="ml-1 text-xs">{positionsOpen ? 'Done' : 'Manage'}</span>
                </Button>
              </div>
              {positions.length === 0 && !positionsOpen && (
                <p className="text-sm text-muted-foreground">No positions yet — they're created with shift templates.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {positions.map(pos => (
                  <div key={pos} className="flex items-center gap-1 bg-muted px-2.5 py-1 rounded-md text-sm">
                    {positionsOpen && editingPositionName === pos ? (
                      <>
                        <Input
                          value={editPositionValue}
                          onChange={e => setEditPositionValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRenamePosition(pos, editPositionValue); if (e.key === 'Escape') setEditingPositionName(null); }}
                          autoFocus
                          className="h-6 w-24 text-xs px-1"
                        />
                        <button onClick={() => handleRenamePosition(pos, editPositionValue)} className="hover:text-foreground transition-colors">
                          <Check className="h-3 w-3" />
                        </button>
                        <button onClick={() => setEditingPositionName(null)} className="hover:text-foreground transition-colors">
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span>{pos}</span>
                        {positionsOpen && (
                          <>
                            <button
                              onClick={() => { setEditingPositionName(pos); setEditPositionValue(pos); }}
                              className="ml-1 hover:text-foreground transition-colors"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => handleDeletePosition(pos)}
                              className="hover:text-destructive transition-colors"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </>
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
                    onKeyDown={e => { if (e.key === 'Enter' && newPositionValue.trim()) handleAddPosition(); }}
                    className="flex-1 h-8 text-sm"
                  />
                  <Button size="sm" onClick={handleAddPosition} disabled={!newPositionValue.trim()}>
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </Card>

            {/* Event Categories section */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-semibold text-base">Event Categories</h2>
                </div>
                {eventCategories.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setCopyCategoriesDialogOpen(true)}>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy All
                  </Button>
                )}
              </div>
              {eventCategories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No event categories yet — create them from the schedule event form.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {eventCategories.map(cat => (
                    <div key={cat.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm" style={{ backgroundColor: cat.color + '20', color: cat.color }}>
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                      {cat.name}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="weeks" className="space-y-4 mt-4">
            <div className="flex justify-between items-center">
              <p className="text-muted-foreground">Build weekly schedules from shift templates for auto-scheduling</p>
              <Button onClick={() => navigate("/week-template/new")}>
                <Plus className="h-4 w-4 mr-2" />New Week Template
              </Button>
            </div>
            {weekTemplates.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {weekTemplates.map((template) => (
                  <Card key={template.id} className="p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-1">{template.template_name}</h3>
                        {template.description && <p className="text-sm text-muted-foreground mb-2">{template.description}</p>}
                        <p className="text-xs text-muted-foreground">{template.assignment_count} shift{template.assignment_count !== 1 ? 's' : ''} assigned</p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/week-template/${template.id}`)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDeleteWeekTemplate(template.id)} className="text-destructive focus:text-destructive">
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="p-12 text-center">
                <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Week Templates Yet</h3>
                <p className="text-muted-foreground mb-4">Create week templates by assigning shift templates to days of the week.</p>
                {shiftTemplates.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-amber-500">You need to create shift templates first</p>
                    <Button onClick={openCreateDialog}>
                      <Plus className="h-4 w-4 mr-2" />Create Shift Templates
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => navigate("/week-template/new")}>
                    <Plus className="h-4 w-4 mr-2" />Create First Week Template
                  </Button>
                )}
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Shift template create/edit dialog */}
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingTemplate ? "Edit Shift Template" : "Create Shift Template"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="start_time">Start Time</Label>
                  <Input id="start_time" type="time" value={formData.start_time} onChange={(e) => setFormData({ ...formData, start_time: e.target.value })} required />
                </div>
                <div>
                  <Label htmlFor="end_time">End Time</Label>
                  <Input id="end_time" type="time" value={formData.end_time} onChange={(e) => setFormData({ ...formData, end_time: e.target.value })} required />
                </div>
              </div>

              <div>
                <Label>Allowed Roles</Label>
                <p className="text-xs text-muted-foreground mb-2">Select which roles can be assigned to this shift</p>
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
                      <label htmlFor={`role-${roleOption.value}`} className="text-sm cursor-pointer">{roleOption.label}</label>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="position">Position</Label>
                <Select value={formData.position} onValueChange={(value) => setFormData({ ...formData, position: value })}>
                  <SelectTrigger><SelectValue placeholder="Select a position" /></SelectTrigger>
                  <SelectContent>
                    {positions.map((pos) => <SelectItem key={pos} value={pos}>{pos}</SelectItem>)}
                  </SelectContent>
                </Select>
                {positions.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">Add positions in the Positions panel below</p>
                )}
              </div>

              <div>
                <Label>Days of Week</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {DAY_NAMES.map((day, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <input type="checkbox" id={`day-${index}`} checked={formData.days_of_week.includes(index)} onChange={() => toggleDay(index)} className="w-4 h-4 rounded border-input" />
                      <label htmlFor={`day-${index}`} className="text-sm cursor-pointer">{day}</label>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="color">Color</Label>
                <Input id="color" type="color" value={formData.color} onChange={(e) => setFormData({ ...formData, color: e.target.value })} className="h-10" />
              </div>

              <Button type="submit" className="w-full">
                {editingTemplate ? "Update Template" : "Create Template"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <CopyShiftTemplatesDialog
          open={copyDialogOpen}
          onOpenChange={(open) => { setCopyDialogOpen(open); if (!open) setCopyTemplateId(null); }}
          templateIds={copyTemplateId ? [copyTemplateId] : shiftTemplates.map(t => t.id)}
          templateNames={copyTemplateId ? shiftTemplates.filter(t => t.id === copyTemplateId).map(t => t.template_name) : shiftTemplates.map(t => t.template_name)}
          onSuccess={() => { setCopyTemplateId(null); fetchTemplates(); }}
        />

        <CopyEventCategoriesDialog
          open={copyCategoriesDialogOpen}
          onOpenChange={setCopyCategoriesDialogOpen}
          categoryIds={eventCategories.map(c => c.id)}
          categoryNames={eventCategories.map(c => c.name)}
          onSuccess={fetchEventCategories}
        />
      </div>
    </Layout>
  );
}
