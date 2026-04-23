import { useRef, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Check, ArrowLeft, Minus, Box, GripVertical, LineChart, ClipboardCheck, Trophy, Upload, X, Crop, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DndContext, closestCenter } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { 
  MetricType, 
  METRIC_CONFIGS, 
  METRIC_GROUPS,
  WidgetSize,
} from "./DashboardWidget";
import { CubeType, TrackerDisplayMode, TrackerRankMetric, TrackerScopeType } from "./AddWidgetDialog";
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
import { THEME_COLORS, migrateAccentColor, getThemeColorClass, isThemeColorKey } from "@/utils/themeColors";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { TrackerPosItemPicker } from "./TrackerPosItemPicker";
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { supabase } from "@/integrations/supabase/client";

export type SectionKey = 'data-cubes' | 'sales-chart' | 'checklists';

export const DEFAULT_SECTION_ORDER: SectionKey[] = ['data-cubes', 'checklists', 'sales-chart'];

export function getSectionOrder(locationId: string): SectionKey[] {
  const key = `dashboard-section-order-${locationId}`;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as SectionKey[];
      // Ensure all sections are present
      const allSections: SectionKey[] = ['data-cubes', 'sales-chart', 'checklists'];
      const valid = parsed.filter(s => allSections.includes(s));
      allSections.forEach(s => { if (!valid.includes(s)) valid.push(s); });
      return valid;
    } catch { return DEFAULT_SECTION_ORDER; }
  }
  return DEFAULT_SECTION_ORDER;
}

export function saveSectionOrder(locationId: string, order: SectionKey[]) {
  localStorage.setItem(`dashboard-section-order-${locationId}`, JSON.stringify(order));
}

export interface CubeConfig {
  id: string;
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  cubeType: CubeType | 'data-3d';
  trackerScope?: { type: TrackerScopeType; role?: string };
  trackerDisplayMode?: TrackerDisplayMode;
  trackerItemRefs?: string[];
  trackerPromoStart?: string | null;
  trackerPromoEnd?: string | null;
  trackerPromoImageUrl?: string | null;
  trackerLocationRefs?: string[];
  trackerRankMetrics?: TrackerRankMetric[];
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
  onReorderCubes?: (orderedIds: string[]) => Promise<void>;
  onSectionOrderChange?: (order: SectionKey[]) => void;
}

// Sortable section row (top-level sections: data-cubes, sales-chart, checklists)
function SortableSectionRow({ sectionKey, children }: { sectionKey: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sectionKey });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative">
      <div
        {...attributes}
        {...listeners}
        className="absolute left-0 top-4 z-10 flex h-7 w-7 cursor-grab items-center justify-center rounded-md border bg-background/95 text-muted-foreground/60 shadow-sm transition-colors hover:bg-accent active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </div>
      <div className="min-w-0 pl-9">{children}</div>
    </div>
  );
}

// Sortable cube row within data cubes section
function SortableCubeRow({ cube, onEdit, onDelete }: { cube: CubeConfig; onEdit: (cube: CubeConfig) => void; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cube.id });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const accentBg = isThemeColorKey(cube.accentColor) ? undefined : cube.accentColor;
  const accentClass = isThemeColorKey(cube.accentColor) ? getThemeColorClass(cube.accentColor) : '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors hover:bg-accent/50"
      onClick={() => onEdit(cube)}
    >
      <div
        {...attributes}
        {...listeners}
        className="flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
      </div>
      <div 
        className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${accentClass}`}
        style={accentBg ? { backgroundColor: accentBg } : undefined}
      >
        {cube.cubeType === 'tracker' ? <Trophy className="h-4 w-4 text-white" /> : <Box className="h-4 w-4 text-white" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">
          {cube.title || '3D Data Cube'}
        </p>
        <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
          {cube.cubeType === 'data-3d'
            ? `${cube.numFaces || 1} face${(cube.numFaces || 1) > 1 ? 's' : ''} · ${(cube.faceMetrics || []).flat().length} metrics`
            : cube.cubeType === 'tracker'
              ? `${cube.trackerDisplayMode === 'expandable' ? 'Expandable' : 'My rank'} · DAY/WTD/Promo`
              : `${cube.size} · ${cube.metrics.length} metrics`}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
        onClick={(e) => { e.stopPropagation(); onDelete(cube.id); }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

type View = 'list' | 'edit';

export function EditDashboardDialog({
  open,
  onOpenChange,
  cubes,
  onUpdateCube,
  onDeleteCube,
  onAddCube,
  onReorderCubes,
  onSectionOrderChange,
}: EditDashboardDialogProps) {
  const promoImageInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>('list');
  const [editingCube, setEditingCube] = useState<CubeConfig | null>(null);
  const [editForm, setEditForm] = useState<Partial<CubeConfig>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [promoImageToCrop, setPromoImageToCrop] = useState('');
  const [promoCropDialogOpen, setPromoCropDialogOpen] = useState(false);
  const [isPromoImageUploading, setIsPromoImageUploading] = useState(false);
  const { currentLocation } = useAppLocation();
  
  // Section order state
  const [sectionOrder, setSectionOrder] = useState<SectionKey[]>(DEFAULT_SECTION_ORDER);
  
  // Load section order when dialog opens
  useEffect(() => {
    if (open && currentLocation?.id) {
      setSectionOrder(getSectionOrder(currentLocation.id));
    }
  }, [open, currentLocation?.id]);
  
  // 3D cube specific state
  const [activeFace, setActiveFace] = useState(0);
  const [faceMetrics, setFaceMetrics] = useState<MetricType[][]>([[], [], [], []]);
  const [faceTitles, setFaceTitles] = useState<string[]>(['', '', '', '']);
  const [numFaces, setNumFaces] = useState(2);

  // Local cube order state for optimistic updates
  const [localCubes, setLocalCubes] = useState<CubeConfig[]>(cubes);
  useEffect(() => { setLocalCubes(cubes); }, [cubes]);

  // Drag-and-drop reorder for data cubes within data-cubes section
  const dataCubes = localCubes.filter(c => c.cubeType === 'data' || c.cubeType === 'data-3d' || c.cubeType === 'tracker');
  const salesChart = localCubes.find(c => c.cubeType === 'sales-chart');
  
  const handleCubeDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    
    const oldIndex = dataCubes.findIndex(c => c.id === active.id);
    const newIndex = dataCubes.findIndex(c => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    
    const reorderedDataCubes = arrayMove(dataCubes, oldIndex, newIndex);
    
    // Optimistically update local state
    const dataCubeIds = new Set(dataCubes.map(c => c.id));
    const newLocalCubes: CubeConfig[] = [];
    let dataIdx = 0;
    for (const cube of localCubes) {
      if (dataCubeIds.has(cube.id)) {
        newLocalCubes.push(reorderedDataCubes[dataIdx]);
        dataIdx++;
      } else {
        newLocalCubes.push(cube);
      }
    }
    setLocalCubes(newLocalCubes);
    
    // Persist to DB
    onReorderCubes?.(newLocalCubes.map(c => c.id));
  };
  
  // Section reorder handler
  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    
    const oldIndex = sectionOrder.indexOf(active.id as SectionKey);
    const newIndex = sectionOrder.indexOf(over.id as SectionKey);
    if (oldIndex === -1 || newIndex === -1) return;
    
    const newOrder = arrayMove(sectionOrder, oldIndex, newIndex);
    setSectionOrder(newOrder);
    if (currentLocation?.id) {
      saveSectionOrder(currentLocation.id, newOrder);
    }
    onSectionOrderChange?.(newOrder);
  };

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
    
    if (cube.cubeType === 'tracker') {
      setEditForm({
        title: cube.title,
        accentColor: themeColor,
        trackerScope: cube.trackerScope || { type: 'location' },
        trackerDisplayMode: cube.trackerDisplayMode || 'summary',
        trackerItemRefs: cube.trackerItemRefs || [],
        trackerPromoStart: cube.trackerPromoStart || null,
        trackerPromoEnd: cube.trackerPromoEnd || null,
        trackerPromoImageUrl: cube.trackerPromoImageUrl || null,
        trackerLocationRefs: cube.trackerLocationRefs || [],
        trackerRankMetrics: cube.trackerRankMetrics || ['units', 'sales', 'pmix'],
      });
    } else if (cube.cubeType === 'data-3d') {
      const faces = cube.faceMetrics || [[], [], [], []];
      const titles = cube.faceTitles || ['', '', '', ''];
      setFaceMetrics([faces[0] || [], faces[1] || [], faces[2] || [], faces[3] || []]);
      setFaceTitles([titles[0] || '', titles[1] || '', titles[2] || '', titles[3] || '']);
      setNumFaces(cube.numFaces || 1);
      setActiveFace(0);
      setEditForm({ title: cube.title, accentColor: themeColor });
    } else {
      const filteredMetrics = cube.metrics.filter(m => validMetrics.includes(m));
      setEditForm({ title: cube.title, metrics: filteredMetrics, accentColor: themeColor });
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
    setPromoCropDialogOpen(false);
    setPromoImageToCrop('');
  };

  const toggleMetric = (metric: MetricType) => {
    if (!editingCube) return;
    
    if (editingCube.cubeType === 'data-3d') {
      const currentFaceMetrics = faceMetrics[activeFace];
      const maxMetrics = 5;
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
      const maxMetrics = editingCube.size === 'small' ? 3 : editingCube.size === 'medium' ? 4 : 6;
      const currentMetrics = editForm.metrics || [];
      if (currentMetrics.includes(metric)) {
        setEditForm(prev => ({ ...prev, metrics: currentMetrics.filter(m => m !== metric) }));
      } else if (currentMetrics.length < maxMetrics) {
        setEditForm(prev => ({ ...prev, metrics: [...currentMetrics, metric] }));
      }
    }
  };
  
  const isMetricUsedElsewhere = (metric: MetricType) => {
    return faceMetrics.some((face, idx) => idx !== activeFace && idx < numFaces && face.includes(metric));
  };

  const handleSave = async () => {
    if (!editingCube) return;
    setIsSaving(true);
    try {
      if (editingCube.cubeType === 'data-3d') {
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
    setTimeout(() => onAddCube(), 100);
  };

  const handlePromoImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPromoImageToCrop(URL.createObjectURL(file));
    setPromoCropDialogOpen(true);
    event.target.value = '';
  };

  const handlePromoImageCropComplete = async (croppedBlob: Blob) => {
    setIsPromoImageUploading(true);
    try {
      const filePath = `promo-trackers/promo-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from('brand-assets')
        .upload(filePath, croppedBlob, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('brand-assets')
        .getPublicUrl(filePath);

      setEditForm(prev => ({ ...prev, trackerPromoImageUrl: data.publicUrl }));
      toast.success('Promo image uploaded');
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload promo image');
    } finally {
      setIsPromoImageUploading(false);
      if (promoImageToCrop.startsWith('blob:')) URL.revokeObjectURL(promoImageToCrop);
      setPromoImageToCrop('');
    }
  };

  const maxMetrics = editingCube 
    ? (editingCube.size === 'small' ? 3 : editingCube.size === 'medium' ? 4 : 6)
    : 3;

  // Build section items for the section-level DnD
  const sectionItems = sectionOrder.filter(s => {
    if (s === 'data-cubes') return dataCubes.length > 0;
    if (s === 'sales-chart') return !!salesChart;
    if (s === 'checklists') return true; // always show
    return false;
  });

  const renderSectionContent = (section: SectionKey) => {
    switch (section) {
      case 'data-cubes':
        return (
          <div className="space-y-2">
            <div className="p-3 rounded-lg border bg-accent/30">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center">
                  <Box className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">Data Cubes</p>
                  <p className="text-[11px] text-muted-foreground">{dataCubes.length} cube{dataCubes.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            </div>
            {/* Individual cubes within - separate from section DnD (rendered outside section context) */}
            <div className="space-y-1.5 pl-3">
              {dataCubes.map(cube => (
                <SortableCubeRow
                  key={cube.id}
                  cube={cube}
                  onEdit={handleEditCube}
                  onDelete={(id) => setDeleteId(id)}
                />
              ))}
            </div>
          </div>
        );
      case 'sales-chart':
        if (!salesChart) return null;
        return (
          <div
            className="flex items-center gap-2 p-3 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors"
            onClick={() => handleEditCube(salesChart)}
          >
            <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ backgroundColor: '#0D9488' }}>
              <LineChart className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{salesChart.title || 'Sales Overview'}</p>
              <p className="text-[11px] text-muted-foreground">Full sales chart</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
              onClick={(e) => { e.stopPropagation(); setDeleteId(salesChart.id); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      case 'checklists':
        return (
          <div className="p-3 rounded-lg border bg-accent/30">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center">
                <ClipboardCheck className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">Checklists</p>
                <p className="text-[11px] text-muted-foreground">All assigned checklists</p>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md flex-col overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)]">
          <DialogHeader className="shrink-0 border-b px-4 py-3">
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

          {/* List View - Section-based */}
          {view === 'list' && (
            <div className="flex-1 flex flex-col min-h-0">
              <ScrollArea className="flex-1 -mx-6 px-6">
                <div className="space-y-2 pb-4">
                  {cubes.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No widgets yet. Add one to get started!
                    </p>
                  )}
                  <DndContext
                    collisionDetection={closestCenter}
                    onDragEnd={(event) => {
                      const { active, over } = event;
                      if (!over || active.id === over.id) return;
                      // Determine if this is a section drag or cube drag
                      const isSectionDrag = sectionItems.includes(active.id as SectionKey);
                      if (isSectionDrag) {
                        handleSectionDragEnd(event);
                      } else {
                        handleCubeDragEnd(event);
                      }
                    }}
                  >
                    <SortableContext items={[...sectionItems, ...dataCubes.map(c => c.id)]} strategy={verticalListSortingStrategy}>
                      {sectionItems.map(section => (
                        <SortableSectionRow key={section} sectionKey={section}>
                          {renderSectionContent(section)}
                        </SortableSectionRow>
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              </ScrollArea>

              <div className="shrink-0 border-t px-4 py-3">
                <Button 
                  onClick={handleAddClick}
                  className="w-full"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Widget
                </Button>
              </div>
            </div>
          )}

          {/* Edit View */}
          {view === 'edit' && editingCube && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {/* Widget Label - for all cube types */}
              <div className="space-y-1.5">
                <Label htmlFor="edit-title">
                  {editingCube.cubeType === 'tracker' ? 'Promo Name' : editingCube.cubeType === 'data' ? 'Title' : 'Label'}
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
                  className="h-9"
                />
                {editingCube.cubeType !== 'data' && editingCube.cubeType !== 'tracker' && (
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

              {editingCube.cubeType === 'tracker' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-promo-start">Promo Start</Label>
                      <Input id="edit-promo-start" type="date" className="h-9" value={editForm.trackerPromoStart || ''} onChange={(e) => setEditForm(prev => ({ ...prev, trackerPromoStart: e.target.value || null }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-promo-end">Promo End</Label>
                      <Input id="edit-promo-end" type="date" className="h-9" value={editForm.trackerPromoEnd || ''} onChange={(e) => setEditForm(prev => ({ ...prev, trackerPromoEnd: e.target.value || null }))} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Promo Image</Label>
                    <input ref={promoImageInputRef} type="file" accept="image/*" className="hidden" onChange={handlePromoImageSelect} disabled={isPromoImageUploading} />
                    {editForm.trackerPromoImageUrl ? (
                      <div className="space-y-2">
                        <div className="relative h-[58px] overflow-hidden rounded-lg border bg-primary">
                          <img src={editForm.trackerPromoImageUrl} alt="Promo preview" className="absolute inset-0 h-full w-full object-cover" />
                          <div className="absolute inset-0 bg-background/30" />
                          <div className="absolute inset-0 bg-gradient-to-r from-background/35 via-background/10 to-background/35" />
                          <div className="absolute left-3 top-2 inline-flex max-w-[68%] flex-col rounded-md border border-background/20 bg-foreground/50 px-2.5 py-1.5 text-background shadow-md shadow-foreground/15 backdrop-blur-md">
                            <p className="text-[10px] font-bold uppercase leading-none tracking-wider text-background/70">Live promo</p>
                            <p className="mt-1 max-w-full truncate text-sm font-semibold leading-tight">{editForm.title || 'Promo'}</p>
                          </div>
                          <Button type="button" variant="destructive" size="icon" className="absolute right-2 top-2 h-7 w-7" onClick={() => setEditForm(prev => ({ ...prev, trackerPromoImageUrl: null }))}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => promoImageInputRef.current?.click()} disabled={isPromoImageUploading}>
                            <Upload className="mr-2 h-4 w-4" />
                            Replace
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => { setPromoImageToCrop(editForm.trackerPromoImageUrl || ''); setPromoCropDialogOpen(true); }} disabled={isPromoImageUploading}>
                            <Crop className="mr-2 h-4 w-4" />
                            Crop
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="flex h-24 w-full items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 text-muted-foreground transition-colors hover:border-muted-foreground/50" onClick={() => promoImageInputRef.current?.click()} disabled={isPromoImageUploading}>
                        {isPromoImageUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                      </button>
                    )}
                  </div>
                  <TrackerPosItemPicker
                    value={editForm.trackerItemRefs || []}
                    onChange={(items) => setEditForm(prev => ({ ...prev, trackerItemRefs: items }))}
                  />
                  <div className="space-y-1.5">
                    <Label>Scope</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['user', 'role', 'location'] as TrackerScopeType[]).map(scope => (
                        <Button key={scope} type="button" variant={editForm.trackerScope?.type === scope ? 'default' : 'outline'} size="sm" onClick={() => setEditForm(prev => ({ ...prev, trackerScope: { type: scope } }))}>
                          {scope === 'user' ? 'User' : scope === 'role' ? 'Role' : 'Location'}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Dashboard View</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant={editForm.trackerDisplayMode === 'summary' ? 'default' : 'outline'} size="sm" onClick={() => setEditForm(prev => ({ ...prev, trackerDisplayMode: 'summary' }))}>My Rank</Button>
                      <Button type="button" variant={editForm.trackerDisplayMode === 'expandable' ? 'default' : 'outline'} size="sm" onClick={() => setEditForm(prev => ({ ...prev, trackerDisplayMode: 'expandable' }))}>Expandable</Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Color Selection */}
              <div className="space-y-1.5">
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

            </div>
          )}

          {view === 'edit' && editingCube && (
            <DialogFooter className="shrink-0 border-t bg-background px-4 py-3">
              <Button
                onClick={handleSave}
                disabled={isSaving || isPromoImageUploading || (editingCube.cubeType === 'data' && (editForm.metrics || []).length === 0) || (editingCube.cubeType === 'data-3d' && faceMetrics.slice(0, numFaces).every(f => f.length === 0))}
                className="w-full"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ImageCropDialog
        open={promoCropDialogOpen}
        onOpenChange={setPromoCropDialogOpen}
        imageSrc={promoImageToCrop}
        onCropComplete={handlePromoImageCropComplete}
        cropShape="rect"
        aspect={1 / 0.58}
        cropAreaClassName="!h-[232px]"
      />

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