import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GeneratedShift {
  user_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  shift_date: string;
  template_id?: string;
  template_name?: string;
  hourly_wage?: number;
}

interface HourlyCoverage {
  day_of_week: number;
  hour: number;
  min_staff: number;
}

interface LaborSummary {
  dayOfWeek: number;
  dayName: string;
  totalHours: number;
  totalLaborCost: number;
  projectedSales: number;
  laborPercentage: number;
  targetPercentage: number;
  overBudget: boolean;
  amountOverBudget: number;
}

interface TrimSuggestion {
  shiftIndex: number;
  user_id: string;
  userName: string;
  day_of_week: number;
  original_start: string;
  original_end: string;
  suggested_start: string;
  suggested_end: string;
  minutesTrimmed: number;
  laborSaved: number;
  trimType: 'start' | 'end';
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { 
      location_id, 
      week_start, 
      template_id, 
      generated_shifts,
      labor_percentage_target,
      action // 'analyze' or 'optimize'
    } = await req.json();

    console.log("Optimize labor request:", { location_id, week_start, template_id, action, shiftCount: generated_shifts?.length });

    if (!location_id || !week_start) {
      throw new Error("Missing required parameters: location_id and week_start");
    }

    const weekStartDate = new Date(week_start + "T12:00:00Z");

    // Get employee wages
    const userIds = [...new Set((generated_shifts || []).map((s: GeneratedShift) => s.user_id))];
    
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, hourly_wage")
      .in("id", userIds);

    if (profileError) throw profileError;

    const wageMap = new Map<string, number>();
    const nameMap = new Map<string, string>();
    (profiles || []).forEach((p: any) => {
      wageMap.set(p.id, p.hourly_wage || 15);
      nameMap.set(p.id, p.full_name || 'Unknown');
    });

    // Get hourly coverage requirements from template
    let hourlyCoverage: HourlyCoverage[] = [];
    if (template_id) {
      const { data: coverageData, error: coverageError } = await supabase
        .from("week_template_hourly_coverage")
        .select("day_of_week, hour, min_staff")
        .eq("week_template_id", template_id);

      if (coverageError) throw coverageError;
      hourlyCoverage = (coverageData || []).map((c: any) => ({
        day_of_week: c.day_of_week,
        hour: c.hour,
        min_staff: c.min_staff || 0,
      }));
    }

    // Get projected sales from hourly coverage or week template assignments
    const { data: salesData, error: salesError } = await supabase
      .from("week_template_hourly_coverage")
      .select("day_of_week, projected_sales")
      .eq("week_template_id", template_id || '');

    const dailySales: Record<number, number> = {};
    (salesData || []).forEach((s: any) => {
      if (s.projected_sales) {
        dailySales[s.day_of_week] = (dailySales[s.day_of_week] || 0) + (s.projected_sales || 0);
      }
    });

    // Calculate shift hours
    const calculateShiftHours = (startTime: string, endTime: string): number => {
      const startParts = startTime.split(":");
      const endParts = endTime.split(":");
      const startHour = parseInt(startParts[0]) + parseInt(startParts[1]) / 60;
      const endHour = parseInt(endParts[0]) + parseInt(endParts[1]) / 60;
      return endHour > startHour ? endHour - startHour : 24 - startHour + endHour;
    };

    // Add wage info to shifts
    const shiftsWithWages: GeneratedShift[] = (generated_shifts || []).map((s: GeneratedShift) => ({
      ...s,
      hourly_wage: wageMap.get(s.user_id) || 15,
    }));

    // Calculate labor summary per day
    const laborSummary: LaborSummary[] = [];
    const targetPct = labor_percentage_target || 25; // Default 25% labor target

    for (let day = 0; day < 7; day++) {
      const dayShifts = shiftsWithWages.filter(s => s.day_of_week === day);
      let totalHours = 0;
      let totalLaborCost = 0;

      dayShifts.forEach(shift => {
        const hours = calculateShiftHours(shift.start_time, shift.end_time);
        totalHours += hours;
        totalLaborCost += hours * (shift.hourly_wage || 15);
      });

      const projectedSales = dailySales[day] || 0;
      const laborPercentage = projectedSales > 0 ? (totalLaborCost / projectedSales) * 100 : 0;
      const overBudget = projectedSales > 0 && laborPercentage > targetPct;
      const targetLaborCost = projectedSales * (targetPct / 100);
      const amountOverBudget = overBudget ? totalLaborCost - targetLaborCost : 0;

      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

      laborSummary.push({
        dayOfWeek: day,
        dayName: dayNames[day],
        totalHours,
        totalLaborCost,
        projectedSales,
        laborPercentage,
        targetPercentage: targetPct,
        overBudget,
        amountOverBudget,
      });
    }

    if (action === 'analyze') {
      // Just return the analysis
      return new Response(
        JSON.stringify({
          laborSummary,
          totalLaborCost: laborSummary.reduce((sum, d) => sum + d.totalLaborCost, 0),
          totalProjectedSales: laborSummary.reduce((sum, d) => sum + d.projectedSales, 0),
          overBudgetDays: laborSummary.filter(d => d.overBudget).length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: Optimize - Generate trim suggestions
    const trimSuggestions: TrimSuggestion[] = [];
    const optimizedShifts = [...shiftsWithWages];

    // Helper to count staff at a specific hour on a day
    const countStaffAtHour = (shifts: GeneratedShift[], day: number, hour: number): number => {
      return shifts.filter(shift => {
        if (shift.day_of_week !== day) return false;
        const startHour = parseInt(shift.start_time.split(":")[0]);
        const endHour = parseInt(shift.end_time.split(":")[0]);
        // Check if this shift covers this hour
        if (endHour > startHour) {
          return hour >= startHour && hour < endHour;
        } else {
          // Overnight shift
          return hour >= startHour || hour < endHour;
        }
      }).length;
    };

    // Get min staff requirement for an hour
    const getMinStaff = (day: number, hour: number): number => {
      const coverage = hourlyCoverage.find(c => c.day_of_week === day && c.hour === hour);
      return coverage?.min_staff || 0;
    };

    // Can we trim the end of a shift without violating min_staff?
    const canTrimEnd = (shifts: GeneratedShift[], shiftIndex: number, minutes: number): boolean => {
      const shift = shifts[shiftIndex];
      const endHour = parseInt(shift.end_time.split(":")[0]);
      const endMin = parseInt(shift.end_time.split(":")[1]);
      
      // Calculate new end time
      let newEndMin = endMin - minutes;
      let newEndHour = endHour;
      while (newEndMin < 0) {
        newEndMin += 60;
        newEndHour -= 1;
      }
      
      // Check each hour that would be affected
      const startHour = parseInt(shift.start_time.split(":")[0]);
      
      // The affected hour is the one right before the original end
      const affectedHour = endMin === 0 ? endHour - 1 : endHour;
      
      // If we're trimming into a new hour, check if we'd drop below min staff
      if (newEndHour < endHour || (newEndHour === endHour && newEndMin < endMin)) {
        // Check hours from newEndHour to endHour
        for (let h = newEndHour; h < endHour; h++) {
          // Simulate removing this shift from that hour
          const currentStaff = countStaffAtHour(shifts, shift.day_of_week, h);
          const minStaff = getMinStaff(shift.day_of_week, h);
          
          // Would removing this shift from this hour violate min_staff?
          if (currentStaff - 1 < minStaff) {
            return false;
          }
        }
      }
      
      return true;
    };

    // Can we trim the start of a shift without violating min_staff?
    const canTrimStart = (shifts: GeneratedShift[], shiftIndex: number, minutes: number): boolean => {
      const shift = shifts[shiftIndex];
      const startHour = parseInt(shift.start_time.split(":")[0]);
      const startMin = parseInt(shift.start_time.split(":")[1]);
      
      // Calculate new start time
      let newStartMin = startMin + minutes;
      let newStartHour = startHour;
      while (newStartMin >= 60) {
        newStartMin -= 60;
        newStartHour += 1;
      }
      
      // Check hours that would be affected (from original start to new start)
      for (let h = startHour; h < newStartHour; h++) {
        const currentStaff = countStaffAtHour(shifts, shift.day_of_week, h);
        const minStaff = getMinStaff(shift.day_of_week, h);
        
        if (currentStaff - 1 < minStaff) {
          return false;
        }
      }
      
      return true;
    };

    // Process days that are over budget
    for (const daySummary of laborSummary) {
      if (!daySummary.overBudget || daySummary.amountOverBudget <= 0) continue;

      let remainingToTrim = daySummary.amountOverBudget;
      const dayShiftIndices = optimizedShifts
        .map((s, i) => s.day_of_week === daySummary.dayOfWeek ? i : -1)
        .filter(i => i !== -1);

      // Sort shifts by wage (trim higher-paid employees first for max savings)
      dayShiftIndices.sort((a, b) => 
        (optimizedShifts[b].hourly_wage || 15) - (optimizedShifts[a].hourly_wage || 15)
      );

      for (const shiftIndex of dayShiftIndices) {
        if (remainingToTrim <= 0) break;

        const shift = optimizedShifts[shiftIndex];
        const shiftHours = calculateShiftHours(shift.start_time, shift.end_time);
        
        // Don't trim shifts below 3 hours
        if (shiftHours <= 3) continue;

        const wage = shift.hourly_wage || 15;
        const savingsPerQuarter = wage * 0.25; // 15 min = 0.25 hours

        // Try to trim up to 1 hour (4 x 15 min) from each shift
        for (let trimCount = 0; trimCount < 4 && remainingToTrim > 0; trimCount++) {
          // Alternate between trimming end and start
          const trimType = trimCount % 2 === 0 ? 'end' : 'start';
          
          if (trimType === 'end' && canTrimEnd(optimizedShifts, shiftIndex, 15)) {
            // Trim 15 min from end
            const [endHour, endMin] = shift.end_time.split(":").map(Number);
            let newEndMin = endMin - 15;
            let newEndHour = endHour;
            if (newEndMin < 0) {
              newEndMin += 60;
              newEndHour -= 1;
            }
            const newEndTime = `${String(newEndHour).padStart(2, '0')}:${String(newEndMin).padStart(2, '0')}:00`;
            
            // Check if shift is still at least 3 hours
            const newHours = calculateShiftHours(shift.start_time, newEndTime);
            if (newHours < 3) continue;

            trimSuggestions.push({
              shiftIndex,
              user_id: shift.user_id,
              userName: nameMap.get(shift.user_id) || 'Unknown',
              day_of_week: shift.day_of_week,
              original_start: shift.start_time,
              original_end: shift.end_time,
              suggested_start: shift.start_time,
              suggested_end: newEndTime,
              minutesTrimmed: 15,
              laborSaved: savingsPerQuarter,
              trimType: 'end',
            });

            optimizedShifts[shiftIndex] = { ...shift, end_time: newEndTime };
            remainingToTrim -= savingsPerQuarter;
          } else if (trimType === 'start' && canTrimStart(optimizedShifts, shiftIndex, 15)) {
            // Trim 15 min from start
            const [startHour, startMin] = shift.start_time.split(":").map(Number);
            let newStartMin = startMin + 15;
            let newStartHour = startHour;
            if (newStartMin >= 60) {
              newStartMin -= 60;
              newStartHour += 1;
            }
            const newStartTime = `${String(newStartHour).padStart(2, '0')}:${String(newStartMin).padStart(2, '0')}:00`;

            // Check if shift is still at least 3 hours
            const newHours = calculateShiftHours(newStartTime, shift.end_time);
            if (newHours < 3) continue;

            trimSuggestions.push({
              shiftIndex,
              user_id: shift.user_id,
              userName: nameMap.get(shift.user_id) || 'Unknown',
              day_of_week: shift.day_of_week,
              original_start: shift.start_time,
              original_end: shift.end_time,
              suggested_start: newStartTime,
              suggested_end: shift.end_time,
              minutesTrimmed: 15,
              laborSaved: savingsPerQuarter,
              trimType: 'start',
            });

            optimizedShifts[shiftIndex] = { ...shift, start_time: newStartTime };
            remainingToTrim -= savingsPerQuarter;
          }
        }
      }
    }

    // Recalculate labor summary after optimization
    const optimizedLaborSummary: LaborSummary[] = [];
    for (let day = 0; day < 7; day++) {
      const dayShifts = optimizedShifts.filter(s => s.day_of_week === day);
      let totalHours = 0;
      let totalLaborCost = 0;

      dayShifts.forEach(shift => {
        const hours = calculateShiftHours(shift.start_time, shift.end_time);
        totalHours += hours;
        totalLaborCost += hours * (shift.hourly_wage || 15);
      });

      const projectedSales = dailySales[day] || 0;
      const laborPercentage = projectedSales > 0 ? (totalLaborCost / projectedSales) * 100 : 0;
      const overBudget = projectedSales > 0 && laborPercentage > targetPct;
      const targetLaborCost = projectedSales * (targetPct / 100);
      const amountOverBudget = overBudget ? totalLaborCost - targetLaborCost : 0;

      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

      optimizedLaborSummary.push({
        dayOfWeek: day,
        dayName: dayNames[day],
        totalHours,
        totalLaborCost,
        projectedSales,
        laborPercentage,
        targetPercentage: targetPct,
        overBudget,
        amountOverBudget,
      });
    }

    const totalSavings = trimSuggestions.reduce((sum, t) => sum + t.laborSaved, 0);

    console.log(`Generated ${trimSuggestions.length} trim suggestions, saving $${totalSavings.toFixed(2)}`);

    return new Response(
      JSON.stringify({
        originalLaborSummary: laborSummary,
        optimizedLaborSummary,
        optimizedShifts,
        trimSuggestions,
        totalSavings,
        totalOriginalCost: laborSummary.reduce((sum, d) => sum + d.totalLaborCost, 0),
        totalOptimizedCost: optimizedLaborSummary.reduce((sum, d) => sum + d.totalLaborCost, 0),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Optimize labor error:", error);
    const message = error instanceof Error ? error.message : "Failed to optimize labor";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
