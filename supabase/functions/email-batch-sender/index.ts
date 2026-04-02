import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Resend } from 'https://esm.sh/resend@2.0.0'

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
  const resendApiKey = Deno.env.get('RESEND_API_KEY')

  if (!resendApiKey) {
    console.error('[email-batch-sender] RESEND_API_KEY not configured')
    return new Response(
      JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const resend = new Resend(resendApiKey)

  try {
    // ================================================================
    // STEP 1: Pick up pending email jobs (queued by queue_nightly_emails)
    // These have email_type + location_id + target_date but no HTML yet
    // ================================================================
    const { data: jobs, error: jobError } = await supabase
      .from('email_queue')
      .select('*')
      .eq('status', 'pending')
      .not('email_type', 'is', null)
      .not('location_id', 'is', null)
      .lt('retry_count', 3)
      .order('created_at', { ascending: true })
      .limit(10)

    if (jobError) {
      console.error('[email-batch-sender] Job fetch error:', jobError)
      throw jobError
    }

    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No pending email jobs', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[email-batch-sender] Processing ${jobs.length} email jobs`)

    let sentCount = 0
    let errorCount = 0

    for (const job of jobs) {
      try {
        // Mark as processing to prevent double-pickup
        await supabase
          .from('email_queue')
          .update({ status: 'processing' })
          .eq('id', job.id)

        // ================================================================
        // STEP 2: Call support-email-service to render + send
        // It handles: data fetching, HTML rendering, recipient lookup, 
        // queueing individual emails, and logging to daily_summary_logs
        // ================================================================
        const actionMap: Record<string, string> = {
          'daily_summary': 'send_daily_logbook_summary',
          'weekly_summary': 'send_weekly_summary_email',
        }

        const action = actionMap[job.email_type]
        if (!action) {
          throw new Error(`Unknown email_type: ${job.email_type}`)
        }

        const payload: Record<string, any> = {
          location_id: job.location_id,
        }

        // Set the correct date field for each action
        if (job.email_type === 'daily_summary') {
          payload.entry_date = job.target_date
        } else if (job.email_type === 'weekly_summary') {
          // Weekly summary expects week_end date (the Sunday) and week_start (the Monday)
          // target_date is Sunday (yesterday when queued on Monday)
          // week_start is 6 days before week_end (Monday of that week)
          const endDate = new Date(job.target_date + 'T12:00:00')
          const startDate = new Date(endDate)
          startDate.setDate(startDate.getDate() - 6)
          const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          payload.week_end = fmt(endDate)
          payload.week_start = fmt(startDate)
        }

        const response = await fetch(`${supabaseUrl}/functions/v1/support-email-service`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ action, payload }),
        })

        if (!response.ok) {
          const text = await response.text()
          throw new Error(`support-email-service HTTP ${response.status}: ${text}`)
        }

        const result = await response.json()

        if (result.error) {
          throw new Error(result.error)
        }

        // ================================================================
        // STEP 3: Mark the job as sent
        // The support-email-service already queued the individual emails
        // with full HTML into email_queue (those get picked up by 
        // email-queue-sender for actual Resend delivery)
        // ================================================================
        const recipientCount = result.recipientCount || 0
        
        await supabase
          .from('email_queue')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            metadata: {
              ...(job.metadata || {}),
              recipient_count: recipientCount,
              processed_at: new Date().toISOString(),
            },
          })
          .eq('id', job.id)

        sentCount++
        const locationName = job.metadata?.location_name || job.location_id
        console.log(`[email-batch-sender] ✅ ${job.email_type} for ${locationName} (${job.target_date}) → ${recipientCount} recipients`)

      } catch (err: any) {
        errorCount++
        const newRetryCount = (job.retry_count || 0) + 1
        const errorMsg = err.message || 'Unknown error'
        const newStatus = newRetryCount >= 3 ? 'failed' : 'pending'

        console.error(`[email-batch-sender] ❌ ${job.email_type} for ${job.location_id} (attempt ${newRetryCount}/3):`, errorMsg)

        await supabase
          .from('email_queue')
          .update({
            status: newStatus,
            retry_count: newRetryCount,
            last_error: errorMsg,
          })
          .eq('id', job.id)
      }

      // Small delay between jobs to prevent overwhelming downstream services
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    console.log(`[email-batch-sender] Done: ${sentCount} sent, ${errorCount} errors`)

    return new Response(
      JSON.stringify({ 
        message: `Processed ${jobs.length} email jobs`, 
        sent: sentCount, 
        errors: errorCount 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('[email-batch-sender] Fatal error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
