import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Button } from '@/components/ui/button';
import { Settings2 } from 'lucide-react';
import { DataCube, MetricType, SalesDataForCubes } from './DataCube';
import { EditDashboardDialog } from './EditDashboardDialog';

interface CubeConfig {
  id: string;
  title: string;
  metrics: MetricType[];
  accentColor: string;
  displayOrder: number;
}

interface DataCubesSectionProps {
  salesData: SalesDataForCubes | null;
  isLoadingSales?: boolean;
}

export function DataCubesSection({ salesData, isLoadingSales = false }: DataCubesSectionProps) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();
  const [showEditDialog, setShowEditDialog] = useState(false);

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
        metrics: (cube.metrics as MetricType[]) || [],
        accentColor: cube.accent_color || '#8B5CF6',
        displayOrder: cube.display_order,
      })) as CubeConfig[];
    },
    enabled: !!user?.id && !!currentLocation?.id,
  });

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
        {cubes.map((cube) => (
          <DataCube
            key={cube.id}
            title={cube.title}
            metrics={cube.metrics}
            accentColor={cube.accentColor}
            salesData={salesData}
            isLoading={isLoadingSales}
            onClick={() => setShowEditDialog(true)}
          />
        ))}
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
