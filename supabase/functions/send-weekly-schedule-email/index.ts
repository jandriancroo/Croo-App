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

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f8f7f5;padding:24px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;"><a href="https://croohq.com/schedule" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;margin-bottom:16px;">View Schedule</a><p style="color:#aaa;font-size:11px;margin:16px 0 0;">© ${new Date().getFullYear()} Croo. All rights reserved.</p></td></tr></table></td></tr>`;
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
    const { schedule_id, location_id, preview } = await req.json();

    // Preview mode – return sample HTML without needing real IDs
    if (preview) {
      const sampleHtml = wrapEmail(
        `<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;"><h1 style="color:#fff;font-size:24px;font-weight:700;margin:0;">Your Schedule</h1><p style="color:rgba(255,255,255,0.8);font-size:14px;margin:8px 0 0;">Sample Location • Mon Feb 10 – Sun Feb 16</p></td></tr>` +
        `<tr><td style="padding:24px 40px;"><p style="color:${textColor};font-size:15px;">Hi Team Member,</p><p style="color:${textColor};font-size:15px;line-height:1.7;">Here's your schedule for the upcoming week:</p>` +
        DAY_NAMES.map((d, i) => `<div style="border-bottom:1px solid #eee;padding:12px 0;"><strong style="color:${primaryColor};">${d}</strong><br/><span style="color:${textColor};">${i < 5 ? '9:00 AM – 5:00 PM' : 'OFF'}</span></div>`).join('') +
        `</td></tr>` + getEmailFooter()
      );
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
        <tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;">
          <img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:50px;margin-bottom:12px;filter:brightness(0) invert(1);"/>
          <h1 style="color:#fff;font-size:22px;font-weight:600;margin:0;">📅 Your Schedule</h1>
          <p style="color:rgba(255,255,255,0.9);font-size:14px;margin:8px 0 0;">${locationName} • ${weekLabel}</p>
        </td></tr>
        <tr><td style="padding:30px 40px;">
          <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Hey ${firstName}! Your schedule for the week has been published.</p>
          <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:20px;">
            <table style="width:100%;">${shiftRows}</table>
          </div>
          <div style="text-align:center;margin-bottom:20px;">
            <span style="background:${primaryColor};color:#fff;padding:8px 16px;border-radius:20px;font-size:14px;font-weight:600;">${workingShifts.length} shift${workingShifts.length !== 1 ? 's' : ''} • ${totalHours.toFixed(1)} hours</span>
          </div>
        </td></tr>
        ${getEmailFooter()}
      `);

      try {
        await queueEmail({
          from: "CrooHQ <hello@croohq.email>",
          to: [profile.email],
          subject: `📅 Schedule Published: ${weekLabel} - ${locationName}`,
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
