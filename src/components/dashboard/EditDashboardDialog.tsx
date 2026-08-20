import { useRef, useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Check, ArrowLeft, Minus, Box, GripVertical, LineChart, ClipboardCheck, Trophy, Upload, X, Crop, Loader2, Eye, EyeOff, ChevronDown, ChevronRight } from "lucide-react";
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
import { PROMO_BANNER_ASPECT, PROMO_BANNER_ASPECT_CLASS, PromoBadgeOverlay, PromoImageLayers } from "./PromoBannerPreview";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resolveBrandId } from "@/utils/resolveBrandId";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";

import { createDashboardWidget, updateDashboardWidget, deleteDashboardWidget, buildWidgetConfigJson, toggleWidgetHiddenForSelf, toggleTrackerHiddenForLocation, endPromoTrackerByTitle } from "@/lib/dashboardWidgetsClient";
import { AudienceSelector, type AudienceRole } from "./AudienceSelector";
import { ScopeBadge } from "./ScopeBadge";

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
  trackerLocationScope?: 'org' | 'brand';
  // 3D cube specific
  faceMetrics?: MetricType[][];
  faceTitles?: string[];
  numFaces?: number;
  // Visibility / authority (unified widgets)
  authorityScope?: 'self' | 'location' | 'org' | 'brand' | 'app';
  audienceRoles?: AudienceRole[] | null;
  brandId?: string | null;
  organizationId?: string | null;
  locationId?: string | null;
  // Per-user "hide from my dashboard" toggle state for the current viewer
  hiddenForSelf?: boolean;
  // Tracker-only: hidden for ALL users at the current location (admin toggle)
  hiddenForLocation?: boolean;
  trackerExcludedLocationIds?: string[];
  // user_id of the widget creator (for "Created by" attribution)
  createdBy?: string;
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
function SortableCubeRow({
  cube,
  onEdit,
  onDelete,
  onToggleHidden,
  onToggleTrackerLocationHidden,
  creatorName,
  isOwn,
}: {
  cube: CubeConfig;
  onEdit: (cube: CubeConfig) => void;
  onDelete: (id: string) => void;
  onToggleHidden?: (cube: CubeConfig) => void;
  onToggleTrackerLocationHidden?: (cube: CubeConfig) => void;
  creatorName?: string | null;
  isOwn?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cube.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const accentBg = isThemeColorKey(cube.accentColor) ? undefined : cube.accentColor;
  const accentClass = isThemeColorKey(cube.accentColor) ? getThemeColorClass(cube.accentColor) : '';
  const isTracker = cube.cubeType === 'tracker';
  const dimmed = cube.hiddenForSelf || (isTracker && cube.hiddenForLocation);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors hover:bg-accent/50 ${dimmed ? 'opacity-60' : ''}`}
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
        {isTracker ? <Trophy className="h-4 w-4 text-white" /> : <Box className="h-4 w-4 text-white" />}
      </div>
        <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium leading-tight">
            {cube.title || '3D Data Cube'}
          </p>
          {!isOwn && creatorName && (
            <span className="flex-shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              by {creatorName}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
          {isTracker && cube.hiddenForLocation
            ? 'Hidden at this location'
            : cube.hiddenForSelf
              ? 'Hidden from your dashboard'
              : cube.cubeType === 'data-3d'
                ? `${cube.numFaces || 1} face${(cube.numFaces || 1) > 1 ? 's' : ''} · ${(cube.faceMetrics || []).flat().length} metrics`
                : isTracker
                  ? `${cube.trackerDisplayMode === 'expandable' ? 'Expandable' : 'My rank'} · DAY/WTD/Promo`
                  : `${cube.size} · ${cube.metrics.length} metrics`}
        </p>
      </div>
      {isTracker && onToggleTrackerLocationHidden ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground flex-shrink-0"
          title={cube.hiddenForLocation ? 'Show at this location' : 'Hide at this location (all users)'}
          onClick={(e) => { e.stopPropagation(); onToggleTrackerLocationHidden(cube); }}
        >
          {cube.hiddenForLocation ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
      ) : onToggleHidden ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground flex-shrink-0"
          title={cube.hiddenForSelf ? 'Show on my dashboard' : 'Hide from my dashboard'}
          onClick={(e) => { e.stopPropagation(); onToggleHidden(cube); }}
        >
          {cube.hiddenForSelf ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
      ) : null}
      {!isTracker && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); onDelete(cube.id); }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
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
  const [endPromoOpen, setEndPromoOpen] = useState(false);
  const [isEndingPromo, setIsEndingPromo] = useState(false);
  const [promoImageToCrop, setPromoImageToCrop] = useState('');
  const [promoCropDialogOpen, setPromoCropDialogOpen] = useState(false);
  const [isPromoImageUploading, setIsPromoImageUploading] = useState(false);
  const { currentLocation } = useAppLocation();
  const { user } = useAuth();
  const { isAdmin, isOrgAdmin, isBrandAdmin, isSuperAdmin } = useUserRole();
  const canPublish = isAdmin;
  // Personal "hide from my dashboard" toggle is reserved for management roles.
  // (Lower roles see fewer widgets to begin with — they don't need to declutter.)
  const canHideForSelf = isAdmin || isOrgAdmin || isBrandAdmin || isSuperAdmin;
  const queryClient = useQueryClient();

  const handleToggleHiddenForSelf = async (cube: CubeConfig) => {
    try {
      const nowHidden = await toggleWidgetHiddenForSelf(cube.id);
      toast.success(nowHidden ? 'Hidden from your dashboard' : 'Shown on your dashboard');
      queryClient.invalidateQueries({ queryKey: ['dashboard-widgets'] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update visibility');
    }
  };

  const handleToggleTrackerLocationHidden = async (cube: CubeConfig) => {
    if (!currentLocation?.id) return;
    try {
      const nowHidden = await toggleTrackerHiddenForLocation(cube.id, currentLocation.id);
      toast.success(nowHidden ? 'Promo hidden at this location' : 'Promo shown at this location');
      queryClient.invalidateQueries({ queryKey: ['dashboard-widgets'] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update visibility');
    }
  };
  const [excludedLocationIds, setExcludedLocationIds] = useState<string[]>([]);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [audienceRoles, setAudienceRoles] = useState<AudienceRole[] | null>(null);

  // ── Visibility (post-create scope editing) ─────────────────────────────
  type Scope = 'self' | 'location' | 'org' | 'brand' | 'app';
  const [visibilityScope, setVisibilityScope] = useState<Scope>('self');
  const [visibilityAudience, setVisibilityAudience] = useState<AudienceRole[] | null>(null);
  const [visibilityChanged, setVisibilityChanged] = useState(false);
  const [pendingDowngradeOpen, setPendingDowngradeOpen] = useState(false);

  const SCOPE_RANK: Record<Scope, number> = { self: 0, location: 1, org: 2, brand: 3, app: 4 };
  const allowedScopes = ((): Scope[] => {
    const scopes: Scope[] = ['self'];
    if (isAdmin) scopes.push('location');
    if (isOrgAdmin) scopes.push('org');
    if (isBrandAdmin) scopes.push('brand');
    if (isSuperAdmin) scopes.push('app');
    return scopes;
  })();
  const SCOPE_LABEL: Record<Scope, string> = {
    self: 'Just Me',
    location: 'This Location',
    org: 'All Locations in Org',
    brand: 'All Locations in Brand',
    app: 'App-Wide',
  };

  const { data: allPublishableLocations = [] } = useQuery({
    queryKey: ['publishable-locations', user?.id],
    queryFn: async () => {
      if (!user?.id) return [] as Array<{ id: string; name: string; organization_id: string | null; brand_id: string | null }>;
      const { data, error } = await supabase.rpc('get_publishable_locations', { _user_id: user.id });
      if (error) { console.error('[EditDashboardDialog] get_publishable_locations error', error); return []; }
      return (data || []) as Array<{ id: string; name: string; organization_id: string | null; brand_id: string | null }>;
    },
    enabled: !!user?.id && canPublish && open,
    staleTime: 5 * 60 * 1000,
  });

  // Trackers must stay scoped to the brand they were published under.
  // Derive brand from the editing widget's own location; super-admins can
  // publish across brands, but a tracker created for Brand A must NEVER be
  // fanned out to Brand B locations when re-saved.
  const trackerBrandId = (() => {
    const locId = editingCube?.locationId;
    if (!locId) return null;
    return allPublishableLocations.find(l => l.id === locId)?.brand_id ?? null;
  })();
  const publishableLocations = trackerBrandId
    ? allPublishableLocations.filter(l => l.brand_id === trackerBrandId)
    : (editingCube?.locationId
        ? allPublishableLocations.filter(l => l.id === editingCube.locationId)
        : allPublishableLocations);

  // Reset exclusion state when leaving edit view
  useEffect(() => {
    if (view !== 'edit') {
      setExcludedLocationIds([]);
      setExcludeOpen(false);
    }
  }, [view]);

  // Sync this tracker (by title) across all publishable brand locations.
  // Included = upsert; excluded = remove.
  const syncTrackerAcrossLocations = async () => {
    if (!editingCube || editingCube.cubeType !== 'tracker') return;
    if (!editForm.title?.trim()) return;
    const includedLocIds = publishableLocations
      .map(l => l.id)
      .filter(id => !excludedLocationIds.includes(id));

    const cfgJson = buildWidgetConfigJson({
      metrics: [],
      trackerScope: editForm.trackerScope,
      trackerDisplayMode: editForm.trackerDisplayMode,
      trackerItemRefs: editForm.trackerItemRefs || [],
      trackerPromoStart: editForm.trackerPromoStart,
      trackerPromoEnd: editForm.trackerPromoEnd,
      trackerPromoImageUrl: editForm.trackerPromoImageUrl,
      trackerLocationRefs: editForm.trackerLocationRefs || [],
      trackerRankMetrics: editForm.trackerRankMetrics || ['units', 'sales', 'pmix'],
      trackerLocationScope: editForm.trackerLocationScope || 'org',
    });

    const allLocIds = publishableLocations.map(l => l.id);
    const { data: existing } = await supabase
      .from('dashboard_widgets')
      .select('id, location_id')
      .eq('authority_scope', 'location')
      .eq('widget_type', 'tracker')
      .eq('title', editingCube.title || '')
      .in('location_id', allLocIds);
    const byLoc = new Map<string, string>();
    (existing || []).forEach((r: any) => { if (r.location_id) byLoc.set(r.location_id, r.id); });

    const upserts = includedLocIds.map(loc_id => {
      const existingId = byLoc.get(loc_id);
      if (existingId) {
        return updateDashboardWidget({
          widget_id: existingId,
          title: editForm.title,
          accent_color: editForm.accentColor,
          audience_roles: audienceRoles,
          config: cfgJson,
        });
      }
      return createDashboardWidget({
        widget_type: 'tracker',
        config: cfgJson,
        authority_scope: 'location',
        location_id: loc_id,
        audience_roles: audienceRoles,
        title: editForm.title!,
        accent_color: editForm.accentColor,
        widget_size: 'large',
      });
    });
    const removals = excludedLocationIds
      .map(id => byLoc.get(id))
      .filter((id): id is string => !!id)
      .map(id => deleteDashboardWidget(id));

    await Promise.allSettled([...upserts, ...removals]);
  };


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

  // Lookup creator display names for "Created by" attribution on each row.
  // Only fetched when the dialog is open and there are widgets created by other users.
  const otherCreatorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of dataCubes) {
      if (c.createdBy && c.createdBy !== user?.id) ids.add(c.createdBy);
    }
    return Array.from(ids);
  }, [dataCubes, user?.id]);

  const { data: creatorNamesMap = {} } = useQuery({
    queryKey: ['widget-creator-names', otherCreatorIds.sort().join(',')],
    queryFn: async () => {
      if (otherCreatorIds.length === 0) return {} as Record<string, string>;
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .in('id', otherCreatorIds);
      if (error) { console.error('[EditDashboardDialog] creator names error', error); return {}; }
      const map: Record<string, string> = {};
      for (const p of (data || []) as Array<{ id: string; full_name: string | null; nickname: string | null }>) {
        const name = (p.nickname || p.full_name || '').trim();
        if (name) map[p.id] = name.split(/\s+/)[0];
      }
      return map;
    },
    enabled: open && otherCreatorIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  

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
        trackerLocationScope: cube.trackerLocationScope || 'org',
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
    // Seed visibility from current widget
    setVisibilityScope((cube.authorityScope as Scope) || 'self');
    setVisibilityAudience((cube.audienceRoles ?? null) as AudienceRole[] | null);
    setVisibilityChanged(false);
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

  const buildVisibilityUpdates = async (): Promise<Partial<CubeConfig>> => {
    if (!editingCube || !visibilityChanged) return {};
    const updates: Partial<CubeConfig> = {};
    const oldScope = (editingCube.authorityScope as Scope) || 'self';
    if (visibilityScope !== oldScope) {
      updates.authorityScope = visibilityScope;
      // Resolve scope FK based on current location
      if (visibilityScope === 'self' || visibilityScope === 'app') {
        updates.locationId = null;
        updates.organizationId = null;
        updates.brandId = null;
      } else if (visibilityScope === 'location') {
        updates.locationId = currentLocation?.id ?? null;
      } else if (visibilityScope === 'org') {
        updates.organizationId = (currentLocation as any)?.organization_id ?? null;
      } else if (visibilityScope === 'brand') {
        updates.brandId = currentLocation?.id ? await resolveBrandId(currentLocation.id) : null;
      }
    }
    // Audience can change independently of scope
    updates.audienceRoles = visibilityAudience;
    return updates;
  };

  const performSave = async () => {
    if (!editingCube) return;
    setIsSaving(true);
    try {
      const visUpdates = await buildVisibilityUpdates();
      if (editingCube.cubeType === 'data-3d') {
        await onUpdateCube(editingCube.id, {
          ...editForm,
          faceMetrics: faceMetrics.slice(0, numFaces),
          faceTitles: faceTitles.slice(0, numFaces),
          numFaces,
          ...visUpdates,
        });
      } else {
        await onUpdateCube(editingCube.id, { ...editForm, ...visUpdates });
      }
      // For trackers: also sync (upsert/remove) across all brand locations
      if (editingCube.cubeType === 'tracker' && canPublish && publishableLocations.length > 0) {
        try {
          await syncTrackerAcrossLocations();
        } catch (e: any) {
          console.error('[EditDashboardDialog] tracker sync failed', e);
          toast.error('Saved, but failed to sync to other locations');
        }
      }
      handleBack();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editingCube) return;
    // Confirm if user is downgrading scope (narrower visibility).
    const oldScope = (editingCube.authorityScope as Scope) || 'self';
    const isDowngrade =
      visibilityChanged &&
      visibilityScope !== oldScope &&
      SCOPE_RANK[visibilityScope] < SCOPE_RANK[oldScope];
    if (isDowngrade) {
      setPendingDowngradeOpen(true);
      return;
    }
    await performSave();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await onDeleteCube(deleteId);
    setDeleteId(null);
  };

  const handleEndPromo = async () => {
    if (!editingCube) return;
    setIsEndingPromo(true);
    try {
      const removed = await endPromoTrackerByTitle(editingCube.title || '');
      toast.success(`Promo ended — removed from ${removed} location${removed === 1 ? '' : 's'}`);
      queryClient.invalidateQueries({ queryKey: ['dashboard-widgets'] });
      setEndPromoOpen(false);
      handleBack();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to end promo');
    } finally {
      setIsEndingPromo(false);
    }
  };

  const handleAddClick = () => {
    // Open the Add Widget dialog FIRST so it animates in over the Edit dialog,
    // then close the Edit dialog on the next frame. This eliminates the visible
    // gap between Radix's close-out and open-in animations (the "flicker").
    onAddCube();
    requestAnimationFrame(() => onOpenChange(false));
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
                  onToggleHidden={canHideForSelf ? handleToggleHiddenForSelf : undefined}
                  onToggleTrackerLocationHidden={canPublish ? handleToggleTrackerLocationHidden : undefined}
                  isOwn={!!user?.id && cube.createdBy === user.id}
                  creatorName={cube.createdBy ? creatorNamesMap[cube.createdBy] : undefined}
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
              <ScrollArea className="flex-1">
                <div className="space-y-2 px-4 py-3">
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
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="edit-title">
                    {editingCube.cubeType === 'tracker' ? 'Promo Name' : editingCube.cubeType === 'data' ? 'Title' : 'Label'}
                  </Label>
                  {editingCube.cubeType === 'tracker' && (
                    <ScopeBadge scope={(editingCube.trackerLocationScope as any) || editingCube.authorityScope} />
                  )}
                </div>
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

              {editingCube.cubeType !== 'tracker' && (
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <Label className="text-xs font-semibold">Visibility</Label>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Who can see this widget</Label>
                    <Select
                      value={visibilityScope}
                      onValueChange={(v) => {
                        setVisibilityScope(v as Scope);
                        setVisibilityChanged(true);
                      }}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allowedScopes.map(s => (
                          <SelectItem key={s} value={s}>{SCOPE_LABEL[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {visibilityScope !== 'self' && (
                    <AudienceSelector
                      value={visibilityAudience}
                      onChange={(v) => {
                        setVisibilityAudience(v);
                        setVisibilityChanged(true);
                      }}
                    />
                  )}
                </div>
              )}

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
                        <div className={`relative ${PROMO_BANNER_ASPECT_CLASS} w-full overflow-hidden rounded-lg border bg-primary`}>
                          <img src={editForm.trackerPromoImageUrl} alt="Promo preview" className="absolute inset-0 h-full w-full object-cover" />
                          <PromoImageLayers />
                          <PromoBadgeOverlay label={editForm.trackerItemRefs?.[0] || editForm.title || 'Promo item'} />
                          <Button type="button" variant="destructive" size="icon" className="absolute right-2 top-2 z-50 h-7 w-7" onClick={() => setEditForm(prev => ({ ...prev, trackerPromoImageUrl: null }))}>
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
                    <Label>Ranking Pool</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant={(editForm.trackerLocationScope || 'org') === 'org' ? 'default' : 'outline'} size="sm" onClick={() => setEditForm(prev => ({ ...prev, trackerLocationScope: 'org' }))}>Organization</Button>
                      <Button type="button" variant={editForm.trackerLocationScope === 'brand' ? 'default' : 'outline'} size="sm" onClick={() => setEditForm(prev => ({ ...prev, trackerLocationScope: 'brand' }))}>Brand-Wide</Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Brand-Wide ranks every store in the brand.</p>
                  </div>

                  {canPublish && publishableLocations.length > 0 && (
                    <div className="space-y-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
                      <AudienceSelector value={audienceRoles} onChange={setAudienceRoles} />
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => setExcludeOpen(v => !v)}
                          className="flex w-full items-center justify-between text-left"
                        >
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Active at {publishableLocations.length - excludedLocationIds.length}/{publishableLocations.length} stores
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            {excludeOpen ? 'Hide' : 'Exclude stores'}
                            {excludeOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </span>
                        </button>
                        {excludeOpen && (
                          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-background p-1">
                            {publishableLocations.map((loc) => {
                              const excluded = excludedLocationIds.includes(loc.id);
                              return (
                                <label key={loc.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
                                  <Checkbox
                                    checked={!excluded}
                                    onCheckedChange={() => setExcludedLocationIds(prev => excluded ? prev.filter(x => x !== loc.id) : [...prev, loc.id])}
                                  />
                                  <span className={`text-sm ${excluded ? 'text-muted-foreground line-through' : ''}`}>{loc.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                        <p className="text-[11px] text-muted-foreground">Saving updates every included store. Excluded stores have the tracker removed.</p>
                      </div>
                    </div>
                  )}

                  {canPublish && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-destructive">End Promo</p>
                          <p className="text-[11px] text-muted-foreground">
                            Removes this tracker everywhere it appears across the brand.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => setEndPromoOpen(true)}
                          disabled={isEndingPromo}
                        >
                          End Promo
                        </Button>
                      </div>
                    </div>
                  )}
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
        aspect={PROMO_BANNER_ASPECT}
        cropAreaClassName={`!h-auto ${PROMO_BANNER_ASPECT_CLASS} w-full`}
        overlay={<PromoBadgeOverlay label={editForm.trackerItemRefs?.[0] || editForm.title || 'Promo item'} />}

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

      {/* Visibility downgrade confirmation */}
      <AlertDialog open={pendingDowngradeOpen} onOpenChange={setPendingDowngradeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Narrow this widget's visibility?</AlertDialogTitle>
            <AlertDialogDescription>
              This will hide the widget from users at other locations. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setPendingDowngradeOpen(false);
                await performSave();
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* End Promo confirmation */}
      <AlertDialog open={endPromoOpen} onOpenChange={setEndPromoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this promo?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the tracker from every location it was published to. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isEndingPromo}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleEndPromo} disabled={isEndingPromo} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isEndingPromo ? 'Ending…' : 'End Promo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}