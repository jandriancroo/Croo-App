import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Detects the current user's position based on:
 * 1. Active punch clock shift (if clocked in with a shift_id → shift_templates.position)
 * 2. Fallback: today's scheduled shift → shift_templates.position
 * Returns null if no position found (user sees all items).
 */
export function useUserPosition(userId?: string, locationId?: string) {
  const [position, setPosition] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId || !locationId) {
      setLoading(false);
      return;
    }

    const detect = async () => {
      try {
        // 1. Check for active punch (clock_in without matching clock_out)
        const { data: activePunch } = await supabase
          .from('time_punches')
          .select('shift_id')
          .eq('user_id', userId)
          .eq('location_id', locationId)
          .eq('punch_type', 'clock_in')
          .order('punch_time', { ascending: false })
          .limit(1)
          .single();

        if (activePunch?.shift_id) {
          // Check if there's a clock_out after this clock_in
          const { data: clockOut } = await supabase
            .from('time_punches')
            .select('id')
            .eq('user_id', userId)
            .eq('location_id', locationId)
            .eq('punch_type', 'clock_out')
            .gt('punch_time', new Date().toISOString().split('T')[0]) // today
            .order('punch_time', { ascending: false })
            .limit(1)
            .maybeSingle();

          // If still clocked in, get position from shift template
          if (!clockOut) {
            const { data: shift } = await supabase
              .from('scheduled_shifts')
              .select('template:shift_templates(position)')
              .eq('id', activePunch.shift_id)
              .single();

            const templatePosition = (shift as any)?.template?.position;
            if (templatePosition) {
              setPosition(templatePosition);
              setLoading(false);
              return;
            }
          }
        }

        // 2. Fallback: today's scheduled shift
        const today = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
        const todayStr = formatter.format(today);

        const { data: todayShifts } = await supabase
          .from('scheduled_shifts')
          .select('template:shift_templates(position)')
          .eq('user_id', userId)
          .eq('shift_date', todayStr);

        if (todayShifts && todayShifts.length > 0) {
          const firstPosition = (todayShifts[0] as any)?.template?.position;
          if (firstPosition) {
            setPosition(firstPosition);
            setLoading(false);
            return;
          }
        }

        // No position found
        setPosition(null);
      } catch (err) {
        console.error('Error detecting user position:', err);
        setPosition(null);
      } finally {
        setLoading(false);
      }
    };

    detect();
  }, [userId, locationId]);

  return { position, loading };
}
