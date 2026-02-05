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

// ============= SHARED HELPERS =============
function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

function getEmailHeader(title: string, emoji: string = "📢"): string {
  return `<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;"><img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:50px;width:auto;margin-bottom:12px;filter:brightness(0) invert(1);"/><h1 style="color:#fff;font-size:22px;font-weight:600;margin:0;">{{emoji}} ${title}</h1></td></tr>`.replace('{{emoji}}', emoji);
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f8f7f5;padding:24px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;"><a href="https://croohq.com" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;margin-bottom:16px;">Open Croo</a><p style="color:#aaa;font-size:11px;margin:16px 0 0;">© ${new Date().getFullYear()} Croo. All rights reserved.</p></td></tr></table></td></tr>`;
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

// ============= ORIGINAL FUNCTIONS =============

async function sendInviteEmail(payload: any): Promise<Response> {
  const { to, fullName, locationId, resetLink } = payload;
  if (!to || !fullName || !resetLink) {
    return new Response(JSON.stringify({ error: "to, fullName, resetLink required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let orgName = "your new team", locName = "", logoUrl = "", brandName = "";
  if (locationId) {
    const { data: loc } = await supabase.from('locations').select('name, organization_id').eq('id', locationId).single();
    if (loc) {
      locName = loc.name;
      if (loc.organization_id) {
        const { data: org } = await supabase.from('organizations').select('name, logo_url, brand_name').eq('id', loc.organization_id).single();
        if (org) { orgName = org.name; logoUrl = org.logo_url || ""; brandName = org.brand_name || org.name; }
      }
    }
  }

  const firstName = fullName.split(' ')[0];
  const displayName = brandName || orgName;
  const logoHtml = logoUrl ? `<img src="${logoUrl}" alt="${displayName}" style="max-height:100px;max-width:200px;margin-bottom:20px;border-radius:8px;"/>` : `<div style="font-size:48px;margin-bottom:16px;">🎉</div>`;

  const emailResponse = await resend.emails.send({
    from: "CrooHQ <hello@croohq.email>",
    to: [to],
    subject: `🎉 Welcome to ${displayName}${locName ? ` - ${locName}` : ''}!`,
    html: wrapEmail(`<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:50px 40px 40px;text-align:center;">${logoHtml}<h1 style="color:#fff;font-size:32px;font-weight:700;margin:0;">Welcome to the Team!</h1><p style="color:rgba(255,255,255,0.9);font-size:18px;margin:12px 0 0;">${displayName}${locName ? ` • ${locName}` : ''}</p></td></tr><tr><td style="padding:40px;"><p style="color:${textColor};font-size:18px;margin:0 0 20px;">Hey ${firstName}! 👋</p><p style="color:${textColor};font-size:16px;line-height:1.7;margin:0 0 20px;"><strong>Congratulations!</strong> You've been invited to join <strong style="color:${primaryColor};">${displayName}</strong>${locName ? ` at the <strong>${locName}</strong> location` : ''}.</p><table style="width:100%;margin:35px 0;"><tr><td style="text-align:center;"><a href="${resetLink}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:16px 40px;border-radius:12px;font-weight:600;font-size:16px;">Set Your Password</a></td></tr></table><p style="color:#888;font-size:13px;text-align:center;">This link expires in 24 hours.</p></td></tr>`),
  });

  return new Response(JSON.stringify({ success: true, data: emailResponse }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

async function resendInviteEmail(payload: any): Promise<Response> {
  const { userId, newEmail } = payload;
  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  if (!userId) throw new Error("User ID required");

  const { data: profile } = await supabase.from('profiles').select('email').eq('id', userId).single();
  if (!profile) throw new Error("User not found");

  const emailToUse = newEmail || profile.email;
  if (newEmail && newEmail !== profile.email) {
    await supabase.auth.admin.updateUserById(userId, { email: newEmail });
    await supabase.from('profiles').update({ email: newEmail }).eq('id', userId);
  }

  const { data: resetData } = await supabase.auth.admin.generateLink({ type: 'recovery', email: emailToUse, options: { redirectTo: `${supabaseUrl}/reset-password` } });

  return new Response(JSON.stringify({ success: true, message: `Invitation ${newEmail ? 'sent to new email' : 'resent'}`, resetLink: resetData?.properties.action_link }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

async function sendRejectionEmail(payload: any): Promise<Response> {
  const { applicationId, templateId, overrideEmail } = payload;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (!applicationId || !templateId) {
    return new Response(JSON.stringify({ error: "applicationId and templateId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: app } = await supabase.from("job_applications").select("id, full_name, email, organization_id").eq("id", applicationId).single();
  if (!app) return new Response(JSON.stringify({ error: "Application not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: template } = await supabase.from("rejection_email_templates").select("*").eq("id", templateId).eq("organization_id", app.organization_id).single();
  if (!template) return new Response(JSON.stringify({ error: "Template not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: org } = await supabase.from("organizations").select("name, logo_url, brand_name").eq("id", app.organization_id).single();
  const orgName = org?.brand_name || org?.name || "Our Team";
  const logoUrl = org?.logo_url || "";

  const subject = template.subject.replace(/{{name}}/gi, app.full_name).replace(/{{first_name}}/gi, app.full_name.split(" ")[0]).replace(/{{organization}}/gi, orgName);
  const body = template.body.replace(/{{name}}/gi, app.full_name).replace(/{{first_name}}/gi, app.full_name.split(" ")[0]).replace(/{{organization}}/gi, orgName).replace(/\n/g, "<br>");

  const logoHtml = logoUrl ? `<img src="${logoUrl}" alt="${orgName}" style="max-height:60px;max-width:160px;margin-bottom:12px;border-radius:8px;"/>` : `<img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:50px;margin-bottom:12px;filter:brightness(0) invert(1);"/>`;

  const emailResponse = await resend.emails.send({
    from: "CrooHQ Hiring <hiring@croohq.email>",
    to: [overrideEmail || app.email],
    subject,
    html: wrapEmail(`<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;">${logoHtml}<p style="color:rgba(255,255,255,0.9);font-size:16px;margin:8px 0 0;">${orgName}</p></td></tr><tr><td style="padding:30px 40px;"><div style="color:${textColor};font-size:15px;line-height:1.7;">${body}</div></td></tr>`),
  });

  await supabase.from("job_applications").update({ rejection_template_id: templateId, rejection_email_sent_at: new Date().toISOString() }).eq("id", applicationId);

  return new Response(JSON.stringify({ success: true, emailId: emailResponse.data?.id }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function generateICS(date: string, time: string, orgName: string, locationName: string, locationAddress: string | undefined): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, day, hours + 8, minutes));
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  const formatICSDate = (d: Date): string => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const uid = `interview-${date}-${time}-${Date.now()}@croohq.email`;
  const location = locationAddress || locationName;
  return `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//CrooHQ//Interview//EN\nBEGIN:VEVENT\nUID:${uid}\nDTSTAMP:${formatICSDate(new Date())}\nDTSTART:${formatICSDate(startDate)}\nDTEND:${formatICSDate(endDate)}\nSUMMARY:Interview at ${orgName}\nLOCATION:${location}\nSTATUS:CONFIRMED\nEND:VEVENT\nEND:VCALENDAR`;
}

async function sendInterviewInvite(payload: any): Promise<Response> {
  const { conversationId, interviewDate, interviewTime, locationName, locationAddress, scheduledByName } = payload;
  if (!conversationId || !interviewDate || !interviewTime) {
    return new Response(JSON.stringify({ error: "conversationId, interviewDate, interviewTime required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: conversation } = await supabase.from("hiring_conversations").select("id, access_token, application:job_applications(id, full_name, email, organization_id, organization:organizations(name, logo_url, brand_name))").eq("id", conversationId).single();
  if (!conversation) return new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const application = conversation.application as any;
  const org = application?.organization;
  const applicantEmail = application?.email;
  const applicantName = application?.full_name || "Applicant";
  const firstName = applicantName.split(" ")[0];
  const orgName = org?.brand_name || org?.name || "Hiring Team";
  const logoUrl = org?.logo_url || "";
  if (!applicantEmail) return new Response(JSON.stringify({ error: "Applicant has no email" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const chatUrl = `https://croohq.lovable.app/hiring-chat/${conversation.access_token}`;
  const dateObj = new Date(interviewDate + 'T12:00:00');
  const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const [hours, mins] = interviewTime.split(':').map(Number);
  const hour12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedTime = `${hour12}:${mins.toString().padStart(2, '0')} ${ampm}`;
  const icsContent = generateICS(interviewDate, interviewTime, orgName, locationName, locationAddress);
  const logoHtml = logoUrl ? `<img src="${logoUrl}" alt="${orgName}" style="max-height:60px;max-width:160px;margin-bottom:12px;border-radius:8px;"/>` : `<img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:50px;margin-bottom:12px;filter:brightness(0) invert(1);"/>`;

  const emailResponse = await resend.emails.send({
    from: "CrooHQ Hiring <hiring@croohq.email>",
    to: [applicantEmail],
    subject: `Interview Invitation - ${orgName} on ${formattedDate}`,
    html: wrapEmail(`<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;">${logoHtml}<p style="color:rgba(255,255,255,0.9);font-size:16px;margin:8px 0 0;">${orgName}</p></td></tr><tr><td style="padding:30px 40px;"><p style="color:${textColor};font-size:15px;margin:0 0 20px;">Hi ${firstName},</p><p style="color:${textColor};font-size:15px;margin:0 0 24px;"><strong>${scheduledByName}</strong> would like to invite you for an interview at <strong>${orgName}</strong>.</p><div style="background:#f0f9fa;border-radius:12px;padding:24px;margin:0 0 24px;text-align:center;"><p style="color:${primaryColor};font-size:13px;font-weight:600;margin:0 0 8px;">📅 INTERVIEW DETAILS</p><p style="color:${textColor};font-size:20px;font-weight:700;margin:0 0 4px;">${formattedDate}</p><p style="color:${primaryColor};font-size:24px;font-weight:700;margin:0 0 12px;">${formattedTime}</p><p style="color:#666;font-size:14px;margin:0;">📍 ${locationName}</p>${locationAddress ? `<p style="color:#888;font-size:13px;margin:4px 0 0;">${locationAddress}</p>` : ''}</div><div style="text-align:center;margin:24px 0;"><a href="${chatUrl}" style="display:inline-block;background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;">✓ Accept Interview</a></div></td></tr>`),
    attachments: [{ filename: "interview.ics", content: btoa(icsContent) }],
  });

  return new Response(JSON.stringify({ success: true, emailId: emailResponse.data?.id }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

// ============= NOTIFICATION EMAIL (STUB) =============
async function sendNotificationEmail(payload: any): Promise<Response> {
  return new Response(JSON.stringify({ success: true, message: "Use send-notification-email function" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function sendScheduleUpdateEmail(payload: any): Promise<Response> {
  return new Response(JSON.stringify({ success: true, message: "Use send-schedule-update-email function" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function sendWeeklyScheduleEmail(payload: any): Promise<Response> {
  return new Response(JSON.stringify({ success: true, message: "Use send-weekly-schedule-email function" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ============= HIRING & SUPPORT NOTIFICATIONS =============
async function notifyNewApplication(payload: any): Promise<Response> {
  const { applicationId, applicantName, applicantEmail, applicantPhone, locationId, organizationId, templateName } = payload;
  
  if (!applicationId || !applicantName || !organizationId || !templateName) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: org } = await supabase.from("organizations").select("name, brand_name, logo_url").eq("id", organizationId).single();
  const orgDisplayName = org?.brand_name || org?.name || "Your Organization";
  const logoUrl = org?.logo_url || "";

  let locationName = "Any Location";
  if (locationId) {
    const { data: location } = await supabase.from("locations").select("name").eq("id", locationId).single();
    locationName = location?.name || "Unknown Location";
  }

  let recipientQuery = supabase
    .from("profiles")
    .select("id, email, full_name, user_roles!inner(role), user_locations!inner(location_id)")
    .in("user_roles.role", ["admin", "general_manager"]);

  if (locationId) {
    recipientQuery = recipientQuery.eq("user_locations.location_id", locationId);
  }

  const { data: recipients } = await recipientQuery;
  const uniqueEmails = [...new Set(recipients?.map(r => r.email).filter(Boolean))] as string[];

  if (uniqueEmails.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No recipients to notify" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const reviewUrl = "https://croohq.com/hiring";
  const emailHtml = wrapEmail(`
    ${getEmailHeader("📋 New Job Application", logoUrl, orgDisplayName)}
    <tr><td style="padding:30px 40px;">
      <h2 style="color:${textColor};font-size:18px;font-weight:600;margin:0 0 20px;">Applicant Details</h2>
      <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;">
          <tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Name</span><br/><strong style="color:${textColor};font-size:16px;">${applicantName}</strong></td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Email</span><br/><a href="mailto:${applicantEmail}" style="color:${primaryColor};font-size:14px;text-decoration:none;">${applicantEmail}</a></td></tr>
          ${applicantPhone ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Phone</span><br/><a href="tel:${applicantPhone}" style="color:${primaryColor};font-size:14px;text-decoration:none;">${applicantPhone}</a></td></tr>` : ''}
          <tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Position</span><br/><strong style="color:${textColor};font-size:14px;">${templateName}</strong></td></tr>
          <tr><td style="padding:8px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">${locationName}</strong></td></tr>
        </table>
      </div>
      ${getCTAButton(reviewUrl, "Review Application")}
    </td></tr>
    ${getEmailFooter()}
  `);

  const emailPromises = uniqueEmails.map(email => resend.emails.send({
    from: "CrooHQ Hiring <hiring@croohq.email>",
    to: [email],
    subject: `📋 New Application: ${applicantName} - ${templateName}`,
    html: emailHtml,
  }));

  const results = await Promise.allSettled(emailPromises);
  const successful = results.filter(r => r.status === 'fulfilled').length;

  return new Response(JSON.stringify({ success: true, sent: successful, recipients: uniqueEmails.length }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function notifyEmployeeJoined(payload: any): Promise<Response> {
  const { userId } = payload;
  if (!userId) {
    return new Response(JSON.stringify({ error: "userId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: newEmployee, error: employeeError } = await supabase
    .from("profiles")
    .select("id, full_name, email, first_login_at")
    .eq("id", userId)
    .single();

  if (employeeError || !newEmployee) {
    return new Response(JSON.stringify({ error: "Employee not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (newEmployee.first_login_at) {
    return new Response(JSON.stringify({ message: "Already processed" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  await supabase.from("profiles").update({ first_login_at: new Date().toISOString() }).eq("id", userId);

  const { data: userLocations } = await supabase
    .from("user_locations")
    .select("location_id, locations(id, name)")
    .eq("user_id", userId);

  if (!userLocations || userLocations.length === 0) {
    return new Response(JSON.stringify({ message: "No locations found" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const locationIds = userLocations.map(ul => ul.location_id);
  const locationNames = userLocations.map(ul => (ul.locations as any)?.name).filter(Boolean);

  const { data: locationUsers } = await supabase.from("user_locations").select("user_id").in("location_id", locationIds).neq("user_id", userId);
  if (!locationUsers || locationUsers.length === 0) {
    return new Response(JSON.stringify({ message: "No users at locations" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const userIds = [...new Set(locationUsers.map(u => u.user_id))];
  const managerRoles = ["super_admin", "org_admin", "admin", "general_manager", "manager"];
  
  const { data: managerRoleData } = await supabase.from("user_roles").select("user_id").in("user_id", userIds).in("role", managerRoles);
  if (!managerRoleData || managerRoleData.length === 0) {
    return new Response(JSON.stringify({ message: "No managers to notify" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const managerUserIds = [...new Set(managerRoleData.map(r => r.user_id))];
  const { data: managerProfiles } = await supabase.from("profiles").select("id, full_name, email").in("id", managerUserIds);

  const uniqueManagers = new Map<string, { email: string; name: string }>();
  for (const profile of managerProfiles || []) {
    if (profile?.email && !uniqueManagers.has(profile.email)) {
      uniqueManagers.set(profile.email, { email: profile.email, name: profile.full_name || "Manager" });
    }
  }

  const emailPromises = Array.from(uniqueManagers.values()).map(async (manager) => {
    const emailHtml = wrapEmail(`
      ${getEmailHeader("🎉 New Team Member!")}
      <tr><td style="padding:30px 40px;">
        <p style="color:${textColor};font-size:15px;margin:0 0 16px;">Hey ${manager.name.split(' ')[0]}! 👋</p>
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Great news! <strong style="color:${primaryColor};">${newEmployee.full_name || "A new team member"}</strong> has completed their account setup${locationNames.length > 0 ? ` at <strong>${locationNames.join(", ")}</strong>` : ""}.</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;">
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Name</span><br/><strong style="color:${textColor};font-size:15px;">${newEmployee.full_name || "Not provided"}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Email</span><br/><a href="mailto:${newEmployee.email}" style="color:${primaryColor};font-size:14px;text-decoration:none;">${newEmployee.email || "Not provided"}</a></td></tr>
          </table>
        </div>
        <p style="color:#666;font-size:14px;margin:0 0 24px;">You can now add them to the schedule and assign tasks.</p>
        ${getCTAButton("https://croohq.com/users", "View Team")}
      </td></tr>
      ${getEmailFooter()}
    `);

    return resend.emails.send({
      from: "CrooHQ <hello@croohq.email>",
      to: [manager.email],
      subject: `🎉 ${newEmployee.full_name || "New team member"} has joined!`,
      html: emailHtml,
    });
  });

  const results = await Promise.all(emailPromises);
  const successCount = results.filter(r => r.data?.id).length;

  return new Response(JSON.stringify({ message: "Notifications sent", sent: successCount, total: uniqueManagers.size }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function notifyHiringMessage(payload: any): Promise<Response> {
  const { conversationId, messageContent, senderName } = payload;
  
  if (!conversationId || !messageContent) {
    return new Response(JSON.stringify({ error: "conversationId and messageContent required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: conversation, error: convError } = await supabase
    .from("hiring_conversations")
    .select("id, access_token, application:job_applications(id, full_name, email, organization:organizations(name, logo_url, brand_name))")
    .eq("id", conversationId)
    .single();

  if (convError || !conversation) {
    return new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const application = conversation.application as any;
  const org = application?.organization;
  const applicantEmail = application?.email;
  const applicantName = application?.full_name || "Applicant";
  const orgName = org?.brand_name || org?.name || "Hiring Team";
  const logoUrl = org?.logo_url || "";

  if (!applicantEmail) {
    return new Response(JSON.stringify({ error: "Applicant has no email" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const chatUrl = `https://croohq.lovable.app/hiring-chat/${conversation.access_token}`;

  const emailHtml = wrapEmail(`
    ${getEmailHeader(orgName, logoUrl, "")}
    <tr><td style="padding:30px 40px;">
      <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Hi ${applicantName.split(" ")[0]},</p>
      <p style="color:#666;font-size:14px;margin:0 0 16px;"><strong>${senderName}</strong> from ${orgName} sent you a message:</p>
      <div style="background:#f8f7f5;border-left:4px solid ${primaryColor};padding:16px 20px;border-radius:0 8px 8px 0;margin:0 0 24px;">
        <p style="color:${textColor};font-size:15px;line-height:1.6;margin:0;white-space:pre-wrap;">${messageContent.replace(/\n/g, "<br>")}</p>
      </div>
      ${getCTAButton(chatUrl, "Reply to Message")}
      <div style="background:#f0f9fa;border-radius:8px;padding:16px 20px;margin-top:24px;">
        <p style="color:${primaryColor};font-size:13px;font-weight:600;margin:0 0 8px;">📱 Get instant notifications:</p>
        <ol style="color:#666;font-size:13px;line-height:1.6;margin:0;padding-left:20px;">
          <li>Click the link above to open your chat</li>
          <li>Tap <strong>Share</strong> in your browser</li>
          <li>Select <strong>"Add to Home Screen"</strong></li>
        </ol>
      </div>
    </td></tr>
    ${getEmailFooter()}
  `);

  const emailResponse = await resend.emails.send({
    from: "CrooHQ Hiring <hiring@croohq.email>",
    to: [applicantEmail],
    subject: `New message from ${orgName}`,
    html: emailHtml,
  });

  return new Response(JSON.stringify({ success: true, emailId: emailResponse.data?.id }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

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

  // Get support admins
  const SUPPORT_ADMIN_EMAILS = ["jordan@jo-pizza.com"];
  const { data: adminProfiles } = await supabase.from("profiles").select("id, email").in("email", SUPPORT_ADMIN_EMAILS);
  const adminIds = adminProfiles?.map(p => p.id) || [];
  const adminEmails = adminProfiles?.map(p => p.email).filter(Boolean) || [];

  // Send emails
  for (const email of adminEmails) {
    try {
      await resend.emails.send({ from: "CrooHQ Support <support@croohq.email>", to: [email], subject: emailSubject, html: emailHtml });
    } catch (e) {
      console.error("Error sending email to", email, e);
    }
  }

  // Send push notifications to admins
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

// ============= DAILY LOGBOOK =============
async function sendDailyLogbookSummary(payload: any): Promise<Response> {
  return new Response(JSON.stringify({ success: true, message: "Use send-daily-logbook-summary function" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

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
      case "send_invite": return await sendInviteEmail(payload);
      case "resend_invite": return await resendInviteEmail(payload);
      case "send_rejection": return await sendRejectionEmail(payload);
      case "send_interview_invite": return await sendInterviewInvite(payload);
      case "send_support_resolution": return await sendSupportResolution(payload);
      case "send_test": return await sendTestEmail(payload);
      case "send_schedule_update": return await sendScheduleUpdateEmail(payload);
      case "send_weekly_schedule": return await sendWeeklyScheduleEmail(payload);
      case "send_daily_logbook_summary": return await sendDailyLogbookSummary(payload);
      case "new_application": return await notifyNewApplication(payload);
      case "employee_joined": return await notifyEmployeeJoined(payload);
      case "hiring_message": return await notifyHiringMessage(payload);
      case "support_ticket": return await notifySupportTicket(payload);
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (error: any) {
    console.error("Error in email-service:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

serve(handler);
