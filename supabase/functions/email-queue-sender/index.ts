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
    // Exclude orchestration wrapper rows: those have empty html/to_addresses and are
    // managed by email-batch-sender. Only pick up rows with actual content to deliver.
    const { data: queue, error: queueError } = await supabase
      .from('email_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('retry_count', 3)
      .neq('html', '')
      .not('to_addresses', 'eq', '{}')
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
        // Filter out bounced email addresses
        const bouncedAddresses = await supabase
          .from('bounced_emails')
          .select('email_address')
          .in('email_address', item.to_addresses)
        
        let recipientList = item.to_addresses
        if (bouncedAddresses.data && bouncedAddresses.data.length > 0) {
          const bounced = new Set(bouncedAddresses.data.map(b => b.email_address))
          recipientList = item.to_addresses.filter((addr: string) => !bounced.has(addr))
          
          if (recipientList.length === 0) {
            console.log(`[email-queue-sender] ⏭️  Skipping - all recipients bounced: ${item.to_addresses.join(', ')}`)
            await supabase
              .from('email_queue')
              .update({ status: 'bounced' })
              .eq('id', item.id)
            continue
          }
        }
        
        const sendOpts: any = {
          from: item.from_address,
          to: recipientList,
          subject: item.subject,
          html: item.html,
        }

        // Support attachments stored in metadata
        if (item.metadata?.attachments && Array.isArray(item.metadata.attachments)) {
          sendOpts.attachments = item.metadata.attachments
        }

        const result = await resend.emails.send(sendOpts)

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
        const errorMsg = sendErr.message || 'Unknown error'
        
        // Detect bounce errors (permanent delivery failures)
        const isBounce = errorMsg.includes('bounced') || 
                        errorMsg.includes('invalid email') ||
                        errorMsg.includes('does not exist') ||
                        errorMsg.includes('undeliverable') ||
                        sendErr.code === 'UNPROCESSABLE_ENTITY'
        
        if (isBounce && item.to_addresses && Array.isArray(item.to_addresses)) {
          // Record each bounced email address
          for (const email of item.to_addresses) {
            const { error: bounceError } = await supabase
              .from('bounced_emails')
              .upsert({
                email_address: email,
                bounce_reason: errorMsg,
                bounced_at: new Date().toISOString(),
                bounce_count: 1,
              }, { onConflict: 'email_address' })
            
            if (!bounceError) {
              console.log(`[email-queue-sender] 🚫 Marked as bounced: ${email}`)
            }
          }
          
          // Mark as bounced so we don't retry
          await supabase
            .from('email_queue')
            .update({
              status: 'bounced',
              last_error: `Bounced: ${errorMsg}`,
            })
            .eq('id', item.id)
        } else {
          // Transient error - retry up to 3 times
          const newStatus = newRetryCount >= 3 ? 'failed' : 'pending'
          
          console.error(`[email-queue-sender] ❌ Failed (attempt ${newRetryCount}/3): ${item.subject}`, errorMsg)

          await supabase
            .from('email_queue')
            .update({
              retry_count: newRetryCount,
              last_error: errorMsg,
              status: newStatus,
            })
            .eq('id', item.id)
        }
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
