import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, GripVertical, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { DataCube, MetricType, METRIC_CONFIGS, METRIC_GROUPS, SalesDataForCubes } from "./DataCube";

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

interface CubeConfig {
  id?: string;
  title: string;
  metrics: MetricType[];
  accentColor: string;
  displayOrder: number;
  isNew?: boolean;
  toDelete?: boolean;
}

interface EditDashboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  existingCubes: CubeConfig[];
  onSave: () => void;
  salesData: SalesDataForCubes | null;
}

export function EditDashboardDialog({ 
  open, 
  onOpenChange, 
  locationId, 
  existingCubes,
  onSave,
  salesData
}: EditDashboardDialogProps) {
  const { user } = useAuth();
  const [cubes, setCubes] = useState<CubeConfig[]>([]);
  const [editingCubeIndex, setEditingCubeIndex] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setCubes(existingCubes.map((c, i) => ({ ...c, displayOrder: i })));
      setEditingCubeIndex(null);
    }
  }, [open, existingCubes]);

  const handleAddCube = () => {
    const newCube: CubeConfig = {
      title: "",
      metrics: [],
      accentColor: ACCENT_COLORS[cubes.filter(c => !c.toDelete).length % ACCENT_COLORS.length].value,
      displayOrder: cubes.length,
      isNew: true,
    };
    setCubes([...cubes, newCube]);
    setEditingCubeIndex(cubes.length);
  };

  const handleDeleteCube = (index: number) => {
    const cube = cubes[index];
    if (cube.id) {
      // Mark existing cube for deletion
      setCubes(cubes.map((c, i) => i === index ? { ...c, toDelete: true } : c));
    } else {
      // Remove new cube entirely
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
      // Remove metric
      updateCube(index, { metrics: currentMetrics.filter(m => m !== metric) });
    } else if (currentMetrics.length < 3) {
      // Add metric (max 3)
      updateCube(index, { metrics: [...currentMetrics, metric] });
    } else {
      toast.error("Maximum 3 metrics per cube");
    }
  };

  const handleSave = async () => {
    if (!user?.id || !locationId) return;
    
    setIsSubmitting(true);
    
    try {
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
      
      // Validate cubes have at least one metric
      const invalidCubes = toSave.filter(c => c.metrics.length === 0);
      if (invalidCubes.length > 0) {
        toast.error("Each cube must have at least one metric");
        setIsSubmitting(false);
        return;
      }

      // Delete all existing cubes for this user/location and recreate
      // This is simpler than trying to track updates
      const existingIds = existingCubes.filter(c => c.id).map(c => c.id!);
      if (existingIds.length > 0) {
        await supabase
          .from('user_dashboard_cubes')
          .delete()
          .eq('user_id', user.id)
          .eq('location_id', locationId);
      }

      // Insert all cubes with new order
      if (toSave.length > 0) {
        const records = toSave.map((cube, index) => ({
          user_id: user.id,
          location_id: locationId,
          display_order: index,
          title: cube.title || null,
          metrics: cube.metrics,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Dashboard</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Cube List / Grid Preview */}
          {editingCubeIndex === null ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {activeCubes.map((cube, index) => (
                  <div key={cube.id || `new-${index}`} className="relative">
                    <DataCube
                      title={cube.title}
                      metrics={cube.metrics}
                      accentColor={cube.accentColor}
                      salesData={salesData}
                      onClick={() => setEditingCubeIndex(cubes.indexOf(cube))}
                    />
                    {cube.metrics.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
                        <span className="text-xs text-muted-foreground">Tap to configure</span>
                      </div>
                    )}
                  </div>
                ))}
                
                {/* Add Cube Button */}
                <Button
                  variant="outline"
                  className="aspect-square h-auto flex flex-col gap-2 border-dashed"
                  onClick={handleAddCube}
                >
                  <Plus className="h-6 w-6" />
                  <span className="text-xs">Add Cube</span>
                </Button>
              </div>
              
              {activeCubes.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No data cubes yet. Add one to display key metrics at a glance.
                </p>
              )}
            </>
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
                <Label>Cube Title (optional)</Label>
                <Input
                  value={editingCube.title}
                  onChange={(e) => updateCube(editingCubeIndex, { title: e.target.value })}
                  placeholder="e.g., Sales Snapshot"
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

              {/* Metrics Selection */}
              <div className="space-y-3">
                <Label>
                  Metrics ({editingCube.metrics.length}/3)
                </Label>
                
                {/* Selected metrics */}
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

                {/* Grouped metric options */}
                {METRIC_GROUPS.map(group => (
                  <div key={group.label} className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">{group.label}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {group.metrics.map(metric => {
                        const isSelected = editingCube.metrics.includes(metric);
                        const isDisabled = !isSelected && editingCube.metrics.length >= 3;
                        
                        return (
                          <div key={metric} className="flex items-center gap-2">
                            <Checkbox
                              id={`metric-${metric}`}
                              checked={isSelected}
                              disabled={isDisabled}
                              onCheckedChange={() => toggleMetric(editingCubeIndex, metric)}
                            />
                            <label
                              htmlFor={`metric-${metric}`}
                              className={`text-sm cursor-pointer ${isDisabled ? 'opacity-50' : ''}`}
                            >
                              {METRIC_CONFIGS[metric].label}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Preview */}
              <div className="space-y-2">
                <Label>Preview</Label>
                <div className="w-32 mx-auto">
                  <DataCube
                    title={editingCube.title}
                    metrics={editingCube.metrics}
                    accentColor={editingCube.accentColor}
                    salesData={salesData}
                  />
                </div>
              </div>

              {/* Delete button */}
              <Button
                variant="destructive"
                size="sm"
                className="w-full gap-2"
                onClick={() => handleDeleteCube(editingCubeIndex)}
              >
                <Trash2 className="h-4 w-4" />
                Delete Cube
              </Button>
            </div>
          ) : null}
        </div>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Dashboard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
