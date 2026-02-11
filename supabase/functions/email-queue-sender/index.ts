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
    console.error('[email-queue-sender] RESEND_API_KEY not configured')
    return new Response(
      JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const resend = new Resend(resendApiKey)

  try {
    // Fetch pending emails (oldest first, max 20 per run to stay within limits)
    const { data: queue, error: queueError } = await supabase
      .from('email_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('retry_count', 3)
      .order('created_at', { ascending: true })
      .limit(20)

    if (queueError) {
      console.error('[email-queue-sender] Queue fetch error:', queueError)
      throw queueError
    }

    if (!queue || queue.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No pending emails', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[email-queue-sender] Processing ${queue.length} queued emails`)

    let sentCount = 0
    let errorCount = 0

    for (const item of queue) {
      try {
        const result = await resend.emails.send({
          from: item.from_address,
          to: item.to_addresses,
          subject: item.subject,
          html: item.html,
        })

        if (result.error) {
          throw new Error(result.error.message || 'Resend API error')
        }

        // Mark as sent
        await supabase
          .from('email_queue')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            metadata: { ...(item.metadata || {}), resend_id: result.data?.id },
          })
          .eq('id', item.id)

        sentCount++
        console.log(`[email-queue-sender] ✅ Sent: ${item.subject} → ${item.to_addresses.join(', ')}`)

      } catch (sendErr: any) {
        errorCount++
        const newRetryCount = item.retry_count + 1
        const newStatus = newRetryCount >= 3 ? 'failed' : 'pending'

        console.error(`[email-queue-sender] ❌ Failed (attempt ${newRetryCount}/3): ${item.subject}`, sendErr.message)

        await supabase
          .from('email_queue')
          .update({
            retry_count: newRetryCount,
            last_error: sendErr.message || 'Unknown error',
            status: newStatus,
          })
          .eq('id', item.id)
      }

      // Small delay between sends to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    console.log(`[email-queue-sender] Done: ${sentCount} sent, ${errorCount} errors`)

    return new Response(
      JSON.stringify({ message: `Processed ${queue.length} emails`, sent: sentCount, errors: errorCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('[email-queue-sender] Fatal error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
