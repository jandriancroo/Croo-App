import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Check, ArrowLeft, LineChart, LayoutGrid } from "lucide-react";
import { 
  MetricType, 
  METRIC_CONFIGS, 
  METRIC_GROUPS,
  WidgetSize,
} from "./DashboardWidget";
import { CubeType } from "./AddWidgetDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

export interface CubeConfig {
  id: string;
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  cubeType: CubeType;
}

interface EditDashboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cubes: CubeConfig[];
  onUpdateCube: (id: string, updates: Partial<CubeConfig>) => Promise<void>;
  onDeleteCube: (id: string) => Promise<void>;
  onAddCube: () => void;
}

type View = 'list' | 'edit';

export function EditDashboardDialog({
  open,
  onOpenChange,
  cubes,
  onUpdateCube,
  onDeleteCube,
  onAddCube,
}: EditDashboardDialogProps) {
  const [view, setView] = useState<View>('list');
  const [editingCube, setEditingCube] = useState<CubeConfig | null>(null);
  const [editForm, setEditForm] = useState<Partial<CubeConfig>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setView('list');
      setEditingCube(null);
      setEditForm({});
    }
  }, [open]);

  const handleEditCube = (cube: CubeConfig) => {
    setEditingCube(cube);
    setEditForm({
      title: cube.title,
      metrics: [...cube.metrics],
      accentColor: cube.accentColor,
    });
    setView('edit');
  };

  const handleBack = () => {
    setView('list');
    setEditingCube(null);
    setEditForm({});
  };

  const toggleMetric = (metric: MetricType) => {
    if (!editingCube) return;
    
    const maxMetrics = editingCube.size === 'small' ? 3 : editingCube.size === 'medium' ? 4 : 6;
    const currentMetrics = editForm.metrics || [];
    
    if (currentMetrics.includes(metric)) {
      setEditForm(prev => ({ ...prev, metrics: currentMetrics.filter(m => m !== metric) }));
    } else if (currentMetrics.length < maxMetrics) {
      setEditForm(prev => ({ ...prev, metrics: [...currentMetrics, metric] }));
    }
  };

  const handleSave = async () => {
    if (!editingCube) return;
    
    setIsSaving(true);
    try {
      await onUpdateCube(editingCube.id, editForm);
      handleBack();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await onDeleteCube(deleteId);
    setDeleteId(null);
  };

  const handleAddClick = () => {
    onOpenChange(false);
    // Small delay to let dialog close
    setTimeout(() => onAddCube(), 100);
  };

  const maxMetrics = editingCube 
    ? (editingCube.size === 'small' ? 3 : editingCube.size === 'medium' ? 4 : 6)
    : 3;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {view === 'edit' && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 w-8 p-0"
                  onClick={handleBack}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              {view === 'list' ? 'Edit Dashboard' : 'Edit Widget'}
            </DialogTitle>
          </DialogHeader>

          {/* List View */}
          {view === 'list' && (
            <div className="flex-1 flex flex-col min-h-0">
              <ScrollArea className="flex-1 -mx-6 px-6">
                <div className="space-y-2 pb-4">
                  {cubes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No widgets yet. Add one to get started!
                    </p>
                  ) : (
                    cubes.map(cube => (
                      <div
                        key={cube.id}
                        className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors"
                        onClick={() => handleEditCube(cube)}
                      >
                        {/* Color indicator */}
                        <div 
                          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: cube.accentColor }}
                        >
                          {cube.cubeType === 'sales-chart' ? (
                            <LineChart className="h-5 w-5 text-white" />
                          ) : (
                            <LayoutGrid className="h-5 w-5 text-white" />
                          )}
                        </div>
                        
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {cube.title || (cube.cubeType === 'sales-chart' ? 'Sales Overview' : 'Data Cube')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {cube.cubeType === 'sales-chart' 
                              ? 'Full sales chart' 
                              : `${cube.size} · ${cube.metrics.length} metrics`}
                          </p>
                        </div>
                        
                        {/* Delete button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteId(cube.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
              
              {/* Add button */}
              <Button 
                onClick={handleAddClick}
                className="w-full mt-4"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Widget
              </Button>
            </div>
          )}

          {/* Edit View */}
          {view === 'edit' && editingCube && (
            <div className="space-y-4">
              {/* Title - only for non-sales-chart types */}
              {editingCube.cubeType !== 'sales-chart' && (
                <div className="space-y-2">
                  <Label htmlFor="edit-title">Title</Label>
                  <Input
                    id="edit-title"
                    placeholder="e.g., Today's Sales"
                    value={editForm.title || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                  />
                </div>
              )}

              {/* Metrics Selection - only for data cubes */}
              {editingCube.cubeType === 'data' && (
                <div className="space-y-2">
                  <Label>
                    Metrics 
                    <span className="text-muted-foreground font-normal ml-1">
                      ({(editForm.metrics || []).length}/{maxMetrics})
                    </span>
                  </Label>
                  
                  <ScrollArea className="h-[200px] -mx-2 px-2">
                    {METRIC_GROUPS.map(group => (
                      <div key={group.label} className="space-y-1 mb-2">
                        <p className="text-xs text-muted-foreground">{group.label}</p>
                        <div className="flex flex-wrap gap-1">
                          {group.metrics.map(metric => {
                            const isSelected = (editForm.metrics || []).includes(metric);
                            const conf = METRIC_CONFIGS[metric];
                            return (
                              <Badge
                                key={metric}
                                variant={isSelected ? "default" : "outline"}
                                className={`cursor-pointer text-xs ${
                                  isSelected 
                                    ? 'bg-primary' 
                                    : 'hover:bg-accent'
                                }`}
                                onClick={() => toggleMetric(metric)}
                              >
                                {isSelected && <Check className="h-3 w-3 mr-1" />}
                                {conf.shortLabel}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </ScrollArea>
                </div>
              )}

              {/* Color Selection */}
              <div className="space-y-2">
                <Label>Accent Color</Label>
                <div className="flex flex-wrap gap-2">
                  {ACCENT_COLORS.map(color => (
                    <button
                      key={color.value}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        editForm.accentColor === color.value 
                          ? 'border-foreground scale-110' 
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: color.value }}
                      onClick={() => setEditForm(prev => ({ ...prev, accentColor: color.value }))}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>

              {/* Save button */}
              <Button
                onClick={handleSave}
                disabled={isSaving || (editingCube.cubeType === 'data' && (editForm.metrics || []).length === 0)}
                className="w-full"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this widget?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the widget from your dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}