import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Button } from '@/components/ui/button';
import { Settings2 } from 'lucide-react';
import { DataCube, MetricType, SalesDataForCubes } from './DataCube';
import { ChecklistCube } from './ChecklistCube';
import { TaskCube } from './TaskCube';
import { EditDashboardDialog } from './EditDashboardDialog';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { getBusinessDateInTimezone, getBusinessDayRangeInTimezone } from '@/utils/timezoneUtils';

type CubeType = 'data' | 'checklist' | 'task';

interface CubeConfig {
  id: string;
  title: string;
  cubeType: CubeType;
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

interface DataCubesSectionProps {
  salesData: SalesDataForCubes | null;
  isLoadingSales?: boolean;
}

export function DataCubesSection({ salesData, isLoadingSales = false }: DataCubesSectionProps) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
  const queryClient = useQueryClient();
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [checklistData, setChecklistData] = useState<Record<string, ChecklistCompletionData>>({});
  const [taskData, setTaskData] = useState<Record<string, TaskCompletionData>>({});

  // Fetch user's dashboard cubes
  const { data: cubes = [], isLoading } = useQuery({
    queryKey: ['user-dashboard-cubes', user?.id, currentLocation?.id],
    queryFn: async () => {
      if (!user?.id || !currentLocation?.id) return [];

      const { data, error } = await supabase
        .from('user_dashboard_cubes')
        .select('*')
        .eq('user_id', user.id)
        .eq('location_id', currentLocation.id)
        .order('display_order');

      if (error) {
        console.error('Error fetching dashboard cubes:', error);
        return [];
      }

      return (data || []).map(cube => ({
        id: cube.id,
        title: cube.title || '',
        cubeType: (cube.cube_type as CubeType) || 'data',
        metrics: (cube.metrics as MetricType[]) || [],
        referenceId: cube.reference_id || undefined,
        accentColor: cube.accent_color || '#8B5CF6',
        displayOrder: cube.display_order,
      })) as CubeConfig[];
    },
    enabled: !!user?.id && !!currentLocation?.id,
  });

  // Fetch completion data for checklist cubes
  useEffect(() => {
    const loadChecklistData = async () => {
      const checklistCubes = cubes.filter(c => c.cubeType === 'checklist' && c.referenceId);
      if (checklistCubes.length === 0 || !currentLocation?.id) return;

      const businessDateStr = getBusinessDateInTimezone(timezone);
      const { start: periodStart, end: periodEnd } = getBusinessDayRangeInTimezone(businessDateStr, timezone);
      
      const dataMap: Record<string, ChecklistCompletionData> = {};
      
      for (const cube of checklistCubes) {
        const checklistId = cube.referenceId!;
        
        // Get checklist items
        const { data: items } = await supabase
          .from('checklist_items')
          .select('id')
          .eq('checklist_id', checklistId);
        
        const itemCount = items?.length || 0;
        
        // Get submissions for today
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
  }, [cubes, currentLocation?.id, timezone]);

  // Fetch completion data for task cubes
  useEffect(() => {
    const loadTaskData = async () => {
      const taskCubes = cubes.filter(c => c.cubeType === 'task' && c.referenceId);
      if (taskCubes.length === 0) return;

      const dataMap: Record<string, TaskCompletionData> = {};
      
      for (const cube of taskCubes) {
        const taskId = cube.referenceId!;
        
        // Get task and subtasks
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
  }, [cubes]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ 
      queryKey: ['user-dashboard-cubes', user?.id, currentLocation?.id] 
    });
  };

  // Don't render anything if no cubes (they'll add via Edit Dashboard in reorder mode)
  if (cubes.length === 0) {
    return (
      <EditDashboardDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        locationId={currentLocation?.id || ''}
        existingCubes={cubes}
        onSave={handleRefresh}
        salesData={salesData}
      />
    );
  }

  const renderCube = (cube: CubeConfig) => {
    if (cube.cubeType === 'checklist' && cube.referenceId) {
      const data = checklistData[cube.referenceId];
      return (
        <ChecklistCube
          key={cube.id}
          checklistId={cube.referenceId}
          title={cube.title}
          completed={data?.completed || 0}
          expected={data?.expected || 0}
          accentColor={cube.accentColor}
          onClick={() => setShowEditDialog(true)}
        />
      );
    }
    
    if (cube.cubeType === 'task' && cube.referenceId) {
      const data = taskData[cube.referenceId];
      return (
        <TaskCube
          key={cube.id}
          taskId={cube.referenceId}
          title={cube.title}
          isCompleted={data?.isCompleted || false}
          subtaskCount={data?.subtaskCount || 0}
          completedSubtasks={data?.completedSubtasks || 0}
          accentColor={cube.accentColor}
          onClick={() => setShowEditDialog(true)}
        />
      );
    }
    
    return (
      <DataCube
        key={cube.id}
        title={cube.title}
        metrics={cube.metrics}
        accentColor={cube.accentColor}
        salesData={salesData}
        isLoading={isLoadingSales}
        onClick={() => setShowEditDialog(true)}
      />
    );
  };

  return (
    <div className="space-y-3">
      {/* Header with edit button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Data Cubes</h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setShowEditDialog(true)}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Edit
        </Button>
      </div>

      {/* Cubes Grid - 2 columns on mobile */}
      <div className="grid grid-cols-2 gap-3">
        {cubes.map(renderCube)}
      </div>

      <EditDashboardDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        locationId={currentLocation?.id || ''}
        existingCubes={cubes}
        onSave={handleRefresh}
        salesData={salesData}
      />
    </div>
  );
}
