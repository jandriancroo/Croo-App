import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';

export function useOnboardingTour() {
  const { user } = useAuth();
  const { isShiftManager, loading: roleLoading } = useUserRole();
  const queryClient = useQueryClient();
  const [runTour, setRunTour] = useState(false);

  // Check if user has completed the tour
  const { data: hasCompleted, isLoading } = useQuery({
    queryKey: ['onboarding-completion', user?.id],
    queryFn: async () => {
      if (!user?.id) return true; // default to "completed" if no user
      const { data } = await supabase
        .from('onboarding_completions')
        .select('id')
        .eq('user_id', user.id)
        .eq('tour_id', 'main_tour')
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
    staleTime: Infinity,
  });

  // Auto-start tour for shift_manager+ who haven't completed it
  useEffect(() => {
    if (roleLoading || isLoading) return;
    if (!isShiftManager) return; // team members don't see the tour
    if (hasCompleted) return;
    // Small delay so the dashboard renders first
    const timer = setTimeout(() => setRunTour(true), 1500);
    return () => clearTimeout(timer);
  }, [roleLoading, isLoading, isShiftManager, hasCompleted]);

  const completeTour = useCallback(async (skipped: boolean) => {
    setRunTour(false);
    if (!user?.id) return;
    await supabase.from('onboarding_completions').upsert({
      user_id: user.id,
      tour_id: 'main_tour',
      skipped,
    }, { onConflict: 'user_id,tour_id' });
    queryClient.setQueryData(['onboarding-completion', user.id], true);
  }, [user?.id, queryClient]);

  const replayTour = useCallback(async () => {
    if (!user?.id) return;
    // Delete the completion record so the tour can run again
    await supabase
      .from('onboarding_completions')
      .delete()
      .eq('user_id', user.id)
      .eq('tour_id', 'main_tour');
    queryClient.setQueryData(['onboarding-completion', user.id], false);
    setRunTour(true);
  }, [user?.id, queryClient]);

  return {
    runTour,
    setRunTour,
    completeTour,
    replayTour,
    isEligible: !roleLoading && isShiftManager,
  };
}
