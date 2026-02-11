import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Fetch unsent triggers (max 50 per run, oldest first)
    const { data: queue, error: queueError } = await supabase
      .from('alarm_trigger_queue')
      .select(`
        id,
        task_id,
        location_id,
        interval_key,
        retry_count,
        temporary_tasks!alarm_trigger_queue_task_id_fkey (
          id, title, description, push_enabled, notify_only_working,
          temporary_task_assignments (user_id, role)
        )
      `)
      .eq('push_sent', false)
      .lt('retry_count', 3)
      .order('created_at', { ascending: true })
      .limit(50)

    if (queueError) {
      console.error('[alarm-push-sender] Queue fetch error:', queueError)
      throw queueError
    }

    if (!queue || queue.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No pending alarm pushes', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[alarm-push-sender] Processing ${queue.length} queued alarms`)

    let sentCount = 0
    let errorCount = 0

    for (const item of queue) {
      const task = item.temporary_tasks as any
      if (!task) {
        // Task was deleted, mark as sent to clear queue
        await supabase
          .from('alarm_trigger_queue')
          .update({ push_sent: true, push_sent_at: new Date().toISOString(), push_error: 'task_deleted' })
          .eq('id', item.id)
        continue
      }

      if (!task.push_enabled) {
        // Push disabled, mark as sent
        await supabase
          .from('alarm_trigger_queue')
          .update({ push_sent: true, push_sent_at: new Date().toISOString(), push_error: 'push_disabled' })
          .eq('id', item.id)
        continue
      }

      try {
        // Resolve users to notify
        const assignments = task.temporary_task_assignments || []
        let userIdsToNotify: string[] = []
        let rolesToNotify: string[] = []

        for (const assignment of assignments) {
          if (assignment.user_id) {
            userIdsToNotify.push(assignment.user_id)
          } else if (assignment.role) {
            rolesToNotify.push(assignment.role)
          }
        }

        if (task.notify_only_working) {
          // Only notify clocked-in users
          const { data: clockedInUsers } = await supabase
            .from('timeclock_entries')
            .select('user_id')
            .eq('location_id', item.location_id)
            .is('clock_out', null)

          const clockedInSet = new Set(clockedInUsers?.map((u: any) => u.user_id) || [])

          if (userIdsToNotify.length > 0) {
            userIdsToNotify = userIdsToNotify.filter(id => clockedInSet.has(id))
          }

          if (rolesToNotify.length > 0) {
            const { data: roleUsers } = await supabase
              .from('user_roles')
              .select('user_id')
              .in('role', rolesToNotify)

            const roleUserIds = roleUsers?.map((u: any) => u.user_id) || []
            const workingRoleUsers = roleUserIds.filter((id: string) => clockedInSet.has(id))
            userIdsToNotify = [...new Set([...userIdsToNotify, ...workingRoleUsers])]
          }
        } else {
          if (rolesToNotify.length > 0) {
            const { data: locationUsers } = await supabase
              .from('user_locations')
              .select('user_id')
              .eq('location_id', item.location_id)

            const locationUserIds = new Set(locationUsers?.map((u: any) => u.user_id) || [])

            const { data: roleUsers } = await supabase
              .from('user_roles')
              .select('user_id')
              .in('role', rolesToNotify)

            const roleUserIds = (roleUsers?.map((u: any) => u.user_id) || []).filter((id: string) => locationUserIds.has(id))
            userIdsToNotify = [...new Set([...userIdsToNotify, ...roleUserIds])]
          }
        }

        if (userIdsToNotify.length === 0) {
          await supabase
            .from('alarm_trigger_queue')
            .update({ push_sent: true, push_sent_at: new Date().toISOString(), push_error: 'no_users' })
            .eq('id', item.id)
          continue
        }

        // Send push notification
        console.log(`[alarm-push-sender] Sending push for task ${task.id} (${task.title}) to ${userIdsToNotify.length} users`)

        const pushResult = await supabase.functions.invoke('send-push-notification', {
          body: {
            user_ids: userIdsToNotify,
            title: '⏰ ' + task.title,
            body: task.description || 'Recurring task reminder',
            type: 'alarm_task',
            data: { task_id: task.id, interval_key: item.interval_key }
          }
        })

        if (pushResult.error) {
          throw new Error(pushResult.error.message || 'Push invoke failed')
        }

        // Mark as sent
        await supabase
          .from('alarm_trigger_queue')
          .update({ push_sent: true, push_sent_at: new Date().toISOString() })
          .eq('id', item.id)

        sentCount++
        console.log(`[alarm-push-sender] ✅ Push sent for task ${task.id}, interval ${item.interval_key}`)

      } catch (pushErr: any) {
        errorCount++
        console.error(`[alarm-push-sender] ❌ Push failed for task ${task.id}:`, pushErr)

        // Increment retry count and log error
        await supabase
          .from('alarm_trigger_queue')
          .update({
            retry_count: item.retry_count + 1,
            push_error: pushErr.message || 'Unknown error'
          })
          .eq('id', item.id)
      }
    }

    console.log(`[alarm-push-sender] Done: ${sentCount} sent, ${errorCount} errors`)

    return new Response(
      JSON.stringify({ message: `Processed ${queue.length} alarms`, sent: sentCount, errors: errorCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('[alarm-push-sender] Fatal error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
