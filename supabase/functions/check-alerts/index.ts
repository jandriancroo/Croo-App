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

    // Check for overdue checklists
    await checkOverdueChecklists(supabaseClient);

    // Check for late arrivals
    await checkLateArrivals(supabaseClient);

    // Check for expiring certifications
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

async function checkOverdueChecklists(supabaseClient: any) {
  try {
    // Get current time in Pacific timezone
    const pacificTime = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const now = new Date(pacificTime);
    const currentDay = now.getDay();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    
    console.log(`Pacific time: ${now.toLocaleString()}, Day: ${currentDay}, Time: ${currentHours}:${currentMinutes}`);
    
    // Only send notifications at the top of the hour (within first 10 minutes)
    // This creates hourly reminders instead of every 5 minutes
    if (currentMinutes > 10) {
      console.log('Skipping overdue checklist notifications - not at top of hour');
      return;
    }
    
    // Start of today in Pacific time
    const startOfToday = new Date(pacificTime);
    startOfToday.setHours(0, 0, 0, 0);

    // Get all active checklists with due times, ordered by due time
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
      .not('due_by_time', 'is', null)
      .order('due_by_time', { ascending: true });

    if (checklistsError) throw checklistsError;
    if (!checklists || checklists.length === 0) return;

    // Build list of all relevant checklists for today with their due times
    const relevantChecklists = [];
    
    for (const checklist of checklists) {
      // Check if checklist is relevant for today
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

    // Sort by due time
    relevantChecklists.sort((a, b) => a.dueTotalMinutes - b.dueTotalMinutes);
    
    const currentTotalMinutes = currentHours * 60 + currentMinutes;
    
    // Find the "active" overdue checklist - the most recently due one
    // that hasn't been superseded by a newer due checklist
    let activeOverdueChecklist = null;
    
    for (let i = relevantChecklists.length - 1; i >= 0; i--) {
      const checklist = relevantChecklists[i];
      
      // If this checklist is overdue (current time past due time)
      if (currentTotalMinutes >= checklist.dueTotalMinutes) {
        // This is the most recently due checklist - check if it's incomplete
        const endOfToday = new Date(startOfToday);
        endOfToday.setHours(23, 59, 59, 999);

        const { data: submissions } = await supabaseClient
          .from('checklist_submissions')
          .select(`
            id,
            checklist_id,
            checklist_responses(id, item_id)
          `)
          .eq('checklist_id', checklist.id)
          .gte('submitted_at', startOfToday.toISOString())
          .lte('submitted_at', endOfToday.toISOString());

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

        if (completionRate < 1) {
          activeOverdueChecklist = {
            id: checklist.id,
            title: checklist.title,
            completionRate: Math.round(completionRate * 100),
            remainingTasks,
            dueTime: checklist.due_by_time
          };
        }
        
        // Only consider the most recently due checklist
        // Previous checklists stop getting reminders once a new one becomes due
        break;
      }
    }

    // Send notification for the single active overdue checklist
    if (activeOverdueChecklist) {
      console.log(`Active overdue checklist: "${activeOverdueChecklist.title}" (due ${activeOverdueChecklist.dueTime})`);

      // Get all active managers and admins
      const { data: adminUsers } = await supabaseClient
        .from('user_roles')
        .select('user_id')
        .in('role', ['admin', 'manager']);

      if (adminUsers && adminUsers.length > 0) {
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
      }
    } else {
      console.log('No active overdue checklists found');
    }
  } catch (error) {
    console.error('Error checking overdue checklists:', error);
  }
}

async function checkLateArrivals(supabaseClient: any) {
  try {
    // Get current time in Pacific timezone
    const pacificTime = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const now = new Date(pacificTime);
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    
    // Get today's date in Pacific timezone (YYYY-MM-DD format)
    const today = now.toLocaleDateString('en-CA'); // en-CA gives YYYY-MM-DD format
    
    console.log(`Late arrivals check - Pacific time: ${now.toLocaleString()}, today: ${today}`);
    
    // Get today's shifts that should have started
    const { data: shifts, error: shiftsError } = await supabaseClient
      .from('scheduled_shifts')
      .select(`
        id,
        user_id,
        start_time,
        shift_date,
        profiles!scheduled_shifts_user_id_fkey(full_name)
      `)
      .eq('shift_date', today)
      .not('user_id', 'is', null);

    if (shiftsError) throw shiftsError;
    if (!shifts || shifts.length === 0) return;

    const lateEmployees = [];

    for (const shift of shifts) {
      const [shiftHours, shiftMinutes] = shift.start_time.split(':').map(Number);
      // Add 10 minute grace period
      const lateThresholdMinutes = (shiftHours * 60 + shiftMinutes) + 10;
      const currentTotalMinutes = currentHours * 60 + currentMinutes;

      // Check if shift should have started and if we're past the late threshold
      if (currentTotalMinutes < lateThresholdMinutes) continue;

      // Check if employee has punched in
      const { data: punches } = await supabaseClient
        .from('time_punches')
        .select('id, punch_time')
        .eq('user_id', shift.user_id)
        .eq('punch_type', 'in')
        .gte('punch_time', `${today}T00:00:00`)
        .lte('punch_time', `${today}T23:59:59`)
        .order('punch_time', { ascending: true })
        .limit(1);

      if (!punches || punches.length === 0) {
        const minutesLate = currentTotalMinutes - lateThresholdMinutes;
        lateEmployees.push({
          user_id: shift.user_id,
          name: shift.profiles?.full_name || 'Unknown',
          minutes_late: minutesLate
        });
      }
    }

    // Send notifications for late arrivals
    if (lateEmployees.length > 0) {
      console.log(`Found ${lateEmployees.length} late employees`);

      // Get all active managers and admins
      const { data: adminUsers } = await supabaseClient
        .from('user_roles')
        .select('user_id')
        .in('role', ['admin', 'manager']);

      if (adminUsers && adminUsers.length > 0) {
        for (const employee of lateEmployees) {
          await supabaseClient.functions.invoke('send-push-notification', {
            body: {
              user_ids: adminUsers.map((u: any) => u.user_id),
              title: 'Late Arrival',
              body: `${employee.name} is ${employee.minutes_late}+ minutes late`,
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
    console.error('Error checking late arrivals:', error);
  }
}

async function checkExpiringCertifications(supabaseClient: any) {
  try {
    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    const fourteenDaysFromNow = new Date();
    fourteenDaysFromNow.setDate(fourteenDaysFromNow.getDate() + 14);
    
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    // Get certifications expiring in the next 30 days
    const { data: expiringCerts, error: certsError } = await supabaseClient
      .from('certifications')
      .select(`
        id,
        user_id,
        certification_type,
        expiration_date,
        profiles!certifications_user_id_fkey(full_name)
      `)
      .eq('status', 'approved')
      .gte('expiration_date', now.toISOString().split('T')[0])
      .lte('expiration_date', thirtyDaysFromNow.toISOString().split('T')[0]);

    if (certsError) throw certsError;
    if (!expiringCerts || expiringCerts.length === 0) {
      console.log('No expiring certifications found');
      return;
    }

    console.log(`Found ${expiringCerts.length} certifications expiring within 30 days`);

    // Group by urgency and notify
    for (const cert of expiringCerts) {
      const expirationDate = new Date(cert.expiration_date);
      const daysUntilExpiry = Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      // Only notify at specific intervals: 30, 14, 7, 3, 1 days
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

      // Notify the user whose certification is expiring
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

      // Also notify admins
      const { data: adminUsers } = await supabaseClient
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin');

      if (adminUsers && adminUsers.length > 0) {
        await supabaseClient.functions.invoke('send-push-notification', {
          body: {
            user_ids: adminUsers.map((u: any) => u.user_id),
            title: `${urgency}Staff Certification Expiring`,
            body: `${cert.profiles?.full_name}'s ${cert.certification_type} expires ${formattedDate}`,
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
  } catch (error) {
    console.error('Error checking expiring certifications:', error);
  }
}

serve(handler);