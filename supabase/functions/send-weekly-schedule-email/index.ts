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

// Roles that are shift_manager or higher
const MANAGER_ROLES = ['shift_manager', 'manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin'];

interface ShiftData {
  shift_date: string;
  start_time: string;
  end_time: string;
  is_time_off: boolean;
}

interface TeamMemberSchedule {
  name: string;
  shifts: ShiftData[];
  totalHours: number;
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

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

function calculateHours(startTime: string, endTime: string): number {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  let start = startH + startM / 60;
  let end = endH + endM / 60;
  if (end < start) end += 24; // Handle midnight crossover
  return end - start;
}

function calculateNetHours(shifts: ShiftData[]): number {
  let totalHours = 0;
  shifts.forEach(shift => {
    if (!shift.is_time_off) {
      const hours = calculateHours(shift.start_time, shift.end_time);
      totalHours += hours > 5 ? hours - 0.5 : hours;
    }
  });
  return totalHours;
}

function generateScheduleEmail(
  employeeName: string,
  locationName: string,
  weekRange: string,
  shifts: ShiftData[],
  isManager: boolean = false,
  teamSchedule?: TeamMemberSchedule[]
): { subject: string; html: string } {
  // Sort shifts by date
  const sortedShifts = [...shifts].sort((a, b) => a.shift_date.localeCompare(b.shift_date));
  
  // Calculate total hours
  const totalHours = calculateNetHours(shifts);

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

  // Generate team overview for managers
  let teamOverviewHtml = '';
  if (isManager && teamSchedule && teamSchedule.length > 0) {
    // Sort team by name
    const sortedTeam = [...teamSchedule].sort((a, b) => a.name.localeCompare(b.name));
    
    // Get all unique dates
    const allDates = [...new Set(sortedTeam.flatMap(t => t.shifts.map(s => s.shift_date)))].sort();
    
    // Build team rows
    const teamRows = sortedTeam.map(member => {
      // Create a map of date to shift for this member
      const shiftMap = new Map(member.shifts.map(s => [s.shift_date, s]));
      
      const shiftCells = allDates.map(date => {
        const shift = shiftMap.get(date);
        if (!shift) {
          return `<td style="padding: 6px 4px; text-align: center; color: #ccc; font-size: 11px;">—</td>`;
        }
        if (shift.is_time_off) {
          return `<td style="padding: 6px 4px; text-align: center; color: #22c55e; font-size: 11px; font-weight: 500;">OFF</td>`;
        }
        return `<td style="padding: 6px 4px; text-align: center; font-size: 10px; color: ${textColor};">${formatTime(shift.start_time).replace(' ', '')}<br/>${formatTime(shift.end_time).replace(' ', '')}</td>`;
      }).join('');
      
      return `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e8e5df; font-weight: 500; color: ${textColor}; white-space: nowrap;">${member.name.split(' ')[0]}</td>
          ${shiftCells}
          <td style="padding: 8px 8px; border-bottom: 1px solid #e8e5df; text-align: right; font-weight: 600; color: ${primaryColor};">${member.totalHours.toFixed(1)}</td>
        </tr>
      `;
    }).join('');
    
    // Date headers
    const dateHeaders = allDates.map(date => 
      `<th style="padding: 8px 4px; text-align: center; font-size: 10px; text-transform: uppercase; color: #666; font-weight: 600;">${formatShortDate(date)}</th>`
    ).join('');
    
    // Calculate total team hours
    const totalTeamHours = sortedTeam.reduce((sum, m) => sum + m.totalHours, 0);
    
    teamOverviewHtml = `
      <!-- Team Overview Section -->
      <tr>
        <td style="padding: 30px 40px 0;">
          <div style="border-top: 2px solid ${backgroundColor}; padding-top: 24px;">
            <h2 style="color: ${textColor}; font-size: 16px; font-weight: 600; margin: 0 0 16px;">
              👥 Full Team Schedule
            </h2>
            <div style="overflow-x: auto;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #fafafa; border-radius: 10px; overflow: hidden; font-size: 12px;">
                <thead>
                  <tr style="background-color: ${backgroundColor};">
                    <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #666; font-weight: 600;">Name</th>
                    ${dateHeaders}
                    <th style="padding: 10px 8px; text-align: right; font-size: 11px; text-transform: uppercase; color: #666; font-weight: 600;">Hrs</th>
                  </tr>
                </thead>
                <tbody>
                  ${teamRows}
                </tbody>
                <tfoot>
                  <tr style="background-color: ${backgroundColor};">
                    <td colspan="${allDates.length + 1}" style="padding: 10px 12px; font-weight: 600; color: ${textColor};">Total Team Hours</td>
                    <td style="padding: 10px 8px; text-align: right; font-weight: 700; color: ${primaryColor};">${totalTeamHours.toFixed(1)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

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
            <table role="presentation" style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 30px 40px; text-align: center;">
                  <img 
                    src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
                    alt="Croo" 
                    style="height: 50px; width: auto; margin-bottom: 12px; filter: brightness(0) invert(1);" 
                  />
                  <h1 style="color: #ffffff; font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.5px;">
                    📅 ${isManager ? 'Weekly Schedule Published' : 'Your Weekly Schedule'}
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
                    ${isManager 
                      ? `The schedule for <strong style="color: ${primaryColor};">${weekRange}</strong> at <strong>${locationName}</strong> has been published. Here's your schedule:`
                      : `Your schedule for <strong style="color: ${primaryColor};">${weekRange}</strong> at <strong>${locationName}</strong> is ready.`
                    }
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
                    <span style="color: #666; font-size: 12px; text-transform: uppercase;">Your Scheduled Hours</span><br/>
                    <strong style="color: ${primaryColor}; font-size: 28px; font-weight: 700;">${totalHours.toFixed(1)}</strong>
                    <span style="color: ${primaryColor}; font-size: 14px;"> hours</span>
                  </div>
                </td>
              </tr>
              
              ${teamOverviewHtml}
              
              <tr>
                <td style="padding: 0 40px 30px;">
                  <p style="color: #999; font-size: 12px; margin: 20px 0 0; text-align: center;">
                    ${isManager 
                      ? 'View the full schedule in the app for more details.'
                      : 'Questions about your schedule? Talk to your manager or check the app.'
                    }
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
    subject: `📅 ${isManager ? 'Schedule Published' : 'Your Schedule'}: ${weekRange} — ${locationName}`,
    html
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { schedule_id, location_id, cc_email, test_mode, test_email } = await req.json();
    
    // Test mode: send a sample schedule email without needing real data
    if (test_mode && test_email) {
      const sampleShifts: ShiftData[] = [
        { shift_date: '2026-01-12', start_time: '09:00', end_time: '17:00', is_time_off: false },
        { shift_date: '2026-01-13', start_time: '10:00', end_time: '18:00', is_time_off: false },
        { shift_date: '2026-01-14', start_time: '08:00', end_time: '16:00', is_time_off: false },
        { shift_date: '2026-01-15', start_time: '00:00', end_time: '00:00', is_time_off: true },
        { shift_date: '2026-01-16', start_time: '11:00', end_time: '19:00', is_time_off: false },
      ];
      
      const sampleTeam: TeamMemberSchedule[] = [
        { name: 'Jordan Test', shifts: sampleShifts, totalHours: 30.5 },
        { name: 'Alex Demo', shifts: [
          { shift_date: '2026-01-12', start_time: '08:00', end_time: '14:00', is_time_off: false },
          { shift_date: '2026-01-14', start_time: '12:00', end_time: '20:00', is_time_off: false },
        ], totalHours: 13.5 },
        { name: 'Sam Sample', shifts: [
          { shift_date: '2026-01-13', start_time: '06:00', end_time: '14:00', is_time_off: false },
          { shift_date: '2026-01-15', start_time: '10:00', end_time: '18:00', is_time_off: false },
          { shift_date: '2026-01-16', start_time: '07:00', end_time: '15:00', is_time_off: false },
        ], totalHours: 22.5 },
      ];
      
      const { subject, html } = generateScheduleEmail(
        'Jordan Test',
        'Palm Springs (Test)',
        'Jan 12 - Jan 18, 2026',
        sampleShifts,
        true, // Manager view
        sampleTeam
      );
      
      try {
        await resend.emails.send({
          from: "Croo <hello@croohq.email>",
          to: [test_email],
          subject: `[TEST] ${subject}`,
          html
        });
        
        return new Response(
          JSON.stringify({ success: true, test_mode: true, sent_to: test_email }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err: any) {
        console.error("Test email error:", err);
        return new Response(
          JSON.stringify({ success: false, error: err.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
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
    
    // Get all shifts
    const { data: shifts, error: shiftsError } = await supabase
      .from('scheduled_shifts')
      .select('user_id, shift_date, start_time, end_time, is_time_off')
      .eq('schedule_id', schedule_id)
      .not('user_id', 'is', null);
    
    if (shiftsError) throw shiftsError;
    
    // Get unique user IDs
    const userIds = [...new Set((shifts || []).map(s => s.user_id))];
    
    // Get profiles for these users
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds);
    
    if (profilesError) throw profilesError;
    
    // Get roles for these users
    const { data: userRoles, error: rolesError } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .in('user_id', userIds);
    
    if (rolesError) throw rolesError;
    
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    const roleMap = new Map((userRoles || []).map(r => [r.user_id, r.role]));
    
    // Group shifts by user
    const userShifts = new Map<string, { email: string; name: string; shifts: ShiftData[] }>();
    
    for (const shift of shifts || []) {
      const userId = shift.user_id;
      const profile = profileMap.get(userId);
      
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
    
    // Build team schedule for managers
    const teamSchedule: TeamMemberSchedule[] = Array.from(userShifts.entries()).map(([userId, data]) => ({
      name: data.name,
      shifts: data.shifts,
      totalHours: calculateNetHours(data.shifts)
    }));
    
    // Format week range
    const startDate = new Date(schedule.week_start_date + 'T12:00:00');
    const endDate = new Date(schedule.week_end_date + 'T12:00:00');
    const weekRange = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    
    const emailsSent: string[] = [];
    const errors: string[] = [];
    
    // Send email to each user
    for (const [userId, userData] of userShifts) {
      const userRole = roleMap.get(userId) || 'team_member';
      const isManager = MANAGER_ROLES.includes(userRole);
      
      const { subject, html } = generateScheduleEmail(
        userData.name,
        location.name,
        weekRange,
        userData.shifts,
        isManager,
        isManager ? teamSchedule : undefined
      );
      
      try {
        await resend.emails.send({
          from: "Croo <hello@croohq.email>",
          to: [userData.email],
          subject,
          html
        });
        
        emailsSent.push(`${userData.email}${isManager ? ' (manager)' : ''}`);
        console.log(`Sent schedule email to ${userData.email} (manager: ${isManager})`);
      } catch (err: any) {
        console.error(`Failed to send to ${userData.email}:`, err);
        errors.push(`${userData.email}: ${err.message}`);
      }
    }
    
    // Send copy to CC email if provided (send manager version)
    if (cc_email) {
      const randomUser = Array.from(userShifts.values())[0];
      if (randomUser) {
        const { subject, html } = generateScheduleEmail(
          randomUser.name,
          location.name,
          weekRange,
          randomUser.shifts,
          true, // Send manager version
          teamSchedule
        );
        
        try {
          await resend.emails.send({
          from: "Croo <hello@croohq.email>",
            to: [cc_email],
            subject: `[COPY] ${subject}`,
            html
          });
          emailsSent.push(`${cc_email} (copy - manager view)`);
          console.log(`Sent manager copy to ${cc_email}`);
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
