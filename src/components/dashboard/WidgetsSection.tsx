import { useState, useEffect } from 'react';
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
import { AddWidgetDialog, NewDataCubeConfig } from './AddWidgetDialog';
import { toast } from 'sonner';

interface DataCubeConfig {
  id: string;
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  displayOrder: number;
}

interface SortableDataCubeProps {
  cube: DataCubeConfig;
  salesData: SalesDataForWidgets | null;
  isLoading: boolean;
}

function SortableDataCube({ cube, salesData, isLoading }: SortableDataCubeProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cube.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Determine grid span based on size
  const gridClass = cube.size === 'small' ? 'col-span-1' : 'col-span-2';

  return (
    <div ref={setNodeRef} style={style} className={gridClass}>
      <DashboardWidget
        title={cube.title}
        size={cube.size}
        metrics={cube.metrics}
        accentColor={cube.accentColor}
        salesData={salesData}
        isLoading={isLoading}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </div>
  );
}

interface WidgetsSectionProps {
  salesData: SalesDataForWidgets | null;
  isLoadingSales?: boolean;
  hasQuBeyondIntegration?: boolean;
  showAddDialog?: boolean;
  onAddDialogChange?: (open: boolean) => void;
}

export function WidgetsSection({ 
  salesData, 
  isLoadingSales = false, 
  hasQuBeyondIntegration = true,
  showAddDialog: externalShowAddDialog,
  onAddDialogChange,
}: WidgetsSectionProps) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();
  const [internalShowAddDialog, setInternalShowAddDialog] = useState(false);
  const [localCubes, setLocalCubes] = useState<DataCubeConfig[]>([]);

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

  // Fetch user's data cubes (only 'data' type now)
  const { data: cubes = [], isLoading } = useQuery({
    queryKey: ['user-data-cubes', user?.id, currentLocation?.id],
    queryFn: async () => {
      if (!user?.id || !currentLocation?.id) return [];

      const { data, error } = await supabase
        .from('user_dashboard_cubes')
        .select('*')
        .eq('user_id', user.id)
        .eq('location_id', currentLocation.id)
        .eq('cube_type', 'data')
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
      })) as DataCubeConfig[];
    },
    enabled: !!user?.id && !!currentLocation?.id,
  });

  // Sync local cubes state with fetched data
  useEffect(() => {
    setLocalCubes(cubes);
  }, [cubes]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = localCubes.findIndex(c => c.id === active.id);
    const newIndex = localCubes.findIndex(c => c.id === over.id);

    const newOrder = arrayMove(localCubes, oldIndex, newIndex);
    setLocalCubes(newOrder);

    // Persist the new order
    try {
      const updates = newOrder.map((cube, index) => ({
        id: cube.id,
        display_order: index,
      }));

      for (const update of updates) {
        await supabase
          .from('user_dashboard_cubes')
          .update({ display_order: update.display_order })
          .eq('id', update.id);
      }
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
          cube_type: 'data',
          widget_size: config.size,
          metrics: config.metrics,
          accent_color: config.accentColor,
          display_order: localCubes.length,
        });

      if (error) throw error;

      toast.success('Data cube added');
      queryClient.invalidateQueries({ queryKey: ['user-data-cubes'] });
    } catch (error) {
      console.error('Error adding data cube:', error);
      toast.error('Failed to add data cube');
    }
  };

  if (localCubes.length === 0) {
    return (
      <AddWidgetDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onAdd={handleAddCube}
        defaultColorIndex={0}
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
          items={localCubes.map(c => c.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-2 gap-3">
            {localCubes.map(cube => (
              <SortableDataCube
                key={cube.id}
                cube={cube}
                salesData={salesData}
                isLoading={isLoadingSales}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add Data Cube Dialog */}
      <AddWidgetDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onAdd={handleAddCube}
        defaultColorIndex={localCubes.length}
      />
    </div>
  );
}