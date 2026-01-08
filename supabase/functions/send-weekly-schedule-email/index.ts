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

interface ShiftData {
  shift_date: string;
  start_time: string;
  end_time: string;
  is_time_off: boolean;
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

function calculateHours(startTime: string, endTime: string): number {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  let start = startH + startM / 60;
  let end = endH + endM / 60;
  if (end < start) end += 24; // Handle midnight crossover
  return end - start;
}

function generateScheduleEmail(
  employeeName: string,
  locationName: string,
  weekRange: string,
  shifts: ShiftData[]
): { subject: string; html: string } {
  // Sort shifts by date
  const sortedShifts = [...shifts].sort((a, b) => a.shift_date.localeCompare(b.shift_date));
  
  // Calculate total hours
  let totalHours = 0;
  sortedShifts.forEach(shift => {
    if (!shift.is_time_off) {
      const hours = calculateHours(shift.start_time, shift.end_time);
      // Deduct 30min break for shifts over 5 hours
      totalHours += hours > 5 ? hours - 0.5 : hours;
    }
  });

  const shiftsHtml = sortedShifts.map(shift => {
    const hours = calculateHours(shift.start_time, shift.end_time);
    const netHours = hours > 5 ? hours - 0.5 : hours;
    
    if (shift.is_time_off) {
      return `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
            <strong style="color: ${textColor};">${formatDate(shift.shift_date)}</strong>
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df; text-align: center;">
            <span style="color: #22c55e; font-weight: 600;">Day Off</span>
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df; text-align: right;">
            —
          </td>
        </tr>
      `;
    }
    
    return `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df;">
          <strong style="color: ${textColor};">${formatDate(shift.shift_date)}</strong>
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df; text-align: center;">
          <span style="color: ${primaryColor}; font-weight: 500;">${formatTime(shift.start_time)} - ${formatTime(shift.end_time)}</span>
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e8e5df; text-align: right; color: #666;">
          ${netHours.toFixed(1)} hrs
        </td>
      </tr>
    `;
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
            <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 30px 40px; text-align: center;">
                  <img 
                    src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
                    alt="Croo" 
                    style="height: 50px; width: auto; margin-bottom: 12px; filter: brightness(0) invert(1);" 
                  />
                  <h1 style="color: #ffffff; font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.5px;">
                    📅 Your Weekly Schedule
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
                    Your schedule for <strong style="color: ${primaryColor};">${weekRange}</strong> at <strong>${locationName}</strong> is ready.
                  </p>
                  
                  <!-- Schedule Table -->
                  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #fafafa; border-radius: 10px; overflow: hidden;">
                    <thead>
                      <tr style="background-color: ${backgroundColor};">
                        <th style="padding: 12px 16px; text-align: left; font-size: 11px; text-transform: uppercase; color: #666; font-weight: 600;">Day</th>
                        <th style="padding: 12px 16px; text-align: center; font-size: 11px; text-transform: uppercase; color: #666; font-weight: 600;">Time</th>
                        <th style="padding: 12px 16px; text-align: right; font-size: 11px; text-transform: uppercase; color: #666; font-weight: 600;">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${shiftsHtml}
                    </tbody>
                  </table>
                  
                  <!-- Total Hours -->
                  <div style="background: linear-gradient(135deg, ${primaryColor}15 0%, ${primaryColor}08 100%); border-radius: 10px; padding: 16px; margin-top: 20px; text-align: center;">
                    <span style="color: #666; font-size: 12px; text-transform: uppercase;">Total Scheduled Hours</span><br/>
                    <strong style="color: ${primaryColor}; font-size: 28px; font-weight: 700;">${totalHours.toFixed(1)}</strong>
                    <span style="color: ${primaryColor}; font-size: 14px;"> hours</span>
                  </div>
                  
                  <p style="color: #999; font-size: 12px; margin: 20px 0 0; text-align: center;">
                    Questions about your schedule? Talk to your manager or check the app.
                  </p>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f7f5; padding: 24px 40px; border-top: 1px solid #e8e5df;">
                  <table role="presentation" style="width: 100%;">
                    <tr>
                      <td style="text-align: center;">
                        <a href="https://croohq.com/schedule" style="display: inline-block; background: linear-gradient(135deg, ${accentColor} 0%, #e06b10 100%); color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 16px;">
                          View in Croo
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
    subject: `📅 Your Schedule: ${weekRange} — ${locationName}`,
    html
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { schedule_id, location_id, cc_email } = await req.json();
    
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
    
    // Get all shifts with user info
    const { data: shifts, error: shiftsError } = await supabase
      .from('scheduled_shifts')
      .select(`
        user_id,
        shift_date,
        start_time,
        end_time,
        is_time_off,
        profiles!inner(email, full_name)
      `)
      .eq('schedule_id', schedule_id)
      .not('user_id', 'is', null);
    
    if (shiftsError) throw shiftsError;
    
    // Group shifts by user
    const userShifts = new Map<string, { email: string; name: string; shifts: ShiftData[] }>();
    
    for (const shift of shifts || []) {
      const userId = shift.user_id;
      const profile = shift.profiles as any;
      
      if (!profile?.email) continue;
      
      if (!userShifts.has(userId)) {
        userShifts.set(userId, {
          email: profile.email,
          name: profile.full_name || 'Team Member',
          shifts: []
        });
      }
      
      userShifts.get(userId)!.shifts.push({
        shift_date: shift.shift_date,
        start_time: shift.start_time,
        end_time: shift.end_time,
        is_time_off: shift.is_time_off || false
      });
    }
    
    // Format week range
    const startDate = new Date(schedule.week_start_date + 'T12:00:00');
    const endDate = new Date(schedule.week_end_date + 'T12:00:00');
    const weekRange = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    
    const emailsSent: string[] = [];
    const errors: string[] = [];
    
    // Send email to each user
    for (const [userId, userData] of userShifts) {
      const { subject, html } = generateScheduleEmail(
        userData.name,
        location.name,
        weekRange,
        userData.shifts
      );
      
      try {
        const recipients = [userData.email];
        
        // Add CC if provided and this is NOT the cc_email user
        if (cc_email && userData.email !== cc_email) {
          // We'll send a separate copy to CC
        }
        
        await resend.emails.send({
          from: "Croo <schedule@croohq.com>",
          to: recipients,
          subject,
          html
        });
        
        emailsSent.push(userData.email);
        console.log(`Sent schedule email to ${userData.email}`);
      } catch (err: any) {
        console.error(`Failed to send to ${userData.email}:`, err);
        errors.push(`${userData.email}: ${err.message}`);
      }
    }
    
    // Send copy to CC email if provided
    if (cc_email) {
      // Pick a random user to show as example
      const randomUser = Array.from(userShifts.values())[0];
      if (randomUser) {
        const { subject, html } = generateScheduleEmail(
          randomUser.name,
          location.name,
          weekRange,
          randomUser.shifts
        );
        
        try {
          await resend.emails.send({
            from: "Croo <schedule@croohq.com>",
            to: [cc_email],
            subject: `[COPY] ${subject}`,
            html
          });
          emailsSent.push(`${cc_email} (copy)`);
          console.log(`Sent copy to ${cc_email}`);
        } catch (err: any) {
          console.error(`Failed to send copy to ${cc_email}:`, err);
          errors.push(`${cc_email}: ${err.message}`);
        }
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
    console.error("Error sending schedule emails:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
