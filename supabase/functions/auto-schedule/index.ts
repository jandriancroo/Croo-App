import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Employee {
  id: string;
  full_name: string;
  min_weekly_hours: number | null;
  max_weekly_hours: number | null;
  role: string | null;
}

interface ShiftTemplateAssignment {
  id: string;
  day_of_week: number;
  shift_template_id: string;
  template_name: string;
  start_time: string;
  end_time: string;
  role: string;
  position: string;
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
  template_id: string;
  template_name: string;
}

interface UnfilledShift {
  dayOfWeek: number;
  templateName: string;
  startTime: string;
  endTime: string;
  reason: string;
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

    // Get employees with their roles (role is directly on profiles table)
    const { data: employees, error: empError } = await supabase
      .from("profiles")
      .select("id, full_name, min_weekly_hours, max_weekly_hours, role")
      .in("id", userIds)
      .eq("is_active", true)
      .eq("appears_on_schedule", true);

    if (empError) throw empError;

    const employeesWithRoles: Employee[] = (employees || []).map((emp: any) => ({
      id: emp.id,
      full_name: emp.full_name,
      min_weekly_hours: emp.min_weekly_hours,
      max_weekly_hours: emp.max_weekly_hours,
      role: emp.role || null,
    }));

    console.log(`Found ${employeesWithRoles.length} schedulable employees`);

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

    const generatedShifts: GeneratedShift[] = [];
    const unfilledShifts: UnfilledShift[] = [];
    const employeeHours: Record<string, number> = {};

    // Initialize employee hours
    employeesWithRoles.forEach((emp: Employee) => {
      employeeHours[emp.id] = 0;
    });

    // Helper to calculate shift hours
    const calculateShiftHours = (startTime: string, endTime: string): number => {
      const startParts = startTime.split(":");
      const endParts = endTime.split(":");
      const startHour = parseInt(startParts[0]) + parseInt(startParts[1]) / 60;
      const endHour = parseInt(endParts[0]) + parseInt(endParts[1]) / 60;
      return endHour > startHour ? endHour - startHour : 24 - startHour + endHour;
    };

    // Helper to check if employee is available for a shift
    const isEmployeeAvailable = (employeeId: string, dayOfWeek: number, startTime: string, endTime: string): boolean => {
      const shiftDate = new Date(weekStartDate);
      shiftDate.setDate(shiftDate.getDate() + dayOfWeek);
      const shiftDateStr = shiftDate.toISOString().split("T")[0];

      const shiftStartHour = parseInt(startTime.split(":")[0]);
      const shiftEndHour = parseInt(endTime.split(":")[0]);

      for (const block of timeOffBlocks) {
        if (block.user_id !== employeeId) continue;

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
            // Check if shift overlaps with time off block
            if (shiftStartHour < blockEndHour && shiftEndHour > blockStartHour) {
              return false;
            }
          }
        }
      }
      return true;
    };

    // Helper to check if employee can take more hours
    const canTakeMoreHours = (employeeId: string, additionalHours: number): boolean => {
      const emp = employeesWithRoles.find((e: Employee) => e.id === employeeId);
      if (!emp) return false;
      
      const maxHours = emp.max_weekly_hours ?? 40;
      // Skip employees with max_weekly_hours = 0 (they can't be scheduled)
      if (maxHours === 0) return false;
      
      return (employeeHours[employeeId] || 0) + additionalHours <= maxHours;
    };

    // Helper to check if employee role is compatible with shift template role
    const isRoleCompatible = (employeeRole: string | null, templateRole: string | null): boolean => {
      if (!templateRole) return true; // No role restriction on template
      if (!employeeRole) return false; // Employee has no role, can't match

      // Map manager template role to compatible employee roles
      if (templateRole === 'manager') {
        return ['shift_manager', 'general_manager', 'manager', 'admin', 'org_admin', 'super_admin'].includes(employeeRole);
      }
      
      // Map team_member template role to team members only
      if (templateRole === 'team_member') {
        return employeeRole === 'team_member';
      }

      // Default: exact match
      return employeeRole === templateRole;
    };

    // Helper to check if employee already has a shift on this day
    const hasShiftOnDay = (employeeId: string, dayOfWeek: number): boolean => {
      return generatedShifts.some((s) => s.user_id === employeeId && s.day_of_week === dayOfWeek);
    };

    if (source_type === "template" && template_id) {
      // Get shift template assignments for this week template
      const { data: assignmentsData, error: assignError } = await supabase
        .from("week_template_assignments")
        .select(`
          id,
          day_of_week,
          shift_template_id,
          shift_templates!inner (
            template_name,
            start_time,
            end_time,
            role,
            position
          )
        `)
        .eq("week_template_id", template_id)
        .order("day_of_week");

      if (assignError) throw assignError;

      const assignments: ShiftTemplateAssignment[] = (assignmentsData || []).map((a: any) => ({
        id: a.id,
        day_of_week: a.day_of_week,
        shift_template_id: a.shift_template_id,
        template_name: a.shift_templates.template_name,
        start_time: a.shift_templates.start_time,
        end_time: a.shift_templates.end_time,
        role: a.shift_templates.role,
        position: a.shift_templates.position,
      }));

      console.log(`Found ${assignments.length} shift template assignments`);

      // Sort employees by minimum hours (prioritize those who need more hours)
      const sortedEmployees = [...employeesWithRoles].sort((a: Employee, b: Employee) => {
        const aMin = a.min_weekly_hours ?? 0;
        const bMin = b.min_weekly_hours ?? 0;
        return bMin - aMin;
      });

      // For each shift template assignment, try to assign an employee
      for (const assignment of assignments) {
        const shiftDate = new Date(weekStartDate);
        shiftDate.setDate(shiftDate.getDate() + assignment.day_of_week);
        const shiftDateStr = shiftDate.toISOString().split("T")[0];

        const shiftHours = calculateShiftHours(assignment.start_time, assignment.end_time);
        let assigned = false;

        // Try to find an available employee
        for (const emp of sortedEmployees) {
          // Check if employee's role matches the template's role requirement
          if (!isRoleCompatible(emp.role, assignment.role)) {
            continue;
          }

          // Check if employee can be scheduled
          if (!canTakeMoreHours(emp.id, shiftHours)) {
            continue;
          }

          // Check if employee is available (no time off)
          if (!isEmployeeAvailable(emp.id, assignment.day_of_week, assignment.start_time, assignment.end_time)) {
            continue;
          }

          // Check if employee already has a shift on this day (one shift per day max)
          if (hasShiftOnDay(emp.id, assignment.day_of_week)) {
            continue;
          }

          // Assign the shift
          generatedShifts.push({
            user_id: emp.id,
            day_of_week: assignment.day_of_week,
            start_time: assignment.start_time,
            end_time: assignment.end_time,
            shift_date: shiftDateStr,
            template_id: assignment.shift_template_id,
            template_name: assignment.template_name,
          });

          employeeHours[emp.id] = (employeeHours[emp.id] || 0) + shiftHours;
          assigned = true;
          console.log(`Assigned ${emp.full_name} to ${assignment.template_name} on day ${assignment.day_of_week}`);
          break;
        }

        if (!assigned) {
          // Track unfilled shift with reason
          let reason = "No available employees";
          
          // Check why no one could be assigned - first filter by role
          const roleMatchingEmps = sortedEmployees.filter(emp => 
            isRoleCompatible(emp.role, assignment.role)
          );

          if (roleMatchingEmps.length === 0) {
            reason = `No employees with ${assignment.role || 'required'} role`;
          } else {
            const availableEmps = roleMatchingEmps.filter(emp => {
              const maxHours = emp.max_weekly_hours ?? 40;
              if (maxHours === 0) return false;
              return (employeeHours[emp.id] || 0) + shiftHours <= maxHours;
            });

            if (availableEmps.length === 0) {
              reason = "All matching employees at max hours";
            } else {
              const availableWithNoConflict = availableEmps.filter(emp => 
                isEmployeeAvailable(emp.id, assignment.day_of_week, assignment.start_time, assignment.end_time) &&
                !hasShiftOnDay(emp.id, assignment.day_of_week)
              );
              
              if (availableWithNoConflict.length === 0) {
                reason = "All matching employees have conflicts or time off";
              }
            }
          }

          unfilledShifts.push({
            dayOfWeek: assignment.day_of_week,
            templateName: assignment.template_name,
            startTime: assignment.start_time,
            endTime: assignment.end_time,
            reason: reason,
          });
          console.log(`Could not fill ${assignment.template_name} on day ${assignment.day_of_week}: ${reason}`);
        }
      }
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
          .select("user_id, day_of_week, start_time, end_time, template_id")
          .eq("schedule_id", lastSchedule.id)
          .eq("is_time_off", false);

        if (shiftError) throw shiftError;

        console.log(`Found ${(lastShifts || []).length} shifts from last week`);

        for (const shift of (lastShifts || [])) {
          if (!shift.user_id) continue;

          const emp = employeesWithRoles.find((e: Employee) => e.id === shift.user_id);
          if (!emp) continue;

          const shiftDate = new Date(weekStartDate);
          shiftDate.setDate(shiftDate.getDate() + shift.day_of_week);
          const shiftDateStr = shiftDate.toISOString().split("T")[0];

          const shiftHours = calculateShiftHours(shift.start_time, shift.end_time);

          if (
            canTakeMoreHours(shift.user_id, shiftHours) &&
            isEmployeeAvailable(shift.user_id, shift.day_of_week, shift.start_time, shift.end_time)
          ) {
            generatedShifts.push({
              user_id: shift.user_id,
              day_of_week: shift.day_of_week,
              start_time: shift.start_time,
              end_time: shift.end_time,
              shift_date: shiftDateStr,
              template_id: shift.template_id || "",
              template_name: "",
            });
            employeeHours[shift.user_id] = (employeeHours[shift.user_id] || 0) + shiftHours;
          }
        }
      }
    }

    console.log(`Generated ${generatedShifts.length} shifts, ${unfilledShifts.length} unfilled shifts`);
    console.log("Employee hours summary:", employeeHours);

    return new Response(
      JSON.stringify({
        shifts: generatedShifts,
        unfilled: unfilledShifts,
        employeeCount: employeesWithRoles.length,
        employeeHours: employeeHours,
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
