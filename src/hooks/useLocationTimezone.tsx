import { useState, useEffect } from 'react';
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
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE);
  const [closeTime, setCloseTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTimezoneAndHours = async () => {
      if (!currentLocation?.id) {
        setTimezone(DEFAULT_TIMEZONE);
        setCloseTime(null);
        setLoading(false);
        return;
      }

      try {
        // Fetch timezone from location_settings
        const { data: settings, error: settingsError } = await supabase
          .from('location_settings')
          .select('timezone')
          .eq('location_id', currentLocation.id)
          .single();

        if (settingsError && settingsError.code !== 'PGRST116') {
          console.error('Error fetching timezone:', settingsError);
        }

        const tz = settings?.timezone || DEFAULT_TIMEZONE;
        setTimezone(tz);

        // Get current day of week in the location's timezone to fetch correct close time
        const currentDayOfWeek = getDayOfWeekInTimezone(tz);
        
        // Fetch close time for current day from location_hours
        const { data: hours, error: hoursError } = await supabase
          .from('location_hours')
          .select('close_time')
          .eq('location_id', currentLocation.id)
          .eq('day_of_week', currentDayOfWeek)
          .single();

        if (hoursError && hoursError.code !== 'PGRST116') {
          console.error('Error fetching location hours:', hoursError);
        }

        setCloseTime(hours?.close_time || null);
      } catch (error) {
        console.error('Error fetching timezone/hours:', error);
        setTimezone(DEFAULT_TIMEZONE);
        setCloseTime(null);
      } finally {
        setLoading(false);
      }
    };

    fetchTimezoneAndHours();
  }, [currentLocation?.id]);

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
