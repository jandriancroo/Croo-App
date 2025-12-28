import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Button } from '@/components/ui/button';
import { Plus, Settings2 } from 'lucide-react';
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
import { ChecklistCube } from './ChecklistCube';
import { TaskCube } from './TaskCube';
import { AddWidgetDialog } from './AddWidgetDialog';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { getBusinessDateInTimezone, getBusinessDayRangeInTimezone } from '@/utils/timezoneUtils';
import { toast } from 'sonner';

type WidgetType = 'data' | 'checklist' | 'task';

interface WidgetConfig {
  id: string;
  title: string;
  widgetType: WidgetType;
  size: WidgetSize;
  metrics: MetricType[];
  referenceId?: string;
  accentColor: string;
  displayOrder: number;
}

interface ChecklistCompletionData {
  checklistId: string;
  expected: number;
  completed: number;
}

interface TaskCompletionData {
  taskId: string;
  isCompleted: boolean;
  subtaskCount: number;
  completedSubtasks: number;
}

interface SortableWidgetProps {
  widget: WidgetConfig;
  salesData: SalesDataForWidgets | null;
  isLoading: boolean;
  checklistData: Record<string, ChecklistCompletionData>;
  taskData: Record<string, TaskCompletionData>;
  onDelete: (id: string) => void;
}

function SortableWidget({ widget, salesData, isLoading, checklistData, taskData, onDelete }: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Determine grid span based on size
  const gridClass = widget.size === 'small' ? 'col-span-1' : 'col-span-2';

  if (widget.widgetType === 'checklist' && widget.referenceId) {
    const data = checklistData[widget.referenceId];
    return (
      <div ref={setNodeRef} style={style} className={gridClass}>
        <ChecklistCube
          checklistId={widget.referenceId}
          title={widget.title}
          completed={data?.completed || 0}
          expected={data?.expected || 0}
          accentColor={widget.accentColor}
          dragHandleProps={{ ...attributes, ...listeners }}
          isDragging={isDragging}
        />
      </div>
    );
  }

  if (widget.widgetType === 'task' && widget.referenceId) {
    const data = taskData[widget.referenceId];
    return (
      <div ref={setNodeRef} style={style} className={gridClass}>
        <TaskCube
          taskId={widget.referenceId}
          title={widget.title}
          isCompleted={data?.isCompleted || false}
          subtaskCount={data?.subtaskCount || 0}
          completedSubtasks={data?.completedSubtasks || 0}
          accentColor={widget.accentColor}
          dragHandleProps={{ ...attributes, ...listeners }}
          isDragging={isDragging}
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className={gridClass}>
      <DashboardWidget
        title={widget.title}
        size={widget.size}
        metrics={widget.metrics}
        accentColor={widget.accentColor}
        salesData={salesData}
        isLoading={isLoading}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

interface WidgetsSectionProps {
  salesData: SalesDataForWidgets | null;
  isLoadingSales?: boolean;
  showEditButton?: boolean;
  hasQuBeyondIntegration?: boolean;
}

export function WidgetsSection({ 
  salesData, 
  isLoadingSales = false, 
  showEditButton = false,
  hasQuBeyondIntegration = true,
}: WidgetsSectionProps) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
  const queryClient = useQueryClient();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [checklistData, setChecklistData] = useState<Record<string, ChecklistCompletionData>>({});
  const [taskData, setTaskData] = useState<Record<string, TaskCompletionData>>({});
  const [localWidgets, setLocalWidgets] = useState<WidgetConfig[]>([]);

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

  // Fetch user's dashboard widgets
  const { data: widgets = [], isLoading } = useQuery({
    queryKey: ['user-dashboard-widgets', user?.id, currentLocation?.id],
    queryFn: async () => {
      if (!user?.id || !currentLocation?.id) return [];

      const { data, error } = await supabase
        .from('user_dashboard_cubes')
        .select('*')
        .eq('user_id', user.id)
        .eq('location_id', currentLocation.id)
        .order('display_order');

      if (error) {
        console.error('Error fetching dashboard widgets:', error);
        return [];
      }

      return (data || []).map(widget => ({
        id: widget.id,
        title: widget.title || '',
        widgetType: (widget.cube_type as WidgetType) || 'data',
        size: (widget.widget_size as WidgetSize) || 'small',
        metrics: (widget.metrics as MetricType[]) || [],
        referenceId: widget.reference_id || undefined,
        accentColor: widget.accent_color || '#8B5CF6',
        displayOrder: widget.display_order,
      })) as WidgetConfig[];
    },
    enabled: !!user?.id && !!currentLocation?.id,
  });

  // Sync local widgets state with fetched data
  useEffect(() => {
    setLocalWidgets(widgets);
  }, [widgets]);

  // Fetch available checklists
  const { data: checklists = [] } = useQuery({
    queryKey: ['checklists-for-widgets', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      const { data, error } = await supabase
        .from('checklists')
        .select('id, title, frequency')
        .eq('location_id', currentLocation.id)
        .eq('is_active', true)
        .order('title');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation?.id,
  });

  // Fetch available temporary tasks
  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks-for-widgets', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      const { data, error } = await supabase
        .from('temporary_tasks')
        .select('id, title, expires_at')
        .eq('location_id', currentLocation.id)
        .eq('is_active', true)
        .is('completed_at', null)
        .order('expires_at');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation?.id,
  });

  // Fetch completion data for checklist widgets
  useEffect(() => {
    const loadChecklistData = async () => {
      const checklistWidgets = localWidgets.filter(w => w.widgetType === 'checklist' && w.referenceId);
      if (checklistWidgets.length === 0 || !currentLocation?.id) return;

      const businessDateStr = getBusinessDateInTimezone(timezone);
      const { start: periodStart, end: periodEnd } = getBusinessDayRangeInTimezone(businessDateStr, timezone);
      
      const dataMap: Record<string, ChecklistCompletionData> = {};
      
      for (const widget of checklistWidgets) {
        const checklistId = widget.referenceId!;
        
        const { data: items } = await supabase
          .from('checklist_items')
          .select('id')
          .eq('checklist_id', checklistId);
        
        const itemCount = items?.length || 0;
        
        const { data: submissions } = await supabase
          .from('checklist_submissions')
          .select('id, checklist_responses(id, item_id)')
          .eq('checklist_id', checklistId)
          .eq('location_id', currentLocation.id)
          .gte('submitted_at', periodStart.toISOString())
          .lte('submitted_at', periodEnd.toISOString());
        
        const uniqueItemIds = new Set<string>();
        submissions?.forEach((sub: any) => {
          sub.checklist_responses?.forEach((response: any) => {
            if (response.item_id) uniqueItemIds.add(response.item_id);
          });
        });
        
        dataMap[checklistId] = {
          checklistId,
          expected: itemCount,
          completed: uniqueItemIds.size,
        };
      }
      
      setChecklistData(dataMap);
    };

    loadChecklistData();
  }, [localWidgets, currentLocation?.id, timezone]);

  // Fetch completion data for task widgets
  useEffect(() => {
    const loadTaskData = async () => {
      const taskWidgets = localWidgets.filter(w => w.widgetType === 'task' && w.referenceId);
      if (taskWidgets.length === 0) return;

      const dataMap: Record<string, TaskCompletionData> = {};
      
      for (const widget of taskWidgets) {
        const taskId = widget.referenceId!;
        
        const { data: task } = await supabase
          .from('temporary_tasks')
          .select('id, completed_at')
          .eq('id', taskId)
          .single();
        
        const { data: subtasks } = await supabase
          .from('temporary_task_subtasks')
          .select('id, completed_at')
          .eq('task_id', taskId);
        
        const subtaskCount = subtasks?.length || 0;
        const completedSubtasks = subtasks?.filter(s => s.completed_at).length || 0;
        
        dataMap[taskId] = {
          taskId,
          isCompleted: !!task?.completed_at,
          subtaskCount,
          completedSubtasks,
        };
      }
      
      setTaskData(dataMap);
    };

    loadTaskData();
  }, [localWidgets]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;

    const oldIndex = localWidgets.findIndex(w => w.id === active.id);
    const newIndex = localWidgets.findIndex(w => w.id === over.id);
    
    const newOrder = arrayMove(localWidgets, oldIndex, newIndex);
    setLocalWidgets(newOrder);

    // Save new order to database
    try {
      const updates = newOrder.map((widget, index) => ({
        id: widget.id,
        display_order: index,
      }));

      for (const update of updates) {
        await supabase
          .from('user_dashboard_cubes')
          .update({ display_order: update.display_order })
          .eq('id', update.id);
      }
    } catch (error) {
      console.error('Error saving widget order:', error);
      toast.error('Failed to save widget order');
      setLocalWidgets(widgets); // Revert on error
    }
  };

  const handleAddWidget = async (config: {
    title: string;
    widgetType: WidgetType;
    size: WidgetSize;
    metrics: MetricType[];
    referenceId?: string;
    accentColor: string;
  }) => {
    if (!user?.id || !currentLocation?.id) return;

    try {
      const { error } = await supabase
        .from('user_dashboard_cubes')
        .insert({
          user_id: user.id,
          location_id: currentLocation.id,
          title: config.title || null,
          cube_type: config.widgetType,
          widget_size: config.size,
          metrics: config.widgetType === 'data' ? config.metrics : [],
          reference_id: config.referenceId || null,
          accent_color: config.accentColor,
          display_order: localWidgets.length,
        });

      if (error) throw error;

      toast.success('Data cube added');
      queryClient.invalidateQueries({ queryKey: ['user-dashboard-widgets'] });
    } catch (error) {
      console.error('Error adding widget:', error);
      toast.error('Failed to add data cube');
    }
  };

  const handleDeleteWidget = async (id: string) => {
    try {
      const { error } = await supabase
        .from('user_dashboard_cubes')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Data cube removed');
      queryClient.invalidateQueries({ queryKey: ['user-dashboard-widgets'] });
    } catch (error) {
      console.error('Error deleting widget:', error);
      toast.error('Failed to remove data cube');
    }
  };

  const existingChecklistIds = localWidgets.filter(w => w.widgetType === 'checklist').map(w => w.referenceId!);
  const existingTaskIds = localWidgets.filter(w => w.widgetType === 'task').map(w => w.referenceId!);

  return (
    <div className="space-y-3">
      {/* Widgets Grid with Drag & Drop */}
      {localWidgets.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={localWidgets.map(w => w.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-2 gap-3">
              {localWidgets.map(widget => (
                <SortableWidget
                  key={widget.id}
                  widget={widget}
                  salesData={salesData}
                  isLoading={isLoadingSales}
                  checklistData={checklistData}
                  taskData={taskData}
                  onDelete={handleDeleteWidget}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add Data Cube Dialog */}

      {/* Add Widget Dialog */}
      <AddWidgetDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onAdd={handleAddWidget}
        checklists={checklists}
        tasks={tasks}
        existingChecklistIds={existingChecklistIds}
        existingTaskIds={existingTaskIds}
        defaultColorIndex={localWidgets.length}
      />
    </div>
  );
}
