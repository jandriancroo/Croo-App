import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { toast } from 'sonner';

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
    if (!locationId || !startDate || !endDate) return;
    
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
        return;
      }
      
      // Generate date range
      const dates: string[] = [];
      const current = new Date(startDate);
      while (current <= endDate) {
        dates.push(format(current, 'yyyy-MM-dd'));
        current.setDate(current.getDate() + 1);
      }
      
      // Fetch tips for each date from QuBeyond
      const allTips: DailyTipData[] = [];
      
      for (const dateStr of dates) {
        try {
          const { data, error: fetchError } = await supabase.functions.invoke('fetch-qubeyond-sales', {
            body: { 
              locationId, 
              targetDate: dateStr 
            }
          });
          
          if (fetchError) {
            console.error(`Error fetching tips for ${dateStr}:`, fetchError);
            continue;
          }
          
          if (data?.tips) {
            allTips.push({
              date: dateStr,
              ccTips: data.tips.ccTips || 0,
              cashTips: data.tips.cashTips || 0,
              totalTips: data.tips.totalTips || 0
            });
          } else if (data?.weeklyTips?.dailyTips) {
            // Check if the date is in weekly breakdown
            const dayTip = data.weeklyTips.dailyTips.find((d: any) => d.date === dateStr);
            if (dayTip) {
              allTips.push({
                date: dateStr,
                ccTips: dayTip.ccTips || 0,
                cashTips: dayTip.cashTips || 0,
                totalTips: (dayTip.ccTips || 0) + (dayTip.cashTips || 0)
              });
            }
          }
        } catch (err) {
          console.error(`Error fetching tips for ${dateStr}:`, err);
        }
      }
      
      setDailyTips(allTips);
    } catch (err) {
      console.error('Error fetching tips:', err);
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

  return {
    isLoading,
    error,
    dailyTips,
    employeeTipShares,
    totalTipPool,
    refetch: fetchTipsData
  };
}
