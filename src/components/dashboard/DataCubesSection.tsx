import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Button } from '@/components/ui/button';
import { Settings2 } from 'lucide-react';
import { DataCube, MetricType, SalesDataForCubes } from './DataCube';
import { ChecklistCard } from './ChecklistCard';
import { TaskCube } from './TaskCube';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';

// Section types (sections are now mandatory, keeping types for reference)
export type SectionKey = 'data-cubes' | 'sales-overview' | 'assigned-tasks' | 'event-tasks' | 'cash-handling' | 'catering-orders' | 'checklists';

export interface SectionConfig {
  key: SectionKey;
  isVisible: boolean;
  displayOrder: number;
}

// Hook to get section visibility preferences
// Note: Sections are now mandatory, but keeping this hook in case of future needs
export function useDashboardSections() {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();

  const { data: sectionConfigs = [], isLoading } = useQuery({
    queryKey: ['user-dashboard-sections', user?.id, currentLocation?.id],
    queryFn: async () => {
      if (!user?.id || !currentLocation?.id) return [];

      const { data, error } = await supabase
        .from('user_dashboard_sections')
        .select('*')
        .eq('user_id', user.id)
        .eq('location_id', currentLocation.id)
        .order('display_order');

      if (error) {
        console.error('Error fetching dashboard sections:', error);
        return [];
      }

      return (data || []).map(s => ({
        key: s.section_key as SectionKey,
        isVisible: s.is_visible,
        displayOrder: s.display_order,
      })) as SectionConfig[];
    },
    enabled: !!user?.id && !!currentLocation?.id,
    staleTime: 60 * 1000, // 1 min cache - sections rarely change
  });

  // All sections are now mandatory - always return true
  const isSectionVisible = (_key: SectionKey): boolean => {
    return true;
  };

  const refreshSections = () => {
    queryClient.invalidateQueries({ 
      queryKey: ['user-dashboard-sections', user?.id, currentLocation?.id] 
    });
  };

  return {
    sectionConfigs,
    isSectionVisible,
    isLoading,
    refreshSections,
  };
}
