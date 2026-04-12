import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import {
  getTodayInTimezone as getTodayInTz,
  getDateInTimezone as getDateInTz,
  getStartOfTodayInTimezone as getStartOfTodayInTz,
  getDateInTimezoneOffset as getDateInTzOffset,
  toISOStringInTimezone,
  formatTimeDisplay,
  formatDateTimeDisplay,
  getTimezoneOffset,
  getBusinessDateInTimezone as getBusinessDateInTz,
  getBusinessDayRangeInTimezone as getBusinessDayRangeInTz,
  calculateCutoffHour,
  getDayOfWeekInTimezone,
} from '@/utils/timezoneUtils';
const DEFAULT_TIMEZONE = 'America/Los_Angeles';

export const useLocationTimezone = (locationIdOverride?: string) => {
  const { currentLocation } = useAppLocation();
  const locationId = locationIdOverride || currentLocation?.id;

  // Cached timezone query — shared across all consumers via queryKey
  const { data: timezone = DEFAULT_TIMEZONE } = useQuery({
    queryKey: ['location-timezone', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('location_settings')
        .select('timezone')
        .eq('location_id', locationId!)
        .single();
      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching timezone:', error);
      }
      return data?.timezone || DEFAULT_TIMEZONE;
    },
    enabled: !!locationId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Cached close time query — shared key matches usePrefetchDashboard
  const currentDayOfWeek = useMemo(() => getDayOfWeekInTimezone(timezone), [timezone]);

  const { data: closeTime = null, isLoading: loading } = useQuery({
    queryKey: ['location-hours-today', locationId, timezone],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('location_hours')
        .select('close_time')
        .eq('location_id', locationId!)
        .eq('day_of_week', currentDayOfWeek)
        .single();
      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching location hours:', error);
      }
      return data?.close_time || null;
    },
    enabled: !!locationId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // ── Memoized utility functions ──
  // These only re-create when timezone or closeTime changes, not on every render.
  const utils = useMemo(() => ({
    getTodayInTimezone: () => getTodayInTz(timezone),
    getDateInTimezone: (date: Date) => getDateInTz(date, timezone),
    getStartOfTodayInTimezone: () => getStartOfTodayInTz(timezone),
    getDateInTimezoneOffset: (daysOffset: number) => getDateInTzOffset(daysOffset, timezone),
    getBusinessDateInTimezone: () => getBusinessDateInTz(timezone, closeTime),
    getBusinessDayRangeInTimezone: (dateStr: string) => getBusinessDayRangeInTz(dateStr, timezone, closeTime),
    getCutoffHour: () => calculateCutoffHour(closeTime),
    toISO: (dateStr: string, timeStr: string) => toISOStringInTimezone(dateStr, timeStr, timezone),
    formatTime: (timestamp: string | Date) => formatTimeDisplay(timestamp, timezone),
    formatDateTime: (timestamp: string | Date) => formatDateTimeDisplay(timestamp, timezone),
    getOffset: () => getTimezoneOffset(timezone),
  }), [timezone, closeTime]);

  return {
    timezone,
    closeTime,
    loading,
    ...utils,
  };
};
