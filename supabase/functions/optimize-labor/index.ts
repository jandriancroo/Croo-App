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

// Role tiers for cutting priority (lower number = cut first)
const ROLE_CUT_PRIORITY: Record<string, number> = {
  'team_member': 1,
  'shift_manager': 2,
  'manager': 3,
  'general_manager': 4,
  'admin': 5,
  'org_admin': 6,
  'fbc': 7,
  'brand_admin': 8,
  'super_admin': 9,
};

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

    // Map user roles - keep highest role if user has multiple
    (userRoles || []).forEach((r: any) => {
      const currentRole = roleMap.get(r.user_id);
      if (!currentRole || isHigherRole(r.role, currentRole)) {
        roleMap.set(r.user_id, r.role);
      }
    });

    // Helper to compare roles (for keeping highest)
    function isHigherRole(newRole: string, currentRole: string): boolean {
      return (ROLE_CUT_PRIORITY[newRole] || 1) > (ROLE_CUT_PRIORITY[currentRole] || 1);
    }

    // Get role cut priority (lower = cut first)
    const getRolePriority = (userId: string): number => {
      const role = roleMap.get(userId) || 'team_member';
      return ROLE_CUT_PRIORITY[role] || 1;
    };

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

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    // Calculate labor summary per day
    const calculateLaborSummary = (shifts: GeneratedShift[]): LaborSummary[] => {
      const summary: LaborSummary[] = [];
      for (let day = 0; day < 7; day++) {
        const dayShifts = shifts.filter(s => s.day_of_week === day);
        let totalHours = 0;
        let totalLaborCost = 0;

        dayShifts.forEach(shift => {
          const hours = calculateShiftHours(shift.start_time, shift.end_time);
          totalHours += hours;
          totalLaborCost += hours * (shift.hourly_wage || 15);
        });

        const daySettings = dailySettings[day];
        const projectedSales = daySettings?.projectedSales || dailySales[day] || 0;
        const targetPct = daySettings?.laborTarget || 25;
        
        const laborPercentage = projectedSales > 0 ? (totalLaborCost / projectedSales) * 100 : 0;
        const overBudget = projectedSales > 0 && laborPercentage > targetPct;
        const targetLaborCost = projectedSales * (targetPct / 100);
        const amountOverBudget = overBudget ? totalLaborCost - targetLaborCost : 0;

        summary.push({
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
      return summary;
    };

    const laborSummary = calculateLaborSummary(shiftsWithWages);

    if (action === 'analyze') {
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

    // ACTION: Optimize - Layered trimming strategy
    const optimizedShifts = [...shiftsWithWages];
    const trimSuggestions: TrimSuggestion[] = [];

    // Track total minutes trimmed per shift (for consolidation)
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

    // Helper to count staff at a specific hour on a day
    const countStaffAtHour = (shifts: GeneratedShift[], day: number, hour: number): number => {
      return shifts.filter(shift => {
        if (shift.day_of_week !== day) return false;
        const startHour = parseInt(shift.start_time.split(":")[0]);
        const endHour = parseInt(shift.end_time.split(":")[0]);
        if (endHour > startHour) {
          return hour >= startHour && hour < endHour;
        } else {
          return hour >= startHour || hour < endHour;
        }
      }).length;
    };

    // Get min staff requirement for an hour
    const getMinStaff = (day: number, hour: number): number => {
      const coverage = hourlyCoverage.find(c => c.day_of_week === day && c.hour === hour);
      return coverage?.min_staff || 0;
    };

    // Check if trimming end of shift would violate coverage floor
    // Key insight: countStaffAtHour checks hour < endHour, so a shift ending at 18:00 covers hour 17
    // but a shift ending at 17:45 does NOT cover hour 17 (since 17 < 17 is false)
    const canTrimEnd = (shifts: GeneratedShift[], shiftIndex: number, minutes: number): boolean => {
      const shift = shifts[shiftIndex];
      const [endHour, endMin] = shift.end_time.split(":").map(Number);

      let newEndMin = endMin - minutes;
      let newEndHour = endHour;
      while (newEndMin < 0) {
        newEndMin += 60;
        newEndHour -= 1;
      }

      // If we didn't cross into a previous hour, hourly staffing counts are unchanged
      if (newEndHour === endHour) return true;

      // Check each hour that will LOSE this employee's coverage
      // Hours affected: from newEndHour up to (but not including) endHour
      // Example: trim 18:00 -> 17:45 means newEndHour=17, endHour=18
      // Hour 17 will lose coverage (shift no longer covers it)
      for (let h = newEndHour; h < endHour; h++) {
        const currentStaff = countStaffAtHour(shifts, shift.day_of_week, h);
        const minStaff = getMinStaff(shift.day_of_week, h);
        if (currentStaff - 1 < minStaff) {
          console.log(`      Coverage floor: hour ${h} has ${currentStaff} staff, min is ${minStaff}`);
          return false;
        }
      }

      return true;
    };

    // Check if this is a closing shift (protected from cuts)
    const isClosingShift = (shifts: GeneratedShift[], shiftIndex: number): boolean => {
      const shift = shifts[shiftIndex];
      const shiftEndHour = parseInt(shift.end_time.split(":")[0]);
      const shiftEndMin = parseInt(shift.end_time.split(":")[1]);
      const shiftEndTotal = shiftEndHour * 60 + shiftEndMin;

      const locationCloseTime = closingTimes[shift.day_of_week];
      if (locationCloseTime && shiftEndTotal >= locationCloseTime) {
        return true;
      }

      // Fallback: protect latest-ending shifts if no close time set
      const dayShifts = shifts.filter((s) => s.day_of_week === shift.day_of_week);
      let latestEndTotal = 0;

      for (const s of dayShifts) {
        const endHour = parseInt(s.end_time.split(":")[0]);
        const endMin = parseInt(s.end_time.split(":")[1]);
        const endTotal = endHour * 60 + endMin;
        if (endTotal > latestEndTotal) {
          latestEndTotal = endTotal;
        }
      }

      return shiftEndTotal === latestEndTotal;
    };

    // TRIM INCREMENTS (in minutes)
    const TRIM_INCREMENTS = [15, 15, 15, 15]; // 4 layers of 15min = up to 1hr total per person

    // Process each day that's over budget
    for (let day = 0; day < 7; day++) {
      const daySummary = laborSummary.find(d => d.dayOfWeek === day);
      if (!daySummary || !daySummary.overBudget || daySummary.amountOverBudget <= 0) continue;

      let remainingToTrim = daySummary.amountOverBudget;
      console.log(`\nDay ${day} (${daySummary.dayName}): Over budget by $${remainingToTrim.toFixed(2)}`);

      // Get all shifts for this day
      const dayShiftIndices = optimizedShifts
        .map((s, i) => s.day_of_week === day ? i : -1)
        .filter(i => i !== -1);

      // Exclude closing shifts - they're ALWAYS protected
      const eligibleShiftIndices = dayShiftIndices.filter(i => !isClosingShift(optimizedShifts, i));

      console.log(`  Total shifts: ${dayShiftIndices.length}, Eligible (non-closing): ${eligibleShiftIndices.length}`);

      // Group eligible shifts by role priority tier
      const shiftsByTier: Map<number, number[]> = new Map();
      eligibleShiftIndices.forEach(idx => {
        const priority = getRolePriority(optimizedShifts[idx].user_id);
        if (!shiftsByTier.has(priority)) {
          shiftsByTier.set(priority, []);
        }
        shiftsByTier.get(priority)!.push(idx);
      });

      // Sort tiers by priority (1 = team_member first, then 2 = shift_manager, etc.)
      const sortedTiers = [...shiftsByTier.keys()].sort((a, b) => a - b);
      console.log(`  Role tiers to process: ${sortedTiers.map(t => `tier ${t}`).join(', ')}`);

      // Track how many times each shift has been trimmed this day
      const trimCountPerShift = new Map<number, number>();

      // LAYERED APPROACH: For each layer (15min), try to trim ALL eligible people at current tier
      // before moving to next tier. Then move to next layer.
      for (let layer = 0; layer < TRIM_INCREMENTS.length && remainingToTrim > 0; layer++) {
        const trimMinutes = TRIM_INCREMENTS[layer];
        console.log(`  Layer ${layer + 1}: Trimming ${trimMinutes}min from eligible shifts...`);

        // Process each role tier in order (team members first)
        for (const tier of sortedTiers) {
          if (remainingToTrim <= 0) break;

          const tierShifts = shiftsByTier.get(tier) || [];
          // Sort by wage within tier (higher wage = cut first for max savings)
          tierShifts.sort((a, b) => 
            (optimizedShifts[b].hourly_wage || 15) - (optimizedShifts[a].hourly_wage || 15)
          );

          for (const shiftIndex of tierShifts) {
            if (remainingToTrim <= 0) break;

            const shift = optimizedShifts[shiftIndex];
            const currentTrimCount = trimCountPerShift.get(shiftIndex) || 0;

            // Skip if this shift has already been trimmed in this layer
            // (each layer = one trim opportunity per eligible person)
            if (currentTrimCount > layer) continue;

            // Check minimum shift length (don't go below 3 hours)
            const currentHours = calculateShiftHours(shift.start_time, shift.end_time);
            if (currentHours <= 3) {
              console.log(`    Skip ${nameMap.get(shift.user_id)}: shift only ${currentHours.toFixed(1)}h (min 3h)`);
              continue;
            }

            // Check if trim would violate coverage floor
            if (!canTrimEnd(optimizedShifts, shiftIndex, trimMinutes)) {
              console.log(`    Skip ${nameMap.get(shift.user_id)}: would violate min staffing`);
              continue;
            }

            // Calculate new end time
            const [endHour, endMin] = shift.end_time.split(":").map(Number);
            let newEndMin = endMin - trimMinutes;
            let newEndHour = endHour;
            while (newEndMin < 0) {
              newEndMin += 60;
              newEndHour -= 1;
            }
            const newEndTime = `${String(newEndHour).padStart(2, '0')}:${String(newEndMin).padStart(2, '0')}:00`;

            // Verify shift is still at least 3 hours
            const newHours = calculateShiftHours(shift.start_time, newEndTime);
            if (newHours < 3) {
              console.log(`    Skip ${nameMap.get(shift.user_id)}: would drop below 3h`);
              continue;
            }

            // Apply the trim
            const wage = shift.hourly_wage || 15;
            const savings = wage * (trimMinutes / 60);
            const originalEnd = shiftTrimAccumulator.get(shiftIndex)?.original_end || shift.end_time;

            // Accumulate trim for this shift
            const existing = shiftTrimAccumulator.get(shiftIndex);
            if (existing) {
              existing.final_end = newEndTime;
              existing.totalMinutesTrimmed += trimMinutes;
              existing.totalLaborSaved += savings;
            } else {
              shiftTrimAccumulator.set(shiftIndex, {
                user_id: shift.user_id,
                userName: nameMap.get(shift.user_id) || 'Unknown',
                day_of_week: shift.day_of_week,
                original_start: shift.start_time,
                original_end: originalEnd,
                final_end: newEndTime,
                totalMinutesTrimmed: trimMinutes,
                totalLaborSaved: savings,
              });
            }

            // Update the shift
            optimizedShifts[shiftIndex] = { ...shift, end_time: newEndTime };
            trimCountPerShift.set(shiftIndex, currentTrimCount + 1);
            remainingToTrim -= savings;

            const role = roleMap.get(shift.user_id) || 'team_member';
            console.log(`    ✓ Trimmed ${trimMinutes}min from ${nameMap.get(shift.user_id)} (${role}), saved $${savings.toFixed(2)}`);
          }
        }
      }

      console.log(`  Day ${day} complete: Saved $${(daySummary.amountOverBudget - remainingToTrim).toFixed(2)}, still over: $${Math.max(0, remainingToTrim).toFixed(2)}`);
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
    const optimizedLaborSummary = calculateLaborSummary(optimizedShifts);
    const totalSavings = trimSuggestions.reduce((sum, t) => sum + t.laborSaved, 0);

    console.log(`\nOptimization complete: ${trimSuggestions.length} trims, saving $${totalSavings.toFixed(2)}`);

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
