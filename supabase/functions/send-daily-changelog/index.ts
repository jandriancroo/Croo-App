import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// Hardcoded recipient - Jordan's user ID
const CHANGELOG_RECIPIENT_ID = "a2e81a39-0e0b-47b1-a1aa-0e53f3869d37";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate cron secret for internal/scheduled calls
  const cronSecret = req.headers.get('x-cron-secret');
  const expectedSecret = Deno.env.get('CRON_SECRET');
  if (!expectedSecret || cronSecret !== expectedSecret) {
    console.error('Unauthorized: Invalid or missing CRON_SECRET');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get today's date in Pacific timezone
    const now = new Date();
    const pacificDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const today = pacificDate.toISOString().split('T')[0];

    console.log(`Fetching changelog entries for ${today}`);

    // Fetch today's changelog entries
    const { data: entries, error: fetchError } = await supabase
      .from('changelog_entries')
      .select('*')
      .eq('entry_date', today)
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('Error fetching changelog:', fetchError);
      throw fetchError;
    }

    if (!entries || entries.length === 0) {
      console.log('No changelog entries for today');
      return new Response(JSON.stringify({ message: 'No changelog entries for today' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Format the changelog message
    const features = entries.filter(e => e.entry_type === 'feature');
    const fixes = entries.filter(e => e.entry_type === 'fix');
    const improvements = entries.filter(e => e.entry_type === 'improvement');
    const other = entries.filter(e => e.entry_type === 'other');

    let body = '';
    
    if (features.length > 0) {
      body += `✨ Features: ${features.map(f => f.title).join(', ')}`;
    }
    if (fixes.length > 0) {
      if (body) body += ' | ';
      body += `🐛 Fixes: ${fixes.map(f => f.title).join(', ')}`;
    }
    if (improvements.length > 0) {
      if (body) body += ' | ';
      body += `🔧 Improvements: ${improvements.map(i => i.title).join(', ')}`;
    }
    if (other.length > 0) {
      if (body) body += ' | ';
      body += `📝 Other: ${other.map(o => o.title).join(', ')}`;
    }

    // Truncate if too long for push notification
    if (body.length > 200) {
      body = body.substring(0, 197) + '...';
    }

    const totalChanges = entries.length;
    const title = `📋 Daily Changelog - ${totalChanges} update${totalChanges !== 1 ? 's' : ''}`;

    console.log(`Sending changelog notification: ${title}`);
    console.log(`Body: ${body}`);

    // Send push notification
    const { error: pushError } = await supabase.functions.invoke('send-push-notification', {
      body: {
        user_ids: [CHANGELOG_RECIPIENT_ID],
        title,
        body,
        notification_type: 'changelog',
        data: { type: 'changelog', date: today }
      }
    });

    if (pushError) {
      console.error('Error sending push notification:', pushError);
      throw pushError;
    }

    console.log('Changelog notification sent successfully');

    return new Response(JSON.stringify({ 
      success: true, 
      entries_count: entries.length,
      title,
      body 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error in send-daily-changelog:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
