import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function getEmailHeader(title: string): string {
  return `<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;"><img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:50px;margin-bottom:12px;filter:brightness(0) invert(1);"/><h1 style="color:#fff;font-size:22px;font-weight:600;margin:0;">${title}</h1></td></tr>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f8f7f5;padding:24px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;"><a href="https://croohq.com" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;margin-bottom:16px;">Open Croo</a><p style="color:#aaa;font-size:11px;margin:16px 0 0;">© ${new Date().getFullYear()} Croo. All rights reserved.</p></td></tr></table></td></tr>`;
}

function getCTAButton(url: string, text: string): string {
  return `<div style="text-align:center;"><a href="${url}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">${text}</a></div>`;
}

// ============ SUPPORT TICKET ACTIONS ============

async function notifySupportTicket(payload: any): Promise<Response> {
  const { ticket_id, event_type, message_content, sender_name } = payload;
  
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

  switch (event_type) {
    case "new_ticket":
      emailSubject = `New Support Ticket ${ticketNumber} from ${userName}`;
      pushTitle = `New Support Ticket ${ticketNumber}`;
      pushBody = `${userName} reported: ${categoryLabel}`;
      emailContent = `
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">A new support ticket has been submitted.</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;">
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Ticket</span><br/><strong style="color:${primaryColor};font-size:16px;">${ticketNumber}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Category</span><br/><strong style="color:${textColor};font-size:14px;">${categoryLabel}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">From</span><br/><strong style="color:${textColor};font-size:14px;">${userName}</strong></td></tr>
          </table>
        </div>
        <div style="background:#fafafa;border-radius:10px;padding:16px;border-left:4px solid ${primaryColor};">
          <p style="color:#666;font-size:12px;text-transform:uppercase;margin:0 0 8px;">Description</p>
          <p style="color:${textColor};font-size:14px;line-height:1.5;margin:0;">${ticket.description}</p>
        </div>
      `;
      break;
    case "new_message":
      emailSubject = `New message on ${ticketNumber} from ${sender_name || userName}`;
      pushTitle = `Message on ${ticketNumber}`;
      pushBody = message_content?.substring(0, 100) || "New message received";
      emailContent = `
        <p style="color:${textColor};font-size:15px;margin:0 0 8px;">New message on <strong style="color:${primaryColor};">${ticketNumber}</strong></p>
        <p style="color:#666;font-size:13px;margin:0 0 20px;">From: ${sender_name || userName}</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:16px;border-left:4px solid ${primaryColor};">
          <p style="color:${textColor};font-size:14px;line-height:1.5;margin:0;">${message_content || "(no content)"}</p>
        </div>
      `;
      break;
    default:
      return new Response(JSON.stringify({ success: true, message: "No action taken" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const emailHtml = wrapEmail(`
    ${getEmailHeader("🎫 Support Notification")}
    <tr><td style="padding:30px 40px;">${emailContent}<div style="margin-top:24px;">${getCTAButton("https://croohq.com", "View in Croo")}</div></td></tr>
    ${getEmailFooter()}
  `);

  const SUPPORT_ADMIN_EMAILS = ["jordan@jo-pizza.com"];
  const { data: adminProfiles } = await supabase.from("profiles").select("id, email").in("email", SUPPORT_ADMIN_EMAILS);
  const adminIds = adminProfiles?.map(p => p.id) || [];
  const adminEmails = adminProfiles?.map(p => p.email).filter(Boolean) || [];

  for (const email of adminEmails) {
    try {
      await resend.emails.send({ from: "CrooHQ Support <support@croohq.email>", to: [email], subject: emailSubject, html: emailHtml });
    } catch (e) {
      console.error("Error sending email to", email, e);
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
    await resend.emails.send({
      from: "CrooHQ Support <support@croohq.email>",
      to: [userEmail],
      subject: `Your support ticket ${ticketNumber} has been resolved`,
      html: wrapEmail(`<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;"><img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:50px;margin-bottom:12px;filter:brightness(0) invert(1);"/><h1 style="color:#fff;font-size:22px;margin:0;">✅ Ticket Resolved</h1></td></tr><tr><td style="padding:30px 40px;"><p style="color:${textColor};font-size:15px;margin:0 0 16px;">Good news, ${firstName}! 🎉</p><p style="color:${textColor};font-size:15px;margin:0 0 20px;">Your support ticket <strong style="color:${primaryColor};">${ticketNumber}</strong> has been resolved.</p><div style="background:${backgroundColor};border-radius:10px;padding:16px;margin-bottom:24px;border-left:4px solid ${primaryColor};"><p style="color:#666;font-size:12px;margin:0 0 8px;">Original Issue</p><p style="color:${textColor};font-size:14px;margin:0;">${ticket.description}</p></div><div style="text-align:center;"><a href="https://croohq.com" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">Open Croo</a></div></td></tr>`),
    });
  }

  const { data: pushTokens } = await supabase.from("push_tokens").select("token").eq("user_id", ticket.user_id);
  if (pushTokens && pushTokens.length > 0) {
    await supabase.functions.invoke("send-push-notification", {
      body: { tokens: pushTokens.map((t: any) => t.token), title: `Ticket ${ticketNumber} Resolved`, body: "Your support ticket has been resolved.", data: { type: "support_resolved", ticketId: ticket.id } },
    });
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

  // Get location details
  const { data: location, error: locError } = await supabase
    .from("locations")
    .select("id, name, organization_id")
    .eq("id", location_id)
    .single();

  if (locError || !location) {
    return new Response(JSON.stringify({ error: "Location not found", success: false }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Get sales data for the day
  const { data: salesData } = await supabase
    .from("sales_cache")
    .select("net_sales, guest_count, pizza_count, avg_ticket, projected_sales")
    .eq("location_id", location_id)
    .eq("sale_date", entry_date)
    .maybeSingle();

  // Get labor data for the day
  const { data: laborData } = await supabase
    .from("labor_cache")
    .select("labor_hours, labor_cost")
    .eq("location_id", location_id)
    .eq("labor_date", entry_date);

  const totalLaborHours = laborData?.reduce((sum, l) => sum + (l.labor_hours || 0), 0) || 0;
  const totalLaborCost = laborData?.reduce((sum, l) => sum + (l.labor_cost || 0), 0) || 0;

  // Get logbook entries for the day
  const { data: logbookEntries } = await supabase
    .from("logbook_entries")
    .select(`
      id, entry_date, created_at,
      category:category_id (name),
      created_by_profile:created_by (full_name)
    `)
    .eq("location_id", location_id)
    .eq("entry_date", entry_date);

  // Get recipients - managers and above at this location
  const { data: recipients } = await supabase
    .from("user_locations")
    .select(`
      user_id,
      profile:user_id (id, email, full_name),
      user_role:user_id (role)
    `)
    .eq("location_id", location_id);

  const managerRoles = ["admin", "org_admin", "super_admin", "manager", "general_manager"];
  const eligibleRecipients = recipients?.filter((r: any) => {
    const role = r.user_role?.role;
    return managerRoles.includes(role) && r.profile?.email;
  }) || [];

  if (eligibleRecipients.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No eligible recipients", recipientCount: 0 }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Format the date for display
  const displayDate = new Date(entry_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  // Build email content
  const netSales = salesData?.net_sales || 0;
  const projection = salesData?.projected_sales || 0;
  const variance = projection > 0 ? ((netSales - projection) / projection * 100).toFixed(1) : "0";
  const varianceColor = parseFloat(variance) >= 0 ? "#22c55e" : "#ef4444";
  const laborPercent = netSales > 0 ? ((totalLaborCost / netSales) * 100).toFixed(1) : "0";

  const logbookSummary = (logbookEntries || []).map((entry: any) => 
    `<li style="padding:4px 0;color:${textColor};font-size:14px;">${entry.category?.name || "Entry"} - by ${entry.created_by_profile?.full_name || "Unknown"}</li>`
  ).join("");

  const emailHtml = wrapEmail(`
    ${getEmailHeader(`📊 Daily Summary: ${location.name}`)}
    <tr><td style="padding:30px 40px;">
      <p style="color:#666;font-size:14px;margin:0 0 20px;">${displayDate}</p>
      
      <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:20px;">
        <h3 style="color:${primaryColor};font-size:16px;margin:0 0 16px;">💰 Sales Performance</h3>
        <table style="width:100%;">
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;">Net Sales</span><br/><strong style="color:${textColor};font-size:18px;">$${netSales.toLocaleString()}</strong></td><td style="padding:6px 0;text-align:right;"><span style="color:#666;font-size:12px;">vs Projection</span><br/><strong style="color:${varianceColor};font-size:18px;">${parseFloat(variance) >= 0 ? "+" : ""}${variance}%</strong></td></tr>
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;">Guests</span><br/><strong style="color:${textColor};font-size:16px;">${salesData?.guest_count || 0}</strong></td><td style="padding:6px 0;text-align:right;"><span style="color:#666;font-size:12px;">Pizzas</span><br/><strong style="color:${textColor};font-size:16px;">${salesData?.pizza_count || 0}</strong></td></tr>
        </table>
      </div>

      <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:20px;">
        <h3 style="color:${primaryColor};font-size:16px;margin:0 0 16px;">👥 Labor</h3>
        <table style="width:100%;">
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;">Hours</span><br/><strong style="color:${textColor};font-size:16px;">${totalLaborHours.toFixed(1)}h</strong></td><td style="padding:6px 0;text-align:right;"><span style="color:#666;font-size:12px;">Cost</span><br/><strong style="color:${textColor};font-size:16px;">$${totalLaborCost.toLocaleString()}</strong></td></tr>
          <tr><td colspan="2" style="padding:6px 0;"><span style="color:#666;font-size:12px;">Labor %</span><br/><strong style="color:${textColor};font-size:16px;">${laborPercent}%</strong></td></tr>
        </table>
      </div>

      ${logbookEntries && logbookEntries.length > 0 ? `
      <div style="background:#fafafa;border-radius:10px;padding:16px;margin-bottom:20px;border-left:4px solid ${primaryColor};">
        <h3 style="color:${primaryColor};font-size:14px;margin:0 0 12px;">📝 Logbook Entries (${logbookEntries.length})</h3>
        <ul style="margin:0;padding-left:20px;">${logbookSummary}</ul>
      </div>
      ` : ""}

      ${getCTAButton("https://croohq.com", "View Full Report")}
    </td></tr>
    ${getEmailFooter()}
  `);

  // Send to all eligible recipients
  let sentCount = 0;
  for (const recipient of eligibleRecipients) {
    const email = (recipient as any).profile?.email;
    if (email) {
      try {
        await resend.emails.send({
          from: "CrooHQ <reports@croohq.email>",
          to: [email],
          subject: `Daily Summary: ${location.name} - ${displayDate}`,
          html: emailHtml,
        });
        sentCount++;
      } catch (e) {
        console.error("Error sending daily summary to", email, e);
      }
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
    html: wrapEmail(`<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:40px;text-align:center;"><img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:80px;margin-bottom:16px;filter:brightness(0) invert(1);"/><h1 style="color:#fff;font-size:28px;margin:0;">Welcome to Croo!</h1></td></tr><tr><td style="padding:40px;"><p style="color:${textColor};font-size:16px;">Hey there! 👋</p><p style="color:${textColor};font-size:16px;">This is a test email from <strong style="color:${primaryColor};">Croo</strong>.</p></td></tr>`),
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
      html: (content: string) => wrapEmail(`
        ${getEmailHeader('New Chat Message', '💬')}
        <tr>
          <td style="padding: 30px 40px;">
            <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
              <strong style="color: ${primaryColor};">Sarah Johnson</strong> sent you a message in <strong>Hemet Team Chat</strong>:
            </p>
            <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0; border-left: 4px solid ${primaryColor};">
              <p style="color: ${textColor}; font-size: 14px; line-height: 1.5; margin: 0; font-style: italic;">
                "Hey! Can you cover my shift tomorrow? I have a doctor's appointment 🙏"
              </p>
            </div>
            <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
              Tap below to view and reply.
            </p>
          </td>
        </tr>
        ${getEmailFooter()}
      `)
    },
    {
      subject: '📢 New Announcement: Holiday Schedule Update',
      html: (content: string) => wrapEmail(`
        ${getEmailHeader('New Announcement', '📢')}
        <tr>
          <td style="padding: 30px 40px;">
            <h2 style="color: ${textColor}; font-size: 18px; font-weight: 600; margin: 0 0 16px;">
              Holiday Schedule Update
            </h2>
            <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 20px; margin: 16px 0;">
              <p style="color: ${textColor}; font-size: 14px; line-height: 1.6; margin: 0;">
                Quick reminder: We'll be running special holiday hours next week. Please check your schedule carefully and let me know if you have any conflicts. Thanks team! 🎄
              </p>
            </div>
            <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
              Posted by <strong>Mike Thompson</strong> at Hemet
            </p>
          </td>
        </tr>
        ${getEmailFooter()}
      `)
    },
    {
      subject: '📅 Schedule Update: New shift added',
      html: (content: string) => wrapEmail(`
        ${getEmailHeader('Schedule Update', '📅')}
        <tr>
          <td style="padding: 30px 40px;">
            <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
              A new shift has been added to your schedule.
            </p>
            <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #666; font-size: 12px; text-transform: uppercase;">Date</span><br/>
                    <strong style="color: ${textColor}; font-size: 15px;">Monday, January 13, 2026</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #666; font-size: 12px; text-transform: uppercase;">Time</span><br/>
                    <strong style="color: ${textColor}; font-size: 15px;">9:00 AM - 5:00 PM</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #666; font-size: 12px; text-transform: uppercase;">Position</span><br/>
                    <strong style="color: ${textColor}; font-size: 15px;">Shift Leader</strong>
                  </td>
                </tr>
              </table>
            </div>
            <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
              Check the app to view your full schedule.
            </p>
          </td>
        </tr>
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
        html: email.html(''),
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

// ============ HANDLER ============

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, payload } = await req.json();
    
    if (!action) {
      return new Response(JSON.stringify({ error: "action required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    switch (action) {
      case "support_ticket": return await notifySupportTicket(payload);
      case "send_support_resolution": return await sendSupportResolution(payload);
      case "send_daily_logbook_summary": return await sendDailyLogbookSummary(payload);
      case "send_test": return await sendTestEmail(payload);
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (error: any) {
    console.error("Error in support-email-service:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

serve(handler);
