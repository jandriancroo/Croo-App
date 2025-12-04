import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log('Starting alert checks...');

    // Get all locations with their settings
    const { data: locations, error: locationsError } = await supabaseClient
      .from('locations')
      .select(`
        id,
        name,
        location_settings(timezone)
      `);

    if (locationsError) throw locationsError;
    
    if (!locations || locations.length === 0) {
      console.log('No locations found');
      return new Response(
        JSON.stringify({ message: "No locations to check" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${locations.length} locations`);

    // Process each location separately
    for (const location of locations) {
      const timezone = location.location_settings?.[0]?.timezone || 'America/Los_Angeles';
      console.log(`\n=== Processing location: ${location.name} (${timezone}) ===`);

      // Check for overdue checklists at this location
      await checkOverdueChecklists(supabaseClient, timezone, location.id, location.name);

      // Check for monthly checklist reminders at this location
      await checkMonthlyChecklists(supabaseClient, timezone, location.id, location.name);

      // Check for late arrivals at this location
      await checkLateArrivals(supabaseClient, timezone, location.id, location.name);
    }

    // Certifications are user-based, not location-based
    await checkExpiringCertifications(supabaseClient);

    return new Response(
      JSON.stringify({ message: "Alert checks completed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in check-alerts:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

// Helper to get timezone-adjusted day boundaries in UTC
function getTimezoneDayBoundariesInUTC(timezone: string): { startOfDayUTC: Date; endOfDayUTC: Date; localNow: Date; currentDay: number } {
  const utcNow = new Date();
  
  // Get local time string in the specified timezone
  const localTimeStr = utcNow.toLocaleString('en-US', { timeZone: timezone });
  const localNow = new Date(localTimeStr);
  
  // Extract date components from local time
  const localYear = localNow.getFullYear();
  const localMonth = localNow.getMonth();
  const localDay = localNow.getDate();
  const currentDay = localNow.getDay(); // Day of week (0-6)
  
  // Create start of day (midnight) in local timezone, then convert to UTC
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Calculate the offset between UTC and local timezone
  const utcParts = formatter.formatToParts(utcNow);
  const localHour = parseInt(utcParts.find(p => p.type === 'hour')?.value || '0');
  const localMinute = parseInt(utcParts.find(p => p.type === 'minute')?.value || '0');
  
  // Get UTC hour/minute for comparison
  const utcHour = utcNow.getUTCHours();
  const utcMinute = utcNow.getUTCMinutes();
  
  // Calculate offset in milliseconds
  let offsetHours = localHour - utcHour;
  if (offsetHours > 12) offsetHours -= 24;
  if (offsetHours < -12) offsetHours += 24;
  const offsetMs = offsetHours * 60 * 60 * 1000 + (localMinute - utcMinute) * 60 * 1000;
  
  // Start of local day in UTC
  const startOfLocalDay = new Date(localYear, localMonth, localDay, 0, 0, 0, 0);
  const startOfDayUTC = new Date(startOfLocalDay.getTime() - offsetMs);
  
  // End of local day in UTC
  const endOfLocalDay = new Date(localYear, localMonth, localDay, 23, 59, 59, 999);
  const endOfDayUTC = new Date(endOfLocalDay.getTime() - offsetMs);
  
  console.log(`Timezone: ${timezone}, Local time: ${localNow.toLocaleTimeString()}`);
  
  return { startOfDayUTC, endOfDayUTC, localNow, currentDay };
}

// Get users at a specific location with admin/manager roles
// Only includes users explicitly assigned to the location via user_locations
// Super admins must assign themselves to specific locations to receive alerts
async function getLocationAdminsAndManagers(supabaseClient: any, locationId: string) {
  // Get users EXPLICITLY assigned to this location (not based on role access)
  const { data: locationUsers } = await supabaseClient
    .from('user_locations')
    .select('user_id')
    .eq('location_id', locationId);

  if (!locationUsers || locationUsers.length === 0) return [];

  const userIds = locationUsers.map((u: any) => u.user_id);

  // Filter to only admin/manager roles
  const { data: adminUsers } = await supabaseClient
    .from('user_roles')
    .select('user_id')
    .in('user_id', userIds)
    .in('role', ['super_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager']);

  return adminUsers || [];
}

async function checkOverdueChecklists(supabaseClient: any, timezone: string, locationId: string, locationName: string) {
  try {
    const { startOfDayUTC, endOfDayUTC, localNow, currentDay } = getTimezoneDayBoundariesInUTC(timezone);
    const currentHours = localNow.getHours();
    const currentMinutes = localNow.getMinutes();
    
    console.log(`[${locationName}] Checklist check - Local time: ${localNow.toLocaleString()}, Day: ${currentDay}`);

    // Only send overdue notifications within the first 10 minutes of each hour
    // This prevents spamming notifications every 5 minutes
    if (currentMinutes > 10) {
      console.log(`[${locationName}] Skipping overdue check - outside notification window (minute ${currentMinutes})`);
      return;
    }

    // Get active checklists for this location with due times
    const { data: checklists, error: checklistsError } = await supabaseClient
      .from('checklists')
      .select(`
        id,
        title,
        frequency,
        template_type,
        due_by_time,
        checklist_items(id, days_of_week)
      `)
      .eq('is_active', true)
      .eq('location_id', locationId)
      .not('due_by_time', 'is', null)
      .order('due_by_time', { ascending: true });

    if (checklistsError) throw checklistsError;
    if (!checklists || checklists.length === 0) {
      console.log(`[${locationName}] No checklists with due times`);
      return;
    }

    // Build list of relevant checklists for today
    const relevantChecklists = [];
    
    for (const checklist of checklists) {
      const isRelevant = checklist.template_type === 'dynamic' 
        ? checklist.checklist_items?.some((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          )
        : checklist.frequency === 'daily';

      if (!isRelevant) continue;

      const [dueHours, dueMinutes] = checklist.due_by_time.split(':').map(Number);
      const dueTotalMinutes = dueHours * 60 + dueMinutes;
      
      relevantChecklists.push({
        ...checklist,
        dueTotalMinutes
      });
    }

    relevantChecklists.sort((a, b) => a.dueTotalMinutes - b.dueTotalMinutes);
    
    const currentTotalMinutes = currentHours * 60 + currentMinutes;
    
    // Find the "active" overdue checklist
    let activeOverdueChecklist = null;
    
    for (let i = relevantChecklists.length - 1; i >= 0; i--) {
      const checklist = relevantChecklists[i];
      
      if (currentTotalMinutes >= checklist.dueTotalMinutes) {
        const { data: submissions } = await supabaseClient
          .from('checklist_submissions')
          .select(`
            id,
            checklist_id,
            checklist_responses(id, item_id)
          `)
          .eq('checklist_id', checklist.id)
          .eq('location_id', locationId)
          .gte('submitted_at', startOfDayUTC.toISOString())
          .lte('submitted_at', endOfDayUTC.toISOString());

        let totalItems = checklist.checklist_items?.length || 0;
        if (checklist.template_type === 'dynamic') {
          totalItems = checklist.checklist_items?.filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          ).length || 0;
        }

        const uniqueItemIds = new Set();
        submissions?.forEach((sub: any) => {
          sub.checklist_responses?.forEach((response: any) => {
            if (response.item_id) {
              uniqueItemIds.add(response.item_id);
            }
          });
        });
        const totalResponses = uniqueItemIds.size;
        const remainingTasks = totalItems - totalResponses;
        const completionRate = totalItems > 0 ? (totalResponses / totalItems) : 0;
        
        console.log(`[${locationName}] "${checklist.title}": ${totalResponses}/${totalItems} (${Math.round(completionRate * 100)}%)`);

        if (completionRate < 1) {
          activeOverdueChecklist = {
            id: checklist.id,
            title: checklist.title,
            completionRate: Math.round(completionRate * 100),
            remainingTasks,
            dueTime: checklist.due_by_time
          };
        }
        
        break;
      }
    }

    if (activeOverdueChecklist) {
      console.log(`[${locationName}] Active overdue: "${activeOverdueChecklist.title}" (due ${activeOverdueChecklist.dueTime})`);

      const adminUsers = await getLocationAdminsAndManagers(supabaseClient, locationId);

      if (adminUsers.length > 0) {
        const notificationBody = activeOverdueChecklist.completionRate === 0 
          ? `${activeOverdueChecklist.title} is not started` 
          : `${activeOverdueChecklist.title} not completed, ${activeOverdueChecklist.remainingTasks} task${activeOverdueChecklist.remainingTasks === 1 ? '' : 's'} remaining`;
        
        await supabaseClient.functions.invoke('send-push-notification', {
          body: {
            user_ids: adminUsers.map((u: any) => u.user_id),
            title: 'Overdue Checklist',
            body: notificationBody,
            notification_type: 'overdue_checklists',
            data: {
              checklist_id: activeOverdueChecklist.id,
              type: 'overdue_checklist'
            }
          }
        });
        console.log(`[${locationName}] Notification sent to ${adminUsers.length} users`);
      }
    } else {
      console.log(`[${locationName}] No active overdue checklists`);
    }
  } catch (error) {
    console.error(`[${locationName}] Error checking overdue checklists:`, error);
  }
}

async function checkMonthlyChecklists(supabaseClient: any, timezone: string, locationId: string, locationName: string) {
  try {
    const { startOfDayUTC, endOfDayUTC, localNow } = getTimezoneDayBoundariesInUTC(timezone);
    const currentHours = localNow.getHours();
    const currentMinutes = localNow.getMinutes();
    
    // Only send reminders at 9 AM
    if (currentHours !== 9 || currentMinutes > 15) {
      return;
    }

    const localYear = localNow.getFullYear();
    const localMonth = localNow.getMonth();
    const localDay = localNow.getDate();
    const lastDayOfMonth = new Date(localYear, localMonth + 1, 0);
    const daysUntilMonthEnd = lastDayOfMonth.getDate() - localDay;
    
    console.log(`[${locationName}] Monthly check - ${daysUntilMonthEnd} days until month end`);

    const { data: monthlyChecklists, error: checklistsError } = await supabaseClient
      .from('checklists')
      .select(`
        id,
        title,
        visible_days_before_month_end,
        checklist_items(id)
      `)
      .eq('is_active', true)
      .eq('frequency', 'monthly')
      .eq('location_id', locationId)
      .not('visible_days_before_month_end', 'is', null);

    if (checklistsError) throw checklistsError;
    if (!monthlyChecklists || monthlyChecklists.length === 0) return;

    const startOfMonth = new Date(localYear, localMonth, 1);
    const startOfMonthStr = startOfMonth.toISOString();

    // Get users at this location
    const { data: locationUsers } = await supabaseClient
      .from('user_locations')
      .select('user_id')
      .eq('location_id', locationId);

    if (!locationUsers || locationUsers.length === 0) return;

    for (const checklist of monthlyChecklists) {
      if (daysUntilMonthEnd >= checklist.visible_days_before_month_end) continue;

      const totalItems = checklist.checklist_items?.length || 0;
      if (totalItems === 0) continue;

      const { data: submissions } = await supabaseClient
        .from('checklist_submissions')
        .select(`
          id,
          checklist_responses(id, item_id)
        `)
        .eq('checklist_id', checklist.id)
        .eq('location_id', locationId)
        .gte('submitted_at', startOfMonthStr);

      const uniqueItemIds = new Set();
      submissions?.forEach((sub: any) => {
        sub.checklist_responses?.forEach((response: any) => {
          if (response.item_id) {
            uniqueItemIds.add(response.item_id);
          }
        });
      });
      const completedItems = uniqueItemIds.size;
      const remainingTasks = totalItems - completedItems;

      if (remainingTasks === 0) continue;

      console.log(`[${locationName}] Monthly "${checklist.title}": ${completedItems}/${totalItems}, ${daysUntilMonthEnd} days left`);

      let urgencyPrefix = '';
      if (daysUntilMonthEnd <= 1) {
        urgencyPrefix = '⚠️ FINAL DAY: ';
      } else if (daysUntilMonthEnd <= 3) {
        urgencyPrefix = '⚠️ ';
      }

      const daysText = daysUntilMonthEnd === 0 
        ? 'Due TODAY' 
        : daysUntilMonthEnd === 1 
          ? '1 day left' 
          : `${daysUntilMonthEnd} days left`;

      await supabaseClient.functions.invoke('send-push-notification', {
        body: {
          user_ids: locationUsers.map((u: any) => u.user_id),
          title: `${urgencyPrefix}Monthly Checklist Reminder`,
          body: `${checklist.title} - ${remainingTasks} task${remainingTasks === 1 ? '' : 's'} remaining (${daysText})`,
          notification_type: 'overdue_checklists',
          data: {
            checklist_id: checklist.id,
            type: 'monthly_checklist_reminder'
          }
        }
      });
    }
  } catch (error) {
    console.error(`[${locationName}] Error checking monthly checklists:`, error);
  }
}

async function checkLateArrivals(supabaseClient: any, timezone: string, locationId: string, locationName: string) {
  try {
    const { startOfDayUTC, endOfDayUTC, localNow, currentDay } = getTimezoneDayBoundariesInUTC(timezone);
    const currentHours = localNow.getHours();
    const currentMinutes = localNow.getMinutes();
    const currentTotalMinutes = currentHours * 60 + currentMinutes;
    
    const localYear = localNow.getFullYear();
    const localMonth = localNow.getMonth();
    const localDay = localNow.getDate();
    const today = `${localYear}-${String(localMonth + 1).padStart(2, '0')}-${String(localDay).padStart(2, '0')}`;
    
    // Get schedules for this location
    const { data: schedules } = await supabaseClient
      .from('schedules')
      .select('id')
      .eq('location_id', locationId)
      .lte('week_start_date', today)
      .gte('week_end_date', today);

    if (!schedules || schedules.length === 0) return;

    const scheduleIds = schedules.map((s: any) => s.id);

    // Get today's shifts for this location
    const { data: shifts, error: shiftsError } = await supabaseClient
      .from('scheduled_shifts')
      .select(`
        id,
        user_id,
        start_time,
        shift_date
      `)
      .in('schedule_id', scheduleIds)
      .eq('shift_date', today)
      .not('user_id', 'is', null);

    if (shiftsError) throw shiftsError;
    if (!shifts || shifts.length === 0) return;

    const userIds = [...new Set(shifts.map((s: any) => s.user_id))];
    const { data: profiles } = await supabaseClient
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);

    const profileMap = new Map(profiles?.map((p: any) => [p.id, p.full_name]) || []);

    const lateEmployees = [];

    for (const shift of shifts) {
      const [shiftHours, shiftMinutes] = shift.start_time.split(':').map(Number);
      const shiftStartMinutes = shiftHours * 60 + shiftMinutes;
      const minutesSinceShiftStart = currentTotalMinutes - shiftStartMinutes;
      
      if (minutesSinceShiftStart < 15 || minutesSinceShiftStart >= 20) continue;

      const { data: punches } = await supabaseClient
        .from('time_punches')
        .select('id, punch_time')
        .eq('user_id', shift.user_id)
        .eq('punch_type', 'in')
        .eq('location_id', locationId)
        .gte('punch_time', startOfDayUTC.toISOString())
        .lte('punch_time', endOfDayUTC.toISOString())
        .order('punch_time', { ascending: true })
        .limit(1);

      if (!punches || punches.length === 0) {
        lateEmployees.push({
          user_id: shift.user_id,
          name: profileMap.get(shift.user_id) || 'Unknown',
          shift_start: shift.start_time
        });
      }
    }

    if (lateEmployees.length > 0) {
      console.log(`[${locationName}] Found ${lateEmployees.length} late employees`);

      const adminUsers = await getLocationAdminsAndManagers(supabaseClient, locationId);

      if (adminUsers.length > 0) {
        for (const employee of lateEmployees) {
          await supabaseClient.functions.invoke('send-push-notification', {
            body: {
              user_ids: adminUsers.map((u: any) => u.user_id),
              title: '🚨 Late Arrival',
              body: `${employee.name} has not clocked in (shift started ${employee.shift_start})`,
              notification_type: 'late_arrivals',
              data: {
                user_id: employee.user_id,
                type: 'late_arrival'
              }
            }
          });
        }
      }
    }
  } catch (error) {
    console.error(`[${locationName}] Error checking late arrivals:`, error);
  }
}

async function checkExpiringCertifications(supabaseClient: any) {
  try {
    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const { data: expiringCerts, error: certsError } = await supabaseClient
      .from('certifications')
      .select(`
        id,
        user_id,
        certification_type,
        expiration_date
      `)
      .eq('status', 'approved')
      .gte('expiration_date', now.toISOString().split('T')[0])
      .lte('expiration_date', thirtyDaysFromNow.toISOString().split('T')[0]);

    if (certsError) throw certsError;
    if (!expiringCerts || expiringCerts.length === 0) {
      console.log('No expiring certifications found');
      return;
    }

    const userIds = [...new Set(expiringCerts.map((c: any) => c.user_id))];
    const { data: profiles } = await supabaseClient
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);

    const profileMap = new Map(profiles?.map((p: any) => [p.id, p.full_name]) || []);

    console.log(`Found ${expiringCerts.length} certifications expiring within 30 days`);

    for (const cert of expiringCerts) {
      const expirationDate = new Date(cert.expiration_date);
      const daysUntilExpiry = Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      const notifyDays = [30, 14, 7, 3, 1];
      if (!notifyDays.includes(daysUntilExpiry)) continue;

      let urgency = '';
      if (daysUntilExpiry <= 3) {
        urgency = '⚠️ URGENT: ';
      } else if (daysUntilExpiry <= 7) {
        urgency = '⚠️ ';
      }

      const formattedDate = expirationDate.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric'
      });

      // Notify the certificate owner
      await supabaseClient.functions.invoke('send-push-notification', {
        body: {
          user_ids: [cert.user_id],
          title: `${urgency}Certification Expiring`,
          body: `Your ${cert.certification_type} expires ${formattedDate} (${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'})`,
          notification_type: 'certification_expiring',
          data: {
            certification_id: cert.id,
            type: 'certification_expiring'
          }
        }
      });

      // Notify admins at the user's location(s)
      const { data: userLocations } = await supabaseClient
        .from('user_locations')
        .select('location_id')
        .eq('user_id', cert.user_id);

      if (userLocations && userLocations.length > 0) {
        for (const ul of userLocations) {
          const adminUsers = await getLocationAdminsAndManagers(supabaseClient, ul.location_id);
          
          if (adminUsers.length > 0) {
            await supabaseClient.functions.invoke('send-push-notification', {
              body: {
                user_ids: adminUsers.map((u: any) => u.user_id),
                title: `${urgency}Staff Certification Expiring`,
                body: `${profileMap.get(cert.user_id) || 'Employee'}'s ${cert.certification_type} expires ${formattedDate}`,
                notification_type: 'certification_expiring',
                data: {
                  certification_id: cert.id,
                  user_id: cert.user_id,
                  type: 'certification_expiring'
                }
              }
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking expiring certifications:', error);
  }
}

serve(handler);
