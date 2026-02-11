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
    // Fetch unsent alerts (max 50 per run, oldest first)
    const { data: queue, error: queueError } = await supabase
      .from('alert_queue')
      .select('*')
      .eq('push_sent', false)
      .lt('retry_count', 3)
      .order('created_at', { ascending: true })
      .limit(50)

    if (queueError) {
      console.error('[alert-push-sender] Queue fetch error:', queueError)
      throw queueError
    }

    if (!queue || queue.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No pending alerts', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[alert-push-sender] Processing ${queue.length} queued alerts`)

    let sentCount = 0
    let errorCount = 0

    for (const item of queue) {
      try {
        const payload = item.payload as any

        if (item.alert_type === 'alarm') {
          // Alarm alerts need to resolve users dynamically (same as old alarm-push-sender)
          await handleAlarmAlert(supabase, item, payload)
        } else {
          // All other alerts have user_ids pre-resolved in payload
          const userIds = payload.user_ids || []
          if (userIds.length === 0) {
            await markSent(supabase, item.id, 'no_users')
            continue
          }

          const pushResult = await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: userIds,
              title: payload.title,
              body: payload.body,
              notification_type: payload.notification_type,
              type: payload.notification_type,
              data: payload.data || {}
            }
          })

          if (pushResult.error) {
            throw new Error(pushResult.error.message || 'Push invoke failed')
          }
        }

        await markSent(supabase, item.id)
        sentCount++
        console.log(`[alert-push-sender] ✅ ${item.alert_type}: ${item.dedup_key}`)

      } catch (pushErr: any) {
        errorCount++
        console.error(`[alert-push-sender] ❌ ${item.alert_type} failed:`, pushErr)

        await supabase
          .from('alert_queue')
          .update({
            retry_count: item.retry_count + 1,
            push_error: pushErr.message || 'Unknown error'
          })
          .eq('id', item.id)
      }
    }

    console.log(`[alert-push-sender] Done: ${sentCount} sent, ${errorCount} errors`)

    return new Response(
      JSON.stringify({ message: `Processed ${queue.length} alerts`, sent: sentCount, errors: errorCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('[alert-push-sender] Fatal error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ==================== ALARM ALERT HANDLER ====================
// Alarms need dynamic user resolution (clocked-in filtering, role expansion)

async function handleAlarmAlert(supabase: any, item: any, payload: any) {
  const taskId = payload.task_id
  const intervalKey = payload.interval_key

  // Fetch task with assignments
  const { data: task, error: taskError } = await supabase
    .from('temporary_tasks')
    .select(`
      id, title, description, push_enabled, notify_only_working, location_id,
      temporary_task_assignments (user_id, role)
    `)
    .eq('id', taskId)
    .maybeSingle()

  if (taskError) throw taskError

  if (!task) {
    await markSent(supabase, item.id, 'task_deleted')
    return
  }

  if (!task.push_enabled) {
    await markSent(supabase, item.id, 'push_disabled')
    return
  }

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
    await markSent(supabase, item.id, 'no_users')
    return
  }

  console.log(`[alert-push-sender] Sending alarm push for task ${task.id} (${task.title}) to ${userIdsToNotify.length} users`)

  const pushResult = await supabase.functions.invoke('send-push-notification', {
    body: {
      user_ids: userIdsToNotify,
      title: '⏰ ' + task.title,
      body: task.description || 'Recurring task reminder',
      type: 'alarm_task',
      data: { task_id: task.id, interval_key: intervalKey }
    }
  })

  if (pushResult.error) {
    throw new Error(pushResult.error.message || 'Push invoke failed')
  }
}

// ==================== HELPERS ====================

async function markSent(supabase: any, id: string, error?: string) {
  await supabase
    .from('alert_queue')
    .update({
      push_sent: true,
      push_sent_at: new Date().toISOString(),
      ...(error ? { push_error: error } : {})
    })
    .eq('id', id)
}
