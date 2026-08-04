import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============= AUTO-SCHEDULE TYPES =============
interface DayAvailability {
  available: boolean;
  start?: string;
  end?: string;
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
  template_id?: string;
  template_name?: string;
  hourly_wage?: number;
}

interface UnfilledShift {
  dayOfWeek: number;
  templateName: string;
  startTime: string;
  endTime: string;
  reason: string;
}

// ============= OPTIMIZE-LABOR TYPES =============
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

// Role tiers for cutting priority
const ROLE_CUT_PRIORITY: Record<string, number> = {
  'team_member': 1,
  'shift_manager': 2,
  'shift_manager_in_training': 2,
  'manager': 3,
  'general_manager': 4,
  'admin': 5,
  'org_admin': 6,
  'fbc': 7,
  'brand_admin': 8,
  'super_admin': 9,
};

// ============= AUTO-SCHEDULE HELPERS =============
const calculateShiftHours = (startTime: string, endTime: string): number => {
  const startParts = startTime.split(":");
  const endParts = endTime.split(":");
  const startHour = parseInt(startParts[0]) + parseInt(startParts[1]) / 60;
  const endHour = parseInt(endParts[0]) + parseInt(endParts[1]) / 60;
  return endHour > startHour ? endHour - startHour : 24 - startHour + endHour;
};

const getDayName = (dayOfWeek: number): keyof WeeklyAvailability => {
  const days: (keyof WeeklyAvailability)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  return days[dayOfWeek];
};

const timeToMinutes = (time: string): number => {
  const parts = time.split(":");
  return parseInt(parts[0]) * 60 + parseInt(parts[1] || "0");
};

// ============= AUTO-SCHEDULE MAIN =============
async function handleAutoSchedule(req: Request, supabase: any) {
  const { location_id, schedule_id, week_start, source_type, template_id } = await req.json();

  console.log("Auto-schedule request:", { location_id, schedule_id, week_start, source_type, template_id });

  if (!location_id || !week_start) {
    throw new Error("Missing required parameters: location_id and week_start");
  }

  const weekStartDate = new Date(week_start + "T12:00:00Z");
  
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

  employeesWithRoles.forEach((emp: Employee) => {
    employeeHours[emp.id] = 0;
  });

  const isEmployeeAvailable = (employeeId: string, dayOfWeek: number, startTime: string, endTime: string): boolean => {
    const emp = employeesWithRoles.find((e: Employee) => e.id === employeeId);
    if (!emp) return false;

    if (emp.weekly_availability) {
      const dayName = getDayName(dayOfWeek);
      const dayPref = emp.weekly_availability[dayName];
      
      if (dayPref && !dayPref.available) {
        return false;
      }
      
      if (dayPref && dayPref.available) {
        const shiftStartMins = timeToMinutes(startTime);
        const shiftEndMins = timeToMinutes(endTime);
        
        if (dayPref.start) {
          const prefStartMins = timeToMinutes(dayPref.start);
          if (shiftStartMins < prefStartMins) {
            return false;
          }
        }
        
        if (dayPref.end) {
          const prefEndMins = timeToMinutes(dayPref.end);
          if (shiftEndMins > prefEndMins) {
            return false;
          }
        }
      }
    }

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
          if (shiftStartHour < blockEndHour && shiftEndHour > blockStartHour) {
            return false;
          }
        }
      }
    }
    return true;
  };

  const canTakeMoreHours = (employeeId: string, additionalHours: number): boolean => {
    const emp = employeesWithRoles.find((e: Employee) => e.id === employeeId);
    if (!emp) return false;
    
    const maxHours = emp.max_weekly_hours ?? 40;
    if (maxHours === 0) return false;
    
    return (employeeHours[employeeId] || 0) + additionalHours <= maxHours;
  };

  const isRoleCompatible = (employeeRole: string | null, allowedRoles: string[] | null): boolean => {
    if (!allowedRoles || allowedRoles.length === 0) return true;
    if (!employeeRole) return false;

    if (allowedRoles.includes(employeeRole)) return true;

    if (allowedRoles.includes('manager')) {
      if (['shift_manager', 'shift_manager_in_training', 'general_manager', 'admin', 'org_admin', 'super_admin'].includes(employeeRole)) {
        return true;
      }
    }

    if (allowedRoles.includes('team_member') && employeeRole === 'team_member') {
      return true;
    }

    return false;
  };

  const hasShiftOnDay = (employeeId: string, dayOfWeek: number): boolean => {
    return generatedShifts.some((s) => s.user_id === employeeId && s.day_of_week === dayOfWeek);
  };

  const getFillPercentage = (employeeId: string): number => {
    const emp = employeesWithRoles.find((e: Employee) => e.id === employeeId);
    if (!emp) return 100;
    const minHours = emp.min_weekly_hours ?? 0;
    if (minHours === 0) return 100;
    const currentHours = employeeHours[employeeId] || 0;
    return (currentHours / minHours) * 100;
  };

  const getDaysWorked = (employeeId: string): number => {
    const daysWithShifts = new Set(
      generatedShifts.filter(s => s.user_id === employeeId).map(s => s.day_of_week)
    );
    return daysWithShifts.size;
  };

  if (source_type === "template" && template_id) {
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

    const shuffleArray = <T>(array: T[]): T[] => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    const isManagerRole = (role: string | null): boolean => {
      return ['manager', 'shift_manager', 'shift_manager_in_training', 'general_manager', 'admin', 'org_admin', 'super_admin'].includes(role || '');
    };

    const hasMetMinHours = (employeeId: string): boolean => {
      const emp = employeesWithRoles.find((e: Employee) => e.id === employeeId);
      if (!emp) return true;
      const minHours = emp.min_weekly_hours ?? 0;
      if (minHours === 0) return true;
      return (employeeHours[employeeId] || 0) >= minHours;
    };

    for (const assignment of assignments) {
      const shiftDate = new Date(weekStartDate);
      shiftDate.setDate(shiftDate.getDate() + assignment.day_of_week);
      const shiftDateStr = shiftDate.toISOString().split("T")[0];

      const shiftHours = calculateShiftHours(assignment.start_time, assignment.end_time);
      let assigned = false;

      const eligibleEmployees = employeesWithRoles.filter((emp: Employee) => {
        if (!isRoleCompatible(emp.role, assignment.allowed_roles)) return false;
        if (!canTakeMoreHours(emp.id, shiftHours)) return false;
        if (!isEmployeeAvailable(emp.id, assignment.day_of_week, assignment.start_time, assignment.end_time)) return false;
        if (hasShiftOnDay(emp.id, assignment.day_of_week)) return false;
        return true;
      });

      if (eligibleEmployees.length > 0) {
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
          template_id: assignment.shift_template_id,
          template_name: assignment.template_name,
        });

        employeeHours[selectedEmp.id] = (employeeHours[selectedEmp.id] || 0) + shiftHours;
        assigned = true;
        console.log(`Assigned ${selectedEmp.full_name} to ${assignment.template_name} on day ${assignment.day_of_week} (fill: ${getFillPercentage(selectedEmp.id).toFixed(0)}%, days: ${getDaysWorked(selectedEmp.id)})`);
      }

      if (!assigned) {
        let reason = "No available employees";
        
        const roleMatchingEmps = employeesWithRoles.filter((emp: Employee) => 
          isRoleCompatible(emp.role, assignment.allowed_roles)
        );

        if (roleMatchingEmps.length === 0) {
          const rolesDisplay = assignment.allowed_roles?.join(', ') || assignment.role || 'required';
          reason = `No employees with required role(s): ${rolesDisplay}`;
        } else {
          const hoursFailedEmps = roleMatchingEmps.filter(emp => !canTakeMoreHours(emp.id, shiftHours));
          if (hoursFailedEmps.length === roleMatchingEmps.length) {
            reason = "All matching employees have reached max weekly hours";
          } else {
            const unavailableEmps = roleMatchingEmps.filter(emp => !isEmployeeAvailable(emp.id, assignment.day_of_week, assignment.start_time, assignment.end_time));
            if (unavailableEmps.length > 0) {
              reason = `Available employees have conflicts or approvals on this day`;
            }
          }
        }

        unfilledShifts.push({
          dayOfWeek: assignment.day_of_week,
          templateName: assignment.template_name,
          startTime: assignment.start_time,
          endTime: assignment.end_time,
          reason,
        });

        console.log(`Unable to fill: ${assignment.template_name} on day ${assignment.day_of_week} (${reason})`);
      }
    }
  }

  return new Response(
    JSON.stringify({
      shifts: generatedShifts,
      unfilled: unfilledShifts,
      employeeCount: employeesWithRoles.length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============= OPTIMIZE-LABOR MAIN =============
async function handleOptimizeLabor(req: Request, supabase: any) {
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

  const userIds = [...new Set((generated_shifts || []).map((s: GeneratedShift) => s.user_id))];
  
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, hourly_wage")
    .in("id", userIds);

  if (profileError) throw profileError;

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

  const isHigherRole = (newRole: string, currentRole: string): boolean => {
    return (ROLE_CUT_PRIORITY[newRole] || 1) > (ROLE_CUT_PRIORITY[currentRole] || 1);
  };

  (userRoles || []).forEach((r: any) => {
    const currentRole = roleMap.get(r.user_id);
    if (!currentRole || isHigherRole(r.role, currentRole)) {
      roleMap.set(r.user_id, r.role);
    }
  });

  const getRolePriority = (userId: string): number => {
    const role = roleMap.get(userId) || 'team_member';
    return ROLE_CUT_PRIORITY[role] || 1;
  };

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

  const closingTimes: Record<number, number> = {};
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

  const shiftsWithWages: GeneratedShift[] = (generated_shifts || []).map((s: GeneratedShift) => ({
    ...s,
    hourly_wage: wageMap.get(s.user_id) || 15,
  }));

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

  const getMinStaff = (day: number, hour: number): number => {
    const coverage = hourlyCoverage.find(c => c.day_of_week === day && c.hour === hour);
    return coverage?.min_staff || 0;
  };

  const canTrimEnd = (shifts: GeneratedShift[], shiftIndex: number, minutes: number): boolean => {
    const shift = shifts[shiftIndex];
    const [endHour, endMin] = shift.end_time.split(":").map(Number);

    let newEndMin = endMin - minutes;
    let newEndHour = endHour;
    while (newEndMin < 0) {
      newEndMin += 60;
      newEndHour -= 1;
    }

    if (newEndHour === endHour) return true;

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

  const isClosingShift = (shifts: GeneratedShift[], shiftIndex: number): boolean => {
    const shift = shifts[shiftIndex];
    const shiftEndHour = parseInt(shift.end_time.split(":")[0]);
    const shiftEndMin = parseInt(shift.end_time.split(":")[1]);
    const shiftEndTotal = shiftEndHour * 60 + shiftEndMin;

    const locationCloseTime = closingTimes[shift.day_of_week];
    if (locationCloseTime && shiftEndTotal >= locationCloseTime) {
      return true;
    }

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

  const TRIM_INCREMENTS = [15, 15, 15, 15];

  for (let day = 0; day < 7; day++) {
    const daySummary = laborSummary.find(d => d.dayOfWeek === day);
    if (!daySummary || !daySummary.overBudget || daySummary.amountOverBudget <= 0) continue;

    let remainingToTrim = daySummary.amountOverBudget;
    console.log(`\nDay ${day} (${daySummary.dayName}): Over budget by $${remainingToTrim.toFixed(2)}`);

    const dayShiftIndices = optimizedShifts
      .map((s, i) => s.day_of_week === day ? i : -1)
      .filter(i => i !== -1);

    const eligibleShiftIndices = dayShiftIndices.filter(i => !isClosingShift(optimizedShifts, i));

    console.log(`  Total shifts: ${dayShiftIndices.length}, Eligible (non-closing): ${eligibleShiftIndices.length}`);

    const shiftsByTier: Map<number, number[]> = new Map();
    eligibleShiftIndices.forEach(idx => {
      const priority = getRolePriority(optimizedShifts[idx].user_id);
      if (!shiftsByTier.has(priority)) {
        shiftsByTier.set(priority, []);
      }
      shiftsByTier.get(priority)!.push(idx);
    });

    const sortedTiers = [...shiftsByTier.keys()].sort((a, b) => a - b);
    console.log(`  Role tiers to process: ${sortedTiers.map(t => `tier ${t}`).join(', ')}`);

    const trimCountPerShift = new Map<number, number>();

    const tryTrimShift = (shiftIndex: number): boolean => {
      const shift = optimizedShifts[shiftIndex];
      const currentTrimCount = trimCountPerShift.get(shiftIndex) || 0;

      const currentHours = calculateShiftHours(shift.start_time, shift.end_time);
      if (currentHours <= 3) {
        return false;
      }

      if (!canTrimEnd(optimizedShifts, shiftIndex, 15)) {
        return false;
      }

      const [endHour, endMin] = shift.end_time.split(":").map(Number);
      let newEndMin = endMin - 15;
      let newEndHour = endHour;
      while (newEndMin < 0) {
        newEndMin += 60;
        newEndHour -= 1;
      }
      const newEndTime = `${String(newEndHour).padStart(2, '0')}:${String(newEndMin).padStart(2, '0')}:00`;

      const newHours = calculateShiftHours(shift.start_time, newEndTime);
      if (newHours < 3) {
        return false;
      }

      const wage = shift.hourly_wage || 15;
      const savings = wage * 0.25;
      const originalEnd = shiftTrimAccumulator.get(shiftIndex)?.original_end || shift.end_time;

      const existing = shiftTrimAccumulator.get(shiftIndex);
      if (existing) {
        existing.final_end = newEndTime;
        existing.totalMinutesTrimmed += 15;
        existing.totalLaborSaved += savings;
      } else {
        shiftTrimAccumulator.set(shiftIndex, {
          user_id: shift.user_id,
          userName: nameMap.get(shift.user_id) || 'Unknown',
          day_of_week: shift.day_of_week,
          original_start: shift.start_time,
          original_end: originalEnd,
          final_end: newEndTime,
          totalMinutesTrimmed: 15,
          totalLaborSaved: savings,
        });
      }

      optimizedShifts[shiftIndex] = { ...shift, end_time: newEndTime };
      trimCountPerShift.set(shiftIndex, currentTrimCount + 1);
      remainingToTrim -= savings;

      const role = roleMap.get(shift.user_id) || 'team_member';
      console.log(`    ✓ Trimmed 15min from ${nameMap.get(shift.user_id)} (${role}), saved $${savings.toFixed(2)}`);
      return true;
    };

    const runLayerForTier = (tier: number, targetLayer: number): void => {
      const tierShifts = shiftsByTier.get(tier) || [];
      tierShifts.sort((a, b) => 
        (optimizedShifts[b].hourly_wage || 15) - (optimizedShifts[a].hourly_wage || 15)
      );

      for (const shiftIndex of tierShifts) {
        if (remainingToTrim <= 0) break;
        const currentTrimCount = trimCountPerShift.get(shiftIndex) || 0;

        if (currentTrimCount === targetLayer) {
          tryTrimShift(shiftIndex);
        }
      }
    };

    for (let layer = 0; layer < TRIM_INCREMENTS.length; layer++) {
      if (remainingToTrim <= 0) break;
      console.log(`  Layer ${layer + 1}: Processing tier 1 (Team Member) at layer ${layer}`);
      runLayerForTier(1, layer);

      if (remainingToTrim > 0) {
        console.log(`  Layer ${layer + 1}: Processing tier 2 (Shift Manager) at layer ${layer}`);
        runLayerForTier(2, layer);
      }

      if (remainingToTrim > 0) {
        console.log(`  Layer ${layer + 1}: Processing tier 3+ (Managers) at layer ${layer}`);
        for (const tier of sortedTiers) {
          if (tier <= 2) continue;
          runLayerForTier(tier, layer);
          if (remainingToTrim <= 0) break;
        }
      }
    }
  }

  const optimizedLaborSummary = calculateLaborSummary(optimizedShifts);

  return new Response(
    JSON.stringify({
      optimized_shifts: optimizedShifts,
      labor_summary: optimizedLaborSummary,
      total_labor_cost: optimizedLaborSummary.reduce((sum, d) => sum + d.totalLaborCost, 0),
      total_projected_sales: optimizedLaborSummary.reduce((sum, d) => sum + d.projectedSales, 0),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============= MAIN ROUTER =============
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "auto-schedule";

    console.log(`[schedule-service] Action: ${action}`);

    if (action === "auto-schedule") {
      return await handleAutoSchedule(req, supabase);
    } else if (action === "optimize-labor") {
      return await handleOptimizeLabor(req, supabase);
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

  } catch (error: any) {
    console.error("[schedule-service] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
