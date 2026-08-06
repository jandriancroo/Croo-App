import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DateTime } from 'luxon';

interface DailyTipData {
  date: string;
  ccTips: number;
  cashTips: number;
  totalTips: number;
}

interface EmployeeTipShare {
  userId: string;
  employeeName: string;
  totalTips: number;
  dailyBreakdown: { date: string; hours: number; tipShare: number }[];
}

interface TipDistributionResult {
  isLoading: boolean;
  error: string | null;
  dailyTips: DailyTipData[];
  employeeTipShares: EmployeeTipShare[];
  totalTipPool: number;
  totalDistributedTips: number;
  totalHoursWithTips: number;
  refetch: () => void;
}

export function useTipDistribution(
  locationId: string | null,
  startDate: Date | null,
  endDate: Date | null,
  timeCards: any[],
  enabled: boolean = true
): TipDistributionResult {
  const [dailyTips, setDailyTips] = useState<DailyTipData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTipsFromCache = async () => {
    if (!locationId || !startDate || !endDate || !enabled) {
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Use local wall-clock dates — toISOString() shifts to UTC and pulls in an extra day
      const startStr = DateTime.fromJSDate(startDate).toFormat('yyyy-MM-dd');
      const endStr = DateTime.fromJSDate(endDate).toFormat('yyyy-MM-dd');

      // Read directly from the daily_tips cache table
      const { data, error: fetchError } = await supabase
        .from('daily_tips')
        .select('tip_date, total_cc_tips, total_cash_tips')
        .eq('location_id', locationId)
        .gte('tip_date', startStr)
        .lte('tip_date', endStr)
        .order('tip_date');

      if (fetchError) {
        console.error('[TipDistribution] DB fetch error:', fetchError);
        setError('Failed to fetch tips data');
        setDailyTips([]);
        return;
      }

      const tips: DailyTipData[] = (data || []).map((row: any) => ({
        date: row.tip_date,
        ccTips: row.total_cc_tips || 0,
        cashTips: row.total_cash_tips || 0,
        totalTips: (row.total_cc_tips || 0) + (row.total_cash_tips || 0),
      }));

      console.log('[TipDistribution] Loaded from cache:', tips.length, 'days');
      setDailyTips(tips);
    } catch (err) {
      console.error('[TipDistribution] Error:', err);
      setError('Failed to fetch tips data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (enabled) {
      fetchTipsFromCache();
    }
  }, [locationId, startDate?.toISOString(), endDate?.toISOString(), enabled]);

  // Calculate tip distributions based on hours worked per day
  const employeeTipShares = useMemo(() => {
    if (dailyTips.length === 0 || timeCards.length === 0) return [];
    
    const shares: EmployeeTipShare[] = [];
    
    timeCards.forEach(card => {
      const dailyBreakdown: { date: string; hours: number; tipShare: number }[] = [];
      let totalTips = 0;
      
      dailyTips.forEach(tipDay => {
        const dayPunches = card.punchesByDay[tipDay.date] || [];
        
        if (dayPunches.length === 0 || tipDay.totalTips === 0) return;
        
        const clockIn = dayPunches.find((p: any) => p.punch_type === 'clock_in');
        const clockOut = dayPunches.find((p: any) => p.punch_type === 'clock_out');
        
        if (!clockIn || !clockOut) return;
        
        const mealBreakStart = dayPunches.find((p: any) => 
          p.punch_type === 'break_start' && p.notes?.includes('30 minute')
        );
        const mealBreakEnd = dayPunches.find((p: any) => 
          p.punch_type === 'break_end' && p.notes?.includes('30 minute')
        );
        
        let hours = (new Date(clockOut.punch_time).getTime() - new Date(clockIn.punch_time).getTime()) / 3600000;
        
        if (mealBreakStart && mealBreakEnd) {
          const breakHours = (new Date(mealBreakEnd.punch_time).getTime() - 
            new Date(mealBreakStart.punch_time).getTime()) / 3600000;
          hours -= breakHours;
        }
        
        if (hours <= 0) return;
        
        let totalDayHours = 0;
        timeCards.forEach(otherCard => {
          const otherDayPunches = otherCard.punchesByDay[tipDay.date] || [];
          const otherClockIn = otherDayPunches.find((p: any) => p.punch_type === 'clock_in');
          const otherClockOut = otherDayPunches.find((p: any) => p.punch_type === 'clock_out');
          
          if (otherClockIn && otherClockOut) {
            let otherHours = (new Date(otherClockOut.punch_time).getTime() - 
              new Date(otherClockIn.punch_time).getTime()) / 3600000;
            
            const otherBreakStart = otherDayPunches.find((p: any) => 
              p.punch_type === 'break_start' && p.notes?.includes('30 minute')
            );
            const otherBreakEnd = otherDayPunches.find((p: any) => 
              p.punch_type === 'break_end' && p.notes?.includes('30 minute')
            );
            
            if (otherBreakStart && otherBreakEnd) {
              const breakHours = (new Date(otherBreakEnd.punch_time).getTime() - 
                new Date(otherBreakStart.punch_time).getTime()) / 3600000;
              otherHours -= breakHours;
            }
            
            if (otherHours > 0) totalDayHours += otherHours;
          }
        });
        
        const tipShare = totalDayHours > 0 ? (hours / totalDayHours) * tipDay.totalTips : 0;
        
        dailyBreakdown.push({
          date: tipDay.date,
          hours: parseFloat(hours.toFixed(2)),
          tipShare: parseFloat(tipShare.toFixed(2))
        });
        
        totalTips += tipShare;
      });
      
      if (totalTips > 0 || dailyBreakdown.length > 0) {
        shares.push({
          userId: card.profile.id,
          employeeName: card.profile.full_name || 'Unknown',
          totalTips: parseFloat(totalTips.toFixed(2)),
          dailyBreakdown
        });
      }
    });
    
    return shares;
  }, [dailyTips, timeCards]);

  const totalTipPool = useMemo(() => {
    return dailyTips.reduce((sum, day) => sum + day.totalTips, 0);
  }, [dailyTips]);

  const { totalDistributedTips, totalHoursWithTips } = useMemo(() => {
    let distributed = 0;
    let hours = 0;
    
    employeeTipShares.forEach(share => {
      distributed += share.totalTips;
      share.dailyBreakdown.forEach(day => {
        hours += day.hours;
      });
    });
    
    return { totalDistributedTips: distributed, totalHoursWithTips: hours };
  }, [employeeTipShares]);

  return {
    isLoading,
    error,
    dailyTips,
    employeeTipShares,
    totalTipPool,
    totalDistributedTips,
    totalHoursWithTips,
    refetch: fetchTipsFromCache
  };
}
