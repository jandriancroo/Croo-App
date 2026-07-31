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
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets';
import { createDashboardWidget, buildWidgetConfigJson } from '@/lib/dashboardWidgetsClient';
const addWidgetDialogImport = () => import('./AddWidgetDialog').then(m => ({ default: m.AddWidgetDialog }));
const AddWidgetDialog = lazyWithRetry(addWidgetDialogImport);
// Prefetch the chunk on idle so the first open is instant (no Suspense flicker)
const prefetchAddWidgetDialog = () => { addWidgetDialogImport().catch(() => {}); };
import { Add3DCubeDialog, New3DCubeConfig } from './Add3DCubeDialog';
import { DataCube3D } from './DataCube3D';
// Code-split the sales chart (Recharts + framer) out of the first-paint bundle.
// It still mounts with the dashboard (it is the master writer for shared sales
// cache), but its JS loads in parallel instead of blocking cubes/checklists.
const SalesSummary = lazyWithRetry(() => import('./SalesSummary').then(m => ({ default: m.SalesSummary })));

import { TrackerWidget } from './TrackerWidget';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { GripVertical } from 'lucide-react';
import { useIsOledTheme } from '@/hooks/useIsOledTheme';
import { DashSectionTitle } from './DashSectionTitle';

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
  trackerLocationScope?: 'org' | 'brand';
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
            <Suspense fallback={<div className="h-[320px] w-full animate-pulse bg-muted/40" />}>
              <SalesSummary locationSettings={locationSettings} onSalesDataChange={onSalesDataChange as any} />
            </Suspense>

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
  // When true, only tracker widgets render (sales-bearing cubes/chart are hidden).
  // Used for users without view_sales permission so promo trackers still show.
  trackersOnly?: boolean;
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
  trackersOnly = false,
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

  // Unified Widgets: reads + writes go through dashboard_widgets via RPCs.
  const { data: unifiedWidgets = [], isLoading } = useDashboardWidgets(currentLocation?.id);

  // Live render: hide widgets the current user has personally hidden via the
  // eyeball toggle in the Edit dialog. They're still in `unifiedWidgets` so
  // the Edit dialog (managed by Dashboard.tsx) can show them with a restore
  // affordance.
  const cubes: DataCubeConfig[] = useMemo(
    () => unifiedWidgets.filter(w => !w.hiddenForSelf && !w.hiddenForLocation).map(w => ({
      id: w.id,
      title: w.title,
      size: w.size,
      metrics: w.metrics,
      accentColor: w.accentColor,
      displayOrder: w.displayOrder,
      cubeType: w.cubeType,
      faceMetrics: w.faceMetrics,
      faceTitles: w.faceTitles,
      numFaces: w.numFaces,
      trackerScope: w.trackerScope,
      trackerDisplayMode: w.trackerDisplayMode,
      trackerItemRefs: w.trackerItemRefs,
      trackerPromoStart: w.trackerPromoStart,
      trackerPromoEnd: w.trackerPromoEnd,
      trackerPromoImageUrl: w.trackerPromoImageUrl,
      trackerLocationRefs: w.trackerLocationRefs,
      trackerLocationScope: w.trackerLocationScope,
      trackerRankMetrics: w.trackerRankMetrics,
    })),
    [unifiedWidgets]
  );

  // useRoleCubes / roleCubes props are deprecated — unified table handles role visibility via RLS.
  const effectiveCubes: DataCubeConfig[] = cubes;

  // Check if sales chart already exists
  const hasSalesChart = localCubes.some(c => c.cubeType === 'sales-chart');

  // Sync local cubes state with fetched/role data
  useEffect(() => {
    setLocalCubes(effectiveCubes);
  }, [effectiveCubes]);

  // Auto-create Sales Chart widget for users who don't have one yet via the unified RPC.
  // Skip for role-based cubes (those are configured by Org Admin via location/org scope).
  useEffect(() => {
    const autoCreateSalesChart = async () => {
      if (!user?.id || !currentLocation?.id || isLoading || useRoleCubes) return;

      const userHasSalesChart = cubes.some(c => c.cubeType === 'sales-chart');
      if (userHasSalesChart) return;

      const autoCreateKey = `dashboard-auto-sales-chart-${user.id}-${currentLocation.id}`;
      if (localStorage.getItem(autoCreateKey)) return;
      localStorage.setItem(autoCreateKey, 'true');

      try {
        const nextOrder = cubes.reduce((m, c) => Math.max(m, c.displayOrder), -1) + 1;
        await createDashboardWidget({
          widget_type: 'sales-chart',
          config: { metrics: [] },
          authority_scope: 'self',
          location_id: currentLocation.id,
          title: 'Sales Overview',
          accent_color: '#0D9488',
          widget_size: 'large',
          display_order: nextOrder,
        });
        queryClient.invalidateQueries({ queryKey: ['dashboard-widgets'] });
      } catch (error) {
        console.error('Error auto-creating sales chart:', error);
      }
    };

    autoCreateSalesChart();
  }, [user?.id, currentLocation?.id, cubes, isLoading, queryClient, useRoleCubes]);
  
  // Debug logging removed for performance - was causing excess re-render tracking

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const cubesOnly = localCubes.filter(c => c.cubeType === 'data' || c.cubeType === 'data-3d');
    const oldIndex = cubesOnly.findIndex(item => item.id === active.id);
    const newIndex = cubesOnly.findIndex(item => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedCubes = arrayMove(cubesOnly, oldIndex, newIndex);
    const nonDataCubes = localCubes.filter(c => c.cubeType !== 'data' && c.cubeType !== 'data-3d');
    setLocalCubes([...reorderedCubes, ...nonDataCubes]);

    if (useRoleCubes) return;

    try {
      const allCubes = [...reorderedCubes, ...nonDataCubes];
      // Two-phase via RPC to avoid any unique constraint conflicts
      await Promise.all(allCubes.map((cube, i) =>
        supabase.rpc('update_dashboard_widget', {
          _widget_id: cube.id,
          _display_order: -(1000000 + i),
        })
      ));
      await Promise.all(allCubes.map((cube, i) =>
        supabase.rpc('update_dashboard_widget', {
          _widget_id: cube.id,
          _display_order: i,
        })
      ));

      queryClient.invalidateQueries({ queryKey: ['dashboard-widgets'] });
    } catch (error: any) {
      console.error('Error saving cube order:', error);
      toast.error(error?.message ? `Failed to save cube order: ${error.message}` : 'Failed to save cube order');
      setLocalCubes(cubes);
    }
  };

  const handleAddCube = async (config: NewDataCubeConfig) => {
    if (!user?.id || !currentLocation?.id) return;

    try {
      const nextOrder = localCubes.reduce((m, c) => Math.max(m, c.displayOrder), -1) + 1;
      // Trackers added from a personal dashboard are still 'self'-scoped — admin
      // publishing flows (location/org/brand/app + audience_roles) are handled
      // inside the AddWidgetDialog itself. For data cubes, AddWidgetDialog now
      // also passes through admin-chosen authorityScope + audienceRoles.
      const scope = (config as any).authorityScope as ('self'|'location'|'org'|'brand'|'app'|undefined) || 'self';
      const audience = ((config as any).audienceRoles ?? null) as string[] | null;
      let organization_id: string | null = null;
      let brand_id: string | null = null;
      let location_id: string | null = currentLocation.id;
      if (scope === 'org') {
        organization_id = (currentLocation as any)?.organization_id ?? null;
        location_id = null;
      } else if (scope === 'brand') {
        brand_id = await (await import('@/utils/resolveBrandId')).resolveBrandId(currentLocation.id);
        location_id = null;
      } else if (scope === 'app' || scope === 'self') {
        location_id = scope === 'self' ? currentLocation.id : null;
      }
      await createDashboardWidget({
        widget_type: config.cubeType,
        config: buildWidgetConfigJson({
          metrics: config.metrics,
          trackerScope: config.trackerScope,
          trackerDisplayMode: config.trackerDisplayMode,
          trackerItemRefs: config.trackerItemRefs || [],
          trackerPromoStart: config.trackerPromoStart,
          trackerPromoEnd: config.trackerPromoEnd,
          trackerPromoImageUrl: config.trackerPromoImageUrl,
          trackerLocationRefs: config.trackerLocationRefs || [],
          trackerRankMetrics: config.trackerRankMetrics || ['units', 'sales', 'pmix'],
        }),
        authority_scope: scope,
        location_id,
        organization_id,
        brand_id,
        audience_roles: scope === 'self' ? null : audience,
        title: config.title || null,
        accent_color: config.accentColor,
        widget_size: config.size,
        display_order: nextOrder,
      });

      toast.success(config.cubeType === 'sales-chart' ? 'Sales Overview added' : config.cubeType === 'tracker' ? 'Tracker added' : 'Data cube added');
      queryClient.invalidateQueries({ queryKey: ['dashboard-widgets'] });
    } catch (error: any) {
      console.error('Error adding data cube:', error);
      toast.error(error?.message || 'Failed to add widget');
    }
  };

  const handleAdd3DCube = async (config: New3DCubeConfig) => {
    if (!user?.id || !currentLocation?.id) return;

    try {
      const nextOrder = localCubes.reduce((m, c) => Math.max(m, c.displayOrder), -1) + 1;
      await createDashboardWidget({
        widget_type: 'data-3d',
        config: buildWidgetConfigJson({
          metrics: [],
          faceMetrics: config.faceMetrics,
          faceTitles: config.faceTitles,
          numFaces: config.numFaces,
        }),
        authority_scope: 'self',
        location_id: currentLocation.id,
        title: null,
        accent_color: config.accentColor,
        widget_size: 'small',
        display_order: nextOrder,
      });

      toast.success('3D Cube added');
      queryClient.invalidateQueries({ queryKey: ['dashboard-widgets'] });
    } catch (error: any) {
      console.error('Error adding 3D cube:', error);
      toast.error(error?.message || 'Failed to add 3D cube');
    }
  };

  // Separate cubes, trackers (promo), checklists, and sales chart for stacked layout
  const trackerCubes = localCubes.filter(c => c.cubeType === 'tracker');
  const dataCubes = localCubes.filter(c =>
    trackersOnly
      ? false
      : (c.cubeType === 'data-3d' || c.cubeType === 'data')
  );
  const salesChart = trackersOnly ? undefined : localCubes.find(c => c.cubeType === 'sales-chart');

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

  // Decide whether Promo renders before or after the Cubes section, based on
  // the user's order in Edit Dashboard (localCubes is sorted by display_order).
  const firstTrackerIdx = localCubes.findIndex(c => c.cubeType === 'tracker');
  const firstDataIdx = localCubes.findIndex(c => c.cubeType === 'data' || c.cubeType === 'data-3d');
  const promoBeforeCubes =
    trackerCubes.length > 0 &&
    (firstDataIdx === -1 || (firstTrackerIdx !== -1 && firstTrackerIdx < firstDataIdx));

  const renderCubesBlock = () => {
    if (dataCubes.length === 0) return null;
    return (
      <div key="cubes-block" className="flex flex-col gap-2">
        <DashSectionTitle>Cubes</DashSectionTitle>
        <DndContext
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
      </div>
    );
  };

  const renderPromoBlock = () => {
    if (trackerCubes.length === 0) return null;
    return (
      <div key="promo-block" className="flex flex-col gap-2">
        <DashSectionTitle>Promo</DashSectionTitle>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={trackerCubes.map(cube => cube.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-2 gap-3" data-tour="dashboard-promo">
              {trackerCubes.map(cube => (
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
      </div>
    );
  };

  const renderSection = (section: string) => {
    switch (section) {
      case 'data-cubes': {
        if (dataCubes.length === 0 && trackerCubes.length === 0) return null;
        return (
          <div key="data-cubes" className="flex flex-col gap-2.5">
            {promoBeforeCubes ? (
              <>
                {renderPromoBlock()}
                {renderCubesBlock()}
              </>
            ) : (
              <>
                {renderCubesBlock()}
                {renderPromoBlock()}
              </>
            )}
          </div>
        );
      }

      case 'checklists':
        if (!checklistsContent) return null;
        return (
          <div key="checklists" className="w-full">
            {checklistsContent}
          </div>
        );
      case 'sales-chart':
        if (!salesChart) return null;
        return (
          <div key="sales-chart" className="flex flex-col gap-2">
            <DashSectionTitle>Summary</DashSectionTitle>
            <SortableDataCube
              cube={salesChart}
              salesData={salesData}
              isLoading={isLoadingSales}
              locationSettings={locationSettings}
              isReorderMode={isReorderMode}
              onSalesDataChange={onSalesDataChange}
            />
          </div>
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
          {hasOpenedAddDialog && (
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