import { useState, useEffect, ReactNode, useMemo, memo, Suspense } from 'react';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DashboardWidget, MetricType, WidgetSize, SalesDataForWidgets } from './DashboardWidget';
import type { NewDataCubeConfig, CubeType, TrackerDisplayMode, TrackerRankMetric, TrackerScopeType } from './AddWidgetDialog';
const addWidgetDialogImport = () => import('./AddWidgetDialog').then(m => ({ default: m.AddWidgetDialog }));
const AddWidgetDialog = lazyWithRetry(addWidgetDialogImport);
// Prefetch the chunk on idle so the first open is instant (no Suspense flicker)
const prefetchAddWidgetDialog = () => { addWidgetDialogImport().catch(() => {}); };
import { Add3DCubeDialog, New3DCubeConfig } from './Add3DCubeDialog';
import { DataCube3D } from './DataCube3D';
import { SalesSummary } from './SalesSummary';
import { TrackerWidget } from './TrackerWidget';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { GripVertical } from 'lucide-react';
import { useIsOledTheme } from '@/hooks/useIsOledTheme';

// Sales chart accent color - teal to match the chart bars, dark blue for OLED
const SALES_CHART_COLOR = '#0D9488';
const SALES_CHART_COLOR_OLED = 'hsl(215, 30%, 18%)';


interface DataCubeConfig {
  id: string;
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  displayOrder: number;
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



interface SortableDataCubeProps {
  cube: DataCubeConfig;
  salesData: SalesDataForWidgets | null;
  isLoading: boolean;
  locationSettings?: { hours_open?: string; hours_close?: string } | null;
  isReorderMode: boolean;
  onSalesDataChange?: (data: SalesDataForWidgets | null) => void;
}


function SortableDataCube({ cube, salesData, isLoading, locationSettings, isReorderMode, onSalesDataChange }: SortableDataCubeProps) {
  const isOled = useIsOledTheme();
  
  // Use OLED color when in OLED theme
  const salesChartColor = isOled ? SALES_CHART_COLOR_OLED : SALES_CHART_COLOR;
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cube.id, disabled: !isReorderMode });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  if (cube.cubeType === 'tracker') {
    return (
      <div ref={setNodeRef} style={style} className={`col-span-2 ${isDragging ? 'opacity-50' : ''} relative`} {...(isReorderMode ? { ...attributes, ...listeners } : {})}>
        {isReorderMode && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 rounded-lg">
            <div className="p-3 rounded-full bg-primary/20">
              <GripVertical className="h-6 w-6 text-primary" />
            </div>
          </div>
        )}
        <div className={isReorderMode ? 'opacity-85 cursor-grab active:cursor-grabbing' : ''}>
          <TrackerWidget tracker={cube} />
        </div>
      </div>
    );
  }

  // For sales-chart type, render the SalesOverview component with matching cube style
  if (cube.cubeType === 'sales-chart') {
    return (
      <div 
        ref={setNodeRef} 
        style={style} 
        className={`w-full ${isDragging ? 'opacity-50' : ''} relative`}
        {...(isReorderMode ? { ...attributes, ...listeners } : {})}
      >
        <Card className={`overflow-hidden ${isReorderMode ? 'cursor-grab active:cursor-grabbing' : ''}`}>
          {/* Reorder overlay */}
          {isReorderMode && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 rounded-lg">
              <div className="p-3 rounded-full bg-primary/20">
                <GripVertical className="h-6 w-6 text-primary" />
              </div>
            </div>
          )}
          <div className={isReorderMode ? 'opacity-85' : ''}>
            <SalesSummary locationSettings={locationSettings} onSalesDataChange={onSalesDataChange as any} />
          </div>
        </Card>
      </div>
    );
  }

  // For 3D data cubes
  if (cube.cubeType === 'data-3d' && cube.faceMetrics && cube.numFaces) {
    const faceTitles = cube.faceTitles || [];
    const faces = cube.faceMetrics.slice(0, cube.numFaces).map((metrics, idx) => ({ 
      metrics, 
      title: faceTitles[idx] || undefined 
    }));
    
    return (
      <div 
        ref={setNodeRef} 
        style={style} 
        className={`${isDragging ? 'opacity-50' : ''} relative`}
        {...(isReorderMode ? { ...attributes, ...listeners } : {})}
      >
        {/* Reorder overlay */}
        {isReorderMode && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 rounded-lg">
            <div className="p-3 rounded-full bg-primary/20">
              <GripVertical className="h-6 w-6 text-primary" />
            </div>
          </div>
        )}
        {/* Responsive container: square on mobile, rectangular on tablet/desktop */}
        <div className={`${isReorderMode ? 'opacity-85 cursor-grab active:cursor-grabbing' : ''} aspect-square md:aspect-[2/1]`}>
          <DataCube3D
            title={cube.title}
            faces={faces}
            accentColor={cube.accentColor}
            salesData={salesData}
            isLoading={isLoading}
          />
        </div>
      </div>
    );
  }

  // Determine grid span based on size for legacy flat data cubes
  const gridClass = cube.size === 'small' ? 'col-span-1' : 'col-span-2';

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className={`${gridClass} ${isDragging ? 'opacity-50' : ''} relative`}
      {...(isReorderMode ? { ...attributes, ...listeners } : {})}
    >
      {/* Reorder overlay */}
      {isReorderMode && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 rounded-lg">
          <div className="p-3 rounded-full bg-primary/20">
            <GripVertical className="h-6 w-6 text-primary" />
          </div>
        </div>
      )}
      <div className={isReorderMode ? 'opacity-85 cursor-grab active:cursor-grabbing' : ''}>
        <DashboardWidget
          title={cube.title}
          size={cube.size}
          metrics={cube.metrics}
          accentColor={cube.accentColor}
          salesData={salesData}
          isLoading={isLoading}
          isDragging={isDragging}
        />
      </div>
    </div>
  );
}

interface RoleCubeConfig {
  id: string;
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  cubeType: CubeType | 'data-3d';
  faceMetrics?: MetricType[][];
  faceTitles?: string[];
  numFaces?: number;
  displayOrder: number;
}

interface WidgetsSectionProps {
  salesData: SalesDataForWidgets | null;
  isLoadingSales?: boolean;
  hasQuBeyondIntegration?: boolean;
  showAddDialog?: boolean;
  onAddDialogChange?: (open: boolean) => void;
  locationSettings?: { hours_open?: string; hours_close?: string } | null;
  isReorderMode?: boolean;
  checklistsContent?: ReactNode;
  onSalesDataChange?: (data: SalesDataForWidgets | null) => void;
  // Role-based cubes (locked by Org Admin for TM/SM/Manager)
  roleCubes?: RoleCubeConfig[];
  useRoleCubes?: boolean;
  // Section order from parent (reactive)
  sectionOrder?: string[];
}

export const WidgetsSection = memo(function WidgetsSection({
  salesData, 
  isLoadingSales = false, 
  hasQuBeyondIntegration = true,
  showAddDialog: externalShowAddDialog,
  onAddDialogChange,
  locationSettings,
  isReorderMode = false,
  checklistsContent,
  onSalesDataChange,
  roleCubes,
  useRoleCubes = false,
  sectionOrder: sectionOrderProp,
}: WidgetsSectionProps) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();
  const [internalShowAddDialog, setInternalShowAddDialog] = useState(false);
  const [show3DCubeDialog, setShow3DCubeDialog] = useState(false);
  const [localCubes, setLocalCubes] = useState<DataCubeConfig[]>([]);
  

  // Use external control if provided, otherwise use internal state
  const showAddDialog = externalShowAddDialog !== undefined ? externalShowAddDialog : internalShowAddDialog;
  const setShowAddDialog = onAddDialogChange || setInternalShowAddDialog;

  // Track whether the Add Widget dialog has been opened at least once.
  // Once mounted, we keep it mounted so Radix close animations play smoothly
  // and we don't pay the Suspense fallback flicker on subsequent opens.
  const [hasOpenedAddDialog, setHasOpenedAddDialog] = useState(false);
  useEffect(() => {
    if (showAddDialog) setHasOpenedAddDialog(true);
  }, [showAddDialog]);

  // Prefetch the AddWidgetDialog chunk on idle so the FIRST open is also smooth
  useEffect(() => {
    const idle = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 200));
    const cancel = (window as any).cancelIdleCallback || clearTimeout;
    const handle = idle(prefetchAddWidgetDialog);
    return () => cancel(handle);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Fetch user's data cubes (data, data-3d, and sales-chart types)
  // Skip fetching if using role-based cubes (locked by Org Admin)
  const { data: cubes = [], isLoading } = useQuery({
    queryKey: ['user-data-cubes', user?.id, currentLocation?.id],
    queryFn: async () => {
      if (!user?.id || !currentLocation?.id) return [];

      const { data, error } = await supabase
        .from('user_dashboard_cubes')
        .select('*')
        .eq('user_id', user.id)
        .eq('location_id', currentLocation.id)
        .in('cube_type', ['data', 'data-3d', 'sales-chart', 'tracker'])
        .order('display_order');

      if (error) {
        console.error('Error fetching data cubes:', error);
        return [];
      }

      return (data || []).map(cube => ({
        id: cube.id,
        title: cube.title || '',
        size: (cube.widget_size as WidgetSize) || 'small',
        metrics: (cube.metrics as MetricType[]) || [],
        accentColor: cube.accent_color || '#8B5CF6',
        displayOrder: cube.display_order,
        cubeType: cube.cube_type as CubeType | 'data-3d',
        faceMetrics: (cube.face_metrics as MetricType[][]) || [],
        faceTitles: (cube.face_titles as string[]) || [],
        numFaces: cube.num_faces || 1,
        trackerScope: (cube.tracker_scope as { type: TrackerScopeType; role?: string }) || { type: 'location' },
        trackerDisplayMode: (cube.tracker_display_mode as TrackerDisplayMode) || 'summary',
        trackerItemRefs: (cube.tracker_item_refs as string[]) || [],
        trackerPromoStart: cube.tracker_promo_start || null,
        trackerPromoEnd: cube.tracker_promo_end || null,
        trackerPromoImageUrl: cube.tracker_promo_image_url || null,
        trackerLocationRefs: (cube.tracker_location_refs as string[]) || [],
        trackerRankMetrics: (cube.tracker_rank_metrics as TrackerRankMetric[]) || ['units', 'sales', 'pmix'],
      })) as DataCubeConfig[];
    },
    enabled: !!user?.id && !!currentLocation?.id && !useRoleCubes,
    staleTime: 30 * 1000, // 30s cache - prevent duplicate fetches on mount
    placeholderData: (previousData) => previousData, // Show previous data instantly while refetching
  });

  // Determine which cubes to use: role-based (locked) or personal
  const effectiveCubes: DataCubeConfig[] = useRoleCubes && roleCubes 
    ? roleCubes.map(rc => ({
        id: rc.id,
        title: rc.title,
        size: rc.size,
        metrics: rc.metrics,
        accentColor: rc.accentColor,
        displayOrder: rc.displayOrder,
        cubeType: rc.cubeType,
        faceMetrics: rc.faceMetrics || [],
        faceTitles: rc.faceTitles || [],
        numFaces: rc.numFaces || 1,
      }))
    : cubes;

  // Check if sales chart already exists
  const hasSalesChart = localCubes.some(c => c.cubeType === 'sales-chart');

  // Sync local cubes state with fetched/role data
  useEffect(() => {
    setLocalCubes(effectiveCubes);
  }, [effectiveCubes]);

  // Auto-create Sales Chart widget for users who don't have one yet
  // This ensures all team members see Sales Overview by default
  // Skip for role-based cubes (those are configured by Org Admin)
  useEffect(() => {
    const autoCreateSalesChart = async () => {
      if (!user?.id || !currentLocation?.id || isLoading || useRoleCubes) return;
      
      // Only auto-create if user has no cubes at all (first visit) or explicitly no sales chart
      // and the location has QuBeyond integration (hasQuBeyondIntegration prop)
      const userHasSalesChart = cubes.some(c => c.cubeType === 'sales-chart');
      if (userHasSalesChart) return;
      
      // Check localStorage to see if we've already tried to auto-create for this user+location
      const autoCreateKey = `dashboard-auto-sales-chart-${user.id}-${currentLocation.id}`;
      if (localStorage.getItem(autoCreateKey)) return;
      
      // Mark that we've attempted auto-creation (prevent repeated attempts)
      localStorage.setItem(autoCreateKey, 'true');
      
      try {
        // Get max display_order
        const { data: maxOrderRow } = await supabase
          .from('user_dashboard_cubes')
          .select('display_order')
          .eq('user_id', user.id)
          .eq('location_id', currentLocation.id)
          .order('display_order', { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextOrder = (maxOrderRow?.display_order ?? -1) + 1;

        const { error } = await supabase
          .from('user_dashboard_cubes')
          .insert({
            user_id: user.id,
            location_id: currentLocation.id,
            title: 'Sales Overview',
            cube_type: 'sales-chart',
            widget_size: 'large',
            metrics: [],
            accent_color: '#0D9488',
            display_order: nextOrder,
          });

        if (error) {
          console.error('Error auto-creating sales chart:', error);
          return;
        }

        console.log('[WidgetsSection] Auto-created Sales Overview for user');
        queryClient.invalidateQueries({ queryKey: ['user-data-cubes'] });
      } catch (error) {
        console.error('Error auto-creating sales chart:', error);
      }
    };

    autoCreateSalesChart();
  }, [user?.id, currentLocation?.id, cubes, isLoading, queryClient]);
  
  // Debug logging removed for performance - was causing excess re-render tracking

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Only reorder data cubes (not sales chart)
    const cubesOnly = localCubes.filter(c => c.cubeType === 'data' || c.cubeType === 'data-3d');
    const oldIndex = cubesOnly.findIndex(item => item.id === active.id);
    const newIndex = cubesOnly.findIndex(item => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedCubes = arrayMove(cubesOnly, oldIndex, newIndex);
    // Rebuild localCubes preserving non-data-cube items in their positions
    const nonDataCubes = localCubes.filter(c => c.cubeType !== 'data' && c.cubeType !== 'data-3d');
    setLocalCubes([...reorderedCubes, ...nonDataCubes]);

    if (useRoleCubes) return;
    
    try {
      // Persist all cube orders
      const allCubes = [...reorderedCubes, ...nonDataCubes];
      const updates = allCubes.map((cube, index) => ({ id: cube.id, display_order: index }));

      const updateWithRetry = async (id: string, display_order: number) => {
        let lastError: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const { error } = await supabase
            .from('user_dashboard_cubes')
            .update({ display_order })
            .eq('id', id);
          if (!error) return;
          lastError = error;
          if (error.code === '40P01' || error.code === '23505') {
            await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
            continue;
          }
          throw error;
        }
        throw lastError;
      };

      for (let i = 0; i < updates.length; i++) {
        await updateWithRetry(updates[i].id, -(1000000 + i));
      }
      for (const u of updates) {
        await updateWithRetry(u.id, u.display_order);
      }

      queryClient.invalidateQueries({
        queryKey: ['user-data-cubes', user?.id, currentLocation?.id],
      });
    } catch (error: any) {
      console.error('Error saving cube order:', error);
      toast.error(error?.message ? `Failed to save cube order: ${error.message}` : 'Failed to save cube order');
      setLocalCubes(cubes);
    }
  };

  const handleAddCube = async (config: NewDataCubeConfig) => {
    if (!user?.id || !currentLocation?.id) return;

    try {
      // Get the max display_order to avoid unique constraint violation
      const { data: maxOrderRow } = await supabase
        .from('user_dashboard_cubes')
        .select('display_order')
        .eq('user_id', user.id)
        .eq('location_id', currentLocation.id)
        .order('display_order', { ascending: false })
        .limit(1)
        .single();

      const nextOrder = (maxOrderRow?.display_order ?? -1) + 1;

      const { error } = await supabase
        .from('user_dashboard_cubes')
        .insert({
          user_id: user.id,
          location_id: currentLocation.id,
          title: config.title || null,
          cube_type: config.cubeType,
          widget_size: config.size,
          metrics: config.metrics,
          accent_color: config.accentColor,
          display_order: nextOrder,
          tracker_scope: config.trackerScope,
          tracker_display_mode: config.trackerDisplayMode,
          tracker_item_refs: config.trackerItemRefs || [],
          tracker_promo_start: config.trackerPromoStart,
          tracker_promo_end: config.trackerPromoEnd,
          tracker_promo_image_url: config.trackerPromoImageUrl,
          tracker_location_refs: config.trackerLocationRefs || [],
          tracker_rank_metrics: config.trackerRankMetrics || ['units', 'sales', 'pmix'],
        });

      if (error) throw error;

      toast.success(config.cubeType === 'sales-chart' ? 'Sales Overview added' : config.cubeType === 'tracker' ? 'Tracker added' : 'Data cube added');
      queryClient.invalidateQueries({ queryKey: ['user-data-cubes'] });
    } catch (error: any) {
      console.error('Error adding data cube:', error);
      toast.error(error?.message || 'Failed to add widget');
    }
  };

  const handleAdd3DCube = async (config: New3DCubeConfig) => {
    if (!user?.id || !currentLocation?.id) return;

    try {
      // Get the max display_order to avoid unique constraint violation
      const { data: maxOrderRow } = await supabase
        .from('user_dashboard_cubes')
        .select('display_order')
        .eq('user_id', user.id)
        .eq('location_id', currentLocation.id)
        .order('display_order', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextOrder = (maxOrderRow?.display_order ?? -1) + 1;

      const { error } = await supabase
        .from('user_dashboard_cubes')
        .insert({
          user_id: user.id,
          location_id: currentLocation.id,
          title: null,
          cube_type: 'data-3d',
          widget_size: 'small',
          metrics: [],
          face_metrics: config.faceMetrics,
          face_titles: config.faceTitles,
          num_faces: config.numFaces,
          accent_color: config.accentColor,
          display_order: nextOrder,
        });

      if (error) throw error;

      toast.success('3D Cube added');
      queryClient.invalidateQueries({ queryKey: ['user-data-cubes'] });
    } catch (error: any) {
      console.error('Error adding 3D cube:', error);
      toast.error(error?.message || 'Failed to add 3D cube');
    }
  };

  // Separate cubes, checklists, and sales chart for stacked layout on tablet/desktop
  const dataCubes = localCubes.filter(c => c.cubeType === 'data-3d' || c.cubeType === 'data' || c.cubeType === 'tracker');
  const salesChart = localCubes.find(c => c.cubeType === 'sales-chart');

  // Section order: use prop if provided, else read from localStorage
  const sectionOrder = useMemo(() => {
    if (sectionOrderProp) return sectionOrderProp;
    if (!currentLocation?.id) return ['data-cubes', 'checklists', 'sales-chart'];
    const key = `dashboard-section-order-${currentLocation.id}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try { return JSON.parse(saved) as string[]; } catch { /* fallback */ }
    }
    return ['data-cubes', 'checklists', 'sales-chart'];
  }, [currentLocation?.id, sectionOrderProp]);

  // If using role cubes and no cubes configured, show empty state (no add dialogs)
  if (useRoleCubes && localCubes.length === 0 && !checklistsContent) {
    return null;
  }

  // If no cubes and no checklists content, just show the dialog (only for personal cubes)
  if (!useRoleCubes && localCubes.length === 0 && !checklistsContent) {
    return (
      <>
        {hasOpenedAddDialog && (
          <Suspense fallback={null}>
            <AddWidgetDialog
              open={showAddDialog}
              onOpenChange={setShowAddDialog}
              onAdd={handleAddCube}
              defaultColorIndex={0}
              hasSalesChart={false}
              onAdd3DCube={() => {
                setShowAddDialog(false);
                setShow3DCubeDialog(true);
              }}
            />
          </Suspense>
        )}
        <Add3DCubeDialog
          open={show3DCubeDialog}
          onOpenChange={setShow3DCubeDialog}
          onAdd={handleAdd3DCube}
          defaultColorIndex={0}
        />
      </>
    );
  }

  const renderSection = (section: string) => {
    switch (section) {
      case 'data-cubes':
        if (dataCubes.length === 0) return null;
        return (
          <DndContext
            key="data-cubes"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={dataCubes.map(cube => cube.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-2 gap-3" data-tour="dashboard-cubes">
                {dataCubes.map(cube => (
                  <SortableDataCube
                    key={cube.id}
                    cube={cube}
                    salesData={salesData}
                    isLoading={isLoadingSales}
                    locationSettings={locationSettings}
                    isReorderMode={isReorderMode}
                    onSalesDataChange={onSalesDataChange}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        );
      case 'checklists':
        if (!checklistsContent) return null;
        return <div key="checklists" className="w-full">{checklistsContent}</div>;
      case 'sales-chart':
        if (!salesChart) return null;
        return (
          <SortableDataCube
            key={salesChart.id}
            cube={salesChart}
            salesData={salesData}
            isLoading={isLoadingSales}
            locationSettings={locationSettings}
            isReorderMode={isReorderMode}
            onSalesDataChange={onSalesDataChange}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-2.5 w-full">
      {sectionOrder.map(section => renderSection(section))}

      {/* Add Data Cube Dialog - only for personal cubes */}
      {!useRoleCubes && (
        <>
          {showAddDialog && (
            <Suspense fallback={null}>
              <AddWidgetDialog
                open={showAddDialog}
                onOpenChange={setShowAddDialog}
                onAdd={handleAddCube}
                defaultColorIndex={localCubes.length}
                hasSalesChart={hasSalesChart}
                onAdd3DCube={() => {
                  setShowAddDialog(false);
                  setShow3DCubeDialog(true);
                }}
              />
            </Suspense>
          )}
          
          {/* Add 3D Cube Dialog */}
          <Add3DCubeDialog
            open={show3DCubeDialog}
            onOpenChange={setShow3DCubeDialog}
            onAdd={handleAdd3DCube}
            defaultColorIndex={localCubes.length}
          />
        </>
      )}
    </div>
  );
});