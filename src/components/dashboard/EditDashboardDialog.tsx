import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Check, ArrowLeft, LineChart, LayoutGrid, Minus, Box, GripVertical } from "lucide-react";
import { DndContext, closestCenter, DragEndEvent, useSensor, useSensors, PointerSensor, KeyboardSensor } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { THEME_COLORS, ThemeColorKey, migrateAccentColor, getThemeColorClass, isThemeColorKey } from "@/utils/themeColors";

export interface CubeConfig {
  id: string;
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  cubeType: CubeType | 'data-3d';
  // 3D cube specific
  faceMetrics?: MetricType[][];
  faceTitles?: string[];
  numFaces?: number;
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
  
  // 3D cube specific state
  const [activeFace, setActiveFace] = useState(0);
  const [faceMetrics, setFaceMetrics] = useState<MetricType[][]>([[], [], [], []]);
  const [faceTitles, setFaceTitles] = useState<string[]>(['', '', '', '']);
  const [numFaces, setNumFaces] = useState(2);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setView('list');
      setEditingCube(null);
      setEditForm({});
      setActiveFace(0);
      setFaceMetrics([[], [], [], []]);
      setFaceTitles(['', '', '', '']);
      setNumFaces(2);
    }
  }, [open]);

  // Get all valid metrics from METRIC_GROUPS (excludes legacy types)
  const validMetrics = METRIC_GROUPS.flatMap(g => g.metrics);
  
  const handleEditCube = (cube: CubeConfig) => {
    setEditingCube(cube);
    
    // Migrate legacy hex colors to theme color keys
    const themeColor = isThemeColorKey(cube.accentColor) 
      ? cube.accentColor 
      : migrateAccentColor(cube.accentColor);
    
    if (cube.cubeType === 'data-3d') {
      // Initialize 3D cube editing state
      const faces = cube.faceMetrics || [[], [], [], []];
      const titles = cube.faceTitles || ['', '', '', ''];
      setFaceMetrics([
        faces[0] || [],
        faces[1] || [],
        faces[2] || [],
        faces[3] || [],
      ]);
      setFaceTitles([
        titles[0] || '',
        titles[1] || '',
        titles[2] || '',
        titles[3] || '',
      ]);
      setNumFaces(cube.numFaces || 1);
      setActiveFace(0);
      setEditForm({
        title: cube.title,
        accentColor: themeColor,
      });
    } else {
      // Filter out any legacy metrics that aren't in METRIC_GROUPS
      const filteredMetrics = cube.metrics.filter(m => validMetrics.includes(m));
      setEditForm({
        title: cube.title,
        metrics: filteredMetrics,
        accentColor: themeColor,
      });
    }
    setView('edit');
  };

  const handleBack = () => {
    setView('list');
    setEditingCube(null);
    setEditForm({});
    setActiveFace(0);
    setFaceMetrics([[], [], [], []]);
    setFaceTitles(['', '', '', '']);
    setNumFaces(2);
  };

  const toggleMetric = (metric: MetricType) => {
    if (!editingCube) return;
    
    if (editingCube.cubeType === 'data-3d') {
      // 3D cube: toggle metric on current face
      const currentFaceMetrics = faceMetrics[activeFace];
      const maxMetrics = 5; // 4 corners + 1 center
      
      if (currentFaceMetrics.includes(metric)) {
        const updated = [...faceMetrics];
        updated[activeFace] = currentFaceMetrics.filter(m => m !== metric);
        setFaceMetrics(updated);
      } else if (currentFaceMetrics.length < maxMetrics) {
        const updated = [...faceMetrics];
        updated[activeFace] = [...currentFaceMetrics, metric];
        setFaceMetrics(updated);
      }
    } else {
      // Regular data cube
      const maxMetrics = editingCube.size === 'small' ? 3 : editingCube.size === 'medium' ? 4 : 6;
      const currentMetrics = editForm.metrics || [];
      
      if (currentMetrics.includes(metric)) {
        setEditForm(prev => ({ ...prev, metrics: currentMetrics.filter(m => m !== metric) }));
      } else if (currentMetrics.length < maxMetrics) {
        setEditForm(prev => ({ ...prev, metrics: [...currentMetrics, metric] }));
      }
    }
  };
  
  // Check if a metric is used on another face (for 3D cubes)
  const isMetricUsedElsewhere = (metric: MetricType) => {
    return faceMetrics.some((face, idx) => idx !== activeFace && idx < numFaces && face.includes(metric));
  };

  const handleSave = async () => {
    if (!editingCube) return;
    
    setIsSaving(true);
    try {
      if (editingCube.cubeType === 'data-3d') {
        // Save 3D cube with face metrics and titles
        await onUpdateCube(editingCube.id, {
          ...editForm,
          faceMetrics: faceMetrics.slice(0, numFaces),
          faceTitles: faceTitles.slice(0, numFaces),
          numFaces,
        });
      } else {
        await onUpdateCube(editingCube.id, editForm);
      }
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
                          ) : cube.cubeType === 'data-3d' ? (
                            <Box className="h-5 w-5 text-white" />
                          ) : (
                            <LayoutGrid className="h-5 w-5 text-white" />
                          )}
                        </div>
                        
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {cube.title || (cube.cubeType === 'sales-chart'
                              ? 'Sales Overview'
                              : cube.cubeType === 'data-3d'
                                ? '3D Data Cube'
                                : 'Data Cube')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {cube.cubeType === 'sales-chart' 
                              ? 'Full sales chart' 
                              : cube.cubeType === 'data-3d'
                                ? `${cube.numFaces || 1} face${(cube.numFaces || 1) > 1 ? 's' : ''} · ${(cube.faceMetrics || []).flat().length} metrics`
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
              {/* Widget Label - for all cube types */}
              <div className="space-y-2">
                <Label htmlFor="edit-title">
                  {editingCube.cubeType === 'data' ? 'Title' : 'Label'}
                </Label>
                <Input
                  id="edit-title"
                  placeholder={
                    editingCube.cubeType === 'sales-chart' 
                      ? 'e.g., Sales Overview' 
                      : editingCube.cubeType === 'data-3d'
                        ? 'e.g., Main Cube, Labor Cube'
                        : 'e.g., Today\'s Sales'
                  }
                  value={editForm.title || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                />
                {editingCube.cubeType !== 'data' && (
                  <p className="text-[11px] text-muted-foreground">
                    A name to identify this widget in the edit list
                  </p>
                )}
              </div>

              {/* Metrics Selection - only for flat data cubes */}
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

              {/* 3D Cube Configuration */}
              {editingCube.cubeType === 'data-3d' && (
                <div className="space-y-4">
                  {/* Number of Faces */}
                  <div className="space-y-2">
                    <Label>Number of Faces</Label>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setNumFaces(Math.max(1, numFaces - 1))}
                        disabled={numFaces <= 1}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4].map(n => (
                          <div
                            key={n}
                            className={`w-3 h-1 rounded-full transition-all ${
                              n <= numFaces ? 'bg-primary' : 'bg-muted'
                            }`}
                          />
                        ))}
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setNumFaces(Math.min(4, numFaces + 1))}
                        disabled={numFaces >= 4}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground ml-2">
                        {numFaces === 1 ? 'No rotation' : `${numFaces} faces`}
                      </span>
                    </div>
                  </div>

                  {/* Face Tabs */}
                  <div className="space-y-2">
                    <Label>Configure Faces</Label>
                    <Tabs value={String(activeFace)} onValueChange={(v) => setActiveFace(Number(v))}>
                      <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${numFaces}, 1fr)` }}>
                        {Array.from({ length: numFaces }).map((_, idx) => (
                          <TabsTrigger key={idx} value={String(idx)} className="text-xs">
                            Face {idx + 1}
                            {faceMetrics[idx].length > 0 && (
                              <span className="ml-1 text-[10px] opacity-70">
                                ({faceMetrics[idx].length})
                              </span>
                            )}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                      
                      {Array.from({ length: numFaces }).map((_, idx) => (
                        <TabsContent key={idx} value={String(idx)} className="mt-3">
                          <ScrollArea className="h-[200px] -mx-2 px-2">
                            <div className="space-y-3">
                              {/* Per-face title */}
                              <div className="space-y-1.5">
                                <Label className="text-xs">Face {idx + 1} Title</Label>
                                <Input
                                  placeholder={`e.g., ${idx === 0 ? 'Daily' : idx === 1 ? 'Weekly' : idx === 2 ? 'Monthly' : 'Overview'}`}
                                  value={faceTitles[idx]}
                                  onChange={(e) => {
                                    const updated = [...faceTitles];
                                    updated[idx] = e.target.value;
                                    setFaceTitles(updated);
                                  }}
                                  className="h-8 text-sm"
                                />
                              </div>
                              
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">
                                  Select up to 5 metrics (4 corners + 1 center)
                                </span>
                                <span className="text-xs font-medium">
                                  {faceMetrics[idx].length}/4
                                </span>
                              </div>
                              
                              {METRIC_GROUPS.map(group => (
                                <div key={group.label} className="space-y-1">
                                  <p className="text-xs text-muted-foreground">{group.label}</p>
                                  <div className="flex flex-wrap gap-1">
                                    {group.metrics.map(metric => {
                                      const isSelected = faceMetrics[idx].includes(metric);
                                      const usedElsewhere = isMetricUsedElsewhere(metric);
                                      const conf = METRIC_CONFIGS[metric];
                                      return (
                                        <Badge
                                          key={metric}
                                          variant={isSelected ? "default" : "outline"}
                                          className={`cursor-pointer text-xs transition-all ${
                                            isSelected 
                                              ? 'bg-primary' 
                                              : usedElsewhere
                                                ? 'opacity-40'
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
                            </div>
                          </ScrollArea>
                        </TabsContent>
                      ))}
                    </Tabs>
                  </div>
                </div>
              )}

              {/* Color Selection */}
              <div className="space-y-2">
                <Label>Accent Color</Label>
                <div className="flex flex-wrap gap-2">
                  {THEME_COLORS.map(color => (
                    <button
                      key={color.key}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${getThemeColorClass(color.key)} ${
                        editForm.accentColor === color.key 
                          ? 'border-foreground scale-110 ring-2 ring-offset-2 ring-primary' 
                          : 'border-transparent hover:scale-105'
                      }`}
                      onClick={() => setEditForm(prev => ({ ...prev, accentColor: color.key }))}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>

              {/* Save button */}
              <Button
                onClick={handleSave}
                disabled={isSaving || (editingCube.cubeType === 'data' && (editForm.metrics || []).length === 0) || (editingCube.cubeType === 'data-3d' && faceMetrics.slice(0, numFaces).every(f => f.length === 0))}
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