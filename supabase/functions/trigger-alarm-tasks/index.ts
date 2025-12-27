import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper to get current time in a specific timezone
function getTimeInTimezone(timezone: string): { dayOfWeek: number; timeStr: string; date: Date } {
  const now = new Date();
  
  // Get the time string in the target timezone
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  };
  
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(now);
  
  const hour = parts.find(p => p.type === 'hour')?.value || '00';
  const minute = parts.find(p => p.type === 'minute')?.value || '00';
  const weekday = parts.find(p => p.type === 'weekday')?.value || 'Sun';
  
  const dayMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
  };
  
  return {
    dayOfWeek: dayMap[weekday] ?? 0,
    timeStr: `${hour}:${minute}`,
    date: now,
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    console.log(`[Alarm Tasks] Running at ${now.toISOString()} (UTC)`);

    // Fetch all active alarm tasks with their location settings for timezone
    const { data: alarmTasks, error: tasksError } = await supabase
      .from('temporary_tasks')
      .select(`
        *,
        temporary_task_assignments (
          user_id,
          role
        ),
        locations!temporary_tasks_location_id_fkey (
          id,
          location_settings (
            timezone
          )
        )
      `)
      .eq('task_style', 'alarm')
      .eq('is_active', true)
      .eq('is_recurring', true);

    if (tasksError) {
      console.error('[Alarm Tasks] Error fetching tasks:', tasksError);
      throw tasksError;
    }

    console.log(`[Alarm Tasks] Found ${alarmTasks?.length || 0} alarm tasks`);

    if (!alarmTasks || alarmTasks.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No alarm tasks to process', triggered: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let triggeredCount = 0;
    const results: any[] = [];

    for (const task of alarmTasks) {
      // Get timezone for this task's location
      const locationSettings = (task.locations as any)?.location_settings;
      const timezone = locationSettings?.timezone || 'America/Los_Angeles';
      
      // Get current time in the location's timezone
      const { dayOfWeek: currentDayOfWeek, timeStr: currentTimeStr, date: nowInTz } = getTimeInTimezone(timezone);
      
      console.log(`[Alarm Tasks] Task ${task.id} (${task.title}): timezone=${timezone}, localDay=${currentDayOfWeek}, localTime=${currentTimeStr}`);

      // Check if task is active on current day (in local timezone)
      const daysOfWeek: number[] = task.days_of_week || [];
      if (!daysOfWeek.includes(currentDayOfWeek)) {
        console.log(`[Alarm Tasks] Task ${task.id} not active on day ${currentDayOfWeek}`);
        continue;
      }

      // Check if it's time to trigger this task
      let shouldTrigger = false;
      
      if (task.frequency_type === 'interval' && task.frequency_minutes) {
        // Check if enough time has passed since last trigger
        const lastTriggered = task.last_triggered_at ? new Date(task.last_triggered_at) : null;
        const minutesSinceLastTrigger = lastTriggered 
          ? Math.floor((now.getTime() - lastTriggered.getTime()) / (1000 * 60))
          : Infinity;
        
        shouldTrigger = minutesSinceLastTrigger >= task.frequency_minutes;
        console.log(`[Alarm Tasks] Task ${task.id}: interval=${task.frequency_minutes}min, sinceLastTrigger=${minutesSinceLastTrigger}min, shouldTrigger=${shouldTrigger}`);
      } else if (task.frequency_type === 'custom' && task.custom_times) {
        // Check if current time is within 2 minutes of any custom time (in local timezone)
        // This accounts for cron timing variations
        const customTimes: string[] = task.custom_times || [];
        const [currentHour, currentMinute] = currentTimeStr.split(':').map(Number);
        const currentTotalMinutes = currentHour * 60 + currentMinute;
        
        for (const customTime of customTimes) {
          const [targetHour, targetMinute] = customTime.split(':').map(Number);
          const targetTotalMinutes = targetHour * 60 + targetMinute;
          const diff = Math.abs(currentTotalMinutes - targetTotalMinutes);
          
          // Match if within 2 minutes of the target time
          if (diff <= 2 || diff >= 1438) { // 1438 = 24*60 - 2 for midnight wraparound
            shouldTrigger = true;
            break;
          }
        }
        console.log(`[Alarm Tasks] Task ${task.id}: customTimes=${customTimes.join(',')}, localTime=${currentTimeStr}, shouldTrigger=${shouldTrigger}`);
      }

      if (!shouldTrigger) {
        continue;
      }

      // Get the interval key for this trigger (to track completions)
      const intervalKey = `${now.toISOString().split('T')[0]}_${currentTimeStr.replace(':', '')}`;

      // Check if this interval was already completed
      const { data: existingCompletion } = await supabase
        .from('alarm_task_completions')
        .select('id')
        .eq('task_id', task.id)
        .eq('interval_key', intervalKey)
        .maybeSingle();

      if (existingCompletion) {
        console.log(`[Alarm Tasks] Task ${task.id} already completed for interval ${intervalKey}`);
        continue;
      }

      // Get users to notify
      const assignments = task.temporary_task_assignments || [];
      let userIdsToNotify: string[] = [];
      let rolesToNotify: string[] = [];

      for (const assignment of assignments) {
        if (assignment.user_id) {
          userIdsToNotify.push(assignment.user_id);
        } else if (assignment.role) {
          rolesToNotify.push(assignment.role);
        }
      }

      // If notify_only_working is enabled, filter to only clocked-in users
      if (task.notify_only_working) {
        // Get users who are currently clocked in or on break at this location
        const { data: clockedInUsers } = await supabase
          .from('timeclock_entries')
          .select('user_id')
          .eq('location_id', task.location_id)
          .is('clock_out', null);

        const clockedInUserIds = new Set(clockedInUsers?.map(u => u.user_id) || []);

        if (userIdsToNotify.length > 0) {
          // Filter assigned users to only those clocked in
          userIdsToNotify = userIdsToNotify.filter(id => clockedInUserIds.has(id));
        }

        if (rolesToNotify.length > 0) {
          // Get users with these roles who are clocked in at this location
          const { data: roleUsers } = await supabase
            .from('user_roles')
            .select('user_id')
            .in('role', rolesToNotify);

          const roleUserIds = roleUsers?.map(u => u.user_id) || [];
          
          // Only include role users who are clocked in
          const workingRoleUsers = roleUserIds.filter(id => clockedInUserIds.has(id));
          
          // Merge with any direct user assignments
          userIdsToNotify = [...new Set([...userIdsToNotify, ...workingRoleUsers])];
        }

        console.log(`[Alarm Tasks] Task ${task.id}: After filtering for working staff, ${userIdsToNotify.length} users to notify`);
      } else {
        // Not filtering by working status - include all assigned users and role users
        if (rolesToNotify.length > 0) {
          const { data: roleUsers } = await supabase
            .from('user_roles')
            .select('user_id')
            .in('role', rolesToNotify);

          const roleUserIds = roleUsers?.map(u => u.user_id) || [];
          userIdsToNotify = [...new Set([...userIdsToNotify, ...roleUserIds])];
        }
      }

      if (userIdsToNotify.length === 0) {
        console.log(`[Alarm Tasks] Task ${task.id}: No users to notify`);
        // Still trigger the task even if no one to notify - this updates last_triggered_at for punch clock
      }

      // Send push notification if enabled and there are users
      if (task.push_enabled && userIdsToNotify.length > 0) {
        console.log(`[Alarm Tasks] Sending push notification for task ${task.id} to ${userIdsToNotify.length} users`);
        
        try {
          const { error: pushError } = await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: userIdsToNotify,
              title: '⏰ ' + task.title,
              body: task.description || 'Recurring task reminder',
              type: 'alarm_task',
              data: {
                task_id: task.id,
                interval_key: intervalKey,
              }
            }
          });

          if (pushError) {
            console.error(`[Alarm Tasks] Error sending push notification:`, pushError);
          }
        } catch (pushErr) {
          console.error(`[Alarm Tasks] Exception sending push notification:`, pushErr);
        }
      }

      // Update last_triggered_at
      await supabase
        .from('temporary_tasks')
        .update({ last_triggered_at: now.toISOString() })
        .eq('id', task.id);

      triggeredCount++;
      results.push({
        task_id: task.id,
        title: task.title,
        users_notified: userIdsToNotify.length,
        interval_key: intervalKey,
        timezone,
        local_time: currentTimeStr,
      });
    }

    console.log(`[Alarm Tasks] Triggered ${triggeredCount} tasks`);

    return new Response(
      JSON.stringify({ 
        message: `Triggered ${triggeredCount} alarm tasks`,
        triggered: triggeredCount,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Alarm Tasks] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});