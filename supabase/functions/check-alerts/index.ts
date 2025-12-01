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
    const now = new Date();
    const currentDay = now.getDay();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Get all active checklists with due times
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
      .not('due_by_time', 'is', null);

    if (checklistsError) throw checklistsError;
    if (!checklists || checklists.length === 0) return;

    // Filter to only checklists relevant for today and overdue
    const overdueChecklists = [];
    
    for (const checklist of checklists) {
      // Check if checklist is relevant for today
      const isRelevant = checklist.template_type === 'dynamic' 
        ? checklist.checklist_items?.some((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          )
        : checklist.frequency === 'daily';

      if (!isRelevant) continue;

      // Check if overdue
      const [hours, minutes] = checklist.due_by_time.split(':').map(Number);
      const dueTime = new Date(startOfToday);
      dueTime.setHours(hours, minutes, 0, 0);

      if (now < dueTime) continue; // Not due yet

      // Check if incomplete
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

      const completionRate = totalItems > 0 ? (totalResponses / totalItems) : 0;

      if (completionRate < 1) {
        overdueChecklists.push({
          id: checklist.id,
          title: checklist.title,
          completionRate: Math.round(completionRate * 100)
        });
      }
    }

    // Send notifications for overdue checklists
    if (overdueChecklists.length > 0) {
      console.log(`Found ${overdueChecklists.length} overdue checklists`);

      // Get all active managers and admins
      const { data: adminUsers } = await supabaseClient
        .from('user_roles')
        .select('user_id')
        .in('role', ['admin', 'manager']);

      if (adminUsers && adminUsers.length > 0) {
        for (const checklist of overdueChecklists) {
          await supabaseClient.functions.invoke('send-push-notification', {
            body: {
              user_ids: adminUsers.map((u: any) => u.user_id),
              title: 'Overdue Checklist',
              body: `${checklist.title} is ${checklist.completionRate === 0 ? 'not started' : `${checklist.completionRate}% complete`}`,
              notification_type: 'overdue_checklists',
              data: {
                checklist_id: checklist.id,
                type: 'overdue_checklist'
              }
            }
          });
        }
      }
    }
  } catch (error) {
    console.error('Error checking overdue checklists:', error);
  }
}

async function checkLateArrivals(supabaseClient: any) {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
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
      const [hours, minutes] = shift.start_time.split(':').map(Number);
      const shiftStart = new Date();
      shiftStart.setHours(hours, minutes, 0, 0);
      const lateThreshold = new Date(shiftStart.getTime() + 10 * 60000); // 10 minutes late

      // Check if shift should have started and if we're past the late threshold
      if (now < lateThreshold) continue;

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
        lateEmployees.push({
          user_id: shift.user_id,
          name: shift.profiles?.full_name || 'Unknown',
          minutes_late: Math.floor((now.getTime() - lateThreshold.getTime()) / 60000)
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

serve(handler);
