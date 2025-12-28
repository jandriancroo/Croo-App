import { useState, useEffect, ReactNode, useMemo } from 'react';
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
import { AddWidgetDialog, NewDataCubeConfig, CubeType } from './AddWidgetDialog';
import { SalesOverview } from './SalesOverview';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, GripVertical } from 'lucide-react';

// Sales chart accent color - teal to match the chart bars
const SALES_CHART_COLOR = '#0D9488';
const CHECKLISTS_BLOCK_ID = 'checklists-block';

interface DataCubeConfig {
  id: string;
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  displayOrder: number;
  cubeType: CubeType;
}

type SortableItem = DataCubeConfig | { id: typeof CHECKLISTS_BLOCK_ID; cubeType: 'checklists' };

interface SortableDataCubeProps {
  cube: DataCubeConfig;
  salesData: SalesDataForWidgets | null;
  isLoading: boolean;
  locationSettings?: { hours_open?: string; hours_close?: string } | null;
  isReorderMode: boolean;
}

interface SortableChecklistsBlockProps {
  children: ReactNode;
  isReorderMode: boolean;
}

function SortableDataCube({ cube, salesData, isLoading, locationSettings, isReorderMode }: SortableDataCubeProps) {
  const [salesOverviewOpen, setSalesOverviewOpen] = useState(() => {
    const saved = localStorage.getItem('dashboard-sales-overview-open');
    return saved !== null ? JSON.parse(saved) : true;
  });
  
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

  // For sales-chart type, render the SalesOverview component with matching cube style
  if (cube.cubeType === 'sales-chart') {
    return (
      <div 
        ref={setNodeRef} 
        style={style} 
        className={`col-span-2 ${isDragging ? 'opacity-50' : ''} relative`}
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
          {/* Colored header matching other cubes */}
          <Collapsible 
            open={salesOverviewOpen} 
            onOpenChange={(open) => {
              if (!isReorderMode) {
                setSalesOverviewOpen(open);
                localStorage.setItem('dashboard-sales-overview-open', JSON.stringify(open));
              }
            }}
          >
            <CollapsibleTrigger asChild disabled={isReorderMode}>
              <button 
                className={`w-full px-3 py-2 flex items-center justify-between transition-opacity ${isReorderMode ? 'opacity-85 pointer-events-none' : 'cursor-pointer hover:opacity-90'}`}
                style={{ backgroundColor: SALES_CHART_COLOR }}
              >
                <span className="text-sm font-semibold text-white">Sales Overview</span>
                <ChevronDown className={`h-4 w-4 text-white/80 transition-transform duration-200 ${salesOverviewOpen ? 'rotate-180' : ''}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className={isReorderMode ? 'opacity-85' : ''}>
              <SalesOverview locationSettings={locationSettings} />
            </CollapsibleContent>
          </Collapsible>
        </Card>
      </div>
    );
  }

  // Determine grid span based on size for data cubes
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

function SortableChecklistsBlock({ children, isReorderMode }: SortableChecklistsBlockProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: CHECKLISTS_BLOCK_ID, disabled: !isReorderMode });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className={`col-span-2 ${isDragging ? 'opacity-50' : ''} relative`}
      {...(isReorderMode ? { ...attributes, ...listeners } : {})}
    >
      {/* Reorder overlay */}
      {isReorderMode && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 rounded-lg pointer-events-none">
          <div className="p-3 rounded-full bg-primary/20">
            <GripVertical className="h-6 w-6 text-primary" />
          </div>
        </div>
      )}
      <div className={isReorderMode ? 'opacity-85 cursor-grab active:cursor-grabbing' : ''}>
        {children}
      </div>
    </div>
  );
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
}

export function WidgetsSection({ 
  salesData, 
  isLoadingSales = false, 
  hasQuBeyondIntegration = true,
  showAddDialog: externalShowAddDialog,
  onAddDialogChange,
  locationSettings,
  isReorderMode = false,
  checklistsContent,
}: WidgetsSectionProps) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();
  const [internalShowAddDialog, setInternalShowAddDialog] = useState(false);
  const [localCubes, setLocalCubes] = useState<DataCubeConfig[]>([]);
  
  // Create location-specific storage key for checklists position
  const checklistsPositionKey = `dashboard-checklists-position-${currentLocation?.id || 'default'}`;
  
  // Track checklists block position (stored as index in the order)
  const [checklistsPosition, setChecklistsPosition] = useState<number>(-1); // -1 means at the end
  
  // Load checklists position from localStorage when location changes
  useEffect(() => {
    if (currentLocation?.id) {
      const saved = localStorage.getItem(checklistsPositionKey);
      setChecklistsPosition(saved !== null ? parseInt(saved, 10) : -1);
    }
  }, [currentLocation?.id, checklistsPositionKey]);

  // Use external control if provided, otherwise use internal state
  const showAddDialog = externalShowAddDialog !== undefined ? externalShowAddDialog : internalShowAddDialog;
  const setShowAddDialog = onAddDialogChange || setInternalShowAddDialog;

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

  // Fetch user's data cubes (both 'data' and 'sales-chart' types)
  const { data: cubes = [], isLoading } = useQuery({
    queryKey: ['user-data-cubes', user?.id, currentLocation?.id],
    queryFn: async () => {
      if (!user?.id || !currentLocation?.id) return [];

      const { data, error } = await supabase
        .from('user_dashboard_cubes')
        .select('*')
        .eq('user_id', user.id)
        .eq('location_id', currentLocation.id)
        .in('cube_type', ['data', 'sales-chart'])
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
        cubeType: (cube.cube_type as CubeType) || 'data',
      })) as DataCubeConfig[];
    },
    enabled: !!user?.id && !!currentLocation?.id,
  });

  // Check if sales chart already exists
  const hasSalesChart = localCubes.some(c => c.cubeType === 'sales-chart');

  // Sync local cubes state with fetched data
  useEffect(() => {
    setLocalCubes(cubes);
  }, [cubes]);

  // Build combined sortable items list (cubes + checklists block) - memoized
  const sortableItems = useMemo((): SortableItem[] => {
    const items: SortableItem[] = [...localCubes];
    
    if (checklistsContent) {
      const checklistsBlock: SortableItem = { id: CHECKLISTS_BLOCK_ID, cubeType: 'checklists' };
      // Insert at saved position, or at end if position is invalid
      const insertAt = checklistsPosition >= 0 && checklistsPosition <= items.length 
        ? checklistsPosition 
        : items.length;
      items.splice(insertAt, 0, checklistsBlock);
    }
    
    return items;
  }, [localCubes, checklistsContent, checklistsPosition]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = sortableItems.findIndex(item => item.id === active.id);
    const newIndex = sortableItems.findIndex(item => item.id === over.id);

    const newOrder = arrayMove(sortableItems, oldIndex, newIndex);
    
    // Find new position of checklists block
    const newChecklistsIndex = newOrder.findIndex(item => item.id === CHECKLISTS_BLOCK_ID);
    if (newChecklistsIndex !== -1) {
      setChecklistsPosition(newChecklistsIndex);
      localStorage.setItem(checklistsPositionKey, String(newChecklistsIndex));
    }
    
    // Extract just the cubes (not checklists block) and update their order
    const cubesOnly = newOrder.filter((item): item is DataCubeConfig => item.id !== CHECKLISTS_BLOCK_ID);
    setLocalCubes(cubesOnly);

    // Persist the new cube order to database
    try {
      const updates = cubesOnly.map((cube, index) => ({
        id: cube.id,
        display_order: index,
      }));

      const results = await Promise.all(
        updates.map((update) =>
          supabase
            .from('user_dashboard_cubes')
            .update({ display_order: update.display_order })
            .eq('id', update.id)
        )
      );

      const firstError = results.find((r) => r.error)?.error;
      if (firstError) throw firstError;

      queryClient.invalidateQueries({
        queryKey: ['user-data-cubes', user?.id, currentLocation?.id],
      });
    } catch (error) {
      console.error('Error saving cube order:', error);
      toast.error('Failed to save cube order');
      setLocalCubes(cubes); // Revert on error
    }
  };

  const handleAddCube = async (config: NewDataCubeConfig) => {
    if (!user?.id || !currentLocation?.id) return;

    try {
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
          display_order: localCubes.length,
        });

      if (error) throw error;

      toast.success(config.cubeType === 'sales-chart' ? 'Sales Overview added' : 'Data cube added');
      queryClient.invalidateQueries({ queryKey: ['user-data-cubes'] });
    } catch (error) {
      console.error('Error adding data cube:', error);
      toast.error('Failed to add widget');
    }
  };

  // If no cubes and no checklists content, just show the dialog
  if (localCubes.length === 0 && !checklistsContent) {
    return (
      <AddWidgetDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onAdd={handleAddCube}
        defaultColorIndex={0}
        hasSalesChart={false}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Data Cubes Grid with Drag & Drop */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortableItems.map(item => item.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-2 gap-3">
            {sortableItems.map(item => {
              if (item.id === CHECKLISTS_BLOCK_ID) {
                return (
                  <SortableChecklistsBlock key={CHECKLISTS_BLOCK_ID} isReorderMode={isReorderMode}>
                    {checklistsContent}
                  </SortableChecklistsBlock>
                );
              }
              
              const cube = item as DataCubeConfig;
              return (
                <SortableDataCube
                  key={cube.id}
                  cube={cube}
                  salesData={salesData}
                  isLoading={isLoadingSales}
                  locationSettings={locationSettings}
                  isReorderMode={isReorderMode}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add Data Cube Dialog */}
      <AddWidgetDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onAdd={handleAddCube}
        defaultColorIndex={localCubes.length}
        hasSalesChart={hasSalesChart}
      />
    </div>
  );
}