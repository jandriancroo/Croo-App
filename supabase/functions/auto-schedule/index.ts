import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DayAvailability {
  available: boolean;
  start?: string; // e.g., "10:00"
  end?: string;   // e.g., "15:00"
}

interface WeeklyAvailability {
  monday: DayAvailability;
  tuesday: DayAvailability;
  wednesday: DayAvailability;
  thursday: DayAvailability;
  friday: DayAvailability;
  saturday: DayAvailability;
  sunday: DayAvailability;
}

interface Employee {
  id: string;
  full_name: string;
  min_weekly_hours: number | null;
  max_weekly_hours: number | null;
  role: string | null;
  weekly_availability: WeeklyAvailability | null;
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
  allowed_roles: string[] | null;
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

    // Get employees (roles live in public.user_roles)
    const { data: employees, error: empError } = await supabase
      .from("profiles")
      .select("id, full_name, min_weekly_hours, max_weekly_hours, weekly_availability")
      .in("id", userIds)
      .eq("is_active", true)
      .eq("appears_on_schedule", true);

    if (empError) throw empError;

    const schedulableUserIds = (employees || []).map((e: any) => e.id);

    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", schedulableUserIds);

    if (roleError) throw roleError;

    const roleByUserId = new Map<string, string>();
    (roleRows || []).forEach((r: any) => {
      if (r?.user_id && r?.role) roleByUserId.set(r.user_id, r.role);
    });

    const employeesWithRoles: Employee[] = (employees || []).map((emp: any) => ({
      id: emp.id,
      full_name: emp.full_name,
      min_weekly_hours: emp.min_weekly_hours,
      max_weekly_hours: emp.max_weekly_hours,
      role: roleByUserId.get(emp.id) ?? "team_member",
      weekly_availability: emp.weekly_availability as WeeklyAvailability | null,
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

    // Helper to convert day of week (0=Mon) to day name
    const getDayName = (dayOfWeek: number): keyof WeeklyAvailability => {
      const days: (keyof WeeklyAvailability)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      return days[dayOfWeek];
    };

    // Helper to parse time string to minutes since midnight
    const timeToMinutes = (time: string): number => {
      const parts = time.split(":");
      return parseInt(parts[0]) * 60 + parseInt(parts[1] || "0");
    };

    // Helper to check if employee is available for a shift
    const isEmployeeAvailable = (employeeId: string, dayOfWeek: number, startTime: string, endTime: string): boolean => {
      const emp = employeesWithRoles.find((e: Employee) => e.id === employeeId);
      if (!emp) return false;

      // First check weekly availability preferences
      if (emp.weekly_availability) {
        const dayName = getDayName(dayOfWeek);
        const dayPref = emp.weekly_availability[dayName];
        
        if (dayPref && !dayPref.available) {
          // Employee marked as unavailable this day
          return false;
        }
        
        if (dayPref && dayPref.available) {
          // Employee has restricted hours this day - check start and/or end constraints
          const shiftStartMins = timeToMinutes(startTime);
          const shiftEndMins = timeToMinutes(endTime);
          
          // If they have a start restriction (e.g., "from 9:00 AM")
          if (dayPref.start) {
            const prefStartMins = timeToMinutes(dayPref.start);
            if (shiftStartMins < prefStartMins) {
              return false;
            }
          }
          
          // If they have an end restriction (e.g., "until 5:00 PM")
          if (dayPref.end) {
            const prefEndMins = timeToMinutes(dayPref.end);
            if (shiftEndMins > prefEndMins) {
              return false;
            }
          }
        }
      }

      // Then check approved time-off requests
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

    // Helper to check if employee role is compatible with shift template's allowed_roles
    const isRoleCompatible = (employeeRole: string | null, allowedRoles: string[] | null): boolean => {
      // If no allowed_roles specified, allow anyone
      if (!allowedRoles || allowedRoles.length === 0) return true;
      if (!employeeRole) return false;

      // Check if employee's role is in the allowed list
      if (allowedRoles.includes(employeeRole)) return true;

      // Also check role hierarchy - if "manager" is allowed, shift_manager/general_manager should qualify
      if (allowedRoles.includes('manager')) {
        if (['shift_manager', 'general_manager', 'admin', 'org_admin', 'super_admin'].includes(employeeRole)) {
          return true;
        }
      }

      // If "team_member" is allowed and employee is team_member
      if (allowedRoles.includes('team_member') && employeeRole === 'team_member') {
        return true;
      }

      return false;
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
            position,
            allowed_roles
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
        allowed_roles: a.shift_templates.allowed_roles,
      }));

      console.log(`Found ${assignments.length} shift template assignments`);

    // Helper to shuffle array (Fisher-Yates)
    const shuffleArray = <T>(array: T[]): T[] => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    // Helper to get employee's current fill percentage vs their min hours
    const getFillPercentage = (employeeId: string): number => {
      const emp = employeesWithRoles.find((e: Employee) => e.id === employeeId);
      if (!emp) return 100;
      const minHours = emp.min_weekly_hours ?? 0;
      if (minHours === 0) return 100; // No minimum, consider fully satisfied
      const currentHours = employeeHours[employeeId] || 0;
      return (currentHours / minHours) * 100;
    };

    // Helper to get days worked count
    const getDaysWorked = (employeeId: string): number => {
      const daysWithShifts = new Set(
        generatedShifts.filter(s => s.user_id === employeeId).map(s => s.day_of_week)
      );
      return daysWithShifts.size;
    };

    // For each shift template assignment, try to assign an employee
    for (const assignment of assignments) {
      const shiftDate = new Date(weekStartDate);
      shiftDate.setDate(shiftDate.getDate() + assignment.day_of_week);
      const shiftDateStr = shiftDate.toISOString().split("T")[0];

      const shiftHours = calculateShiftHours(assignment.start_time, assignment.end_time);
      let assigned = false;

      // Get all eligible employees for this shift
      const eligibleEmployees = employeesWithRoles.filter((emp: Employee) => {
        // Check role compatibility
        if (!isRoleCompatible(emp.role, assignment.allowed_roles)) return false;
        // Check hours capacity
        if (!canTakeMoreHours(emp.id, shiftHours)) return false;
        // Check availability (no time off)
        if (!isEmployeeAvailable(emp.id, assignment.day_of_week, assignment.start_time, assignment.end_time)) return false;
        // Check if already has shift on this day
        if (hasShiftOnDay(emp.id, assignment.day_of_week)) return false;
        return true;
      });

      if (eligibleEmployees.length > 0) {
        // Helper to check if employee is a manager role
        const isManagerRole = (role: string | null): boolean => {
          return ['manager', 'shift_manager', 'general_manager', 'admin', 'org_admin', 'super_admin'].includes(role || '');
        };

        // Helper to check if employee has met their minimum hours
        const hasMetMinHours = (employeeId: string): boolean => {
          const emp = employeesWithRoles.find((e: Employee) => e.id === employeeId);
          if (!emp) return true;
          const minHours = emp.min_weekly_hours ?? 0;
          if (minHours === 0) return true;
          return (employeeHours[employeeId] || 0) >= minHours;
        };

        // Score employees for fair distribution:
        // PRIORITY 1: Managers who haven't met min hours get massive priority (-1000 bonus)
        // PRIORITY 2: Other employees based on fill percentage
        // PRIORITY 3: Days worked (spread shifts)
        // PRIORITY 4: Random factor for variety
        const scoredEmployees = eligibleEmployees.map((emp: Employee) => {
          const fillPct = getFillPercentage(emp.id);
          const daysWorked = getDaysWorked(emp.id);
          const randomFactor = Math.random() * 10; // 0-10 random bonus
          
          // Lower score = higher priority
          let score = fillPct + (daysWorked * 5) - randomFactor;
          
          // CRITICAL: Managers who haven't met min hours get highest priority
          if (isManagerRole(emp.role) && !hasMetMinHours(emp.id)) {
            score -= 1000; // Massive priority boost for managers under their min hours
          }
          
          // Secondary: Any employee under min hours gets priority (but less than managers)
          if (!hasMetMinHours(emp.id) && !isManagerRole(emp.role)) {
            score -= 200; // Priority boost for team members under min hours
          }
          
          return { emp, score };
        });

        // Sort by score (lowest first = highest priority)
        scoredEmployees.sort((a, b) => a.score - b.score);

        const selectedEmp = scoredEmployees[0].emp;

        // Assign the shift
        generatedShifts.push({
          user_id: selectedEmp.id,
          day_of_week: assignment.day_of_week,
          start_time: assignment.start_time,
          end_time: assignment.end_time,
          shift_date: shiftDateStr,
          template_id: assignment.shift_template_id,
          template_name: assignment.template_name,
        });

        employeeHours[selectedEmp.id] = (employeeHours[selectedEmp.id] || 0) + shiftHours;
        assigned = true;
        console.log(`Assigned ${selectedEmp.full_name} to ${assignment.template_name} on day ${assignment.day_of_week} (fill: ${getFillPercentage(selectedEmp.id).toFixed(0)}%, days: ${getDaysWorked(selectedEmp.id)})`);
      }

      if (!assigned) {
        // Track unfilled shift with reason
        let reason = "No available employees";
        
        // Check why no one could be assigned - first filter by role
        const roleMatchingEmps = employeesWithRoles.filter((emp: Employee) => 
          isRoleCompatible(emp.role, assignment.allowed_roles)
        );

        if (roleMatchingEmps.length === 0) {
          const rolesDisplay = assignment.allowed_roles?.join(', ') || assignment.role || 'required';
          reason = `No employees with ${rolesDisplay} role`;
        } else {
          const availableEmps = roleMatchingEmps.filter((emp: Employee) => {
            const maxHours = emp.max_weekly_hours ?? 40;
            if (maxHours === 0) return false;
            return (employeeHours[emp.id] || 0) + shiftHours <= maxHours;
          });

          if (availableEmps.length === 0) {
            reason = "All matching employees at max hours";
          } else {
            const availableWithNoConflict = availableEmps.filter((emp: Employee) => 
              isEmployeeAvailable(emp.id, assignment.day_of_week, assignment.start_time, assignment.end_time) &&
              !hasShiftOnDay(emp.id, assignment.day_of_week)
            );
            
            if (availableWithNoConflict.length === 0) {
              reason = "All matching employees have conflicts, time off, or availability restrictions";
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
      // Get last week's schedule and use it as the template for auto-scheduling
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
        // Get last week's shifts with template info
        const { data: lastShifts, error: shiftError } = await supabase
          .from("scheduled_shifts")
          .select(`
            user_id, 
            day_of_week, 
            start_time, 
            end_time, 
            template_id,
            shift_templates (
              template_name,
              role,
              allowed_roles
            )
          `)
          .eq("schedule_id", lastSchedule.id)
          .eq("is_time_off", false)
          .order("day_of_week");

        if (shiftError) throw shiftError;

        console.log(`Found ${(lastShifts || []).length} shifts from last week to use as template`);

        // Convert last week's shifts into assignment-like objects
        interface LastWeekAssignment {
          day_of_week: number;
          start_time: string;
          end_time: string;
          template_id: string;
          template_name: string;
          allowed_roles: string[] | null;
          original_user_id: string | null;
        }

        const lastWeekAssignments: LastWeekAssignment[] = (lastShifts || []).map((shift: any) => ({
          day_of_week: shift.day_of_week,
          start_time: shift.start_time,
          end_time: shift.end_time,
          template_id: shift.template_id || "",
          template_name: shift.shift_templates?.template_name || "",
          allowed_roles: shift.shift_templates?.allowed_roles || null,
          original_user_id: shift.user_id,
        }));

        // Helper to shuffle array (Fisher-Yates)
        const shuffleArray = <T>(array: T[]): T[] => {
          const shuffled = [...array];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          return shuffled;
        };

        // Helper to get employee's current fill percentage vs their min hours
        const getFillPercentage = (employeeId: string): number => {
          const emp = employeesWithRoles.find((e: Employee) => e.id === employeeId);
          if (!emp) return 100;
          const minHours = emp.min_weekly_hours ?? 0;
          if (minHours === 0) return 100;
          const currentHours = employeeHours[employeeId] || 0;
          return (currentHours / minHours) * 100;
        };

        // Helper to get days worked count
        const getDaysWorked = (employeeId: string): number => {
          const daysWithShifts = new Set(
            generatedShifts.filter(s => s.user_id === employeeId).map(s => s.day_of_week)
          );
          return daysWithShifts.size;
        };

        // Helper to check if employee role is compatible with shift template's allowed_roles
        const isRoleCompatible = (employeeRole: string | null, allowedRoles: string[] | null): boolean => {
          if (!allowedRoles || allowedRoles.length === 0) return true;
          if (!employeeRole) return false;
          if (allowedRoles.includes(employeeRole)) return true;
          if (allowedRoles.includes('manager')) {
            if (['shift_manager', 'general_manager', 'admin', 'org_admin', 'super_admin'].includes(employeeRole)) {
              return true;
            }
          }
          if (allowedRoles.includes('team_member') && employeeRole === 'team_member') {
            return true;
          }
          return false;
        };

        // Helper to check if employee already has a shift on this day
        const hasShiftOnDay = (employeeId: string, dayOfWeek: number): boolean => {
          return generatedShifts.some((s) => s.user_id === employeeId && s.day_of_week === dayOfWeek);
        };

        // Helper to check if employee is a manager role
        const isManagerRole = (role: string | null): boolean => {
          return ['manager', 'shift_manager', 'general_manager', 'admin', 'org_admin', 'super_admin'].includes(role || '');
        };

        // Helper to check if employee has met their minimum hours
        const hasMetMinHours = (employeeId: string): boolean => {
          const emp = employeesWithRoles.find((e: Employee) => e.id === employeeId);
          if (!emp) return true;
          const minHours = emp.min_weekly_hours ?? 0;
          if (minHours === 0) return true;
          return (employeeHours[employeeId] || 0) >= minHours;
        };

        // Process each shift from last week using the same scoring logic as template mode
        for (const assignment of lastWeekAssignments) {
          const shiftDate = new Date(weekStartDate);
          shiftDate.setDate(shiftDate.getDate() + assignment.day_of_week);
          const shiftDateStr = shiftDate.toISOString().split("T")[0];

          const shiftHours = calculateShiftHours(assignment.start_time, assignment.end_time);
          let assigned = false;

          // First, try the original employee if they're still eligible
          const originalEmp = assignment.original_user_id 
            ? employeesWithRoles.find((e: Employee) => e.id === assignment.original_user_id)
            : null;

          if (originalEmp) {
            const originalEligible = 
              isRoleCompatible(originalEmp.role, assignment.allowed_roles) &&
              canTakeMoreHours(originalEmp.id, shiftHours) &&
              isEmployeeAvailable(originalEmp.id, assignment.day_of_week, assignment.start_time, assignment.end_time) &&
              !hasShiftOnDay(originalEmp.id, assignment.day_of_week);

            if (originalEligible) {
              // Original employee can take this shift
              generatedShifts.push({
                user_id: originalEmp.id,
                day_of_week: assignment.day_of_week,
                start_time: assignment.start_time,
                end_time: assignment.end_time,
                shift_date: shiftDateStr,
                template_id: assignment.template_id,
                template_name: assignment.template_name,
              });
              employeeHours[originalEmp.id] = (employeeHours[originalEmp.id] || 0) + shiftHours;
              assigned = true;
              console.log(`Kept ${originalEmp.full_name} on ${assignment.template_name || 'shift'} on day ${assignment.day_of_week}`);
            }
          }

          // If original employee can't take the shift, find a replacement using scoring
          if (!assigned) {
            const eligibleEmployees = employeesWithRoles.filter((emp: Employee) => {
              if (!isRoleCompatible(emp.role, assignment.allowed_roles)) return false;
              if (!canTakeMoreHours(emp.id, shiftHours)) return false;
              if (!isEmployeeAvailable(emp.id, assignment.day_of_week, assignment.start_time, assignment.end_time)) return false;
              if (hasShiftOnDay(emp.id, assignment.day_of_week)) return false;
              return true;
            });

            if (eligibleEmployees.length > 0) {
              // Score employees for fair distribution
              const scoredEmployees = eligibleEmployees.map((emp: Employee) => {
                const fillPct = getFillPercentage(emp.id);
                const daysWorked = getDaysWorked(emp.id);
                const randomFactor = Math.random() * 10;
                
                let score = fillPct + (daysWorked * 5) - randomFactor;
                
                if (isManagerRole(emp.role) && !hasMetMinHours(emp.id)) {
                  score -= 1000;
                }
                
                if (!hasMetMinHours(emp.id) && !isManagerRole(emp.role)) {
                  score -= 200;
                }
                
                return { emp, score };
              });

              scoredEmployees.sort((a, b) => a.score - b.score);
              const selectedEmp = scoredEmployees[0].emp;

              generatedShifts.push({
                user_id: selectedEmp.id,
                day_of_week: assignment.day_of_week,
                start_time: assignment.start_time,
                end_time: assignment.end_time,
                shift_date: shiftDateStr,
                template_id: assignment.template_id,
                template_name: assignment.template_name,
              });

              employeeHours[selectedEmp.id] = (employeeHours[selectedEmp.id] || 0) + shiftHours;
              assigned = true;
              console.log(`Replaced with ${selectedEmp.full_name} for ${assignment.template_name || 'shift'} on day ${assignment.day_of_week} (fill: ${getFillPercentage(selectedEmp.id).toFixed(0)}%)`);
            }
          }

          if (!assigned) {
            // Track unfilled shift with reason
            let reason = "No available employees";
            
            const roleMatchingEmps = employeesWithRoles.filter((emp: Employee) => 
              isRoleCompatible(emp.role, assignment.allowed_roles)
            );

            if (roleMatchingEmps.length === 0) {
              const rolesDisplay = assignment.allowed_roles?.join(', ') || 'required';
              reason = `No employees with ${rolesDisplay} role`;
            } else {
              const availableEmps = roleMatchingEmps.filter((emp: Employee) => {
                const maxHours = emp.max_weekly_hours ?? 40;
                if (maxHours === 0) return false;
                return (employeeHours[emp.id] || 0) + shiftHours <= maxHours;
              });

              if (availableEmps.length === 0) {
                reason = "All matching employees at max hours";
              } else {
                const availableWithNoConflict = availableEmps.filter((emp: Employee) => 
                  isEmployeeAvailable(emp.id, assignment.day_of_week, assignment.start_time, assignment.end_time) &&
                  !hasShiftOnDay(emp.id, assignment.day_of_week)
                );
                
                if (availableWithNoConflict.length === 0) {
                  reason = "All matching employees have conflicts, time off, or availability restrictions";
                }
              }
            }

            unfilledShifts.push({
              dayOfWeek: assignment.day_of_week,
              templateName: assignment.template_name || "Shift",
              startTime: assignment.start_time,
              endTime: assignment.end_time,
              reason: reason,
            });
            console.log(`Could not fill ${assignment.template_name || 'shift'} on day ${assignment.day_of_week}: ${reason}`);
          }
        }
      } else {
        console.log("No published schedule found for last week");
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
