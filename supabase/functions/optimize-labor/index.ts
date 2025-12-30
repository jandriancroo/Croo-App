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

    // Get employee wages and roles
    const userIds = [...new Set((generated_shifts || []).map((s: GeneratedShift) => s.user_id))];
    
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, hourly_wage")
      .in("id", userIds);

    if (profileError) throw profileError;

    // Get user roles to prioritize cutting team members before managers
    const { data: userRoles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", userIds);

    if (rolesError) throw rolesError;

    const wageMap = new Map<string, number>();
    const nameMap = new Map<string, string>();
    const roleMap = new Map<string, string>();
    
    (profiles || []).forEach((p: any) => {
      wageMap.set(p.id, p.hourly_wage || 15);
      nameMap.set(p.id, p.full_name || 'Unknown');
    });

    // Map user roles - managers/shift_managers/admins get priority protection
    (userRoles || []).forEach((r: any) => {
      const currentRole = roleMap.get(r.user_id);
      // Keep highest role if user has multiple
      if (!currentRole || isHigherRole(r.role, currentRole)) {
        roleMap.set(r.user_id, r.role);
      }
    });

    // Helper to check if role is a manager-level role (protected from cuts)
    const isManagerRole = (role: string | undefined): boolean => {
      return ['admin', 'general_manager', 'manager', 'shift_manager', 'org_admin', 'super_admin', 'fbc', 'brand_admin'].includes(role || '');
    };

    // Helper to compare roles (for keeping highest)
    function isHigherRole(newRole: string, currentRole: string): boolean {
      const roleOrder = ['team_member', 'shift_manager', 'manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin'];
      return roleOrder.indexOf(newRole) > roleOrder.indexOf(currentRole);
    }

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

    // Get location closing times per day
    const closingTimes: Record<number, number> = {}; // day_of_week -> close time in minutes
    const { data: locationHours } = await supabase
      .from("location_hours")
      .select("day_of_week, close_time, is_closed")
      .eq("location_id", location_id);

    (locationHours || []).forEach((lh: any) => {
      if (!lh.is_closed && lh.close_time) {
        const [hours, mins] = lh.close_time.split(":").map(Number);
        closingTimes[lh.day_of_week] = hours * 60 + mins;
      }
    });
    console.log("Location closing times:", closingTimes);

    // Get per-day labor targets and projected sales from week_template_day_settings
    const dailySettings: Record<number, { laborTarget: number; projectedSales: number }> = {};
    if (template_id) {
      const { data: daySettingsData, error: daySettingsError } = await supabase
        .from("week_template_day_settings")
        .select("day_of_week, labor_percentage_target, projected_sales")
        .eq("week_template_id", template_id);

      if (daySettingsError) {
        console.log("No day settings found, will use defaults:", daySettingsError.message);
      }

      (daySettingsData || []).forEach((ds: any) => {
        dailySettings[ds.day_of_week] = {
          laborTarget: ds.labor_percentage_target || 25,
          projectedSales: ds.projected_sales || 0,
        };
      });
    }

    // Fallback: Get projected sales from hourly coverage if day settings don't have it
    const { data: salesData } = await supabase
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

    // Calculate labor summary per day using per-day targets from template
    const laborSummary: LaborSummary[] = [];
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (let day = 0; day < 7; day++) {
      const dayShifts = shiftsWithWages.filter(s => s.day_of_week === day);
      let totalHours = 0;
      let totalLaborCost = 0;

      dayShifts.forEach(shift => {
        const hours = calculateShiftHours(shift.start_time, shift.end_time);
        totalHours += hours;
        totalLaborCost += hours * (shift.hourly_wage || 15);
      });

      // Use per-day settings if available, fallback to hourly coverage aggregation
      const daySettings = dailySettings[day];
      const projectedSales = daySettings?.projectedSales || dailySales[day] || 0;
      const targetPct = daySettings?.laborTarget || 25; // Per-day target or default 25%
      
      const laborPercentage = projectedSales > 0 ? (totalLaborCost / projectedSales) * 100 : 0;
      const overBudget = projectedSales > 0 && laborPercentage > targetPct;
      const targetLaborCost = projectedSales * (targetPct / 100);
      const amountOverBudget = overBudget ? totalLaborCost - targetLaborCost : 0;

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

    // Helper to check if this is a closing shift (ends at or after location close, or is latest shift of day)
    const isClosingShift = (shifts: GeneratedShift[], shiftIndex: number): boolean => {
      const shift = shifts[shiftIndex];
      const shiftEndHour = parseInt(shift.end_time.split(":")[0]);
      const shiftEndMin = parseInt(shift.end_time.split(":")[1]);
      const shiftEndTotal = shiftEndHour * 60 + shiftEndMin;

      // Check if shift ends at or after location closing time
      const locationCloseTime = closingTimes[shift.day_of_week];
      if (locationCloseTime && shiftEndTotal >= locationCloseTime) {
        console.log(`Shift for ${nameMap.get(shift.user_id)} ends at ${shift.end_time} (${shiftEndTotal}min), at/after close (${locationCloseTime}min) - protected`);
        return true;
      }

      // Also check if this is the latest ending shift of the day (fallback)
      const dayShifts = shifts.filter(s => s.day_of_week === shift.day_of_week);
      let latestEndTotal = 0;
      
      for (const s of dayShifts) {
        const endHour = parseInt(s.end_time.split(":")[0]);
        const endMin = parseInt(s.end_time.split(":")[1]);
        const endTotal = endHour * 60 + endMin;
        if (endTotal > latestEndTotal) {
          latestEndTotal = endTotal;
        }
      }

      // This is a closing shift if it ends at the latest time
      return shiftEndTotal === latestEndTotal;
    };

    // Track accumulated trims per shift (to consolidate multiple 15-min trims into one entry)
    const shiftTrimAccumulator: Map<number, {
      user_id: string;
      userName: string;
      day_of_week: number;
      original_start: string;
      original_end: string;
      final_end: string;
      totalMinutesTrimmed: number;
      totalLaborSaved: number;
    }> = new Map();

    // Process days that are over budget
    for (const daySummary of laborSummary) {
      if (!daySummary.overBudget || daySummary.amountOverBudget <= 0) continue;

      let remainingToTrim = daySummary.amountOverBudget;
      const dayShiftIndices = optimizedShifts
        .map((s, i) => s.day_of_week === daySummary.dayOfWeek ? i : -1)
        .filter(i => i !== -1);

      // Log all shifts for this day before filtering
      console.log(`Day ${daySummary.dayOfWeek} - All shifts:`);
      dayShiftIndices.forEach(i => {
        const s = optimizedShifts[i];
        const role = roleMap.get(s.user_id) || 'unknown';
        const isCloser = isClosingShift(optimizedShifts, i);
        console.log(`  - ${nameMap.get(s.user_id)}: ${s.start_time}-${s.end_time}, role=${role}, isCloser=${isCloser}`);
      });

      // Exclude closing shifts from consideration
      const eligibleShiftIndices = dayShiftIndices.filter(i => !isClosingShift(optimizedShifts, i));
      
      // Log excluded shifts
      const excludedIndices = dayShiftIndices.filter(i => isClosingShift(optimizedShifts, i));
      if (excludedIndices.length > 0) {
        console.log(`Day ${daySummary.dayOfWeek} - Excluded (closing shifts):`);
        excludedIndices.forEach(i => {
          const s = optimizedShifts[i];
          console.log(`  - ${nameMap.get(s.user_id)}: ${s.start_time}-${s.end_time} (ends at/after close or is latest shift)`);
        });
      }
      
      // Separate team members and managers
      const teamMemberIndices = eligibleShiftIndices.filter(i => 
        !isManagerRole(roleMap.get(optimizedShifts[i].user_id))
      );
      const managerIndices = eligibleShiftIndices.filter(i => 
        isManagerRole(roleMap.get(optimizedShifts[i].user_id))
      );

      // Sort each group by wage (higher paid first for max savings)
      const sortByWage = (a: number, b: number) => 
        (optimizedShifts[b].hourly_wage || 15) - (optimizedShifts[a].hourly_wage || 15);
      
      teamMemberIndices.sort(sortByWage);
      managerIndices.sort(sortByWage);

      // Track how many 15-min increments we've trimmed from each shift
      const trimCountPerShift = new Map<number, number>();

      console.log(`Day ${daySummary.dayOfWeek}: ${teamMemberIndices.length} team members eligible, ${managerIndices.length} managers eligible, need to trim $${remainingToTrim.toFixed(2)}`);

      // Trimming rules:
      // - Max 30 min (2 x 15 min) per person total
      // - Team members get cut first (up to 30 min each)
      // - Managers only get cut if still over budget (up to 30 min each)
      const MAX_TRIMS_PER_PERSON = 2; // 30 min max per person
      
      // Phase 1: Cut up to 30 min from each team member
      for (const shiftIndex of teamMemberIndices) {
        if (remainingToTrim <= 0) break;
        
        const totalTrimsSoFar = trimCountPerShift.get(shiftIndex) || 0;
        
        // Cut up to 2 increments (30 min max) per team member
        for (let t = 0; t < MAX_TRIMS_PER_PERSON - totalTrimsSoFar && remainingToTrim > 0; t++) {
          const trimmed = tryTrimShift(shiftIndex, trimCountPerShift);
          if (!trimmed) break;
        }
      }

      // Phase 2: Cut up to 30 min from each manager (if still over budget)
      for (const shiftIndex of managerIndices) {
        if (remainingToTrim <= 0) break;
        
        const totalTrimsSoFar = trimCountPerShift.get(shiftIndex) || 0;
        
        // Cut up to 2 increments (30 min max) per manager
        for (let t = 0; t < MAX_TRIMS_PER_PERSON - totalTrimsSoFar && remainingToTrim > 0; t++) {
          const trimmed = tryTrimShift(shiftIndex, trimCountPerShift);
          if (!trimmed) break;
        }
      }

      console.log(`Day ${daySummary.dayOfWeek}: Trimmed $${(daySummary.amountOverBudget - remainingToTrim).toFixed(2)}, $${remainingToTrim.toFixed(2)} still over budget (max 30min/person limit reached)`);

      // Helper function to attempt trimming a shift
      function tryTrimShift(shiftIndex: number, trimCounts: Map<number, number>): boolean {
        const shift = optimizedShifts[shiftIndex];
        const shiftHours = calculateShiftHours(shift.start_time, optimizedShifts[shiftIndex].end_time);
        
        // Don't trim shifts below 3 hours
        if (shiftHours <= 3) return false;

        const wage = shift.hourly_wage || 15;
        const savingsPerQuarter = wage * 0.25;

        if (!canTrimEnd(optimizedShifts, shiftIndex, 15)) return false;

        // Trim 15 min from end
        const currentShift = optimizedShifts[shiftIndex];
        const [endHour, endMin] = currentShift.end_time.split(":").map(Number);
        let newEndMin = endMin - 15;
        let newEndHour = endHour;
        if (newEndMin < 0) {
          newEndMin += 60;
          newEndHour -= 1;
        }
        const newEndTime = `${String(newEndHour).padStart(2, '0')}:${String(newEndMin).padStart(2, '0')}:00`;
        
        // Check if shift is still at least 3 hours
        const newHours = calculateShiftHours(shift.start_time, newEndTime);
        if (newHours < 3) return false;

        // Get original end time (before any trimming in this session)
        const originalEnd = shiftTrimAccumulator.get(shiftIndex)?.original_end || shift.end_time;

        // Accumulate trim for this shift
        const existing = shiftTrimAccumulator.get(shiftIndex);
        if (existing) {
          existing.final_end = newEndTime;
          existing.totalMinutesTrimmed += 15;
          existing.totalLaborSaved += savingsPerQuarter;
        } else {
          shiftTrimAccumulator.set(shiftIndex, {
            user_id: shift.user_id,
            userName: nameMap.get(shift.user_id) || 'Unknown',
            day_of_week: shift.day_of_week,
            original_start: shift.start_time,
            original_end: originalEnd,
            final_end: newEndTime,
            totalMinutesTrimmed: 15,
            totalLaborSaved: savingsPerQuarter,
          });
        }

        // Update the shift and tracking
        optimizedShifts[shiftIndex] = { ...optimizedShifts[shiftIndex], end_time: newEndTime };
        trimCounts.set(shiftIndex, (trimCounts.get(shiftIndex) || 0) + 1);
        remainingToTrim -= savingsPerQuarter;
        
        console.log(`Trimmed 15min from ${nameMap.get(shift.user_id)} (${isManagerRole(roleMap.get(shift.user_id)) ? 'manager' : 'team member'}), saved $${savingsPerQuarter.toFixed(2)}`);
        return true;
      }
    }

    // Convert accumulated trims to trim suggestions
    for (const [shiftIndex, trim] of shiftTrimAccumulator) {
      trimSuggestions.push({
        shiftIndex,
        user_id: trim.user_id,
        userName: trim.userName,
        day_of_week: trim.day_of_week,
        original_start: trim.original_start,
        original_end: trim.original_end,
        suggested_start: trim.original_start,
        suggested_end: trim.final_end,
        minutesTrimmed: trim.totalMinutesTrimmed,
        laborSaved: trim.totalLaborSaved,
        trimType: 'end',
      });
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

      // Use per-day settings if available
      const daySettings = dailySettings[day];
      const projectedSales = daySettings?.projectedSales || dailySales[day] || 0;
      const targetPct = daySettings?.laborTarget || 25;
      
      const laborPercentage = projectedSales > 0 ? (totalLaborCost / projectedSales) * 100 : 0;
      const overBudget = projectedSales > 0 && laborPercentage > targetPct;
      const targetLaborCost = projectedSales * (targetPct / 100);
      const amountOverBudget = overBudget ? totalLaborCost - targetLaborCost : 0;

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
