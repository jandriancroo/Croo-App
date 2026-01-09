import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { MetricType, WidgetSize } from '@/components/dashboard/DashboardWidget';
import { CubeType } from '@/components/dashboard/AddWidgetDialog';

export interface RoleCubeConfig {
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

// Map user role to the role key used in role_dashboard_cubes
function getRoleCubeKey(userRole: {
  isAdmin: boolean;
  isGeneralManager: boolean;
  isManager: boolean;
  isShiftManager: boolean;
}): string | null {
  // Admins and higher get personal freedom - no role-based cubes
  if (userRole.isAdmin) return null;
  
  // Check roles in order of hierarchy
  if (userRole.isGeneralManager) return 'general_manager';
  if (userRole.isManager) return 'manager';
  if (userRole.isShiftManager) return 'shift_manager';
  
  // Default to team_member
  return 'team_member';
}

/**
 * Hook to fetch role-based dashboard cubes for the current user
 * Returns the cubes configured by the Org Admin for the user's role
 * Returns null for Admin+ (they have personal freedom)
 */
export function useRoleDashboardCubes(organizationId: string | null) {
  const { user } = useAuth();
  const userRole = useUserRole();
  
  const roleKey = getRoleCubeKey(userRole);
  
  return useQuery({
    queryKey: ['role-dashboard-cubes', organizationId, roleKey],
    queryFn: async () => {
      if (!organizationId || !roleKey) return null;
      
      const { data, error } = await supabase
        .from('role_dashboard_cubes')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('role', roleKey)
        .maybeSingle();
      
      if (error) {
        console.error('Error fetching role dashboard cubes:', error);
        return null;
      }
      
      if (!data || !data.cubes) return null;
      
      // Parse the cubes JSON array
      const cubesData = data.cubes as any[];
      if (!Array.isArray(cubesData) || cubesData.length === 0) return null;
      
      return cubesData.map((cube, index) => ({
        id: cube.id || `role-cube-${index}`,
        title: cube.title || '',
        size: (cube.size as WidgetSize) || 'small',
        metrics: (cube.metrics as MetricType[]) || [],
        accentColor: cube.accentColor || '#8B5CF6',
        cubeType: (cube.cubeType as CubeType | 'data-3d') || 'data',
        faceMetrics: (cube.faceMetrics as MetricType[][]) || [],
        faceTitles: (cube.faceTitles as string[]) || [],
        numFaces: cube.numFaces || 1,
        displayOrder: index,
      })) as RoleCubeConfig[];
    },
    enabled: !!organizationId && !!roleKey && !!user?.id,
    staleTime: 60 * 1000, // 1 min cache - role configs rarely change
  });
}

/**
 * Hook to check if user should use role-based cubes (vs personal cubes)
 * Returns true for TM/SM/Manager if role cubes are configured
 */
export function useShouldUseRoleCubes(organizationId: string | null) {
  const { data: roleCubes, isLoading } = useRoleDashboardCubes(organizationId);
  const userRole = useUserRole();
  
  const roleKey = getRoleCubeKey(userRole);
  
  // Admin+ always uses personal cubes
  if (!roleKey) {
    return { shouldUseRoleCubes: false, isLoading: false };
  }
  
  // For TM/SM/Manager: use role cubes if configured, otherwise show nothing
  return {
    shouldUseRoleCubes: true, // Always use role-based system for non-admin
    roleCubes: roleCubes || [], // Empty array if not configured
    isLoading,
  };
}
