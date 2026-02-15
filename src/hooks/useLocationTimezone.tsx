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

export const useLocationTimezone = () => {
  const { currentLocation } = useAppLocation();
  const locationId = currentLocation?.id;

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

  // Date utilities using the location's timezone
  const getTodayInTimezone = (): string => {
    return getTodayInTz(timezone);
  };

  const getDateInTimezone = (date: Date): string => {
    return getDateInTz(date, timezone);
  };

  const getStartOfTodayInTimezone = (): Date => {
    return getStartOfTodayInTz(timezone);
  };

  const getDateInTimezoneOffset = (daysOffset: number): string => {
    return getDateInTzOffset(daysOffset, timezone);
  };

  // Business day utilities that use the location's close time for cutoff calculation
  const getBusinessDateInTimezone = (): string => {
    return getBusinessDateInTz(timezone, closeTime);
  };

  const getBusinessDayRangeInTimezone = (dateStr: string): { start: Date; end: Date } => {
    return getBusinessDayRangeInTz(dateStr, timezone, closeTime);
  };

  const getCutoffHour = (): number => {
    return calculateCutoffHour(closeTime);
  };

  // Convert a local date and time to ISO string for database storage
  const toISO = (dateStr: string, timeStr: string): string => {
    return toISOStringInTimezone(dateStr, timeStr, timezone);
  };

  // Format a timestamp for display
  const formatTime = (timestamp: string | Date): string => {
    return formatTimeDisplay(timestamp, timezone);
  };

  // Format a full datetime for display
  const formatDateTime = (timestamp: string | Date): string => {
    return formatDateTimeDisplay(timestamp, timezone);
  };

  // Get the timezone offset string
  const getOffset = (): string => {
    return getTimezoneOffset(timezone);
  };

  return {
    timezone,
    closeTime,
    loading,
    getTodayInTimezone,
    getDateInTimezone,
    getStartOfTodayInTimezone,
    getDateInTimezoneOffset,
    getBusinessDateInTimezone,
    getBusinessDayRangeInTimezone,
    getCutoffHour,
    toISO,
    formatTime,
    formatDateTime,
    getOffset,
  };
};
