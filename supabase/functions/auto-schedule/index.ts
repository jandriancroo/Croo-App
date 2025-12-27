import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface HourlyCoverage {
  day_of_week: number;
  hour: number;
  min_staff: number;
}

interface Employee {
  id: string;
  full_name: string;
  min_weekly_hours: number | null;
  max_weekly_hours: number | null;
}

interface AvailabilityBlock {
  user_id: string;
  start_date: string;
  end_date: string | null;
  time_scope: string;
  start_time: string | null;
  end_time: string | null;
}

interface GeneratedShift {
  user_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  shift_date: string;
}

interface UnfilledGap {
  dayOfWeek: number;
  hour: number;
  required: number;
  filled: number;
  gap: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { location_id, schedule_id, week_start, source_type, template_id } = await req.json();

    console.log("Auto-schedule request:", { location_id, schedule_id, week_start, source_type, template_id });

    if (!location_id || !week_start) {
      throw new Error("Missing required parameters: location_id and week_start");
    }

    // Parse week start date
    const weekStartDate = new Date(week_start + "T12:00:00Z");
    
    // Get employees at this location with their min/max hours
    const { data: userLocations, error: ulError } = await supabase
      .from("user_locations")
      .select("user_id")
      .eq("location_id", location_id);

    if (ulError) throw ulError;

    const userIds = (userLocations || []).map((ul: any) => ul.user_id);

    if (userIds.length === 0) {
      return new Response(
        JSON.stringify({ shifts: [], unfilled: [], employeeCount: 0, message: "No employees found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: employees, error: empError } = await supabase
      .from("profiles")
      .select("id, full_name, min_weekly_hours, max_weekly_hours")
      .in("id", userIds)
      .eq("is_active", true)
      .eq("appears_on_schedule", true);

    if (empError) throw empError;

    console.log(`Found ${(employees || []).length} schedulable employees`);

    // Get approved time off for the week
    const weekEnd = new Date(weekStartDate);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split("T")[0];

    const { data: timeOffData, error: toError } = await supabase
      .from("availability_requests")
      .select("user_id, start_date, end_date, time_scope, start_time, end_time")
      .eq("location_id", location_id)
      .eq("status", "approved")
      .gte("start_date", week_start)
      .lte("start_date", weekEndStr);

    if (toError) throw toError;

    const timeOffBlocks: AvailabilityBlock[] = (timeOffData || []).map((r: any) => ({
      user_id: r.user_id,
      start_date: r.start_date,
      end_date: r.end_date,
      time_scope: r.time_scope,
      start_time: r.start_time,
      end_time: r.end_time,
    }));

    console.log(`Found ${timeOffBlocks.length} approved time off blocks`);

    let hourlyCoverage: HourlyCoverage[] = [];
    let existingShifts: any[] = [];

    if (source_type === "template" && template_id) {
      // Get hourly coverage from template
      const { data: coverageData, error: covError } = await supabase
        .from("week_template_hourly_coverage")
        .select("day_of_week, hour, min_staff")
        .eq("week_template_id", template_id)
        .gt("min_staff", 0);

      if (covError) throw covError;
      hourlyCoverage = coverageData || [];
      console.log(`Found ${hourlyCoverage.length} hourly coverage requirements`);
    } else if (source_type === "last_week") {
      // Get last week's schedule
      const lastWeekStart = new Date(weekStartDate);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekStartStr = lastWeekStart.toISOString().split("T")[0];

      const { data: lastSchedule, error: lsError } = await supabase
        .from("schedules")
        .select("id")
        .eq("location_id", location_id)
        .eq("week_start_date", lastWeekStartStr)
        .single();

      if (lsError && lsError.code !== "PGRST116") throw lsError;

      if (lastSchedule) {
        const { data: lastShifts, error: shiftError } = await supabase
          .from("scheduled_shifts")
          .select("user_id, day_of_week, start_time, end_time")
          .eq("schedule_id", lastSchedule.id)
          .eq("is_time_off", false);

        if (shiftError) throw shiftError;
        existingShifts = lastShifts || [];
        console.log(`Found ${existingShifts.length} shifts from last week`);
      }
    }

    // Generate shifts based on source
    const generatedShifts: GeneratedShift[] = [];
    const unfilledGaps: UnfilledGap[] = [];
    const employeeHours: Record<string, number> = {};

    // Initialize employee hours
    (employees || []).forEach((emp: Employee) => {
      employeeHours[emp.id] = 0;
    });

    // Helper to check if employee is available at a given day/hour
    const isEmployeeAvailable = (employeeId: string, dayOfWeek: number, hour: number): boolean => {
      const shiftDate = new Date(weekStartDate);
      shiftDate.setDate(shiftDate.getDate() + dayOfWeek);
      const shiftDateStr = shiftDate.toISOString().split("T")[0];

      for (const block of timeOffBlocks) {
        if (block.user_id !== employeeId) continue;

        // Check if this date falls within the time off block
        const blockStart = new Date(block.start_date);
        const blockEnd = block.end_date ? new Date(block.end_date) : blockStart;
        const checkDate = new Date(shiftDateStr);

        if (checkDate >= blockStart && checkDate <= blockEnd) {
          if (block.time_scope === "full_day" || block.time_scope === "multi_day") {
            return false;
          }
          if (block.time_scope === "partial_day" && block.start_time && block.end_time) {
            const blockStartHour = parseInt(block.start_time.split(":")[0]);
            const blockEndHour = parseInt(block.end_time.split(":")[0]);
            if (hour >= blockStartHour && hour < blockEndHour) {
              return false;
            }
          }
        }
      }
      return true;
    };

    // Helper to check if employee can take more hours
    const canTakeMoreHours = (employeeId: string, additionalHours: number): boolean => {
      const emp = (employees || []).find((e: Employee) => e.id === employeeId);
      if (!emp) return false;
      
      const maxHours = emp.max_weekly_hours ?? 40; // Default to 40 if not set
      return (employeeHours[employeeId] || 0) + additionalHours <= maxHours;
    };

    if (source_type === "last_week" && existingShifts.length > 0) {
      // Copy last week's shifts, adjusting dates and checking availability
      for (const shift of existingShifts) {
        if (!shift.user_id) continue;

        // Check if employee is still active
        const emp = (employees || []).find((e: Employee) => e.id === shift.user_id);
        if (!emp) continue;

        const shiftDate = new Date(weekStartDate);
        shiftDate.setDate(shiftDate.getDate() + shift.day_of_week);
        const shiftDateStr = shiftDate.toISOString().split("T")[0];

        // Calculate shift hours
        const startHour = parseInt(shift.start_time.split(":")[0]);
        const endHour = parseInt(shift.end_time.split(":")[0]);
        const shiftHours = endHour > startHour ? endHour - startHour : 24 - startHour + endHour;

        // Check availability for the entire shift
        let available = true;
        for (let h = startHour; h !== endHour; h = (h + 1) % 24) {
          if (!isEmployeeAvailable(shift.user_id, shift.day_of_week, h)) {
            available = false;
            break;
          }
        }

        if (available && canTakeMoreHours(shift.user_id, shiftHours)) {
          generatedShifts.push({
            user_id: shift.user_id,
            day_of_week: shift.day_of_week,
            start_time: shift.start_time,
            end_time: shift.end_time,
            shift_date: shiftDateStr,
          });
          employeeHours[shift.user_id] = (employeeHours[shift.user_id] || 0) + shiftHours;
        }
      }
    } else if (source_type === "template" && hourlyCoverage.length > 0) {
      // Build shifts from hourly coverage requirements
      // Group consecutive hours into shifts
      const coverageByDay: Record<number, number[]> = {};
      
      for (const cov of hourlyCoverage) {
        if (!coverageByDay[cov.day_of_week]) {
          coverageByDay[cov.day_of_week] = [];
        }
        // Add the hour for each staff member needed
        for (let i = 0; i < cov.min_staff; i++) {
          coverageByDay[cov.day_of_week].push(cov.hour);
        }
      }

      // Track coverage fulfillment
      const filledCoverage: Record<string, number> = {};

      // Sort employees by minimum hours (prioritize those who need more hours)
      const sortedEmployees = [...(employees || [])].sort((a: Employee, b: Employee) => {
        const aMin = a.min_weekly_hours ?? 0;
        const bMin = b.min_weekly_hours ?? 0;
        return bMin - aMin;
      });

      // For each day, try to assign shifts
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        const hoursNeeded = coverageByDay[dayOfWeek] || [];
        if (hoursNeeded.length === 0) continue;

        // Get unique hours sorted
        const uniqueHours = [...new Set(hoursNeeded)].sort((a, b) => a - b);
        if (uniqueHours.length === 0) continue;

        // Find contiguous ranges
        const ranges: { start: number; end: number }[] = [];
        let rangeStart = uniqueHours[0];
        let prevHour = uniqueHours[0];

        for (let i = 1; i <= uniqueHours.length; i++) {
          const currentHour = uniqueHours[i];
          if (currentHour !== prevHour + 1 || i === uniqueHours.length) {
            ranges.push({ start: rangeStart, end: prevHour + 1 });
            rangeStart = currentHour;
          }
          prevHour = currentHour;
        }

        // Calculate date for this day
        const shiftDate = new Date(weekStartDate);
        shiftDate.setDate(shiftDate.getDate() + dayOfWeek);
        const shiftDateStr = shiftDate.toISOString().split("T")[0];

        // For each range, try to assign employees
        for (const range of ranges) {
          const shiftHours = range.end - range.start;

          for (const emp of sortedEmployees) {
            // Check if already has a shift on this day (simple: skip for now)
            const hasShiftOnDay = generatedShifts.some(
              (s) => s.user_id === emp.id && s.day_of_week === dayOfWeek
            );
            if (hasShiftOnDay) continue;

            // Check availability for the entire shift
            let available = true;
            for (let h = range.start; h < range.end; h++) {
              if (!isEmployeeAvailable(emp.id, dayOfWeek, h)) {
                available = false;
                break;
              }
            }

            if (available && canTakeMoreHours(emp.id, shiftHours)) {
              const startTime = `${range.start.toString().padStart(2, "0")}:00:00`;
              const endTime = `${range.end.toString().padStart(2, "0")}:00:00`;

              generatedShifts.push({
                user_id: emp.id,
                day_of_week: dayOfWeek,
                start_time: startTime,
                end_time: endTime,
                shift_date: shiftDateStr,
              });

              employeeHours[emp.id] = (employeeHours[emp.id] || 0) + shiftHours;

              // Mark hours as filled
              for (let h = range.start; h < range.end; h++) {
                const key = `${dayOfWeek}-${h}`;
                filledCoverage[key] = (filledCoverage[key] || 0) + 1;
              }

              break; // One employee per range for now
            }
          }
        }
      }

      // Calculate unfilled gaps
      for (const cov of hourlyCoverage) {
        const key = `${cov.day_of_week}-${cov.hour}`;
        const filled = filledCoverage[key] || 0;
        if (filled < cov.min_staff) {
          unfilledGaps.push({
            dayOfWeek: cov.day_of_week,
            hour: cov.hour,
            required: cov.min_staff,
            filled: filled,
            gap: cov.min_staff - filled,
          });
        }
      }
    }

    console.log(`Generated ${generatedShifts.length} shifts, ${unfilledGaps.length} unfilled gaps`);

    return new Response(
      JSON.stringify({
        shifts: generatedShifts,
        unfilled: unfilledGaps,
        employeeCount: (employees || []).length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Auto-schedule error:", error);
    const message = error instanceof Error ? error.message : "Failed to generate schedule";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
