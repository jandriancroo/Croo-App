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
  getTimezoneOffset
} from '@/utils/timezoneUtils';

const DEFAULT_TIMEZONE = 'America/Los_Angeles';

export const useLocationTimezone = () => {
  const { currentLocation } = useAppLocation();
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTimezone = async () => {
      if (!currentLocation?.id) {
        setTimezone(DEFAULT_TIMEZONE);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('location_settings')
          .select('timezone')
          .eq('location_id', currentLocation.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error fetching timezone:', error);
        }

        setTimezone(data?.timezone || DEFAULT_TIMEZONE);
      } catch (error) {
        console.error('Error fetching timezone:', error);
        setTimezone(DEFAULT_TIMEZONE);
      } finally {
        setLoading(false);
      }
    };

    fetchTimezone();
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
    loading,
    getTodayInTimezone,
    getDateInTimezone,
    getStartOfTodayInTimezone,
    getDateInTimezoneOffset,
    toISO,
    formatTime,
    formatDateTime,
    getOffset,
  };
};
