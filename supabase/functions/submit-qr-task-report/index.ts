import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReportRequest {
  task_id: string;
  location_id: string;
  selected_issues: string[];
  guest_note: string | null;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: ReportRequest = await req.json();
    const { task_id, location_id, selected_issues, guest_note } = body;

    // Validate required fields
    if (!task_id || !location_id || !selected_issues?.length) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get client IP for rate limiting (from headers)
    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    // Rate limit check: 1 report per IP per 5 minutes for this task
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentReports } = await supabase
      .from('qr_task_reports')
      .select('id')
      .eq('task_id', task_id)
      .eq('reporter_ip', clientIP)
      .gte('created_at', fiveMinutesAgo)
      .limit(1);

    if (recentReports && recentReports.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Please wait before submitting another report' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert the report
    const { data: report, error: insertError } = await supabase
      .from('qr_task_reports')
      .insert({
        task_id,
        location_id,
        selected_issues,
        guest_note,
        reporter_ip: clientIP,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting report:', insertError);
      throw insertError;
    }

    // Fetch task details for notification
    const { data: task } = await supabase
      .from('temporary_tasks')
      .select('title, qr_notify_punch_clock, accent_color')
      .eq('id', task_id)
      .single();

    // Fetch location name
    const { data: location } = await supabase
      .from('locations')
      .select('name')
      .eq('id', location_id)
      .single();

    // Send push notification to managers at this location
    const issuesText = selected_issues.join(', ');
    const notificationTitle = `🚨 ${task?.title || 'QR Alert'}`;
    const notificationBody = `Issues reported: ${issuesText}${guest_note ? ` - "${guest_note}"` : ''}`;

    // Call the send-push-notification function
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          roles: ['manager', 'general_manager', 'admin', 'org_admin', 'super_admin'],
          location_id,
          title: notificationTitle,
          body: notificationBody,
          type: 'qr_task_report',
          data: {
            task_id,
            report_id: report.id,
            selected_issues,
          },
        }),
      });
    } catch (pushError) {
      console.error('Error sending push notification:', pushError);
      // Don't fail the request if push fails
    }

    console.log(`[QR Task Report] Created report ${report.id} for task ${task_id} at ${location?.name || location_id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        report_id: report.id,
        message: 'Report submitted successfully' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in submit-qr-task-report:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
