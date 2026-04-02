import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function queueEmail(opts: { from: string; to: string[]; subject: string; html: string; source: string; dedupKey?: string }) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { error } = await supabase.from('email_queue').insert({
    from_address: opts.from,
    to_addresses: opts.to,
    subject: opts.subject,
    html: opts.html,
    source: opts.source,
    dedup_key: opts.dedupKey || null,
    metadata: {},
  });
  if (error) {
    console.error(`[schedule-email] Queue insert failed:`, error);
    throw error;
  }
  console.log(`[schedule-email] Queued → ${opts.to.join(', ')}`);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

const systemFontStack = "'Manrope', -apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:${systemFontStack};"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="width:100%;max-width:720px;margin:0 auto;background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f0ebe1;padding:30px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;padding-bottom:12px;"><div style="display:inline-flex;align-items:center;gap:10px;justify-content:center;"><span style="color:#3a5f7d;font-size:16px;font-weight:400;letter-spacing:-0.2px;">Powered by</span><img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-transparent.webp" alt="CrooHQ" style="height:44px;" /></div></td></tr><tr><td style="text-align:center;"><p style="color:#999;font-size:12px;margin:0;">&copy; 2026 Croo. All rights reserved.</p></td></tr></table></td></tr>`;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function formatTime12h(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { schedule_id, location_id, preview, preview_type } = await req.json();

    // Preview mode – return sample HTML without needing real IDs
    if (preview) {
      if (preview_type === 'manager') {
        // Manager full-team schedule preview
        const weekLabel = 'Feb 10 – Feb 16';
        const sampleEmployees = [
          { name: 'Sarah Johnson', role: 'Shift Manager', shifts: ['9:00 AM – 5:00 PM', '9:00 AM – 5:00 PM', '10:00 AM – 6:00 PM', 'OFF', '8:00 AM – 4:00 PM', 'OFF', 'OFF'], hours: 38 },
          { name: 'Mike Chen', role: 'Team Lead', shifts: ['OFF', '11:00 AM – 7:00 PM', '11:00 AM – 7:00 PM', '9:00 AM – 5:00 PM', '9:00 AM – 5:00 PM', '10:00 AM – 4:00 PM', 'OFF'], hours: 38 },
          { name: 'Emily Davis', role: 'Crew', shifts: ['10:00 AM – 3:00 PM', 'OFF', '10:00 AM – 3:00 PM', '10:00 AM – 3:00 PM', 'OFF', '9:00 AM – 2:00 PM', 'OFF'], hours: 20 },
          { name: 'James Wilson', role: 'Crew', shifts: ['OFF', '8:00 AM – 2:00 PM', 'OFF', '11:00 AM – 5:00 PM', '11:00 AM – 5:00 PM', 'OFF', '10:00 AM – 4:00 PM'], hours: 24 },
          { name: 'Lisa Park', role: 'Crew', shifts: ['7:00 AM – 1:00 PM', '7:00 AM – 1:00 PM', 'OFF', 'OFF', '7:00 AM – 1:00 PM', '8:00 AM – 2:00 PM', 'OFF'], hours: 24 },
        ];
        const dayAbbrs = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const dayDates = ['10', '11', '12', '13', '14', '15', '16'];
        const totalShifts = sampleEmployees.reduce((s, e) => s + e.shifts.filter(x => x !== 'OFF').length, 0);
        const totalHours = sampleEmployees.reduce((s, e) => s + e.hours, 0);

        const headerRow = `<tr><td style="padding:8px 10px;font-size:11px;font-weight:700;color:#666;text-transform:uppercase;text-align:left;border-bottom:2px solid ${primaryColor};">Employee</td>${dayAbbrs.map((d, i) => `<td style="padding:8px 4px;font-size:11px;font-weight:700;color:#666;text-transform:uppercase;text-align:center;border-bottom:2px solid ${primaryColor};"><div>${d}</div><div style="font-weight:400;font-size:10px;color:#999;">${dayDates[i]}</div></td>`).join('')}</tr>`;

        const employeeRows = sampleEmployees.map((emp, idx) => {
          const bg = idx % 2 === 0 ? '#fafaf8' : '#ffffff';
          const shiftCells = emp.shifts.map(s => {
            if (s === 'OFF') return `<td style="padding:4px 2px;text-align:center;background:${bg};"><span style="color:#ccc;font-size:10px;">OFF</span></td>`;
            return `<td style="padding:4px 2px;text-align:center;background:${bg};"><div style="background:#e6f7f9;border-radius:6px;padding:3px 4px;font-size:10px;color:${primaryColor};font-weight:600;line-height:1.4;">${s.replace(' – ', '<br/>')}</div></td>`;
          }).join('');
          return `<tr><td style="padding:6px 10px;background:${bg};white-space:nowrap;"><div style="font-size:12px;font-weight:600;color:${textColor};">${emp.name}</div><div style="font-size:10px;color:#888;">${emp.role}</div></td>${shiftCells}</tr>`;
        }).join('');

        const html = wrapEmail(`
          <!-- HEADER -->
          <tr><td style="background-color:${primaryColor};padding:20px 32px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="vertical-align:middle;text-align:left;width:180px;">
                  <img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:40px;" />
                </td>
                <td style="vertical-align:middle;text-align:center;">
                  <h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Weekly Schedule</h1>
                </td>
                <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;">
                  <p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">Sample Location</p>
                  <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${systemFontStack};">${weekLabel}</p>
                </td>
              </tr>
            </table>
          </td></tr>

          <tr><td style="padding:28px 24px;">
            <!-- SUMMARY BADGES -->
            <div style="text-align:center;margin-bottom:24px;">
              <span style="display:inline-block;background:#e6f7f9;color:${primaryColor};padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;margin:0 4px;">${sampleEmployees.length} Employees</span>
              <span style="display:inline-block;background:#e6f7f9;color:${primaryColor};padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;margin:0 4px;">${totalShifts} Shifts</span>
              <span style="display:inline-block;background:#e6f7f9;color:${primaryColor};padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;margin:0 4px;">${totalHours}h Total</span>
            </div>

            <!-- SCHEDULE GRID -->
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden;">
                ${headerRow}
                ${employeeRows}
              </table>
            </div>
          </td></tr>
          ${getEmailFooter()}
        `);
        return new Response(JSON.stringify({ html }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Individual employee preview (default)
      const weekLabel = 'Feb 10 – Feb 16';
      const sampleShifts = [
        { day: 'Monday, Feb 10', time: '9:00 AM – 5:00 PM' },
        { day: 'Tuesday, Feb 11', time: '9:00 AM – 5:00 PM' },
        { day: 'Wednesday, Feb 12', time: '10:00 AM – 6:00 PM' },
        { day: 'Thursday, Feb 13', time: null },
        { day: 'Friday, Feb 14', time: '8:00 AM – 4:00 PM' },
        { day: 'Saturday, Feb 15', time: null },
        { day: 'Sunday, Feb 16', time: null },
      ];

      const shiftRows = sampleShifts.map(s => {
        if (!s.time) {
          return `<tr><td style="padding:10px 16px;border-bottom:1px solid #eee;"><strong style="color:${textColor};font-size:14px;">${s.day}</strong><br/><span style="color:#ccc;font-size:13px;">OFF</span></td></tr>`;
        }
        return `<tr><td style="padding:10px 16px;border-bottom:1px solid #eee;"><strong style="color:${textColor};font-size:14px;">${s.day}</strong><br/><span style="color:${primaryColor};font-size:14px;font-weight:600;">${s.time}</span></td></tr>`;
      }).join('');

      const sampleHtml = wrapEmail(`
        <!-- HEADER -->
        <tr><td style="background-color:${primaryColor};padding:20px 32px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="vertical-align:middle;text-align:left;width:180px;">
                <img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:40px;" />
              </td>
              <td style="vertical-align:middle;text-align:center;">
                <h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Your Schedule</h1>
              </td>
              <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;">
                <p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">Sample Location</p>
                <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${systemFontStack};">${weekLabel}</p>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:28px 32px;">
          <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Hey Sarah! Your schedule for the week has been published.</p>
          <div style="background:#fafaf8;border-radius:16px;padding:16px;margin-bottom:20px;">
            <table style="width:100%;">${shiftRows}</table>
          </div>
          <div style="text-align:center;margin-bottom:20px;">
            <span style="display:inline-block;background:${primaryColor};color:#fff;padding:8px 20px;border-radius:20px;font-size:14px;font-weight:600;">4 shifts • 30.0 hours</span>
          </div>
        </td></tr>
        ${getEmailFooter()}
      `);
      return new Response(JSON.stringify({ html: sampleHtml }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!schedule_id || !location_id) {
      return new Response(JSON.stringify({ error: "schedule_id and location_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get schedule info
    const { data: schedule } = await supabase
      .from("schedules")
      .select("id, week_start_date, week_end_date")
      .eq("id", schedule_id)
      .single();

    if (!schedule) {
      return new Response(JSON.stringify({ error: "Schedule not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get location name
    const { data: location } = await supabase
      .from("locations")
      .select("name")
      .eq("id", location_id)
      .single();

    const locationName = location?.name || "Your Location";

    // Get all shifts for this schedule
    const { data: shifts } = await supabase
      .from("scheduled_shifts")
      .select("user_id, shift_date, start_time, end_time, is_time_off")
      .eq("schedule_id", schedule_id)
      .not("user_id", "is", null);

    if (!shifts || shifts.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No shifts to email" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Group shifts by user
    const shiftsByUser = new Map<string, typeof shifts>();
    for (const shift of shifts) {
      if (!shift.user_id) continue;
      const existing = shiftsByUser.get(shift.user_id) || [];
      existing.push(shift);
      shiftsByUser.set(shift.user_id, existing);
    }

    // Get user profiles with emails
    const userIds = Array.from(shiftsByUser.keys());
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);

    if (!profiles) {
      return new Response(JSON.stringify({ success: true, message: "No profiles found" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check notification preferences
    const { data: notifSettings } = await supabase
      .from("user_notification_settings")
      .select("user_id, push_enabled")
      .eq("location_id", location_id)
      .eq("notification_type", "schedule_updates")
      .eq("push_enabled", false);

    const optedOutUsers = new Set((notifSettings || []).map(s => s.user_id));

    // Format week dates for subject
    const startDate = new Date(schedule.week_start_date + 'T12:00:00');
    const endDate = new Date(schedule.week_end_date + 'T12:00:00');
    const weekLabel = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

    let sentCount = 0;

    for (const profile of profiles) {
      if (!profile.email || optedOutUsers.has(profile.id)) continue;

      const userShifts = shiftsByUser.get(profile.id) || [];
      if (userShifts.length === 0) continue;

      // Sort by date
      userShifts.sort((a, b) => a.shift_date.localeCompare(b.shift_date));

      const firstName = profile.full_name?.split(' ')[0] || 'Team Member';

      // Build shift rows
      const shiftRows = userShifts.map(s => {
        const date = new Date(s.shift_date + 'T12:00:00');
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        if (s.is_time_off) {
          return `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;"><strong style="color:${textColor};">${dayName}, ${dateStr}</strong><br/><span style="color:#ef4444;font-size:13px;">Time Off</span></td></tr>`;
        }

        return `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;"><strong style="color:${textColor};">${dayName}, ${dateStr}</strong><br/><span style="color:${primaryColor};font-size:14px;font-weight:600;">${formatTime12h(s.start_time)} – ${formatTime12h(s.end_time)}</span></td></tr>`;
      }).join('');

      const workingShifts = userShifts.filter(s => !s.is_time_off);
      const totalHours = workingShifts.reduce((sum, s) => {
        const [sh, sm] = s.start_time.split(':').map(Number);
        const [eh, em] = s.end_time.split(':').map(Number);
        let hrs = (eh * 60 + em - sh * 60 - sm) / 60;
        if (hrs < 0) hrs += 24;
        return sum + hrs;
      }, 0);

      const emailHtml = wrapEmail(`
         <!-- HEADER -->
         <tr><td style="background-color:${primaryColor};padding:20px 32px;">
           <table style="width:100%;border-collapse:collapse;">
             <tr>
               <td style="vertical-align:middle;text-align:left;width:180px;">
                 <img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:40px;" />
               </td>
               <td style="vertical-align:middle;text-align:center;">
                 <h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Your Schedule</h1>
               </td>
               <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;">
                 <p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">${locationName}</p>
                 <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${systemFontStack};">${weekLabel}</p>
               </td>
             </tr>
           </table>
         </td></tr>
        <tr><td style="padding:28px 32px;">
          <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Hey ${firstName}! Your schedule for the week has been published.</p>
          <div style="background:#fafaf8;border-radius:16px;padding:16px;margin-bottom:20px;">
            <table style="width:100%;">${shiftRows}</table>
          </div>
          <div style="text-align:center;margin-bottom:20px;">
            <span style="display:inline-block;background:${primaryColor};color:#fff;padding:8px 20px;border-radius:20px;font-size:14px;font-weight:600;">${workingShifts.length} shift${workingShifts.length !== 1 ? 's' : ''} • ${totalHours.toFixed(1)} hours</span>
          </div>
        </td></tr>
        ${getEmailFooter()}
      `);

      try {
        await queueEmail({
          from: "CrooHQ <hello@croohq.email>",
          to: [profile.email],
          subject: `Schedule Published: ${weekLabel} - ${locationName}`,
          html: emailHtml,
          source: "schedule_published",
          dedupKey: `schedule_${schedule_id}_${profile.id}`,
        });
        sentCount++;
      } catch (e) {
        console.error(`[schedule-email] Failed for ${profile.email}:`, e);
      }
    }

    console.log(`[schedule-email] Sent ${sentCount} schedule emails for ${locationName}`);
    return new Response(JSON.stringify({ success: true, sentCount }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[send-weekly-schedule-email] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
