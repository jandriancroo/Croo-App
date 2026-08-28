// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { requireCaller } from "../_shared/callerAuth.ts";

// Format a UTC timestamp to America/Los_Angeles time string
// ── Business-day window, location timezone + that location's business open ──
// Mirrors src/utils/timezoneUtils.ts getBusinessDayRangeInTimezone: the day starts
// at (close_time + 3h) when that lands in the early morning, otherwise midnight.
// Never hardcode 08:00Z — locations are not all Pacific.
const DEFAULT_CUTOFF_HOUR = 3;

async function getLocationDayContext(supabase: any, locationId: string) {
  const [{ data: settings }, { data: hours }] = await Promise.all([
    supabase.from("location_settings").select("timezone").eq("location_id", locationId).maybeSingle(),
    supabase.from("location_hours").select("day_of_week, close_time").eq("location_id", locationId),
  ]);
  const timezone = settings?.timezone || "America/Los_Angeles";
  const closeByDow = new Map<number, string>();
  for (const h of (hours || [])) {
    if (h.close_time) closeByDow.set(h.day_of_week, h.close_time);
  }
  return { timezone, closeByDow };
}

function tzOffsetMinutes(timezone: string, at: Date): number {
  // Offset (minutes) to add to a local wall-clock time to get UTC.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at).reduce((acc: any, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((at.getTime() - asUTC) / 60000);
}

/** UTC Date for a local wall-clock time in `timezone`. */
function zonedTimeToUtc(dateStr: string, hour: number, timezone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, 0, 0);
  const guess = new Date(naive);
  return new Date(naive + tzOffsetMinutes(timezone, guess) * 60000);
}

function mon0DayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return (new Date(y, m - 1, d, 12, 0, 0).getDay() + 6) % 7;
}

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const nd = new Date(y, m - 1, d + days, 12, 0, 0);
  return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, "0")}-${String(nd.getDate()).padStart(2, "0")}`;
}

/** Start/end (UTC) of the business day for `dateStr` at this location. */
function businessDayRange(
  dateStr: string,
  ctx: { timezone: string; closeByDow: Map<number, string> }
): { start: Date; end: Date } {
  const close = ctx.closeByDow.get(mon0DayOfWeek(dateStr));
  const closeHour = close ? Number(close.split(":")[0]) : -1;
  const cutoff = closeHour >= 0 ? (closeHour + 3) % 24 : DEFAULT_CUTOFF_HOUR;
  const startHour = cutoff > 0 && cutoff < 12 ? cutoff : 0;
  return {
    start: zonedTimeToUtc(dateStr, startHour, ctx.timezone),
    end: zonedTimeToUtc(addDaysStr(dateStr, 1), startHour, ctx.timezone),
  };
}

/**
 * Score filter (Jordan + Ryan rule): an item archived AFTER the period started is
 * still expected — the period keeps the hole. Archived before it, never expected.
 */
function expectedInPeriod(item: any, periodStart: Date): boolean {
  if (!item?.deleted_at) return true;
  return new Date(item.deleted_at).getTime() >= periodStart.getTime();
}

function formatTimePST(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
  } catch {
    return "";
  }
}

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Queue an email for reliable delivery via email_queue table
// Gracefully skips duplicates (dedup constraint violations)
async function queueEmail(opts: { from: string; to: string[]; subject: string; html: string; source: string; dedupKey?: string; metadata?: Record<string, any> }) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { error } = await supabase.from('email_queue').insert({
    from_address: opts.from,
    to_addresses: opts.to,
    subject: opts.subject,
    html: opts.html,
    source: opts.source,
    dedup_key: opts.dedupKey || null,
    metadata: opts.metadata || {},
  });
  if (error) {
    // Duplicate key = already sent, skip gracefully
    if (error.code === '23505') {
      console.log(`[support-email] ⏭️ Already sent (dedup): "${opts.subject}" → ${opts.to.join(', ')}`);
      return;
    }
    console.error(`[support-email] Queue insert failed for "${opts.subject}":`, error);
    throw error;
  }
  console.log(`[support-email] Queued: "${opts.subject}" → ${opts.to.join(', ')}`);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const primaryColor = "#3a8c9b";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";
const containerBg = "#f5f4f1";

const systemFontStack = "'Manrope', -apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const WHITE_LOGO = "https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp";
const TRANSPARENT_LOGO = "https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-transparent.webp";

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:${systemFontStack};"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="width:100%;max-width:720px;margin:0 auto;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

function getUnifiedHeader(title: string): string {
  return `<tr><td style="background:${primaryColor};border-radius:16px 16px 0 0;padding:18px 16px;position:relative;"><div style="position:absolute;left:16px;top:50%;transform:translateY(-50%);"><div style="width:36px;height:36px;background:#fff;border-radius:8px;text-align:center;line-height:36px;"><img src="${WHITE_LOGO}" alt="CrooHQ" style="height:24px;vertical-align:middle;" /></div></div><h1 style="color:#fff;font-size:18px;font-weight:500;margin:0;font-family:${systemFontStack};letter-spacing:-0.2px;text-align:center;padding:8px 0;">${title}</h1></td></tr>`;
}

// Pulse-specific header with brand logo and location info
function getPulseHeader(title: string, brandLogoUrl: string | null, locationName: string, storeNumber: string | null, dateInfo: string): string {
  return `<tr><td style="background:${primaryColor};border-radius:16px 16px 0 0;padding:24px 24px 20px;"><table style="width:100%;border-collapse:collapse;"><tr><td style="vertical-align:middle;text-align:left;">${brandLogoUrl ? `<img src="${brandLogoUrl}" alt="Brand" style="height:40px;width:40px;border-radius:10px;object-fit:contain;background:#fff;" />` : `<div style="width:36px;height:36px;background:#fff;border-radius:8px;text-align:center;line-height:36px;"><img src="${WHITE_LOGO}" alt="CrooHQ" style="height:24px;vertical-align:middle;" /></div>`}</td><td style="vertical-align:middle;text-align:right;"><p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">${locationName}${storeNumber ? ` #${storeNumber}` : ''}</p><p style="color:rgba(255,255,255,0.65);font-size:12px;margin:2px 0 0;font-family:${systemFontStack};">${dateInfo}</p></td></tr></table><h1 style="color:#fff;font-size:22px;font-weight:700;margin:14px 0 0;letter-spacing:0.3px;font-family:${systemFontStack};">${title}</h1></td></tr>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f0ebe1;padding:12px 24px;border-top:1px solid #e8e5df;border-radius:0 0 16px 16px;"><table role="presentation" style="width:100%;"><tr><td style="text-align:left;vertical-align:middle;"><div style="display:inline-flex;align-items:center;gap:6px;"><span style="color:#3a5f7d;font-size:12px;font-weight:400;">Powered by</span><img src="${TRANSPARENT_LOGO}" alt="CrooHQ" style="height:28px;" /></div></td><td style="text-align:right;vertical-align:middle;"><p style="color:#999;font-size:11px;margin:0;">&copy; ${new Date().getFullYear()} Croo. All rights reserved.</p></td></tr></table></td></tr>`;
}

function getCTAButton(url: string, text: string): string {
  return `<div style="text-align:center;"><a href="${url}" style="display:inline-block;background:${accentColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">${text}</a></div>`;
}

// ============ SUPPORT TICKET ACTIONS ============

async function notifySupportTicket(payload: any): Promise<Response> {
  const { ticket_id, event_type, message_content, sender_name, preview } = payload;
  
  // Preview mode - return sample HTML without needing a real ticket
  if (preview) {
    const html = wrapEmail(`
      ${getUnifiedHeader("Support Ticket")}
      <tr><td style="padding:28px 32px;">
        <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Ticket Details</p>
        <div style="background:${containerBg};border-radius:12px;padding:16px 20px;margin-bottom:16px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="vertical-align:top;width:33%;padding:4px 0;">
                <p style="color:#888;font-size:11px;font-weight:500;text-transform:uppercase;margin:0 0 2px;">Ticket</p>
                <p style="color:${primaryColor};font-size:16px;font-weight:700;margin:0;">#SUP-042</p>
              </td>
              <td style="vertical-align:top;width:33%;padding:4px 0;">
                <p style="color:#888;font-size:11px;font-weight:500;text-transform:uppercase;margin:0 0 2px;">Category</p>
                <p style="color:${textColor};font-size:14px;font-weight:600;margin:0;">UI Glitch</p>
              </td>
              <td style="vertical-align:top;width:33%;padding:4px 0;">
                <p style="color:#888;font-size:11px;font-weight:500;text-transform:uppercase;margin:0 0 2px;">From</p>
                <p style="color:${textColor};font-size:14px;font-weight:600;margin:0;">John Doe</p>
              </td>
            </tr>
          </table>
        </div>
        <div style="border-top:1px solid #e8e5df;margin-bottom:16px;"></div>
        <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Description</p>
        <div style="background:${containerBg};border-radius:12px;padding:16px 20px;">
          <p style="color:${textColor};font-size:14px;line-height:1.6;margin:0;">The schedule page flickers when switching between weeks on mobile. Happens consistently on iPhone 15.</p>
        </div>
        <div style="margin-top:24px;">${getCTAButton("https://croohq.com", "View in Croo")}</div>
      </td></tr>
      ${getEmailFooter()}
    `);
    return new Response(JSON.stringify({ html }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (!ticket_id || !event_type) {
    return new Response(JSON.stringify({ error: "ticket_id and event_type required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: ticket, error: ticketError } = await supabase
    .from("support_tickets")
    .select("*, profiles:user_id (full_name, email)")
    .eq("id", ticket_id)
    .single();

  if (ticketError || !ticket) {
    return new Response(JSON.stringify({ error: "Ticket not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const ticketNumber = `#SUP-${String(ticket.ticket_number).padStart(3, '0')}`;
  const userName = ticket.profiles?.full_name || "Unknown User";
  const categoryLabels: Record<string, string> = {
    ui_glitch: 'UI Glitch', broken_feature: 'Broken Feature', login_issues: 'Login Issues',
    data_sync_issues: 'Data/Sync Issues', notification_issues: 'Notification Issues',
    scheduling_issues: 'Scheduling Issues', other: 'Other',
  };
  const categoryLabel = categoryLabels[ticket.category] || ticket.category;

  let emailSubject = "";
  let emailContent = "";
  let pushTitle = "";
  let pushBody = "";

  const fontStack = systemFontStack;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

  switch (event_type) {
    case "new_ticket":
      emailSubject = `New Support Ticket ${ticketNumber} from ${userName}`;
      pushTitle = `New Support Ticket ${ticketNumber}`;
      pushBody = `${userName} reported: ${categoryLabel}`;
      emailContent = `
        <!-- TICKET INFO -->
        <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Ticket Details</p>
        <div style="background:#f5f4f1;border-radius:16px;padding:16px 20px;margin-bottom:16px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="vertical-align:top;width:33%;padding:4px 0;">
                <p style="color:#888;font-size:11px;font-weight:500;text-transform:uppercase;margin:0 0 2px;">Ticket</p>
                <p style="color:${primaryColor};font-size:16px;font-weight:700;margin:0;">${ticketNumber}</p>
              </td>
              <td style="vertical-align:top;width:33%;padding:4px 0;">
                <p style="color:#888;font-size:11px;font-weight:500;text-transform:uppercase;margin:0 0 2px;">Category</p>
                <p style="color:${textColor};font-size:14px;font-weight:600;margin:0;">${categoryLabel}</p>
              </td>
              <td style="vertical-align:top;width:33%;padding:4px 0;">
                <p style="color:#888;font-size:11px;font-weight:500;text-transform:uppercase;margin:0 0 2px;">From</p>
                <p style="color:${textColor};font-size:14px;font-weight:600;margin:0;">${userName}</p>
              </td>
            </tr>
          </table>
        </div>
        <div style="border-top:1px solid #e8e5df;margin-bottom:16px;"></div>
        <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Description</p>
        <div style="background:#f5f4f1;border-radius:16px;padding:16px 20px;border-left:4px solid ${primaryColor};">
          <p style="color:${textColor};font-size:14px;line-height:1.6;margin:0;">${ticket.description}</p>
        </div>
       `;
      break;
    case "new_message":
      emailSubject = `New message on ${ticketNumber} from ${sender_name || userName}`;
      pushTitle = `Message on ${ticketNumber}`;
      pushBody = message_content?.substring(0, 100) || "New message received";
      emailContent = `
        <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">New Message</p>
        <div style="background:#f5f4f1;border-radius:16px;padding:16px 20px;margin-bottom:16px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="vertical-align:top;width:50%;padding:4px 0;">
                <p style="color:#888;font-size:11px;font-weight:500;text-transform:uppercase;margin:0 0 2px;">Ticket</p>
                <p style="color:${primaryColor};font-size:16px;font-weight:700;margin:0;">${ticketNumber}</p>
              </td>
              <td style="vertical-align:top;width:50%;padding:4px 0;">
                <p style="color:#888;font-size:11px;font-weight:500;text-transform:uppercase;margin:0 0 2px;">From</p>
                <p style="color:${textColor};font-size:14px;font-weight:600;margin:0;">${sender_name || userName}</p>
              </td>
            </tr>
          </table>
        </div>
        <div style="border-top:1px solid #e8e5df;margin-bottom:16px;"></div>
        <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Message</p>
        <div style="background:#f5f4f1;border-radius:16px;padding:16px 20px;border-left:4px solid ${primaryColor};">
          <p style="color:${textColor};font-size:14px;line-height:1.6;margin:0;">${message_content || "(no content)"}</p>
        </div>
       `;
      break;
    default:
      return new Response(JSON.stringify({ success: true, message: "No action taken" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

   const emailHtml = wrapEmail(`
     ${getUnifiedHeader("Support Ticket")}
     <tr><td style="padding:28px 32px;">${emailContent}<div style="margin-top:24px;">${getCTAButton("https://croohq.com", "View in Croo")}</div></td></tr>
     ${getEmailFooter()}
   `);

  const SUPPORT_ADMIN_EMAILS = ["jordan@jo-pizza.com"];
  const { data: adminProfiles } = await supabase.from("profiles").select("id, email").in("email", SUPPORT_ADMIN_EMAILS);
  const adminIds = adminProfiles?.map(p => p.id) || [];
  const adminEmails = adminProfiles?.map(p => p.email).filter(Boolean) || [];

  for (const email of adminEmails) {
    try {
      await queueEmail({
        from: "CrooHQ Support <support@croohq.email>",
        to: [email],
        subject: emailSubject,
        html: emailHtml,
        source: 'support_ticket',
        dedupKey: `support_${event_type}_${ticket_id}_${email}`,
      });
    } catch (e) {
      console.error("Error queuing email to", email, e);
    }
  }

  if (adminIds.length > 0) {
    try {
      await supabase.functions.invoke("send-push-notification", {
        body: { user_ids: adminIds, title: pushTitle, body: pushBody, data: { type: "support_ticket", ticketId: ticket.id }, notification_type: "support_tickets" },
      });
    } catch (e) {
      console.error("Error sending push:", e);
    }
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function sendSupportResolution(payload: any): Promise<Response> {
  const { ticketId } = payload;
  if (!ticketId) return new Response(JSON.stringify({ error: "ticketId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: ticket } = await supabase.from("support_tickets").select("*, profiles:user_id (full_name, email)").eq("id", ticketId).single();
  if (!ticket) return new Response(JSON.stringify({ error: "Ticket not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const ticketNumber = `#SUP-${String(ticket.ticket_number).padStart(3, '0')}`;
  const userEmail = ticket.profiles?.email;
  const userName = ticket.profiles?.full_name || "Team Member";
  const firstName = userName.split(' ')[0];

  if (userEmail) {
    await queueEmail({
      from: "CrooHQ Support <support@croohq.email>",
      to: [userEmail],
      subject: `Your support ticket ${ticketNumber} has been resolved`,
      html: wrapEmail(`${getUnifiedHeader("Ticket Resolved")}<tr><td style="padding:30px 40px;"><p style="color:${textColor};font-size:15px;margin:0 0 16px;">Good news, ${firstName}!</p><p style="color:${textColor};font-size:15px;margin:0 0 20px;">Your support ticket <strong style="color:${primaryColor};">${ticketNumber}</strong> has been resolved.</p><div style="background:${containerBg};border-radius:12px;padding:16px 20px;margin-bottom:24px;"><p style="color:#888;font-size:11px;text-transform:uppercase;margin:0 0 8px;font-weight:500;">Original Issue</p><p style="color:${textColor};font-size:14px;margin:0;">${ticket.description}</p></div>${getCTAButton("https://croohq.com", "Open Croo")}</td></tr>${getEmailFooter()}`),
      source: 'support_resolution',
      dedupKey: `support_resolution_${ticketId}`,
    });
  }

  // Send push notification to the ticket owner
  try {
    await supabase.functions.invoke("send-push-notification", {
      body: {
        user_ids: [ticket.user_id],
        title: `Ticket ${ticketNumber} Resolved`,
        body: "Your support ticket has been resolved.",
        notification_type: "support_tickets",
        data: { type: "support_resolved", ticketId: ticket.id },
      },
    });
  } catch (pushErr) {
    console.error("Error sending resolution push notification:", pushErr);
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ============ DAILY LOGBOOK SUMMARY ============

async function sendDailyLogbookSummary(payload: any): Promise<Response> {
  const { location_id, entry_date } = payload;
  
  if (!location_id || !entry_date) {
    return new Response(JSON.stringify({ error: "location_id and entry_date required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Parse entry_date safely to get same-day-last-week and same-day-last-year
  const [yr, mo, dy] = entry_date.split("-").map(Number);
  const entryLocal = new Date(yr, mo - 1, dy);
  const jsDayOfWeek = entryLocal.getDay(); // JS Sunday-start (0=Sun, 5=Fri)
  // Checklist items use Monday-start indexing (0=Mon, 4=Fri, 6=Sun) — convert
  const dayOfWeek = (jsDayOfWeek + 6) % 7;

  const lastWeekDate = new Date(yr, mo - 1, dy - 7);
  const lwStr = `${lastWeekDate.getFullYear()}-${String(lastWeekDate.getMonth() + 1).padStart(2, "0")}-${String(lastWeekDate.getDate()).padStart(2, "0")}`;

  const nextDate = new Date(yr, mo - 1, dy + 1);
  const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}-${String(nextDate.getDate()).padStart(2, "0")}`;

  const lastYearDate = new Date(yr - 1, mo - 1, dy);
  // Find same day-of-week in the previous year (closest match)
  const lyDow = lastYearDate.getDay();
  const diff = dayOfWeek - lyDow;
  lastYearDate.setDate(lastYearDate.getDate() + diff);
  const lyStr = `${lastYearDate.getFullYear()}-${String(lastYearDate.getMonth() + 1).padStart(2, "0")}-${String(lastYearDate.getDate()).padStart(2, "0")}`;

  // Business day boundaries in the LOCATION's timezone + its business open.
  const dayCtx = await getLocationDayContext(supabase, location_id);
  const dayRange = businessDayRange(entry_date, dayCtx);
  const businessDayStartUTC = dayRange.start.toISOString();
  const businessDayEndUTC = dayRange.end.toISOString();

  // Parallel data fetches
  const [
    { data: location },
    { data: salesData },
    { data: compSales },
    { data: laborData },
    { data: locationSettings },
    { data: logbookEntries },
    { data: checklistSubs },
    { data: allChecklistVersions },
    { data: locationUsers },
  ] = await Promise.all([
    supabase.from("locations").select("id, name, organization_id, store_number").eq("id", location_id).single(),
    supabase.from("sales_cache").select("net_sales, guest_count, pizza_count, avg_ticket, projected_sales, override_projection, living_projection, initial_projection, product_mix, yoy_net_sales").eq("location_id", location_id).eq("sale_date", entry_date).maybeSingle(),
    supabase.from("sales_cache").select("sale_date, net_sales").eq("location_id", location_id).in("sale_date", [lwStr, lyStr]),
    supabase.from("labor_cache").select("labor_hours, labor_cost").eq("location_id", location_id).eq("labor_date", entry_date),
    supabase.from("location_settings").select("labor_percentage_target").eq("location_id", location_id).maybeSingle(),
    supabase.from("logbook_entries").select(`id, entry_date, created_at, category:category_id (name), created_by_profile:created_by (full_name)`).eq("location_id", location_id).eq("entry_date", entry_date),
    // Use business day boundaries matching app's getBusinessDayRangeInTimezone
    supabase.from("checklist_submissions").select("id, checklist_id, submitted_at, submitted_by_profile:submitted_by (full_name)").eq("location_id", location_id).gte("submitted_at", businessDayStartUTC).lt("submitted_at", businessDayEndUTC),
    supabase.from("checklists").select("id, title, frequency, template_type, is_active, family_id, replaces_checklist_id, superseded_at, checklist_items(id, days_of_week, deleted_at)").eq("location_id", location_id),
    supabase.from("user_locations").select("user_id").eq("location_id", location_id),
  ]);

  // Closed-period reporting ignores is_active: a version swapped out after this
  // period started still owns it. Pending drafts never count.
  const activeChecklists = (allChecklistVersions || []).filter((c: any) =>
    wasLiveDuringPeriod(c, new Date(businessDayStartUTC))
  );


  if (!location) {
    return new Response(JSON.stringify({ error: "Location not found", success: false }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Fetch brand logo — prefer locations.brand_id, fall back to organization → brand
  let brandLogoUrl: string | null = null;
  let brandIdForLogo: string | null = (location as any)?.brand_id ?? null;
  if (!brandIdForLogo && location.organization_id) {
    const { data: org } = await supabase.from("organizations").select("brand_id").eq("id", location.organization_id).maybeSingle();
    brandIdForLogo = org?.brand_id ?? null;
  }
  if (brandIdForLogo) {
    const { data: brand } = await supabase.from("brands").select("logo_url").eq("id", brandIdForLogo).maybeSingle();
    brandLogoUrl = brand?.logo_url || null;
  }


  // Get cash handling logbook entry values
  const cashCategories = ["Drawer Count", "Safe Count", "Bank Deposit"];
  const cashEntries = (logbookEntries || []).filter((e: any) => cashCategories.includes(e.category?.name));
  let cashDetails: { category: string; author: string; fields: { name: string; value: string }[] }[] = [];
  
  if (cashEntries.length > 0) {
    const entryIds = cashEntries.map((e: any) => e.id);
    const { data: entryValues } = await supabase
      .from("logbook_entry_values")
      .select("entry_id, value_text, value_number, field:field_id (field_name)")
      .in("entry_id", entryIds);
    
    cashDetails = cashEntries.map((entry: any) => {
      const vals = (entryValues || []).filter((v: any) => v.entry_id === entry.id);
      const fields: { name: string; value: string }[] = [];
      
      for (const v of vals) {
        const fieldName = v.field?.field_name || "";
        if (fieldName.includes("_data") && v.value_text) {
          try {
            const parsed = JSON.parse(v.value_text);
            if (parsed.totalSafe !== undefined) fields.push({ name: "Total Safe", value: `$${Number(parsed.totalSafe).toLocaleString()}` });
            if (parsed.difference !== undefined) fields.push({ name: "Difference", value: `$${Number(parsed.difference).toLocaleString()}` });
            if (parsed.shift) fields.push({ name: "Shift", value: parsed.shift });
            if (parsed.totalDrawer !== undefined) fields.push({ name: "Total Drawer", value: `$${Number(parsed.totalDrawer).toLocaleString()}` });
            if (parsed.actualDeposit !== undefined) fields.push({ name: "Actual Deposit", value: `$${Number(parsed.actualDeposit).toLocaleString()}` });
            if (parsed.expectedDeposit !== undefined) fields.push({ name: "Expected Deposit", value: `$${Number(parsed.expectedDeposit).toLocaleString()}` });
            if (parsed.variance !== undefined) fields.push({ name: "Variance", value: `$${Number(parsed.variance).toLocaleString()}` });
          } catch {}
        } else if (v.value_number !== null && v.value_number !== undefined) {
          fields.push({ name: fieldName, value: `$${Number(v.value_number).toLocaleString()}` });
        } else if (v.value_text) {
          fields.push({ name: fieldName, value: v.value_text });
        }
      }
      return { category: entry.category?.name || "Cash", author: entry.created_by_profile?.full_name || "Unknown", completedAt: entry.created_at, fields };
    });
  }

  // Recipients - managers and above
  const userIds = (locationUsers || []).map((u: any) => u.user_id);
  const managerRoles = ["admin", "org_admin", "super_admin", "manager", "general_manager"];
  let eligibleRecipients: { id: string; email: string; full_name: string }[] = [];

  if (userIds.length > 0) {
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name").in("id", userIds),
      supabase.from("user_roles").select("user_id, role").in("user_id", userIds),
    ]);
    const roleMap = new Map((roles || []).map((r: any) => [r.user_id, r.role]));
    eligibleRecipients = (profiles || []).filter((p: any) => {
      const role = roleMap.get(p.id);
      return managerRoles.includes(role) && p.email;
    });
  }

  console.log(`[DAILY-SUMMARY] Location ${location?.name}: ${eligibleRecipients.length} eligible recipients`);

  if (eligibleRecipients.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No eligible recipients", recipientCount: 0 }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ---- Calculations ----
  const netSales = salesData?.net_sales || 0;
  const projection = salesData?.override_projection || salesData?.living_projection || salesData?.initial_projection || salesData?.projected_sales || 0;
  const projVariance = projection > 0 ? ((netSales - projection) / projection * 100) : 0;
  const projVarianceStr = projVariance.toFixed(1);
  const projColor = projVariance >= 0 ? "#22c55e" : "#ef4444";
  const projDiff = netSales - projection;

  // Last week & last year comparisons
  const lwSales = (compSales || []).find((s: any) => s.sale_date === lwStr)?.net_sales || 0;
  const lySales = salesData?.yoy_net_sales || (compSales || []).find((s: any) => s.sale_date === lyStr)?.net_sales || 0;
  const lwPct = lwSales > 0 ? ((netSales - lwSales) / lwSales * 100).toFixed(1) : null;
  const lyPct = lySales > 0 ? ((netSales - lySales) / lySales * 100).toFixed(1) : null;

  // Labor
  const totalLaborHours = laborData?.reduce((sum: number, l: any) => sum + (l.labor_hours || 0), 0) || 0;
  const totalLaborCost = laborData?.reduce((sum: number, l: any) => sum + (l.labor_cost || 0), 0) || 0;
  const laborPercent = netSales > 0 ? (totalLaborCost / netSales * 100) : 0;
  const laborGoal = locationSettings?.labor_percentage_target || 25;
  const laborGoalDollars = netSales * (laborGoal / 100);
  const laborOverUnder = totalLaborCost - laborGoalDollars;
  const laborColor = laborPercent <= laborGoal ? "#22c55e" : "#ef4444";

  // Top 5 items from product_mix
  let topItems: { name: string; qty: number; sales: number }[] = [];
  if (salesData?.product_mix && Array.isArray(salesData.product_mix)) {
    topItems = (salesData.product_mix as any[])
      .filter((i: any) => (i.sales || i.netSales || 0) > 0)
      .sort((a: any, b: any) => (b.sales || b.netSales || 0) - (a.sales || a.netSales || 0))
      .slice(0, 5)
      .map((i: any) => ({ name: i.name || i.itemName || "Item", qty: i.quantity || i.qty || 0, sales: i.sales || i.netSales || 0 }));
  }

  // Checklists: match submissions to active daily + dynamic checklists (dynamic may have frequency="weekly" but template_type="dynamic")
  const dailyChecklists = (activeChecklists || []).filter((c: any) => c.frequency === "daily" || c.template_type === "dynamic");
  const checklistMap = new Map((activeChecklists || []).map((c: any) => [c.id, c.title]));
  const completedIds = new Set((checklistSubs || []).map((s: any) => s.checklist_id));
  
  // Build set of active item IDs per checklist for today's day of week
  // Dynamic checklists: only items with days_of_week matching today
  // Regular daily checklists: all items (null days_of_week = every day)
  const checklistItemCounts: Record<string, number> = {};
  const activeItemIds = new Set<string>();
  const checklistTypeMap = new Map((activeChecklists || []).map((c: any) => [c.id, c.template_type]));
  for (const c of (activeChecklists || [])) {
    // Score view: keep items archived after this business day started (the hole stays).
    const items = (c.checklist_items || []).filter((i: any) => expectedInPeriod(i, dayRange.start));
    const isDynamic = c.template_type === "dynamic";
    const todayItems = isDynamic
      ? items.filter((i: any) => i.days_of_week && i.days_of_week.includes(dayOfWeek))
      : items; // Regular checklists: all items are active every day
    checklistItemCounts[c.id] = todayItems.length;
    for (const i of todayItems) activeItemIds.add(i.id);
  }

  // Fetch ALL responses for submissions (same as app — count all, cap at itemCount)
  const subIds = (checklistSubs || []).map((s: any) => s.id);
  const checklistCompleters: Record<string, Set<string>> = {};
  const checklistLatestResponse: Record<string, { full_name: string; created_at: string }> = {};
  const checklistResponseCounts: Record<string, number> = {};
  const checklistLastSub: Record<string, any> = {};

  if (subIds.length > 0) {
    // No FK from completed_by → profiles, so query responses without join
    const { data: responses, error: respErr } = await supabase
      .from("checklist_responses")
      .select("submission_id, item_id, created_at, completed_by")
      .in("submission_id", subIds);
    if (respErr) console.error("[DAILY-SUMMARY] Response query error:", respErr);

    // Collect unique completer IDs to look up names
    const completerIds = new Set<string>();
    if (responses) {
      for (const r of responses) {
        if (r.completed_by) completerIds.add(r.completed_by);
      }
    }
    // Fetch completer names
    const completerNameMap = new Map<string, string>();
    if (completerIds.size > 0) {
      const { data: completerProfiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(completerIds));
      for (const p of (completerProfiles || [])) {
        if (p.full_name) completerNameMap.set(p.id, p.full_name);
      }
    }

    if (responses) {
      for (const r of responses) {
        const sub = (checklistSubs || []).find((s: any) => s.id === r.submission_id);
        if (!sub) continue;
        const cid = sub.checklist_id;

        // Numerator lives in the same universe as the denominator (expected items
        // for this day), so archiving can never push the % past 100.
        if (!r.item_id || activeItemIds.has(r.item_id)) {
          checklistResponseCounts[cid] = (checklistResponseCounts[cid] || 0) + 1;
        }

        const completerName = r.completed_by ? completerNameMap.get(r.completed_by) : null;
        if (completerName) {
          if (!checklistCompleters[cid]) checklistCompleters[cid] = new Set();
          checklistCompleters[cid].add(completerName);
          if (!checklistLatestResponse[cid] || r.created_at > checklistLatestResponse[cid].created_at) {
            checklistLatestResponse[cid] = { full_name: completerName, created_at: r.created_at };
          }
        }
      }
    }
  }

  // Track latest submission per checklist
  for (const sub of (checklistSubs || [])) {
    const cid = sub.checklist_id;
    if (!checklistLastSub[cid] || sub.submitted_at > checklistLastSub[cid].submitted_at) {
      checklistLastSub[cid] = sub;
    }
  }

  const seenChecklistIds = new Set<string>();
  const checklistRows: { title: string; completed: boolean; completers: string[]; submittedAt: string | null; itemsCompleted: number; itemsTotal: number; pct: number }[] = [];
  
  for (const c of dailyChecklists) {
    if (seenChecklistIds.has(c.id)) continue;
    seenChecklistIds.add(c.id);
    const completed = completedIds.has(c.id);
    const lastSub = checklistLastSub[c.id];
    const latestResp = checklistLatestResponse[c.id];
    const totalItems = checklistItemCounts[c.id] || 0;
    const completedItems = Math.min(checklistResponseCounts[c.id] || 0, totalItems);
    const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : (completed ? 100 : 0);
    const completers = checklistCompleters[c.id] ? Array.from(checklistCompleters[c.id]) : (lastSub?.submitted_by_profile?.full_name ? [lastSub.submitted_by_profile.full_name] : []);
    checklistRows.push({ title: c.title, completed, completers, submittedAt: latestResp?.created_at || lastSub?.submitted_at || null, itemsCompleted: completedItems, itemsTotal: totalItems, pct });
  }
  for (const sub of (checklistSubs || [])) {
    if (!seenChecklistIds.has(sub.checklist_id)) {
      seenChecklistIds.add(sub.checklist_id);
      const totalItems = checklistItemCounts[sub.checklist_id] || 0;
      const completedItems = Math.min(checklistResponseCounts[sub.checklist_id] || 0, totalItems);
      const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 100;
      const latestResp = checklistLatestResponse[sub.checklist_id];
      const completers = checklistCompleters[sub.checklist_id] ? Array.from(checklistCompleters[sub.checklist_id]) : (checklistLastSub[sub.checklist_id]?.submitted_by_profile?.full_name ? [checklistLastSub[sub.checklist_id].submitted_by_profile.full_name] : []);
      checklistRows.push({
        title: checklistMap.get(sub.checklist_id) || "Checklist",
        completed: true,
        completers,
        submittedAt: latestResp?.created_at || checklistLastSub[sub.checklist_id]?.submitted_at || null,
        itemsCompleted: completedItems,
        itemsTotal: totalItems,
        pct,
      });
    }
  }

  // Non-cash logbook entries
  const logEntries = (logbookEntries || []).filter((e: any) => !cashCategories.includes(e.category?.name));

  // Format date - computed below using parsed yr/mo/dy to avoid timezone bugs

  // Helper for comparison badges
  const compBadge = (pct: string | null, label: string) => {
    if (pct === null) return `<span style="color:#999;font-size:12px;">${label}: N/A</span>`;
    const n = parseFloat(pct);
    const c = n >= 0 ? "#22c55e" : "#ef4444";
    const arrow = n >= 0 ? "▲" : "▼";
    return `<span style="color:${c};font-size:13px;font-weight:600;">${arrow} ${n >= 0 ? "+" : ""}${pct}% ${label}</span>`;
  };

  // ---- Build Email HTML ----
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dayNamesShort = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const monthNamesShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const shortDate = `${dayNamesShort[jsDayOfWeek]}, ${monthNamesShort[mo - 1]} ${dy}`;
  const displayDate = `${dayNames[jsDayOfWeek]}, ${monthNames[mo - 1]} ${dy}, ${yr}`;
  const completedCount = checklistRows.filter(c => c.completed).length;
  const totalChecklists = checklistRows.length;

  // System font - Manrope
  const fontStack = "'Manrope', -apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  // Wider daily summary email with clean Croo branding
  // Build checklist rows HTML - compact table style matching preview
  const checklistRowsHtml = checklistRows.length > 0 ? `<table style="width:100%;border-collapse:collapse;background:#f5f4f1;border-radius:12px;overflow:hidden;">
    ${checklistRows.map((c, i) => {
      const timeStr = c.submittedAt ? formatTimePST(c.submittedAt) : "";
      const statusIcon = c.pct >= 100
        ? `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#22c55e;text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">✓</span>`
        : `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#ef4444;text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">✗</span>`;
      const itemsColor = c.pct >= 100 ? '#22c55e' : '#ef4444';
      const statusText = c.completed ? (c.completers.length > 0 ? c.completers.join(', ') : '') : '<span style="color:#ef4444;">Not Started</span>';
      const border = i < checklistRows.length - 1 ? 'border-bottom:1px solid #e8e5df;' : '';
      return `<tr style="${border}">
        <td style="padding:8px 12px;width:20px;">${statusIcon}</td>
        <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">${c.title}</span></td>
        <td style="padding:8px 4px;text-align:right;"><span style="font-size:11px;color:${itemsColor};font-weight:600;">${c.itemsCompleted}/${c.itemsTotal}</span></td>
        <td style="padding:8px 12px;text-align:right;"><span style="font-size:11px;color:#888;">${timeStr ? `${statusText ? statusText.replace(/<[^>]*>/g, '') + ' · ' : ''}${timeStr}` : statusText}</span></td>
      </tr>`;
    }).join("")}
  </table>` : `<p style="color:#888;font-size:13px;margin:0;">None scheduled</p>`;

  // Build cash handling rows HTML - compact table style
  const cashRowsHtml = (() => {
    const rows: string[] = [];
    const safeCounts = cashDetails.filter(c => c.category === "Safe Count");
    const drawerCounts = cashDetails.filter(c => c.category === "Drawer Count");
    const bankDeposits = cashDetails.filter(c => c.category === "Bank Deposit");

    for (const c of safeCounts) {
      const shiftField = c.fields.find(f => f.name === "Shift");
      const shiftVal = shiftField?.value || "AM";
      const completedTime = c.completedAt ? formatTimePST(c.completedAt) : "";
      rows.push(`<tr style="border-bottom:1px solid #e8e5df;">
        <td style="padding:8px 12px;width:20px;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#22c55e;text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">✓</span></td>
        <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">Safe Count — ${shiftVal}</span></td>
        <td style="padding:8px 4px;text-align:right;"><span style="font-size:11px;color:#22c55e;font-weight:600;">Completed</span></td>
        <td style="padding:8px 12px;text-align:right;"><span style="font-size:11px;color:#888;">${c.author}${completedTime ? ` · ${completedTime}` : ""}</span></td>
      </tr>`);
    }
    if (safeCounts.length === 0) {
      rows.push(`<tr style="border-bottom:1px solid #e8e5df;">
        <td style="padding:8px 12px;width:20px;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#ef4444;text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">✗</span></td>
        <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">Safe Count</span></td>
        <td style="padding:8px 4px;text-align:right;"><span style="font-size:11px;color:#ef4444;font-weight:600;">Not Completed</span></td>
        <td style="padding:8px 12px;text-align:right;"></td>
      </tr>`);
    }

    for (const c of drawerCounts) {
      const varianceField = c.fields.find(f => f.name === "Variance") || c.fields.find(f => f.name === "Difference");
      const varianceNum = varianceField ? parseFloat(varianceField.value.replace(/[^0-9.-]/g, '')) : 0;
      const varianceColor = varianceNum >= 0 ? '#22c55e' : '#ef4444';
      const varianceStr = varianceNum >= 0 ? `+$${Math.abs(varianceNum).toFixed(2)}` : `-$${Math.abs(varianceNum).toFixed(2)}`;
      const statusIcon = Math.abs(varianceNum) > 10
        ? `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#f59e0b;text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">!</span>`
        : `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#22c55e;text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">✓</span>`;
      const completedTime = c.completedAt ? formatTimePST(c.completedAt) : "";
      rows.push(`<tr style="border-bottom:1px solid #e8e5df;">
        <td style="padding:8px 12px;width:20px;">${statusIcon}</td>
        <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">Drawer Count</span></td>
        <td style="padding:8px 4px;text-align:right;"><span style="font-size:11px;color:${varianceColor};font-weight:600;">${varianceStr}</span></td>
        <td style="padding:8px 12px;text-align:right;"><span style="font-size:11px;color:#888;">${c.author}${completedTime ? ` · ${completedTime}` : ""}</span></td>
      </tr>`);
    }
    if (drawerCounts.length === 0) {
      rows.push(`<tr style="border-bottom:1px solid #e8e5df;">
        <td style="padding:8px 12px;width:20px;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#ef4444;text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">✗</span></td>
        <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">Drawer Count</span></td>
        <td style="padding:8px 4px;text-align:right;"><span style="font-size:11px;color:#ef4444;font-weight:600;">Not Completed</span></td>
        <td style="padding:8px 12px;text-align:right;"></td>
      </tr>`);
    }

    for (const c of bankDeposits) {
      const amountField = c.fields.find(f => f.name !== "Shift");
      const completedTime = c.completedAt ? formatTimePST(c.completedAt) : "";
      rows.push(`<tr>
        <td style="padding:8px 12px;width:20px;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#22c55e;text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">✓</span></td>
        <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">Bank Deposit</span></td>
        <td style="padding:8px 4px;text-align:right;"><span style="font-size:11px;color:${textColor};font-weight:600;">${amountField?.value || ""}</span></td>
        <td style="padding:8px 12px;text-align:right;"><span style="font-size:11px;color:#888;">${c.author}${completedTime ? ` · ${completedTime}` : ""}</span></td>
      </tr>`);
    }

    if (rows.length === 0) return '';
    // Remove trailing border from last row
    const lastIdx = rows.length - 1;
    rows[lastIdx] = rows[lastIdx].replace('border-bottom:1px solid #e8e5df;', '');
    return `<table style="width:100%;border-collapse:collapse;background:#f5f4f1;border-radius:12px;overflow:hidden;">${rows.join("")}</table>`;
  })();

  // Build logbook entries HTML - two-row compact style
  const logEntriesHtml = logEntries.length > 0 ? `<table style="width:100%;border-collapse:collapse;background:#f5f4f1;border-radius:12px;overflow:hidden;">
    ${logEntries.map((e: any, i: number) => {
      const timeStr = e.created_at ? formatTimePST(e.created_at) : "";
      const categoryName = e.category?.name || "Entry";
      const authorName = e.created_by_profile?.full_name || "";
      const border = i < logEntries.length - 1 ? 'border-bottom:1px solid #e8e5df;' : '';
      const icon = categoryName.toLowerCase().includes('complaint') ? '!' : categoryName.toLowerCase().includes('equipment') ? '⚙' : '📝';
      const iconBg = categoryName.toLowerCase().includes('complaint') ? '#ef4444' : categoryName.toLowerCase().includes('equipment') ? '#f59e0b' : primaryColor;
      return `<tr style="${border}">
        <td style="padding:8px 12px;width:20px;vertical-align:top;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${iconBg};text-align:center;line-height:18px;color:#fff;font-size:10px;font-weight:700;">${icon}</span></td>
        <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">${categoryName}</span></td>
        <td style="padding:8px 12px;text-align:right;"><span style="font-size:11px;color:#888;">${authorName}${timeStr ? ` · ${timeStr}` : ""}</span></td>
      </tr>`;
    }).join("")}
  </table>` : '';

  const emailHtml = wrapEmail(`
    ${getPulseHeader("Daily Pulse", brandLogoUrl, location.name, location.store_number, displayDate)}
    <tr><td style="padding:24px;">

      <!-- SALES + LABOR ROW -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="vertical-align:top;width:50%;padding-right:20px;">
            <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Sales</p>
            <p style="margin:0;"><strong style="color:${textColor};font-size:28px;">$${netSales.toLocaleString()}</strong></p>
            <p style="color:#888;font-size:13px;margin:4px 0 0;">Target: $${projection.toLocaleString()} (<span style="color:${projColor};font-weight:600;">${projDiff >= 0 ? "+" : ""}$${Math.abs(projDiff).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>)</p>
            <table style="margin-top:8px;"><tr>
              <td style="padding-right:16px;">${compBadge(lwPct, "LW")}</td>
              <td>${compBadge(lyPct, "LY")}</td>
            </tr></table>
          </td>
          <td style="vertical-align:top;width:50%;text-align:right;border-left:1px solid #e8e5df;padding-left:20px;">
            <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Labor</p>
            <p style="margin:0;"><strong style="color:${laborColor};font-size:28px;">${laborPercent.toFixed(1)}%</strong></p>
            <p style="color:#888;font-size:13px;margin:4px 0 0;">$${totalLaborCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} &middot; ${totalLaborHours.toFixed(1)}h</p>
            <p style="color:${laborColor};font-size:13px;font-weight:600;margin:4px 0 0;">${laborOverUnder > 0 ? "+" : "-"}$${Math.abs(laborOverUnder).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} vs ${laborGoal}% goal</p>
          </td>
        </tr>
      </table>

      <div style="border-top:1px solid #e8e5df;margin-bottom:20px;"></div>

      <!-- CHECKLISTS -->
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Checklists ${completedCount}/${totalChecklists}</p>
      ${checklistRowsHtml}

      <div style="border-top:1px solid #e8e5df;margin:20px 0;"></div>

      <!-- CASH HANDLING -->
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Cash Handling</p>
      ${cashRowsHtml || `<p style="color:#888;font-size:13px;margin:0;">No entries</p>`}

      ${logEntries.length > 0 ? `
      <div style="border-top:1px solid #e8e5df;margin:20px 0;"></div>
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Logbook ${logEntries.length} ${logEntries.length === 1 ? 'entry' : 'entries'}</p>
      ${logEntriesHtml}
      ` : ""}

      ${topItems.length > 0 ? `
      <div style="border-top:1px solid #e8e5df;margin:20px 0;"></div>
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Top Items by Sales</p>
      <table style="width:100%;border-collapse:collapse;">
        ${topItems.map((item, i) => `
        <tr style="border-bottom:1px solid #f0ebe1;">
          <td style="padding:6px 0;color:${primaryColor};font-weight:700;font-size:14px;width:24px;">${i + 1}</td>
          <td style="padding:6px 0;color:${textColor};font-size:13px;">${item.name}</td>
          <td style="padding:6px 0;color:#888;font-size:13px;text-align:center;width:50px;">${item.qty}</td>
          <td style="padding:6px 0;color:${textColor};font-size:13px;text-align:right;font-weight:600;width:70px;">$${item.sales.toLocaleString()}</td>
        </tr>`).join("")}
      </table>
      ` : `
      <div style="border-top:1px solid #e8e5df;margin:20px 0;"></div>
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Top Items by Sales</p>
      <p style="color:#888;font-size:13px;margin:0;">No sales data available</p>
      `}

    </td></tr>
    ${getEmailFooter()}
  `);

  // If preview mode, return HTML without sending
  if (payload.preview) {
    return new Response(JSON.stringify({ success: true, html: emailHtml }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Send to all eligible recipients
  let sentCount = 0;
  for (const recipient of eligibleRecipients) {
    try {
      const isTest = payload.test === true;
      await queueEmail({
        from: "CrooHQ <reports@croohq.email>",
        to: [recipient.email],
        subject: `${isTest ? '[TEST] ' : ''}Daily Pulse: ${location.name} - ${shortDate}`,
        html: emailHtml,
        source: isTest ? 'test_preview' : 'daily_summary',
        dedupKey: isTest ? `test_${Date.now()}_${recipient.email}` : `daily_summary_v5_${location_id}_${entry_date}_${recipient.email}`,
      });
      sentCount++;
    } catch (e) {
      console.error("Error queuing daily summary for", (recipient as any).email, e);
    }
  }

  // Log the send
  await supabase
    .from("daily_summary_logs")
    .upsert({
      location_id,
      summary_date: entry_date,
      recipient_count: sentCount,
    }, { onConflict: "location_id,summary_date" });

  return new Response(JSON.stringify({ success: true, recipientCount: sentCount }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ============ TEST EMAIL ============

async function sendTestEmail(payload: any): Promise<Response> {
  const { to, subject = "Welcome to Croo!" } = payload;
  if (!to) return new Response(JSON.stringify({ error: "to required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const emailResponse = await resend.emails.send({
    from: "CrooHQ <hello@croohq.email>",
    to: [to],
    subject,
    html: wrapEmail(`<tr><td style="background:${primaryColor};padding:40px;text-align:center;"><img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:80px;margin-bottom:16px;"/><h1 style="color:#fff;font-size:28px;margin:0;">Welcome to Croo!</h1></td></tr><tr><td style="padding:40px;"><p style="color:${textColor};font-size:16px;">Hey there! 👋</p><p style="color:${textColor};font-size:16px;">This is a test email from <strong style="color:${primaryColor};">Croo</strong>.</p></td></tr>`),
  });

  return new Response(JSON.stringify({ success: true, data: emailResponse }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

// ============ BATCH TEST EMAILS ============

async function sendAllTestEmails(payload: any): Promise<Response> {
  const { to } = payload;
  
  if (!to) {
    throw new Error("Email address is required");
  }

  console.log(`Sending all test emails to: ${to}`);

  const testEmails = [
    {
      subject: '💬 New message from Sarah Johnson',
      html: () => wrapEmail(`
        ${getUnifiedHeader('New Chat Message')}
        <tr><td style="padding:24px;">
          <p style="color:${textColor};font-size:14px;line-height:1.6;margin:0 0 12px;">
            <strong style="color:${primaryColor};">Sarah Johnson</strong> sent you a message in <strong>Hemet Team Chat</strong>:
          </p>
          <div style="background:${containerBg};border-radius:12px;padding:16px;margin:0 0 12px;border-left:4px solid ${primaryColor};">
            <p style="color:${textColor};font-size:13px;line-height:1.5;margin:0;font-style:italic;">"Hey! Can you cover my shift tomorrow? I have a doctor's appointment 🙏"</p>
          </div>
          <p style="color:#888;font-size:12px;margin:0;">Tap below to view and reply.</p>
        </td></tr>
        ${getEmailFooter()}
      `)
    },
    {
      subject: '📢 New Announcement: Holiday Schedule Update',
      html: () => wrapEmail(`
        ${getUnifiedHeader('New Announcement')}
        <tr><td style="padding:24px;">
          <h2 style="color:${textColor};font-size:16px;font-weight:700;margin:0 0 12px;">Holiday Schedule Update</h2>
          <div style="background:${containerBg};border-radius:12px;padding:16px;margin:0 0 12px;">
            <p style="color:${textColor};font-size:13px;line-height:1.6;margin:0;">Quick reminder: We'll be running special holiday hours next week. Please check your schedule carefully and let me know if you have any conflicts. Thanks team! 🎄</p>
          </div>
          <p style="color:#888;font-size:12px;margin:0;">Posted by <strong>Mike Thompson</strong> at Hemet</p>
        </td></tr>
        ${getEmailFooter()}
      `)
    },
    {
      subject: '📅 Schedule Update: New shift added',
      html: () => wrapEmail(`
        ${getUnifiedHeader('Schedule Update')}
        <tr><td style="padding:24px;">
          <p style="color:${textColor};font-size:14px;line-height:1.6;margin:0 0 12px;">A new shift has been added to your schedule.</p>
          <div style="background:${containerBg};border-radius:12px;padding:16px;margin:0 0 12px;">
            <table role="presentation" style="width:100%;">
              <tr><td style="padding:6px 0;"><span style="color:#888;font-size:11px;text-transform:uppercase;">Date</span><br/><strong style="color:${textColor};font-size:14px;">Monday, January 13, 2026</strong></td></tr>
              <tr><td style="padding:6px 0;"><span style="color:#888;font-size:11px;text-transform:uppercase;">Time</span><br/><strong style="color:${textColor};font-size:14px;">9:00 AM - 5:00 PM</strong></td></tr>
              <tr><td style="padding:6px 0;"><span style="color:#888;font-size:11px;text-transform:uppercase;">Position</span><br/><strong style="color:${textColor};font-size:14px;">Shift Leader</strong></td></tr>
            </table>
          </div>
          <p style="color:#888;font-size:12px;margin:0;">Check the app to view your full schedule.</p>
        </td></tr>
        ${getEmailFooter()}
      `)
    },
  ];

  const results = [];
  
  // Send emails with a small delay between each
  for (let i = 0; i < testEmails.length; i++) {
    const email = testEmails[i];
    
    try {
      const emailResponse = await resend.emails.send({
        from: "CrooHQ <hello@croohq.email>",
        to: [to],
        subject: `[TEST ${i + 1}/${testEmails.length}] ${email.subject}`,
        html: email.html(),
      });
      
      results.push({ subject: email.subject, success: true, id: emailResponse.data?.id });
      console.log(`Sent email ${i + 1}: ${email.subject}`);
      
      // Small delay to avoid rate limiting
      if (i < testEmails.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error: any) {
      results.push({ subject: email.subject, success: false, error: error.message });
      console.error(`Failed to send email ${i + 1}: ${error.message}`);
    }
  }

  return new Response(JSON.stringify({ 
    success: true, 
    total: testEmails.length,
    results 
  }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// ============ WEEKLY SUMMARY EMAIL ============

async function sendWeeklySummaryEmail(payload: any): Promise<Response> {
  const { location_id, week_start, week_end, preview } = payload;

  if (!location_id || !week_start || !week_end) {
    return new Response(JSON.stringify({ error: "location_id, week_start, and week_end required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Parse dates
  const [sYr, sMo, sDy] = week_start.split("-").map(Number);
  const [eYr, eMo, eDy] = week_end.split("-").map(Number);

  // Generate date range
  const weekDates: string[] = [];
  const startD = new Date(sYr, sMo - 1, sDy);
  const endD = new Date(eYr, eMo - 1, eDy);
  const cur = new Date(startD);
  while (cur <= endD) {
    weekDates.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`);
    cur.setDate(cur.getDate() + 1);
  }

  // Parallel data fetches
  const [
    { data: location },
    { data: salesRows },
    { data: laborRows },
    { data: locationSettings },
    { data: allChecklistVersions },
    { data: logbookEntries },
  ] = await Promise.all([
    supabase.from("locations").select("id, name, organization_id, store_number").eq("id", location_id).single(),
    supabase.from("sales_cache").select("sale_date, net_sales, guest_count, pizza_count, projected_sales, override_projection, living_projection, initial_projection").eq("location_id", location_id).gte("sale_date", week_start).lte("sale_date", week_end),
    supabase.from("labor_cache").select("labor_date, labor_hours, labor_cost").eq("location_id", location_id).gte("labor_date", week_start).lte("labor_date", week_end),
    supabase.from("location_settings").select("labor_percentage_target").eq("location_id", location_id).maybeSingle(),
    supabase.from("checklists").select("id, title, frequency, template_type, is_active, family_id, replaces_checklist_id, superseded_at, checklist_items(id, days_of_week, deleted_at)").eq("location_id", location_id),
    supabase.from("logbook_entries").select("id, entry_date, created_at, category:category_id (name), created_by_profile:created_by (full_name)").eq("location_id", location_id).gte("entry_date", week_start).lte("entry_date", week_end),
  ]);

  // Monday morning's prior-week summary must still see a version swapped out at open.
  const activeChecklists = (allChecklistVersions || []).filter((c: any) =>
    wasLiveDuringPeriod(c, new Date(`${week_start}T00:00:00Z`))
  );


  if (!location) {
    return new Response(JSON.stringify({ error: "Location not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Brand logo — prefer locations.brand_id, fall back to organization → brand
  let brandLogoUrl: string | null = null;
  let brandIdForLogo: string | null = (location as any)?.brand_id ?? null;
  if (!brandIdForLogo && location.organization_id) {
    const { data: org } = await supabase.from("organizations").select("brand_id").eq("id", location.organization_id).maybeSingle();
    brandIdForLogo = org?.brand_id ?? null;
  }
  if (brandIdForLogo) {
    const { data: brand } = await supabase.from("brands").select("logo_url").eq("id", brandIdForLogo).maybeSingle();
    brandLogoUrl = brand?.logo_url || null;
  }


  // ---- Aggregate Sales ----
  let totalSales = 0;
  let totalGuests = 0;
  let totalPizzas = 0;
  let totalProjection = 0;
  const dailySales: { date: string; sales: number; projection: number }[] = [];

  for (const dateStr of weekDates) {
    const row = (salesRows || []).find((r: any) => r.sale_date === dateStr);
    const sales = row?.net_sales || 0;
    const proj = row?.override_projection || row?.living_projection || row?.initial_projection || row?.projected_sales || 0;
    totalSales += sales;
    totalGuests += row?.guest_count || 0;
    totalPizzas += row?.pizza_count || 0;
    totalProjection += proj;
    dailySales.push({ date: dateStr, sales, projection: proj });
  }

  const projVariance = totalProjection > 0 ? ((totalSales - totalProjection) / totalProjection * 100) : 0;
  const projDiff = totalSales - totalProjection;
  const projColor = projDiff >= 0 ? "#22c55e" : "#ef4444";

  // ---- Aggregate Labor ----
  const totalLaborHours = (laborRows || []).reduce((sum: number, l: any) => sum + (l.labor_hours || 0), 0);
  const totalLaborCost = (laborRows || []).reduce((sum: number, l: any) => sum + (l.labor_cost || 0), 0);
  const laborPercent = totalSales > 0 ? (totalLaborCost / totalSales * 100) : 0;
  const laborGoal = locationSettings?.labor_percentage_target || 25;
  const laborGoalDollars = totalSales * (laborGoal / 100);
  const laborOverUnder = totalLaborCost - laborGoalDollars;
  const laborColor = laborPercent <= laborGoal ? "#22c55e" : "#ef4444";

  // ---- Aggregate Checklists ----
  // Fetch all submissions for the week
  const weekCtx = await getLocationDayContext(supabase, location_id);
  const weekStartUTC = businessDayRange(week_start, weekCtx).start;
  const weekEndUTC = businessDayRange(week_end, weekCtx).end;

  const { data: weekSubs } = await supabase
    .from("checklist_submissions")
    .select("id, checklist_id, submitted_at")
    .eq("location_id", location_id)
    .gte("submitted_at", weekStartUTC.toISOString())
    .lt("submitted_at", weekEndUTC.toISOString());

  // Calculate expected items across the week (archive-aware, per business day)
  const dailyAndDynamicChecklists = (activeChecklists || []).filter((c: any) => c.frequency === "daily" || c.template_type === "dynamic");
  let totalExpectedItems = 0;
  const expectedItemIds = new Set<string>();
  for (const dateStr of weekDates) {
    const monDow = mon0DayOfWeek(dateStr);
    const dayStart = businessDayRange(dateStr, weekCtx).start;
    for (const c of dailyAndDynamicChecklists) {
      const items = (c.checklist_items || []).filter((i: any) => expectedInPeriod(i, dayStart));
      const isDynamic = c.template_type === "dynamic";
      const todayItems = isDynamic
        ? items.filter((i: any) => i.days_of_week && i.days_of_week.includes(monDow))
        : items;
      totalExpectedItems += todayItems.length;
      for (const i of todayItems) expectedItemIds.add(i.id);
    }
  }

  // Numerator must live in the same universe as the denominator, or the % breaks 100.
  const subIds = (weekSubs || []).map((s: any) => s.id);
  let totalResponseCount = 0;
  if (subIds.length > 0) {
    const { data: responses } = await supabase.from("checklist_responses").select("id, item_id").in("submission_id", subIds);
    totalResponseCount = (responses || []).filter((r: any) => r.item_id && expectedItemIds.has(r.item_id)).length;
  }
  const checklistPct = totalExpectedItems > 0 ? Math.round((Math.min(totalResponseCount, totalExpectedItems) / totalExpectedItems) * 100) : 0;

  // ---- Cash Handling ----
  const cashCategories = ["Drawer Count", "Safe Count", "Bank Deposit"];
  const cashEntries = (logbookEntries || []).filter((e: any) => cashCategories.includes(e.category?.name));
  let drawerVarianceTotal = 0;
  let drawerCount = 0;
  let safeCountTotal = 0;
  let depositTotal = 0;

  // Per-day cash variance map
  const dailyCashVariance: Record<string, number> = {};

  if (cashEntries.length > 0) {
    const entryIds = cashEntries.map((e: any) => e.id);
    const { data: entryValues } = await supabase
      .from("logbook_entry_values")
      .select("entry_id, value_text, field:field_id (field_name)")
      .in("entry_id", entryIds);

    for (const entry of cashEntries) {
      const vals = (entryValues || []).filter((v: any) => v.entry_id === entry.id);
      for (const v of vals) {
        const fn = v.field?.field_name || "";
        if (fn.includes("_data") && v.value_text) {
          try {
            const parsed = JSON.parse(v.value_text);
            if (entry.category?.name === "Drawer Count" && parsed.variance !== undefined) {
              const variance = Number(parsed.variance);
              drawerVarianceTotal += variance;
              drawerCount++;
              const entryDate = entry.entry_date;
              dailyCashVariance[entryDate] = (dailyCashVariance[entryDate] || 0) + variance;
            }
            if (entry.category?.name === "Safe Count" && parsed.totalSafe !== undefined) {
              safeCountTotal++;
            }
            if (entry.category?.name === "Bank Deposit" && parsed.actualDeposit !== undefined) {
              // Audited amount wins once a deposit audit exists.
              depositTotal += Number(parsed.auditedDeposit ?? parsed.actualDeposit);
            }
          } catch {}
        }
      }
    }
  }

  // ---- Per-day labor data ----
  const dailyLaborMap: Record<string, { hours: number; cost: number }> = {};
  for (const l of (laborRows || [])) {
    const ld = l.labor_date;
    if (!dailyLaborMap[ld]) dailyLaborMap[ld] = { hours: 0, cost: 0 };
    dailyLaborMap[ld].hours += l.labor_hours || 0;
    dailyLaborMap[ld].cost += l.labor_cost || 0;
  }

  // ---- Recipients ----
  const { data: locationUsers } = await supabase.from("user_locations").select("user_id").eq("location_id", location_id);
  const userIds = (locationUsers || []).map((u: any) => u.user_id);
  const managerRoles = ["admin", "org_admin", "super_admin", "manager", "general_manager"];
  let eligibleRecipients: { id: string; email: string; full_name: string }[] = [];

  if (userIds.length > 0) {
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name").in("id", userIds),
      supabase.from("user_roles").select("user_id, role").in("user_id", userIds),
    ]);
    const roleMap = new Map((roles || []).map((r: any) => [r.user_id, r.role]));
    eligibleRecipients = (profiles || []).filter((p: any) => managerRoles.includes(roleMap.get(p.id)) && p.email);
  }

  // ---- Format dates ----
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const displayRange = `${monthNames[sMo - 1]} ${sDy} – ${sMo !== eMo ? monthNames[eMo - 1] + " " : ""}${eDy}, ${eYr}`;

  // ---- Best / Worst Day ----
  const sortedDays = [...dailySales].filter(d => d.sales > 0).sort((a, b) => b.sales - a.sales);
  const bestDay = sortedDays[0];
  const worstDay = sortedDays[sortedDays.length - 1];

  // Average daily
  const daysWithSales = dailySales.filter(d => d.sales > 0).length || 1;
  const avgDailySales = totalSales / daysWithSales;

  // Day name helper
  const getDayName = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return dayNames[new Date(y, m - 1, d).getDay()];
  };
  const getShortDay = (dateStr: string) => getDayName(dateStr).slice(0, 3);

  // ---- AI Weekly Insights ----
  let aiInsightsHtml = '';
  try {
    // Build context for AI
    const aiContext = {
      totalSales, totalProjection, projDiff,
      laborPercent: laborPercent.toFixed(1), laborGoal, laborOverUnder,
      drawerVarianceTotal: drawerVarianceTotal.toFixed(2),
      checklistPct,
      bestDay: bestDay ? { day: getDayName(bestDay.date), sales: bestDay.sales } : null,
      worstDay: worstDay ? { day: getDayName(worstDay.date), sales: worstDay.sales } : null,
      dailyBreakdown: dailySales.map(d => ({
        day: getShortDay(d.date),
        sales: d.sales,
        projection: d.projection,
        laborPct: dailyLaborMap[d.date] && d.sales > 0 ? (dailyLaborMap[d.date].cost / d.sales * 100).toFixed(1) : null,
        cashVariance: dailyCashVariance[d.date] || 0,
      })),
    };

    const aiPrompt = `You are a restaurant operations analyst for ${location.name}. Analyze this week's performance (${displayRange}) and provide 3-4 brief, actionable insights. Be specific with numbers. Format as short paragraphs with bold labels. Keep total response under 200 words.

Data:
- Sales: $${totalSales.toLocaleString()} vs $${totalProjection.toLocaleString()} target (${projDiff >= 0 ? '+' : ''}$${projDiff.toLocaleString()})
- Labor: ${laborPercent.toFixed(1)}% vs ${laborGoal}% goal (${laborOverUnder >= 0 ? '+' : '-'}$${Math.abs(laborOverUnder).toLocaleString()})
- Drawer Variance: $${drawerVarianceTotal.toFixed(2)}
- Checklist Completion: ${checklistPct}%
- Best Day: ${bestDay ? getDayName(bestDay.date) + ' $' + bestDay.sales.toLocaleString() : 'N/A'}
- Worst Day: ${worstDay ? getDayName(worstDay.date) + ' $' + worstDay.sales.toLocaleString() : 'N/A'}
- Daily: ${dailySales.map(d => `${getShortDay(d.date)}: $${d.sales.toLocaleString()}`).join(', ')}

Write concise insights about sales trends, labor efficiency, cash handling, and checklists. Use plain text, no markdown.`;

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) throw new Error('LOVABLE_API_KEY not set');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: aiPrompt }],
      }),
    });

    if (aiResponse.ok) {
      const aiResult = await aiResponse.json();
      const aiText = aiResult?.choices?.[0]?.message?.content || aiResult?.content || '';
      if (aiText) {
        // Format the AI text into HTML paragraphs
        const paragraphs = aiText.split('\n\n').filter((p: string) => p.trim());
        const formattedInsights = paragraphs.map((p: string) => {
          // Bold labels that start with **Label:** or similar
          const formatted = p.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
          return `<p style="margin:0 0 10px;font-size:13px;color:${textColor};line-height:1.6;">${formatted}</p>`;
        }).join('');
        aiInsightsHtml = `
          <div style="border-top:1px solid #e8e5df;margin:20px 0;"></div>
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">🤖 AI Weekly Insights</p>
          <div style="background:linear-gradient(135deg,#f0fdf4 0%,#f0f9ff 100%);border:1px solid #d1e7dd;border-radius:12px;padding:16px;">
            ${formattedInsights}
          </div>`;
      }
    }
  } catch (aiErr: any) {
    console.error('[weekly-pulse] AI insights error (non-fatal):', aiErr.message);
  }

  // ---- Daily breakdown table with cash ----
  const dailyTableHtml = dailySales.map((d, i) => {
    const dayLabel = getShortDay(d.date);
    const daySales = d.sales;
    const dayLabor = dailyLaborMap[d.date];
    const dayLaborPct = dayLabor && daySales > 0 ? (dayLabor.cost / daySales * 100).toFixed(1) : '—';
    const dayCash = dailyCashVariance[d.date] || 0;
    const cashStr = dayCash === 0 ? '+$0.00' : (dayCash >= 0 ? `+$${Math.abs(dayCash).toFixed(2)}` : `-$${Math.abs(dayCash).toFixed(2)}`);
    const cashColor = dayCash === 0 ? '#888' : (dayCash >= 0 ? '#22c55e' : '#ef4444');
    const border = i < dailySales.length - 1 ? 'border-bottom:1px solid #e8e5df;' : '';
    return `<tr style="${border}">
      <td style="padding:8px 12px;font-size:13px;color:${textColor};font-weight:600;">${dayLabel}</td>
      <td style="padding:8px 12px;text-align:right;font-size:13px;color:${textColor};">$${daySales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
      <td style="padding:8px 12px;text-align:right;font-size:11px;color:#888;">${dayLaborPct}%</td>
      <td style="padding:8px 12px;text-align:right;font-size:13px;color:${cashColor};font-weight:600;">${cashStr}</td>
    </tr>`;
  }).join("");

  // ---- Checklist weekly rows ----
  // Count per-checklist daily completions
  const weeklyChecklistData: { title: string; daysCompleted: number; totalDays: number }[] = [];
  const dailyAndDynamic = (activeChecklists || []).filter((c: any) => c.frequency === "daily" || c.template_type === "dynamic");
  for (const c of dailyAndDynamic) {
    let activeDays = 0;
    let completedDays = 0;
    for (const dateStr of weekDates) {
      const monDow = mon0DayOfWeek(dateStr);
      const { start: dayStart, end: dayEnd } = businessDayRange(dateStr, weekCtx);
      // A day the GM emptied by archiving still counts as an active day this week
      // (4/5, not 4/4) — items archived after that day started are still expected.
      const items = (c.checklist_items || []).filter((i: any) => expectedInPeriod(i, dayStart));
      const isDynamic = c.template_type === "dynamic";
      const todayItems = isDynamic ? items.filter((i: any) => i.days_of_week && i.days_of_week.includes(monDow)) : items;
      if (todayItems.length > 0) {
        activeDays++;
        const startIso = dayStart.toISOString();
        const endIso = dayEnd.toISOString();
        const hasSub = (weekSubs || []).some((s: any) => s.checklist_id === c.id && s.submitted_at >= startIso && s.submitted_at < endIso);
        if (hasSub) completedDays++;
      }
    }
    if (activeDays > 0) {
      weeklyChecklistData.push({ title: c.title, daysCompleted: completedDays, totalDays: activeDays });
    }
  }

  const weeklyChecklistHtml = weeklyChecklistData.length > 0 ? `<table style="width:100%;border-collapse:collapse;background:#f5f4f1;border-radius:12px;overflow:hidden;">
    ${weeklyChecklistData.map((c, i) => {
      const allComplete = c.daysCompleted >= c.totalDays;
      const icon = allComplete
        ? `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#22c55e;text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">✓</span>`
        : `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#ef4444;text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">✗</span>`;
      const statusColor = allComplete ? '#22c55e' : '#ef4444';
      const border = i < weeklyChecklistData.length - 1 ? 'border-bottom:1px solid #e8e5df;' : '';
      return `<tr style="${border}">
        <td style="padding:8px 12px;width:20px;">${icon}</td>
        <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">${c.title}</span></td>
        <td style="padding:8px 12px;text-align:right;"><span style="font-size:11px;color:${statusColor};font-weight:600;">${c.daysCompleted}/${c.totalDays} days</span></td>
      </tr>`;
    }).join("")}
  </table>` : `<p style="color:#888;font-size:13px;margin:0;">No checklists tracked</p>`;

  const emailHtml = wrapEmail(`
    ${getPulseHeader("Weekly Pulse", brandLogoUrl, location.name, location.store_number, displayRange)}
    <tr><td style="padding:24px;">

      <!-- SALES + LABOR ROW -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="vertical-align:top;width:50%;padding-right:20px;">
            <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Total Sales</p>
            <p style="margin:0;"><strong style="color:${textColor};font-size:28px;">$${totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></p>
            <p style="color:#888;font-size:13px;margin:4px 0 0;">Target: $${totalProjection.toLocaleString(undefined, { maximumFractionDigits: 0 })} (<span style="color:${projColor};font-weight:600;">${projDiff >= 0 ? "+" : ""}$${Math.abs(projDiff).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>)</p>
            <p style="color:#888;font-size:12px;margin:6px 0 0;">Avg Daily: $${avgDailySales.toLocaleString(undefined, { maximumFractionDigits: 0 })} &middot; ${totalGuests.toLocaleString()} guests &middot; ${totalPizzas.toLocaleString()} pizzas</p>
          </td>
          <td style="vertical-align:top;width:50%;text-align:right;border-left:1px solid #e8e5df;padding-left:20px;">
            <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Total Labor</p>
            <p style="margin:0;"><strong style="color:${laborColor};font-size:28px;">${laborPercent.toFixed(1)}%</strong></p>
            <p style="color:#888;font-size:13px;margin:4px 0 0;">$${totalLaborCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} &middot; ${totalLaborHours.toFixed(1)}h</p>
            <p style="color:${laborColor};font-size:13px;font-weight:600;margin:4px 0 0;">${laborOverUnder > 0 ? "+" : "-"}$${Math.abs(laborOverUnder).toLocaleString(undefined, { maximumFractionDigits: 0 })} vs ${laborGoal}% goal</p>
          </td>
        </tr>
      </table>

      <div style="border-top:1px solid #e8e5df;margin-bottom:20px;"></div>

      <!-- DAILY BREAKDOWN TABLE -->
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Daily Breakdown</p>
      <table style="width:100%;border-collapse:collapse;background:#f5f4f1;border-radius:12px;overflow:hidden;margin-bottom:20px;">
        <tr style="border-bottom:2px solid #e8e5df;">
          <td style="padding:8px 12px;font-weight:700;font-size:11px;color:#888;text-transform:uppercase;">Day</td>
          <td style="padding:8px 12px;text-align:right;font-weight:700;font-size:11px;color:#888;text-transform:uppercase;">Sales</td>
          <td style="padding:8px 12px;text-align:right;font-weight:700;font-size:11px;color:#888;text-transform:uppercase;">Labor%</td>
          <td style="padding:8px 12px;text-align:right;font-weight:700;font-size:11px;color:#888;text-transform:uppercase;">Cash +/-</td>
        </tr>
        ${dailyTableHtml}
      </table>

      ${bestDay && worstDay && bestDay.date !== worstDay.date ? `
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <td style="width:50%;padding-right:8px;">
            <div style="background:#f0fdf4;border-radius:12px;padding:10px 14px;">
              <p style="margin:0;font-size:11px;color:#888;text-transform:uppercase;">Best Day</p>
              <p style="margin:2px 0 0;font-size:14px;color:#22c55e;font-weight:700;">${getDayName(bestDay.date)} — $${bestDay.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            </div>
          </td>
          <td style="width:50%;padding-left:8px;">
            <div style="background:#fef2f2;border-radius:12px;padding:10px 14px;">
              <p style="margin:0;font-size:11px;color:#888;text-transform:uppercase;">Slowest Day</p>
              <p style="margin:2px 0 0;font-size:14px;color:#ef4444;font-weight:700;">${getDayName(worstDay.date)} — $${worstDay.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            </div>
          </td>
        </tr>
      </table>
      ` : ''}

      <div style="border-top:1px solid #e8e5df;margin:20px 0;"></div>

      <!-- CHECKLISTS -->
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Checklists</p>
      ${weeklyChecklistHtml}

      <div style="border-top:1px solid #e8e5df;margin:20px 0;"></div>

      <!-- CASH HANDLING SUMMARY -->
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Cash Handling</p>
      <table style="width:100%;border-collapse:collapse;background:#f5f4f1;border-radius:12px;overflow:hidden;">
        <tr style="border-bottom:1px solid #e8e5df;">
          <td style="padding:8px 12px;width:20px;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${Math.abs(drawerVarianceTotal) > 20 ? '#ef4444' : '#22c55e'};text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">${Math.abs(drawerVarianceTotal) > 20 ? '!' : '✓'}</span></td>
          <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">Drawer Variance</span></td>
          <td style="padding:8px 12px;text-align:right;"><span style="font-size:13px;color:${drawerVarianceTotal >= 0 ? '#22c55e' : '#ef4444'};font-weight:600;">${drawerVarianceTotal >= 0 ? '+' : '-'}$${Math.abs(drawerVarianceTotal).toFixed(2)}</span></td>
        </tr>
        <tr style="border-bottom:1px solid #e8e5df;">
          <td style="padding:8px 12px;width:20px;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${primaryColor};text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">#</span></td>
          <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">Drawer Counts</span></td>
          <td style="padding:8px 12px;text-align:right;"><span style="font-size:13px;color:${textColor};font-weight:600;">${drawerCount}</span></td>
        </tr>
        <tr${depositTotal > 0 ? ' style="border-bottom:1px solid #e8e5df;"' : ''}>
          <td style="padding:8px 12px;width:20px;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${primaryColor};text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">#</span></td>
          <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">Safe Counts</span></td>
          <td style="padding:8px 12px;text-align:right;"><span style="font-size:13px;color:${textColor};font-weight:600;">${safeCountTotal}</span></td>
        </tr>
        ${depositTotal > 0 ? `<tr>
          <td style="padding:8px 12px;width:20px;"><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#22c55e;text-align:center;line-height:18px;color:#fff;font-size:11px;font-weight:700;">$</span></td>
          <td style="padding:8px 4px;"><span style="font-size:13px;color:${textColor};font-weight:600;">Total Deposits</span></td>
          <td style="padding:8px 12px;text-align:right;"><span style="font-size:13px;color:${textColor};font-weight:600;">$${depositTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></td>
        </tr>` : ''}
      </table>

      ${aiInsightsHtml}

    </td></tr>
    ${getEmailFooter()}
  `);

  // Preview mode
  if (preview) {
    return new Response(JSON.stringify({ html: emailHtml, success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Send to eligible recipients
  if (eligibleRecipients.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No eligible recipients", recipientCount: 0 }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const dedupKey = `weekly_summary_v2_${location_id}_${week_start}`;
  await queueEmail({
    from: "CrooHQ <reports@croohq.email>",
    to: eligibleRecipients.map(r => r.email),
    subject: `Weekly Pulse — ${location.name} — ${displayRange}`,
    html: emailHtml,
    source: "weekly_summary",
    dedupKey,
  });

  return new Response(JSON.stringify({ success: true, recipientCount: eligibleRecipients.length }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ============ HANDLER ============

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireCaller(req, corsHeaders);
  if ("response" in auth) return auth.response;

  try {
    const { action, payload } = await req.json();
    
    if (!action) {
      return new Response(JSON.stringify({ error: "action required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    switch (action) {
      case "support_ticket": return await notifySupportTicket(payload);
      case "send_support_resolution": return await sendSupportResolution(payload);
      case "send_daily_logbook_summary": return await sendDailyLogbookSummary(payload);
      case "send_weekly_summary_email": return await sendWeeklySummaryEmail(payload);
      case "send_test": return await sendTestEmail(payload);
      case "send_all_test_emails": return await sendAllTestEmails(payload);
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (error: any) {
    console.error("Error in support-email-service:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

serve(handler);
