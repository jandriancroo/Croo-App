import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'check-alerts'

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    switch (action) {
      case 'check-alerts':
        return await handleCheckAlerts(req, supabase)
      case 'trigger-alarm-tasks':
        return await handleTriggerAlarmTasks(supabase)
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
  } catch (error: any) {
    console.error(`[alert-service] Error (action=${action}):`, error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ==================== CHECK ALERTS ====================

async function handleCheckAlerts(req: Request, supabase: any): Promise<Response> {
  // Validate cron secret for scheduled calls
  const cronSecret = req.headers.get('x-cron-secret')
  const expectedSecret = Deno.env.get('CRON_SECRET')
  const authHeader = req.headers.get('authorization')
  
  const hasValidCronSecret = expectedSecret && cronSecret === expectedSecret
  const hasServiceRole = authHeader?.includes('service_role')
  
  if (!hasValidCronSecret && !hasServiceRole) {
    const isInternalCall = req.headers.get('x-supabase-internal') === 'true'
    if (!isInternalCall) {
      console.error('Unauthorized: Invalid or missing CRON_SECRET')
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }
  
  console.log('[check-alerts] Starting alert checks...')

  const { data: locations, error: locationsError } = await supabase
    .from('locations')
    .select(`id, name, location_settings(timezone)`)

  if (locationsError) throw locationsError
  
  if (!locations || locations.length === 0) {
    return new Response(
      JSON.stringify({ message: 'No locations to check' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log(`[check-alerts] Processing ${locations.length} locations`)

  for (const location of locations) {
    const timezone = location.location_settings?.[0]?.timezone || 'America/Los_Angeles'
    console.log(`\n=== Processing location: ${location.name} (${timezone}) ===`)

    await checkOverdueChecklists(supabase, timezone, location.id, location.name)
    await checkMonthlyChecklists(supabase, timezone, location.id, location.name)
    await checkLateArrivals(supabase, timezone, location.id, location.name)
    await checkClockInChecklistReminders(supabase, timezone, location.id, location.name)
  }

  await checkExpiringCertifications(supabase)

  return new Response(
    JSON.stringify({ message: 'Alert checks completed' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ==================== TRIGGER ALARM TASKS ====================

async function handleTriggerAlarmTasks(supabase: any): Promise<Response> {
  const now = new Date()
  console.log(`[trigger-alarm-tasks] Running at ${now.toISOString()} (UTC)`)

  const { data: alarmTasks, error: tasksError } = await supabase
    .from('temporary_tasks')
    .select(`
      *,
      temporary_task_assignments (user_id, role),
      locations!temporary_tasks_location_id_fkey (
        id,
        location_settings (timezone)
      )
    `)
    .eq('task_style', 'alarm')
    .eq('is_active', true)
    .eq('is_recurring', true)

  if (tasksError) {
    console.error('[trigger-alarm-tasks] Error fetching tasks:', tasksError)
    throw tasksError
  }

  console.log(`[trigger-alarm-tasks] Found ${alarmTasks?.length || 0} alarm tasks`)

  if (!alarmTasks || alarmTasks.length === 0) {
    return new Response(
      JSON.stringify({ message: 'No alarm tasks to process', triggered: 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let triggeredCount = 0
  const results: any[] = []

  for (const task of alarmTasks) {
    const locationSettings = (task.locations as any)?.location_settings
    const timezone = locationSettings?.timezone || 'America/Los_Angeles'
    
    const { dayOfWeek, timeStr, dateStr } = getTimeInTimezone(timezone)

    console.log(
      `[trigger-alarm-tasks] Task ${task.id} (${task.title}): timezone=${timezone}, localDay=${dayOfWeek}, localDate=${dateStr}, localTime=${timeStr}`
    )

    const daysOfWeek: number[] = task.days_of_week || []
    if (!daysOfWeek.includes(dayOfWeek)) {
      console.log(`[trigger-alarm-tasks] Task ${task.id} not active on day ${dayOfWeek}`)
      continue
    }

    const alarmStartTime = task.alarm_start_time?.slice(0, 5) || '09:00'
    const alarmEndTime = task.alarm_end_time?.slice(0, 5) || '21:00'
    
    const parseTimeToMinutes = (t: string): number => {
      const [h, m] = t.split(':').map(Number)
      return h * 60 + m
    }
    
    const currentMinutes = parseTimeToMinutes(timeStr)
    const startMinutes = parseTimeToMinutes(alarmStartTime)
    const endMinutes = parseTimeToMinutes(alarmEndTime)
    
    let isWithinTimeWindow: boolean
    if (startMinutes <= endMinutes) {
      isWithinTimeWindow = currentMinutes >= startMinutes && currentMinutes <= endMinutes
    } else {
      isWithinTimeWindow = currentMinutes >= startMinutes || currentMinutes <= endMinutes
    }
    
    if (!isWithinTimeWindow) {
      console.log(`[trigger-alarm-tasks] Task ${task.id} outside active hours (${alarmStartTime}-${alarmEndTime}), current: ${timeStr}`)
      continue
    }

    let shouldTrigger = false
    let matchedTimeStr: string | null = null

    if (task.frequency_type === 'interval' && task.frequency_minutes) {
      const [currentHour, currentMinute] = timeStr.split(':').map(Number)
      const intervalMinutes = task.frequency_minutes
      const currentMinuteOfDay = currentHour * 60 + currentMinute
      
      const lastBoundaryMinuteOfDay = Math.floor(currentMinuteOfDay / intervalMinutes) * intervalMinutes
      const nextBoundaryMinuteOfDay = lastBoundaryMinuteOfDay + intervalMinutes
      
      const TOLERANCE_MINUTES = 1
      const distanceToLast = currentMinuteOfDay - lastBoundaryMinuteOfDay
      const distanceToNext = nextBoundaryMinuteOfDay - currentMinuteOfDay
      
      const isAtLastBoundary = distanceToLast <= TOLERANCE_MINUTES
      const isAtNextBoundary = distanceToNext <= TOLERANCE_MINUTES
      
      let boundaryMinuteOfDay: number | null = null
      if (isAtLastBoundary) {
        boundaryMinuteOfDay = lastBoundaryMinuteOfDay
      } else if (isAtNextBoundary) {
        boundaryMinuteOfDay = nextBoundaryMinuteOfDay
      }

      if (boundaryMinuteOfDay !== null) {
        const alignedHour = Math.floor(boundaryMinuteOfDay / 60) % 24
        const alignedMinute = boundaryMinuteOfDay % 60
        matchedTimeStr = `${alignedHour.toString().padStart(2, '0')}:${alignedMinute.toString().padStart(2, '0')}`
        
        if (task.last_triggered_at) {
          const lastTriggered = new Date(task.last_triggered_at)
          const msSinceLastTrigger = now.getTime() - lastTriggered.getTime()
          const minutesSinceLastTrigger = msSinceLastTrigger / (1000 * 60)
          const minGapMinutes = intervalMinutes - 2
          
          if (minutesSinceLastTrigger < minGapMinutes) {
            console.log(
              `[trigger-alarm-tasks] Task ${task.id}: Skipping - only ${minutesSinceLastTrigger.toFixed(1)}min since last trigger`
            )
            continue
          }
        }
        
        shouldTrigger = true
      }
    } else if (task.frequency_type === 'custom' && task.custom_times) {
      const customTimes: string[] = task.custom_times || []
      for (const customTime of customTimes) {
        if (customTime === timeStr) {
          shouldTrigger = true
          matchedTimeStr = customTime
          break
        }
      }
    }

    if (!shouldTrigger || !matchedTimeStr) continue

    const intervalKey = `${dateStr}_${matchedTimeStr.replace(':', '')}`

    const { data: existingCompletion } = await supabase
      .from('alarm_task_completions')
      .select('id')
      .eq('task_id', task.id)
      .eq('interval_key', intervalKey)
      .maybeSingle()

    if (existingCompletion) {
      console.log(`[trigger-alarm-tasks] Task ${task.id} already completed for interval ${intervalKey}`)
      continue
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
        .eq('location_id', task.location_id)
        .is('clock_out', null)

      const clockedInUserIds = new Set(clockedInUsers?.map((u: any) => u.user_id) || [])

      if (userIdsToNotify.length > 0) {
        userIdsToNotify = userIdsToNotify.filter(id => clockedInUserIds.has(id))
      }

      if (rolesToNotify.length > 0) {
        const { data: roleUsers } = await supabase
          .from('user_roles')
          .select('user_id')
          .in('role', rolesToNotify)

        const roleUserIds = roleUsers?.map((u: any) => u.user_id) || []
        const workingRoleUsers = roleUserIds.filter((id: string) => clockedInUserIds.has(id))
        userIdsToNotify = [...new Set([...userIdsToNotify, ...workingRoleUsers])]
      }
    } else {
      if (rolesToNotify.length > 0) {
        const { data: locationUsers } = await supabase
          .from('user_locations')
          .select('user_id')
          .eq('location_id', task.location_id)
        
        const locationUserIds = new Set(locationUsers?.map((u: any) => u.user_id) || [])
        
        const { data: roleUsers } = await supabase
          .from('user_roles')
          .select('user_id')
          .in('role', rolesToNotify)

        const roleUserIds = (roleUsers?.map((u: any) => u.user_id) || []).filter((id: string) => locationUserIds.has(id))
        userIdsToNotify = [...new Set([...userIdsToNotify, ...roleUserIds])]
      }
    }

    if (task.push_enabled && userIdsToNotify.length > 0) {
      console.log(`[trigger-alarm-tasks] Sending push for task ${task.id} to ${userIdsToNotify.length} users`)
      
      try {
        await supabase.functions.invoke('send-push-notification', {
          body: {
            user_ids: userIdsToNotify,
            title: '⏰ ' + task.title,
            body: task.description || 'Recurring task reminder',
            type: 'alarm_task',
            data: { task_id: task.id, interval_key: intervalKey }
          }
        })
      } catch (pushErr) {
        console.error(`[trigger-alarm-tasks] Push notification error:`, pushErr)
      }
    }

    await supabase
      .from('temporary_tasks')
      .update({ last_triggered_at: now.toISOString() })
      .eq('id', task.id)

    triggeredCount++
    results.push({
      task_id: task.id,
      title: task.title,
      users_notified: userIdsToNotify.length,
      interval_key: intervalKey,
      timezone,
      local_time: timeStr,
    })
  }

  console.log(`[trigger-alarm-tasks] Triggered ${triggeredCount} tasks`)

  return new Response(
    JSON.stringify({ message: `Triggered ${triggeredCount} alarm tasks`, triggered: triggeredCount, results }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ==================== HELPER FUNCTIONS ====================

function getTimeInTimezone(timezone: string): { dayOfWeek: number; timeStr: string; dateStr: string } {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(now)
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'

  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

  return {
    dayOfWeek: dayMap[weekday] ?? 0,
    timeStr: `${hour}:${minute}`,
    dateStr: `${year}-${month}-${day}`,
  }
}

function getTimezoneDayBoundariesInUTC(timezone: string): { startOfDayUTC: Date; endOfDayUTC: Date; localNow: Date; currentDay: number } {
  const utcNow = new Date()
  const localTimeStr = utcNow.toLocaleString('en-US', { timeZone: timezone })
  const localNow = new Date(localTimeStr)
  
  const localYear = localNow.getFullYear()
  const localMonth = localNow.getMonth()
  const localDay = localNow.getDate()
  const currentDay = localNow.getDay()
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  })
  
  const utcParts = formatter.formatToParts(utcNow)
  const localHour = parseInt(utcParts.find(p => p.type === 'hour')?.value || '0')
  const localMinute = parseInt(utcParts.find(p => p.type === 'minute')?.value || '0')
  
  const utcHour = utcNow.getUTCHours()
  const utcMinute = utcNow.getUTCMinutes()
  
  let offsetHours = localHour - utcHour
  if (offsetHours > 12) offsetHours -= 24
  if (offsetHours < -12) offsetHours += 24
  const offsetMs = offsetHours * 60 * 60 * 1000 + (localMinute - utcMinute) * 60 * 1000
  
  const startOfLocalDay = new Date(localYear, localMonth, localDay, 0, 0, 0, 0)
  const startOfDayUTC = new Date(startOfLocalDay.getTime() - offsetMs)
  
  const endOfLocalDay = new Date(localYear, localMonth, localDay, 23, 59, 59, 999)
  const endOfDayUTC = new Date(endOfLocalDay.getTime() - offsetMs)
  
  return { startOfDayUTC, endOfDayUTC, localNow, currentDay }
}

function formatTime12Hour(time24: string): string {
  if (!time24) return '--:--'
  const [hours, minutes] = time24.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const hours12 = hours % 12 || 12
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`
}

async function getLocationAdminsAndManagers(supabase: any, locationId: string, notificationType: string) {
  const { data: locationUsers } = await supabase
    .from('user_locations')
    .select('user_id')
    .eq('location_id', locationId)

  if (!locationUsers || locationUsers.length === 0) return []

  const userIds = locationUsers.map((u: any) => u.user_id)

  const { data: adminUsers } = await supabase
    .from('user_roles')
    .select('user_id')
    .in('user_id', userIds)
    .in('role', ['super_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager'])

  if (!adminUsers || adminUsers.length === 0) return []

  const adminUserIds = adminUsers.map((u: any) => u.user_id)
  const { data: disabledPrefs } = await supabase
    .from('user_notification_settings')
    .select('user_id')
    .eq('location_id', locationId)
    .eq('notification_type', notificationType)
    .eq('push_enabled', false)
    .in('user_id', adminUserIds)

  const disabledUserIds = new Set(disabledPrefs?.map((p: any) => p.user_id) || [])
  return adminUsers.filter((u: any) => !disabledUserIds.has(u.user_id))
}

// ==================== CHECK ALERTS FUNCTIONS ====================

async function checkOverdueChecklists(supabase: any, timezone: string, locationId: string, locationName: string) {
  try {
    const { startOfDayUTC, endOfDayUTC, localNow, currentDay } = getTimezoneDayBoundariesInUTC(timezone)
    const currentHours = localNow.getHours()
    const currentMinutes = localNow.getMinutes()
    
    const { data: checklists, error: checklistsError } = await supabase
      .from('checklists')
      .select(`id, title, frequency, template_type, due_by_time, checklist_items(id, days_of_week)`)
      .eq('is_active', true)
      .eq('location_id', locationId)
      .not('due_by_time', 'is', null)
      .order('due_by_time', { ascending: true })

    if (checklistsError) throw checklistsError
    if (!checklists || checklists.length === 0) return

    const relevantChecklists = []
    
    for (const checklist of checklists) {
      const isRelevant = checklist.template_type === 'dynamic' 
        ? checklist.checklist_items?.some((item: any) => item.days_of_week?.includes(currentDay))
        : checklist.frequency === 'daily'

      if (!isRelevant) continue

      const [dueHours, dueMinutes] = checklist.due_by_time.split(':').map(Number)
      relevantChecklists.push({ ...checklist, dueTotalMinutes: dueHours * 60 + dueMinutes })
    }

    relevantChecklists.sort((a, b) => a.dueTotalMinutes - b.dueTotalMinutes)
    const currentTotalMinutes = currentHours * 60 + currentMinutes
    
    const overdueChecklists = []
    
    for (const checklist of relevantChecklists) {
      if (currentTotalMinutes < checklist.dueTotalMinutes) continue
      
      const { data: submissions } = await supabase
        .from('checklist_submissions')
        .select(`id, checklist_id, checklist_responses(id, item_id)`)
        .eq('checklist_id', checklist.id)
        .eq('location_id', locationId)
        .gte('submitted_at', startOfDayUTC.toISOString())
        .lte('submitted_at', endOfDayUTC.toISOString())

      let totalItems = checklist.checklist_items?.length || 0
      if (checklist.template_type === 'dynamic') {
        totalItems = checklist.checklist_items?.filter((item: any) => item.days_of_week?.includes(currentDay)).length || 0
      }

      const uniqueItemIds = new Set()
      submissions?.forEach((sub: any) => {
        sub.checklist_responses?.forEach((response: any) => {
          if (response.item_id) uniqueItemIds.add(response.item_id)
        })
      })
      
      const completionRate = totalItems > 0 ? (uniqueItemIds.size / totalItems) : 0

      if (completionRate < 1) {
        overdueChecklists.push({
          id: checklist.id,
          title: checklist.title,
          completionRate: Math.round(completionRate * 100),
          remainingTasks: totalItems - uniqueItemIds.size,
          dueTime: checklist.due_by_time
        })
      }
    }

    for (const activeOverdueChecklist of overdueChecklists) {
      const recentWindowAgo = new Date(Date.now() - 59 * 60 * 1000).toISOString()
      const { data: recentNotification } = await supabase
        .from('checklist_notification_logs')
        .select('id')
        .eq('checklist_id', activeOverdueChecklist.id)
        .eq('location_id', locationId)
        .eq('notification_type', 'overdue_hourly')
        .gte('sent_at', recentWindowAgo)
        .limit(1)

      if (recentNotification && recentNotification.length > 0) continue

      const adminUsers = await getLocationAdminsAndManagers(supabase, locationId, 'overdue_checklists')

      if (adminUsers.length > 0) {
        const notificationBody = activeOverdueChecklist.completionRate === 0 
          ? `${activeOverdueChecklist.title} is not started` 
          : `${activeOverdueChecklist.title} not completed, ${activeOverdueChecklist.remainingTasks} task${activeOverdueChecklist.remainingTasks === 1 ? '' : 's'} remaining`
        
        const pushResult = await supabase.functions.invoke('send-push-notification', {
          body: {
            user_ids: adminUsers.map((u: any) => u.user_id),
            title: `Overdue Checklist - ${locationName}`,
            body: notificationBody,
            notification_type: 'overdue_checklists',
            data: { checklist_id: activeOverdueChecklist.id, type: 'overdue_checklist', location_id: locationId }
          }
        })

        const successful = Number((pushResult as any)?.data?.successful ?? NaN)
        if (!Number.isNaN(successful) && successful === 0) continue

        await supabase.from('checklist_notification_logs').insert({
          checklist_id: activeOverdueChecklist.id,
          location_id: locationId,
          notification_type: 'overdue_hourly'
        })
      }
    }
  } catch (error) {
    console.error(`[${locationName}] Error checking overdue checklists:`, error)
  }
}

async function checkMonthlyChecklists(supabase: any, timezone: string, locationId: string, locationName: string) {
  try {
    const { localNow } = getTimezoneDayBoundariesInUTC(timezone)
    const currentHours = localNow.getHours()
    const currentMinutes = localNow.getMinutes()
    
    if (currentHours !== 9 || currentMinutes > 15) return

    const localYear = localNow.getFullYear()
    const localMonth = localNow.getMonth()
    const localDay = localNow.getDate()
    const lastDayOfMonth = new Date(localYear, localMonth + 1, 0)
    const daysUntilMonthEnd = lastDayOfMonth.getDate() - localDay
    
    const { data: monthlyChecklists, error: checklistsError } = await supabase
      .from('checklists')
      .select(`id, title, visible_days_before_month_end, checklist_items(id)`)
      .eq('is_active', true)
      .eq('frequency', 'monthly')
      .eq('location_id', locationId)
      .not('visible_days_before_month_end', 'is', null)

    if (checklistsError) throw checklistsError
    if (!monthlyChecklists || monthlyChecklists.length === 0) return

    const startOfMonth = new Date(localYear, localMonth, 1)
    const startOfMonthStr = startOfMonth.toISOString()

    const { data: locationUsers } = await supabase
      .from('user_locations')
      .select('user_id')
      .eq('location_id', locationId)

    if (!locationUsers || locationUsers.length === 0) return

    for (const checklist of monthlyChecklists) {
      if (daysUntilMonthEnd >= checklist.visible_days_before_month_end) continue

      const totalItems = checklist.checklist_items?.length || 0
      if (totalItems === 0) continue

      const { data: submissions } = await supabase
        .from('checklist_submissions')
        .select(`id, checklist_responses(id, item_id)`)
        .eq('checklist_id', checklist.id)
        .eq('location_id', locationId)
        .gte('submitted_at', startOfMonthStr)

      const uniqueItemIds = new Set()
      submissions?.forEach((sub: any) => {
        sub.checklist_responses?.forEach((response: any) => {
          if (response.item_id) uniqueItemIds.add(response.item_id)
        })
      })
      
      const remainingTasks = totalItems - uniqueItemIds.size
      if (remainingTasks === 0) continue

      let urgencyText = ''
      if (daysUntilMonthEnd <= 1) urgencyText = 'FINAL DAY: '
      else if (daysUntilMonthEnd <= 3) urgencyText = 'URGENT: '

      const daysText = daysUntilMonthEnd === 0 ? 'Due TODAY' : daysUntilMonthEnd === 1 ? '1 day left' : `${daysUntilMonthEnd} days left`

      await supabase.functions.invoke('send-push-notification', {
        body: {
          user_ids: locationUsers.map((u: any) => u.user_id),
          title: `${urgencyText}Monthly Checklist - ${locationName}`,
          body: `${checklist.title} - ${remainingTasks} task${remainingTasks === 1 ? '' : 's'} remaining (${daysText})`,
          notification_type: 'overdue_checklists',
          data: { checklist_id: checklist.id, type: 'monthly_checklist_reminder', location_id: locationId }
        }
      })
    }
  } catch (error) {
    console.error(`[${locationName}] Error checking monthly checklists:`, error)
  }
}

async function checkLateArrivals(supabase: any, timezone: string, locationId: string, locationName: string) {
  try {
    const { startOfDayUTC, endOfDayUTC, localNow } = getTimezoneDayBoundariesInUTC(timezone)
    const currentHours = localNow.getHours()
    const currentMinutes = localNow.getMinutes()
    const currentTotalMinutes = currentHours * 60 + currentMinutes
    
    const localYear = localNow.getFullYear()
    const localMonth = localNow.getMonth()
    const localDay = localNow.getDate()
    const today = `${localYear}-${String(localMonth + 1).padStart(2, '0')}-${String(localDay).padStart(2, '0')}`
    
    const { data: schedules } = await supabase
      .from('schedules')
      .select('id')
      .eq('location_id', locationId)
      .lte('week_start_date', today)
      .gte('week_end_date', today)

    if (!schedules || schedules.length === 0) return

    const scheduleIds = schedules.map((s: any) => s.id)

    const { data: shifts, error: shiftsError } = await supabase
      .from('scheduled_shifts')
      .select(`id, user_id, start_time, shift_date`)
      .in('schedule_id', scheduleIds)
      .eq('shift_date', today)
      .not('user_id', 'is', null)

    if (shiftsError) throw shiftsError
    if (!shifts || shifts.length === 0) return

    const userIds = [...new Set(shifts.map((s: any) => s.user_id))]
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds)

    const profileMap = new Map(profiles?.map((p: any) => [p.id, p.full_name]) || [])
    const lateEmployees = []

    for (const shift of shifts) {
      const [shiftHours, shiftMinutes] = shift.start_time.split(':').map(Number)
      const shiftStartMinutes = shiftHours * 60 + shiftMinutes
      const minutesSinceShiftStart = currentTotalMinutes - shiftStartMinutes
      
      if (minutesSinceShiftStart < 15 || minutesSinceShiftStart >= 20) continue

      const { data: punches } = await supabase
        .from('time_punches')
        .select('id, punch_time')
        .eq('user_id', shift.user_id)
        .eq('punch_type', 'in')
        .eq('location_id', locationId)
        .gte('punch_time', startOfDayUTC.toISOString())
        .lte('punch_time', endOfDayUTC.toISOString())
        .order('punch_time', { ascending: true })
        .limit(1)

      if (!punches || punches.length === 0) {
        lateEmployees.push({
          user_id: shift.user_id,
          name: profileMap.get(shift.user_id) || 'Unknown',
          shift_start: shift.start_time
        })
      }
    }

    if (lateEmployees.length > 0) {
      const adminUsers = await getLocationAdminsAndManagers(supabase, locationId, 'late_arrivals')

      if (adminUsers.length > 0) {
        for (const employee of lateEmployees) {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: adminUsers.map((u: any) => u.user_id),
              title: `Late Arrival - ${locationName}`,
              body: `${employee.name} has not clocked in (shift started ${formatTime12Hour(employee.shift_start)})`,
              notification_type: 'late_arrivals',
              data: { user_id: employee.user_id, type: 'late_arrival', location_id: locationId }
            }
          })
        }
      }
    }
  } catch (error) {
    console.error(`[${locationName}] Error checking late arrivals:`, error)
  }
}

async function checkClockInChecklistReminders(supabase: any, timezone: string, locationId: string, locationName: string) {
  try {
    const { startOfDayUTC, endOfDayUTC, localNow, currentDay } = getTimezoneDayBoundariesInUTC(timezone)
    
    const now = new Date()
    const thirteenMinAgo = new Date(now.getTime() - 17 * 60 * 1000)
    const seventeenMinAgo = new Date(now.getTime() - 13 * 60 * 1000)
    
    const { data: recentPunches, error: punchError } = await supabase
      .from('time_punches')
      .select('user_id, punch_time')
      .eq('location_id', locationId)
      .eq('punch_type', 'in')
      .gte('punch_time', thirteenMinAgo.toISOString())
      .lte('punch_time', seventeenMinAgo.toISOString())

    if (punchError) throw punchError
    if (!recentPunches || recentPunches.length === 0) return

    const { data: checklists, error: checklistsError } = await supabase
      .from('checklists')
      .select(`id, title, frequency, template_type, due_by_time, checklist_items(id, days_of_week), checklist_role_tags(role)`)
      .eq('is_active', true)
      .eq('location_id', locationId)
      .not('due_by_time', 'is', null)

    if (checklistsError) throw checklistsError
    if (!checklists || checklists.length === 0) return

    const currentHours = localNow.getHours()
    const currentMinutes = localNow.getMinutes()
    const currentTotalMinutes = currentHours * 60 + currentMinutes

    const upcomingChecklists = []
    
    for (const checklist of checklists) {
      const isRelevantToday = checklist.template_type === 'dynamic' 
        ? checklist.checklist_items?.some((item: any) => item.days_of_week?.includes(currentDay))
        : checklist.frequency === 'daily'

      if (!isRelevantToday) continue

      const [dueHours, dueMinutes] = checklist.due_by_time.split(':').map(Number)
      const dueTotalMinutes = dueHours * 60 + dueMinutes
      
      if (currentTotalMinutes > dueTotalMinutes + 120) continue

      const { data: submissions } = await supabase
        .from('checklist_submissions')
        .select(`id, checklist_responses(id, item_id)`)
        .eq('checklist_id', checklist.id)
        .eq('location_id', locationId)
        .gte('submitted_at', startOfDayUTC.toISOString())
        .lte('submitted_at', endOfDayUTC.toISOString())

      let totalItems = checklist.checklist_items?.length || 0
      if (checklist.template_type === 'dynamic') {
        totalItems = checklist.checklist_items?.filter((item: any) => item.days_of_week?.includes(currentDay)).length || 0
      }

      const uniqueItemIds = new Set()
      submissions?.forEach((sub: any) => {
        sub.checklist_responses?.forEach((response: any) => {
          if (response.item_id) uniqueItemIds.add(response.item_id)
        })
      })
      
      if (uniqueItemIds.size >= totalItems) continue

      upcomingChecklists.push({
        id: checklist.id,
        title: checklist.title,
        dueTime: checklist.due_by_time,
        remainingTasks: totalItems - uniqueItemIds.size,
        roleTags: checklist.checklist_role_tags?.map((rt: any) => rt.role) || []
      })
    }

    if (upcomingChecklists.length === 0) return

    for (const punch of recentPunches) {
      const userId = punch.user_id
      
      const { data: existingReminder } = await supabase
        .from('checklist_notification_logs')
        .select('id')
        .eq('location_id', locationId)
        .eq('notification_type', 'clock_in_reminder')
        .eq('trigger_user_id', userId)
        .gte('sent_at', startOfDayUTC.toISOString())
        .limit(1)

      if (existingReminder && existingReminder.length > 0) continue

      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)

      const userRoleSet = new Set(userRoles?.map((r: any) => r.role) || [])
      
      const relevantChecklists = upcomingChecklists.filter(cl => {
        if (cl.roleTags.length === 0) return true
        return cl.roleTags.some((tag: string) => userRoleSet.has(tag))
      })

      if (relevantChecklists.length === 0) continue

      const checklistNames = relevantChecklists.slice(0, 3).map(cl => cl.title)
      const moreCount = relevantChecklists.length - 3
      
      let body = ''
      if (relevantChecklists.length === 1) {
        const cl = relevantChecklists[0]
        body = `${cl.title} has ${cl.remainingTasks} task${cl.remainingTasks === 1 ? '' : 's'} remaining (due ${formatTime12Hour(cl.dueTime)})`
      } else {
        body = checklistNames.join(', ')
        if (moreCount > 0) body += ` +${moreCount} more`
        body += ' need attention'
      }

      await supabase.functions.invoke('send-push-notification', {
        body: {
          user_ids: [userId],
          title: `Checklist Reminder - ${locationName}`,
          body: body,
          notification_type: 'overdue_checklists',
          data: { type: 'clock_in_checklist_reminder', location_id: locationId }
        }
      })

      await supabase.from('checklist_notification_logs').insert({
        checklist_id: relevantChecklists[0].id,
        location_id: locationId,
        notification_type: 'clock_in_reminder',
        trigger_user_id: userId
      })
    }
  } catch (error) {
    console.error(`[${locationName}] Error checking clock-in checklist reminders:`, error)
  }
}

async function checkExpiringCertifications(supabase: any) {
  try {
    const now = new Date()
    const thirtyDaysFromNow = new Date()
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

    const { data: expiringCerts, error: certsError } = await supabase
      .from('certifications')
      .select(`id, user_id, certification_type, expiration_date`)
      .eq('status', 'approved')
      .gte('expiration_date', now.toISOString().split('T')[0])
      .lte('expiration_date', thirtyDaysFromNow.toISOString().split('T')[0])

    if (certsError) throw certsError
    if (!expiringCerts || expiringCerts.length === 0) return

    const userIds = [...new Set(expiringCerts.map((c: any) => c.user_id))]
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds)

    const profileMap = new Map(profiles?.map((p: any) => [p.id, p.full_name]) || [])

    for (const cert of expiringCerts) {
      const expirationDate = new Date(cert.expiration_date)
      const daysUntilExpiry = Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      
      const notifyDays = [30, 14, 7, 3, 1]
      if (!notifyDays.includes(daysUntilExpiry)) continue

      const urgencyText = daysUntilExpiry <= 3 ? 'URGENT: ' : ''
      const formattedDate = expirationDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

      await supabase.functions.invoke('send-push-notification', {
        body: {
          user_ids: [cert.user_id],
          title: `${urgencyText}Certification Expiring`,
          body: `Your ${cert.certification_type} expires ${formattedDate} (${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'})`,
          notification_type: 'certification_expiring',
          data: { certification_id: cert.id, type: 'certification_expiring' }
        }
      })

      const { data: userLocations } = await supabase
        .from('user_locations')
        .select('location_id')
        .eq('user_id', cert.user_id)

      if (userLocations && userLocations.length > 0) {
        const locationIds = userLocations.map((ul: any) => ul.location_id)
        const { data: locations } = await supabase
          .from('locations')
          .select('id, name')
          .in('id', locationIds)
        const locationMap = new Map(locations?.map((l: any) => [l.id, l.name]) || [])

        for (const ul of userLocations) {
          const adminUsers = await getLocationAdminsAndManagers(supabase, ul.location_id, 'certification_expiring')
          const locName = locationMap.get(ul.location_id) || 'Unknown'
          
          if (adminUsers.length > 0) {
            await supabase.functions.invoke('send-push-notification', {
              body: {
                user_ids: adminUsers.map((u: any) => u.user_id),
                title: `${urgencyText}Certification Expiring - ${locName}`,
                body: `${profileMap.get(cert.user_id) || 'Employee'}'s ${cert.certification_type} expires ${formattedDate}`,
                notification_type: 'certification_expiring',
                data: { certification_id: cert.id, user_id: cert.user_id, type: 'certification_expiring', location_id: ul.location_id }
              }
            })
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking expiring certifications:', error)
  }
}
