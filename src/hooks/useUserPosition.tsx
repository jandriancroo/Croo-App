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
        // 1. Check if user is currently clocked in by finding the most recent punch today
        const today = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
        const todayStr = formatter.format(today);

        // Get the most recent punch of any type today
        const { data: lastPunch } = await supabase
          .from('time_punches')
          .select('shift_id, punch_type')
          .eq('user_id', userId)
          .eq('location_id', locationId)
          .gte('punch_time', todayStr + 'T00:00:00')
          .lte('punch_time', todayStr + 'T23:59:59')
          .order('punch_time', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Only consider them clocked in if the last punch today is a clock_in (not clock_out/break)
        if (lastPunch?.punch_type === 'clock_in' && lastPunch?.shift_id) {
          const { data: shift } = await supabase
            .from('scheduled_shifts')
            .select('template:shift_templates(position)')
            .eq('id', lastPunch.shift_id)
            .single();

          const templatePosition = (shift as any)?.template?.position;
          if (templatePosition) {
            setPosition(templatePosition);
            setLoading(false);
            return;
          }
        }

        // 2. Fallback: today's scheduled shift

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
