import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

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
  timeCards: any[]
): TipDistributionResult {
  const [dailyTips, setDailyTips] = useState<DailyTipData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTipsData = async () => {
    if (!locationId || !startDate || !endDate) {
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Get QuBeyond integration for this location
      const { data: integration } = await supabase
        .from('location_integrations')
        .select('credentials, is_active')
        .eq('location_id', locationId)
        .eq('integration_type', 'qubeyond')
        .eq('is_active', true)
        .single();
      
      if (!integration) {
        setDailyTips([]);
        setIsLoading(false);
        return;
      }
      
      // Generate date range
      const dates: string[] = [];
      const current = new Date(startDate);
      while (current <= endDate) {
        dates.push(format(current, 'yyyy-MM-dd'));
        current.setDate(current.getDate() + 1);
      }
      
      console.log('[TipDistribution] Fetching tips for dates:', dates);
      
      // Get unique weeks that we need to fetch
      // The edge function returns a full calendar week of tips for each targetDate
      const weekStarts = new Set<string>();
      dates.forEach(date => {
        const d = new Date(date + 'T12:00:00');
        const day = d.getDay();
        const diff = day === 0 ? 6 : day - 1; // Monday-based week start
        d.setDate(d.getDate() - diff);
        const weekStart = format(d, 'yyyy-MM-dd');
        weekStarts.add(weekStart);
      });
      
      console.log('[TipDistribution] Week starts to fetch:', Array.from(weekStarts));
      
      // Fetch tips for each week in parallel
      const allTips: DailyTipData[] = [];
      const weekStartsArray = Array.from(weekStarts);
      
      const results = await Promise.all(
        weekStartsArray.map(async (weekStart) => {
          // Use the last day of the week (Sunday) as target date, but never go beyond today
          const weekStartDate = new Date(weekStart + 'T12:00:00');
          const weekEndDate = new Date(weekStartDate.getTime() + 6 * 24 * 60 * 60 * 1000);
          const today = new Date();
          // Clamp to today so we don't request future dates from QuBeyond
          const effectiveEndDate = weekEndDate > today ? today : weekEndDate;
          const targetDate = format(effectiveEndDate, 'yyyy-MM-dd');

          try {
            const { data, error: fetchError } = await supabase.functions.invoke('fetch-qubeyond-sales', {
              body: { 
                locationId, 
                targetDate,
                skipProjections: true // We only need tips data
              }
            });
            
            if (fetchError) {
              console.error(`[TipDistribution] Error fetching tips for week ${weekStart}:`, fetchError);
              return [];
            }
            
            console.log(`[TipDistribution] Response for ${targetDate}:`, {
              hasTips: !!data?.tips,
              hasWeeklyTips: !!data?.weeklyTips,
              dailyTipsCount: data?.weeklyTips?.dailyTips?.length || 0
            });
            
            const weekTips: DailyTipData[] = [];
            
            // Extract daily tips from weeklyTips breakdown
            if (data?.weeklyTips?.dailyTips) {
              data.weeklyTips.dailyTips.forEach((dayTip: any) => {
                // Only include dates within our requested range
                if (dates.includes(dayTip.date)) {
                  const totalTips = (dayTip.ccTips || 0) + (dayTip.cashTips || 0);
                  weekTips.push({
                    date: dayTip.date,
                    ccTips: dayTip.ccTips || 0,
                    cashTips: dayTip.cashTips || 0,
                    totalTips
                  });
                }
              });
            }
            
            return weekTips;
          } catch (err) {
            console.error(`[TipDistribution] Error fetching tips for week ${weekStart}:`, err);
            return [];
          }
        })
      );
      
      // Flatten results and remove duplicates
      results.forEach(weekTips => allTips.push(...weekTips));
      
      const uniqueTips = allTips.reduce((acc, tip) => {
        const existing = acc.find(t => t.date === tip.date);
        if (!existing) {
          acc.push(tip);
        }
        return acc;
      }, [] as DailyTipData[]);
      
      console.log('[TipDistribution] Final tips:', uniqueTips);
      setDailyTips(uniqueTips.sort((a, b) => a.date.localeCompare(b.date)));
    } catch (err) {
      console.error('[TipDistribution] Error fetching tips:', err);
      setError('Failed to fetch tips data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTipsData();
  }, [locationId, startDate?.toISOString(), endDate?.toISOString()]);

  // Calculate tip distributions based on hours worked per day
  const employeeTipShares = useMemo(() => {
    if (dailyTips.length === 0 || timeCards.length === 0) return [];
    
    const shares: EmployeeTipShare[] = [];
    
    timeCards.forEach(card => {
      const dailyBreakdown: { date: string; hours: number; tipShare: number }[] = [];
      let totalTips = 0;
      
      // For each day with tips, calculate this employee's share
      dailyTips.forEach(tipDay => {
        const dayPunches = card.punchesByDay[tipDay.date] || [];
        
        if (dayPunches.length === 0 || tipDay.totalTips === 0) return;
        
        // Calculate hours worked this day
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
        
        // Calculate total hours worked by all employees this day
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
        
        // Calculate tip share proportionally
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

  // Calculate total distributed tips and total hours that earned tips
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
    refetch: fetchTipsData
  };
}
