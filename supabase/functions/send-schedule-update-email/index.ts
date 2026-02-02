import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Croo brand colors
const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

interface ScheduleChange {
  user_id: string;
  type: 'added' | 'removed' | 'modified';
  oldShift?: {
    shift_date: string;
    start_time: string;
    end_time: string;
    is_time_off?: boolean;
  };
  newShift?: {
    shift_date: string;
    start_time: string;
    end_time: string;
    is_time_off?: boolean;
  };
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function generateUpdateEmail(
  employeeName: string,
  locationName: string,
  weekRange: string,
  changes: ScheduleChange[]
): { subject: string; html: string } {
  
  const changesHtml = changes.map(change => {
    if (change.type === 'added' && change.newShift) {
      if (change.newShift.is_time_off) {
        return `
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
              <span style="background-color: #22c55e20; color: #22c55e; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">NEW</span>
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
              <strong style="color: ${textColor};">${formatDate(change.newShift.shift_date)}</strong>
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
              <span style="color: #22c55e; font-weight: 600;">Day Off</span>
            </td>
          </tr>
        `;
      }
      return `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
            <span style="background-color: #22c55e20; color: #22c55e; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">NEW</span>
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
            <strong style="color: ${textColor};">${formatDate(change.newShift.shift_date)}</strong>
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
            <span style="color: ${primaryColor}; font-weight: 500;">${formatTime(change.newShift.start_time)} - ${formatTime(change.newShift.end_time)}</span>
          </td>
        </tr>
      `;
    }
    
    if (change.type === 'removed' && change.oldShift) {
      if (change.oldShift.is_time_off) {
        return `
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
              <span style="background-color: #ef444420; color: #ef4444; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">REMOVED</span>
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
              <strong style="color: ${textColor}; text-decoration: line-through;">${formatDate(change.oldShift.shift_date)}</strong>
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
              <span style="color: #999; text-decoration: line-through;">Day Off</span>
            </td>
          </tr>
        `;
      }
      return `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
            <span style="background-color: #ef444420; color: #ef4444; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">REMOVED</span>
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
            <strong style="color: ${textColor}; text-decoration: line-through;">${formatDate(change.oldShift.shift_date)}</strong>
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
            <span style="color: #999; text-decoration: line-through;">${formatTime(change.oldShift.start_time)} - ${formatTime(change.oldShift.end_time)}</span>
          </td>
        </tr>
      `;
    }
    
    if (change.type === 'modified' && change.oldShift && change.newShift) {
      return `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
            <span style="background-color: ${accentColor}20; color: ${accentColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">CHANGED</span>
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
            <strong style="color: ${textColor};">${formatDate(change.newShift.shift_date)}</strong>
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
            <span style="color: #999; text-decoration: line-through; font-size: 12px;">${formatTime(change.oldShift.start_time)} - ${formatTime(change.oldShift.end_time)}</span><br/>
            <span style="color: ${primaryColor}; font-weight: 500;">${formatTime(change.newShift.start_time)} - ${formatTime(change.newShift.end_time)}</span>
          </td>
        </tr>
      `;
    }
    
    return '';
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: ${backgroundColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 30px 20px;">
            <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, ${accentColor} 0%, #e06b10 100%); padding: 30px 40px; text-align: center;">
                  <img 
                    src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
                    alt="Croo" 
                    style="height: 50px; width: auto; margin-bottom: 12px; filter: brightness(0) invert(1);" 
                  />
                  <h1 style="color: #ffffff; font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.5px;">
                    ⚡ Schedule Updated
                  </h1>
                </td>
              </tr>
              
              <!-- Content -->
              <tr>
                <td style="padding: 30px 40px;">
                  <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 8px;">
                    Hey <strong>${employeeName.split(' ')[0]}</strong>! 👋
                  </p>
                  <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
                    Your schedule for <strong style="color: ${primaryColor};">${weekRange}</strong> at <strong>${locationName}</strong> has been updated. Here's what changed:
                  </p>
                  
                  <!-- Changes Table -->
                  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #fafafa; border-radius: 10px; overflow: hidden;">
                    <thead>
                      <tr style="background-color: ${backgroundColor};">
                        <th style="padding: 12px 16px; text-align: left; font-size: 11px; text-transform: uppercase; color: #666; font-weight: 600;">Status</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 11px; text-transform: uppercase; color: #666; font-weight: 600;">Day</th>
                        <th style="padding: 12px 16px; text-align: left; font-size: 11px; text-transform: uppercase; color: #666; font-weight: 600;">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${changesHtml}
                    </tbody>
                  </table>
                  
                  <p style="color: #999; font-size: 12px; margin: 20px 0 0; text-align: center;">
                    Open the app to see your complete updated schedule.
                  </p>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f7f5; padding: 24px 40px; border-top: 1px solid #e8e5df;">
                  <table role="presentation" style="width: 100%;">
                    <tr>
                      <td style="text-align: center;">
                        <a href="https://croohq.com/schedule" style="display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 16px;">
                          View Schedule
                        </a>
                        <p style="color: #aaa; font-size: 11px; margin: 16px 0 0;">
                          © ${new Date().getFullYear()} Croo. All rights reserved.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return {
    subject: `⚡ Schedule Updated: ${weekRange} — ${locationName}`,
    html
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { schedule_id, location_id, changes } = await req.json() as {
      schedule_id: string;
      location_id: string;
      changes: ScheduleChange[];
    };
    
    if (!changes || changes.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No changes to notify' }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get schedule info
    const { data: schedule, error: scheduleError } = await supabase
      .from('schedules')
      .select('week_start_date, week_end_date')
      .eq('id', schedule_id)
      .single();
    
    if (scheduleError) throw scheduleError;
    
    // Get location name
    const { data: location, error: locationError } = await supabase
      .from('locations')
      .select('name')
      .eq('id', location_id)
      .single();
    
    if (locationError) throw locationError;
    
    // Get unique affected user IDs
    const affectedUserIds = [...new Set(changes.map(c => c.user_id).filter(Boolean))];
    
    // Get profiles for affected users
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', affectedUserIds);
    
    if (profilesError) throw profilesError;
    
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    
    // Format week range
    const startDate = new Date(schedule.week_start_date + 'T12:00:00');
    const endDate = new Date(schedule.week_end_date + 'T12:00:00');
    const weekRange = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    
    // Group changes by user
    const changesByUser = new Map<string, ScheduleChange[]>();
    for (const change of changes) {
      if (!change.user_id) continue;
      if (!changesByUser.has(change.user_id)) {
        changesByUser.set(change.user_id, []);
      }
      changesByUser.get(change.user_id)!.push(change);
    }
    
    const emailsSent: string[] = [];
    const errors: string[] = [];
    
    // Send email to each affected user
    for (const [userId, userChanges] of changesByUser) {
      const profile = profileMap.get(userId);
      if (!profile?.email) continue;
      
      const { subject, html } = generateUpdateEmail(
        profile.full_name || 'Team Member',
        location.name,
        weekRange,
        userChanges
      );
      
      try {
        await resend.emails.send({
          from: "Croo <hello@croohq.email>",
          to: [profile.email],
          subject,
          html
        });
        
        emailsSent.push(profile.email);
        console.log(`Sent schedule update email to ${profile.email}`);
      } catch (err: any) {
        console.error(`Failed to send to ${profile.email}:`, err);
        errors.push(`${profile.email}: ${err.message}`);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        emails_sent: emailsSent.length,
        recipients: emailsSent,
        errors: errors.length > 0 ? errors : undefined
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error sending schedule update emails:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
