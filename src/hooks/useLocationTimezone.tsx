import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';

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
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  };

  const getDateInTimezone = (date: Date): string => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  };

  const getStartOfTodayInTimezone = (): Date => {
    const dateStr = getTodayInTimezone();
    // Get UTC offset for this timezone
    const offset = getTimezoneOffset(timezone);
    return new Date(`${dateStr}T00:00:00${offset}`);
  };

  const getDateInTimezoneOffset = (daysOffset: number): string => {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    return getDateInTimezone(date);
  };

  return {
    timezone,
    loading,
    getTodayInTimezone,
    getDateInTimezone,
    getStartOfTodayInTimezone,
    getDateInTimezoneOffset,
  };
};

// Helper to get timezone offset string
const getTimezoneOffset = (timezone: string): string => {
  const offsets: Record<string, string> = {
    'America/Los_Angeles': '-08:00',
    'America/Denver': '-07:00',
    'America/Phoenix': '-07:00',
    'America/Chicago': '-06:00',
    'America/New_York': '-05:00',
    'America/Anchorage': '-09:00',
    'Pacific/Honolulu': '-10:00',
  };
  return offsets[timezone] || '-08:00';
};
