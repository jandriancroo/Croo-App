import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, X, BarChart3, ClipboardCheck, ListTodo, LayoutGrid, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { DataCube, MetricType, METRIC_CONFIGS, METRIC_GROUPS, SalesDataForCubes } from "./DataCube";
import { ChecklistCube } from "./ChecklistCube";
import { TaskCube } from "./TaskCube";

const ACCENT_COLORS = [
  { value: "#8B5CF6", label: "Purple" },
  { value: "#10B981", label: "Green" },
  { value: "#F59E0B", label: "Orange" },
  { value: "#EF4444", label: "Red" },
  { value: "#3B82F6", label: "Blue" },
  { value: "#EC4899", label: "Pink" },
  { value: "#14B8A6", label: "Teal" },
  { value: "#6366F1", label: "Indigo" },
];

// Available dashboard sections
export const DASHBOARD_SECTIONS = [
  { key: 'data-cubes', label: 'Data Cubes', description: 'Sales and metrics at a glance' },
  { key: 'sales-overview', label: 'Sales Overview', description: 'Detailed sales breakdown' },
  { key: 'assigned-tasks', label: 'Assigned Tasks', description: 'Your temporary tasks' },
  { key: 'event-tasks', label: 'Event Tasks', description: 'Daily event cards' },
  { key: 'cash-handling', label: 'Cash Handling', description: 'Drawer and safe counts' },
  { key: 'catering-orders', label: 'Catering Orders', description: 'Today\'s catering pickups' },
  { key: 'checklists', label: 'Checklists', description: 'Daily/weekly/monthly checklists' },
] as const;

export type SectionKey = typeof DASHBOARD_SECTIONS[number]['key'];

type CubeType = 'data' | 'checklist' | 'task';

interface CubeConfig {
  id?: string;
  title: string;
  cubeType: CubeType;
  metrics: MetricType[];
  referenceId?: string;
  accentColor: string;
  displayOrder: number;
  isNew?: boolean;
  toDelete?: boolean;
}

export interface SectionConfig {
  key: SectionKey;
  isVisible: boolean;
  displayOrder: number;
}

interface EditDashboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  existingCubes: CubeConfig[];
  existingSections?: SectionConfig[];
  onSave: () => void;
  salesData: SalesDataForCubes | null;
  hasQuBeyondIntegration?: boolean;
}

export function EditDashboardDialog({ 
  open, 
  onOpenChange, 
  locationId, 
  existingCubes,
  existingSections,
  onSave,
  salesData,
  hasQuBeyondIntegration = true,
}: EditDashboardDialogProps) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const [cubes, setCubes] = useState<CubeConfig[]>([]);
  const [sections, setSections] = useState<SectionConfig[]>([]);
  const [editingCubeIndex, setEditingCubeIndex] = useState<number | null>(null);
  const [addingType, setAddingType] = useState<CubeType | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'sections' | 'cubes'>('sections');

  // Fetch available checklists
  const { data: checklists = [] } = useQuery({
    queryKey: ['checklists-for-cubes', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      const { data, error } = await supabase
        .from('checklists')
        .select('id, title, frequency')
        .eq('location_id', currentLocation.id)
        .eq('is_active', true)
        .order('title');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation?.id && open,
  });

  // Fetch available temporary tasks (quick tasks)
  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks-for-cubes', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      const { data, error } = await supabase
        .from('temporary_tasks')
        .select('id, title, expires_at')
        .eq('location_id', currentLocation.id)
        .eq('is_active', true)
        .is('completed_at', null)
        .order('expires_at');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation?.id && open,
  });

  useEffect(() => {
    if (open) {
      setCubes(existingCubes.map((c, i) => ({ ...c, displayOrder: i })));
      
      // Initialize sections - use existing or create defaults
      if (existingSections && existingSections.length > 0) {
        setSections(existingSections);
      } else {
        // Default all sections to visible
        setSections(DASHBOARD_SECTIONS.map((s, i) => ({
          key: s.key,
          isVisible: true,
          displayOrder: i,
        })));
      }
      
      setEditingCubeIndex(null);
      setAddingType(null);
    }
  }, [open, existingCubes, existingSections]);

  const toggleSectionVisibility = (key: SectionKey) => {
    setSections(sections.map(s => 
      s.key === key ? { ...s, isVisible: !s.isVisible } : s
    ));
  };

  const handleAddDataCube = () => {
    const newCube: CubeConfig = {
      title: "",
      cubeType: 'data',
      metrics: [],
      accentColor: ACCENT_COLORS[cubes.filter(c => !c.toDelete).length % ACCENT_COLORS.length].value,
      displayOrder: cubes.length,
      isNew: true,
    };
    setCubes([...cubes, newCube]);
    setEditingCubeIndex(cubes.length);
    setAddingType(null);
  };

  const handleAddChecklistCube = (checklistId: string, checklistTitle: string) => {
    const newCube: CubeConfig = {
      title: checklistTitle,
      cubeType: 'checklist',
      metrics: [],
      referenceId: checklistId,
      accentColor: "#8B5CF6",
      displayOrder: cubes.length,
      isNew: true,
    };
    setCubes([...cubes, newCube]);
    setAddingType(null);
  };

  const handleAddTaskCube = (taskId: string, taskTitle: string) => {
    const newCube: CubeConfig = {
      title: taskTitle,
      cubeType: 'task',
      metrics: [],
      referenceId: taskId,
      accentColor: "#F59E0B",
      displayOrder: cubes.length,
      isNew: true,
    };
    setCubes([...cubes, newCube]);
    setAddingType(null);
  };

  const handleDeleteCube = (index: number) => {
    const cube = cubes[index];
    if (cube.id) {
      setCubes(cubes.map((c, i) => i === index ? { ...c, toDelete: true } : c));
    } else {
      setCubes(cubes.filter((_, i) => i !== index));
    }
    setEditingCubeIndex(null);
  };

  const updateCube = (index: number, updates: Partial<CubeConfig>) => {
    setCubes(cubes.map((c, i) => i === index ? { ...c, ...updates } : c));
  };

  const toggleMetric = (index: number, metric: MetricType) => {
    const cube = cubes[index];
    const currentMetrics = cube.metrics;
    
    if (currentMetrics.includes(metric)) {
      updateCube(index, { metrics: currentMetrics.filter(m => m !== metric) });
    } else if (currentMetrics.length < 3) {
      updateCube(index, { metrics: [...currentMetrics, metric] });
    } else {
      toast.error("Maximum 3 metrics per cube");
    }
  };

  const handleSave = async () => {
    if (!user?.id || !locationId) return;
    
    setIsSubmitting(true);
    
    try {
      // Save section preferences
      // First delete existing
      await supabase
        .from('user_dashboard_sections')
        .delete()
        .eq('user_id', user.id)
        .eq('location_id', locationId);

      // Insert new section preferences
      if (sections.length > 0) {
        const sectionRecords = sections.map((s, index) => ({
          user_id: user.id,
          location_id: locationId,
          section_key: s.key,
          is_visible: s.isVisible,
          display_order: index,
        }));

        const { error: sectionsError } = await supabase
          .from('user_dashboard_sections')
          .insert(sectionRecords);
        
        if (sectionsError) throw sectionsError;
      }

      // Delete cubes marked for deletion
      const toDelete = cubes.filter(c => c.toDelete && c.id);
      if (toDelete.length > 0) {
        const { error } = await supabase
          .from('user_dashboard_cubes')
          .delete()
          .in('id', toDelete.map(c => c.id!));
        if (error) throw error;
      }

      // Get cubes to save (not deleted)
      const toSave = cubes.filter(c => !c.toDelete);
      
      // Validate data cubes have at least one metric
      const invalidCubes = toSave.filter(c => c.cubeType === 'data' && c.metrics.length === 0);
      if (invalidCubes.length > 0) {
        toast.error("Each data cube must have at least one metric");
        setIsSubmitting(false);
        return;
      }

      // Delete all existing cubes for this user/location and recreate
      await supabase
        .from('user_dashboard_cubes')
        .delete()
        .eq('user_id', user.id)
        .eq('location_id', locationId);

      // Insert all cubes with new order
      if (toSave.length > 0) {
        const records = toSave.map((cube, index) => ({
          user_id: user.id,
          location_id: locationId,
          display_order: index,
          title: cube.title || null,
          cube_type: cube.cubeType,
          metrics: cube.cubeType === 'data' ? cube.metrics : [],
          reference_id: cube.referenceId || null,
          accent_color: cube.accentColor,
        }));

        const { error } = await supabase
          .from('user_dashboard_cubes')
          .insert(records);
        
        if (error) throw error;
      }

      toast.success("Dashboard saved");
      onSave();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error saving dashboard:", error);
      toast.error("Failed to save dashboard");
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeCubes = cubes.filter(c => !c.toDelete);
  const editingCube = editingCubeIndex !== null ? cubes[editingCubeIndex] : null;

  // Get list of already-added checklist/task IDs
  const addedChecklistIds = activeCubes.filter(c => c.cubeType === 'checklist').map(c => c.referenceId);
  const addedTaskIds = activeCubes.filter(c => c.cubeType === 'task').map(c => c.referenceId);

  // Filter sections based on available features
  const availableSections = DASHBOARD_SECTIONS.filter(s => {
    if ((s.key === 'data-cubes' || s.key === 'sales-overview') && !hasQuBeyondIntegration) {
      return false;
    }
    return true;
  });

  const renderCubePreview = (cube: CubeConfig, index: number) => {
    const realIndex = cubes.indexOf(cube);
    
    if (cube.cubeType === 'checklist') {
      return (
        <ChecklistCube
          checklistId={cube.referenceId || ''}
          title={cube.title}
          completed={0}
          expected={0}
          accentColor={cube.accentColor}
          onClick={() => setEditingCubeIndex(realIndex)}
        />
      );
    }
    
    if (cube.cubeType === 'task') {
      return (
        <TaskCube
          taskId={cube.referenceId || ''}
          title={cube.title}
          accentColor={cube.accentColor}
          onClick={() => setEditingCubeIndex(realIndex)}
        />
      );
    }
    
    return (
      <div className="relative">
        <DataCube
          title={cube.title}
          metrics={cube.metrics}
          accentColor={cube.accentColor}
          salesData={salesData}
          onClick={() => setEditingCubeIndex(realIndex)}
        />
        {cube.metrics.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
            <span className="text-xs text-muted-foreground">Tap to configure</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Dashboard</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Main View - Tabs for Sections and Cubes */}
          {editingCubeIndex === null && addingType === null ? (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'sections' | 'cubes')} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="sections" className="gap-1.5">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Cards
                </TabsTrigger>
                <TabsTrigger value="cubes" className="gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Cubes
                </TabsTrigger>
              </TabsList>

              {/* Sections Tab - Toggle visibility */}
              <TabsContent value="sections" className="mt-4 space-y-2">
                <p className="text-xs text-muted-foreground mb-3">
                  Toggle which cards appear on your dashboard
                </p>
                {availableSections.map(section => {
                  const config = sections.find(s => s.key === section.key);
                  const isVisible = config?.isVisible ?? true;
                  
                  return (
                    <div 
                      key={section.key}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{section.label}</p>
                        <p className="text-xs text-muted-foreground truncate">{section.description}</p>
                      </div>
                      <Switch
                        checked={isVisible}
                        onCheckedChange={() => toggleSectionVisibility(section.key)}
                      />
                    </div>
                  );
                })}
              </TabsContent>

              {/* Cubes Tab - Add/Edit cubes */}
              <TabsContent value="cubes" className="mt-4">
                <p className="text-xs text-muted-foreground mb-3">
                  Add quick-glance cubes for sales, checklists, or tasks
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {activeCubes.map((cube, index) => (
                    <div key={cube.id || `new-${index}`}>
                      {renderCubePreview(cube, index)}
                    </div>
                  ))}
                  
                  {/* Add Cube Button */}
                  <Button
                    variant="outline"
                    className="aspect-square h-auto flex flex-col gap-2 border-dashed"
                    onClick={() => setAddingType('data')}
                  >
                    <Plus className="h-6 w-6" />
                    <span className="text-xs">Add</span>
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          ) : addingType !== null ? (
            /* Selecting what type of cube to add */
            <div className="space-y-4">
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2"
                onClick={() => setAddingType(null)}
              >
                ← Back
              </Button>

              <Tabs defaultValue="data" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="data" className="gap-1 text-xs">
                    <BarChart3 className="h-3 w-3" />
                    Data
                  </TabsTrigger>
                  <TabsTrigger value="checklist" className="gap-1 text-xs">
                    <ClipboardCheck className="h-3 w-3" />
                    Checklist
                  </TabsTrigger>
                  <TabsTrigger value="task" className="gap-1 text-xs">
                    <ListTodo className="h-3 w-3" />
                    Task
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="data" className="mt-4">
                  <Button
                    variant="outline"
                    className="w-full h-20 flex flex-col gap-2"
                    onClick={handleAddDataCube}
                  >
                    <BarChart3 className="h-6 w-6" />
                    <span>Add Data Cube</span>
                  </Button>
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Display sales, labor, and other metrics
                  </p>
                </TabsContent>

                <TabsContent value="checklist" className="mt-4 space-y-2">
                  {checklists.filter(c => !addedChecklistIds.includes(c.id)).map(checklist => (
                    <Button
                      key={checklist.id}
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={() => handleAddChecklistCube(checklist.id, checklist.title)}
                    >
                      <ClipboardCheck className="h-4 w-4" />
                      <span className="truncate">{checklist.title}</span>
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {checklist.frequency}
                      </Badge>
                    </Button>
                  ))}
                  {checklists.filter(c => !addedChecklistIds.includes(c.id)).length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      All checklists have been added
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="task" className="mt-4 space-y-2">
                  {tasks.filter(t => !addedTaskIds.includes(t.id)).map(task => (
                    <Button
                      key={task.id}
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={() => handleAddTaskCube(task.id, task.title)}
                    >
                      <ListTodo className="h-4 w-4" />
                      <span className="truncate">{task.title}</span>
                    </Button>
                  ))}
                  {tasks.filter(t => !addedTaskIds.includes(t.id)).length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No active tasks available to add
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          ) : editingCube && !editingCube.toDelete ? (
            /* Editing Single Cube */
            <div className="space-y-4">
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2"
                onClick={() => setEditingCubeIndex(null)}
              >
                ← Back to cubes
              </Button>

              {/* Title */}
              <div className="space-y-2">
                <Label>Cube Title</Label>
                <Input
                  value={editingCube.title}
                  onChange={(e) => updateCube(editingCubeIndex, { title: e.target.value })}
                  placeholder={editingCube.cubeType === 'data' ? "e.g., Sales Snapshot" : ""}
                  disabled={editingCube.cubeType !== 'data'}
                />
              </div>

              {/* Accent Color */}
              <div className="space-y-2">
                <Label>Color</Label>
                <Select 
                  value={editingCube.accentColor} 
                  onValueChange={(v) => updateCube(editingCubeIndex, { accentColor: v })}
                >
                  <SelectTrigger>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-4 h-4 rounded-full" 
                        style={{ backgroundColor: editingCube.accentColor }}
                      />
                      <SelectValue />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {ACCENT_COLORS.map(color => (
                      <SelectItem key={color.value} value={color.value}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: color.value }}
                          />
                          {color.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Metrics Selection (only for data cubes) */}
              {editingCube.cubeType === 'data' && (
                <div className="space-y-3">
                  <Label>
                    Metrics ({editingCube.metrics.length}/3)
                  </Label>
                  
                  {editingCube.metrics.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {editingCube.metrics.map(metric => (
                        <Badge key={metric} variant="secondary" className="gap-1">
                          {METRIC_CONFIGS[metric].shortLabel}
                          <X 
                            className="h-3 w-3 cursor-pointer" 
                            onClick={() => toggleMetric(editingCubeIndex, metric)}
                          />
                        </Badge>
                      ))}
                    </div>
                  )}
                  
                  <div className="space-y-4 max-h-48 overflow-y-auto">
                    {METRIC_GROUPS.map((group) => (
                      <div key={group.label}>
                        <h4 className="text-xs font-medium text-muted-foreground mb-1">{group.label}</h4>
                        <div className="space-y-1">
                          {group.metrics.map((metric) => {
                            const config = METRIC_CONFIGS[metric];
                            const isSelected = editingCube.metrics.includes(metric);
                            const isDisabled = !isSelected && editingCube.metrics.length >= 3;
                            
                            return (
                              <button
                                key={metric}
                                className={`w-full flex items-center gap-2 p-2 rounded text-left text-sm transition-colors ${
                                  isSelected 
                                    ? 'bg-primary/10 border border-primary/30' 
                                    : isDisabled
                                      ? 'opacity-50 cursor-not-allowed'
                                      : 'hover:bg-muted'
                                }`}
                                onClick={() => !isDisabled && toggleMetric(editingCubeIndex, metric)}
                                disabled={isDisabled}
                              >
                                <span className="flex-1">{config.shortLabel}</span>
                                {isSelected && <Badge variant="secondary" className="text-[10px]">Selected</Badge>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Delete Button */}
              <Button
                variant="destructive"
                size="sm"
                className="w-full gap-2"
                onClick={() => handleDeleteCube(editingCubeIndex)}
              >
                <Trash2 className="h-4 w-4" />
                Remove Cube
              </Button>
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}