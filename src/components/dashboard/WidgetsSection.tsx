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
import { AddWidgetDialog, NewDataCubeConfig, CubeType } from './AddWidgetDialog';
import { SalesOverview } from './SalesOverview';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ChevronDown, Trash2, MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface DataCubeConfig {
  id: string;
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  displayOrder: number;
  cubeType: CubeType;
}

interface SortableDataCubeProps {
  cube: DataCubeConfig;
  salesData: SalesDataForWidgets | null;
  isLoading: boolean;
  locationSettings?: { hours_open?: string; hours_close?: string } | null;
  onDelete: (id: string) => void;
}

function SortableDataCube({ cube, salesData, isLoading, locationSettings, onDelete }: SortableDataCubeProps) {
  const [salesOverviewOpen, setSalesOverviewOpen] = useState(() => {
    const saved = localStorage.getItem('dashboard-sales-overview-open');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  
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

  // For sales-chart type, render the SalesOverview component
  if (cube.cubeType === 'sales-chart') {
    return (
      <div ref={setNodeRef} style={style} className="col-span-2 relative group">
        <Collapsible 
          open={salesOverviewOpen} 
          onOpenChange={(open) => {
            setSalesOverviewOpen(open);
            localStorage.setItem('dashboard-sales-overview-open', JSON.stringify(open));
          }}
        >
          <div className="flex items-center">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex-1 flex items-center justify-between px-3 py-2 h-auto hover:bg-muted/50 rounded-lg">
                <span className="text-base font-semibold">Sales Overview</span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${salesOverviewOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            
            {/* Delete menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem 
                  className="text-destructive focus:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <CollapsibleContent>
            <SalesOverview locationSettings={locationSettings} />
          </CollapsibleContent>
        </Collapsible>
        
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Sales Overview?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the Sales Overview from your dashboard. You can add it back anytime.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(cube.id)}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // Determine grid span based on size for data cubes
  const gridClass = cube.size === 'small' ? 'col-span-1' : 'col-span-2';

  return (
    <div ref={setNodeRef} style={style} className={`${gridClass} relative group`}>
      <DashboardWidget
        title={cube.title}
        size={cube.size}
        metrics={cube.metrics}
        accentColor={cube.accentColor}
        salesData={salesData}
        isLoading={isLoading}
        isDragging={isDragging}
      />
      
      {/* Delete button overlay */}
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/80 hover:bg-background">
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem 
              className="text-destructive focus:text-destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this cube?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{cube.title || 'Data Cube'}" from your dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDelete(cube.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
}

export function WidgetsSection({ 
  salesData, 
  isLoadingSales = false, 
  hasQuBeyondIntegration = true,
  showAddDialog: externalShowAddDialog,
  onAddDialogChange,
  locationSettings,
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

  const handleDeleteCube = async (id: string) => {
    try {
      const { error } = await supabase
        .from('user_dashboard_cubes')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Widget removed');
      queryClient.invalidateQueries({ queryKey: ['user-data-cubes'] });
    } catch (error) {
      console.error('Error deleting cube:', error);
      toast.error('Failed to remove widget');
    }
  };

  if (localCubes.length === 0) {
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
                locationSettings={locationSettings}
                onDelete={handleDeleteCube}
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
        hasSalesChart={hasSalesChart}
      />
    </div>
  );
}