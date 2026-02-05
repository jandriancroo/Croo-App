import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Croo brand colors
const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

// ============= HANDLER ROUTING =============

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, payload } = await req.json();

    if (!action) {
      return new Response(
        JSON.stringify({ error: "action parameter is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route to specific handler based on action
    switch (action) {
      case "send_invite":
        return await sendInviteEmail(payload);
      case "resend_invite":
        return await resendInviteEmail(payload);
      case "send_rejection":
        return await sendRejectionEmail(payload);
      case "send_test":
        return await sendTestEmail(payload);
      case "send_notification":
        return await sendNotificationEmail(payload);
      case "send_interview_invite":
        return await sendInterviewInviteEmail(payload);
      case "send_support_resolution":
        return await sendSupportResolutionEmail(payload);
      case "send_schedule_update":
        return await sendScheduleUpdateEmail(payload);
      case "send_weekly_schedule":
        return await sendWeeklyScheduleEmail(payload);
      case "send_daily_logbook_summary":
        return await sendDailyLogbookSummaryEmail(payload);
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error: any) {
    console.error("Error in email-service:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

// ============= EMAIL TEMPLATES & HELPERS =============

function wrapEmail(content: string): string {
  return `
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
              ${content}
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

// ============= HANDLER: send_invite =============

async function sendInviteEmail(payload: any): Promise<Response> {
  try {
    const { to, fullName, locationId, resetLink } = payload;

    if (!to || !fullName || !resetLink) {
      return new Response(
        JSON.stringify({ error: "to, fullName, and resetLink are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    let organizationName = "your new team";
    let locationName = "";
    let logoUrl = "";
    let brandName = "";

    if (locationId) {
      const { data: location } = await supabaseAdmin
        .from('locations')
        .select('name, organization_id')
        .eq('id', locationId)
        .single();

      if (location) {
        locationName = location.name;
        
        if (location.organization_id) {
          const { data: org } = await supabaseAdmin
            .from('organizations')
            .select('name, logo_url, brand_name')
            .eq('id', location.organization_id)
            .single();

          if (org) {
            organizationName = org.name;
            logoUrl = org.logo_url || "";
            brandName = org.brand_name || org.name;
          }
        }
      }
    }

    const firstName = fullName.split(' ')[0];

    const emailResponse = await resend.emails.send({
      from: "CrooHQ <hello@croohq.email>",
      to: [to],
      subject: `🎉 Welcome to ${brandName || organizationName}${locationName ? ` - ${locationName}` : ''}!`,
      html: wrapEmail(`
        <tr>
          <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 50px 40px 40px; text-align: center;">
            ${logoUrl ? `
              <img src="${logoUrl}" alt="${brandName || organizationName}" style="max-height: 100px; max-width: 200px; width: auto; margin-bottom: 20px; border-radius: 8px;" />
            ` : `
              <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
            `}
            <h1 style="color: #ffffff; font-size: 32px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">Welcome to the Team!</h1>
            <p style="color: rgba(255,255,255,0.9); font-size: 18px; margin: 12px 0 0; font-weight: 400;">
              ${brandName || organizationName}${locationName ? ` • ${locationName}` : ''}
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding: 40px;">
            <p style="color: ${textColor}; font-size: 18px; line-height: 1.6; margin: 0 0 20px;">
              Hey ${firstName}! 👋
            </p>
            <p style="color: ${textColor}; font-size: 16px; line-height: 1.7; margin: 0 0 20px;">
              <strong>Congratulations!</strong> You've been invited to join <strong style="color: ${primaryColor};">${brandName || organizationName}</strong>${locationName ? ` at the <strong>${locationName}</strong> location` : ''}. We're thrilled to have you on the team!
            </p>
            <div style="background: linear-gradient(135deg, ${backgroundColor} 0%, #e8e3d9 100%); border-radius: 12px; padding: 24px; margin: 30px 0;">
              <h2 style="color: ${textColor}; font-size: 16px; font-weight: 600; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.5px;">🚀 Getting Started</h2>
              <ol style="color: ${textColor}; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
                <li style="margin-bottom: 8px;"><strong>Set your password</strong> using the button below</li>
                <li style="margin-bottom: 8px;"><strong>Download the Croo app</strong> or visit croohq.com</li>
                <li style="margin-bottom: 8px;"><strong>Check your schedule</strong> and get ready for your first shift!</li>
              </ol>
            </div>
            <table role="presentation" style="width: 100%; margin: 35px 0;">
              <tr>
                <td style="text-align: center;">
                  <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, ${accentColor} 0%, #e06b10 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 6px 20px rgba(245, 130, 32, 0.35);">Set Your Password</a>
                </td>
              </tr>
            </table>
            <p style="color: #888; font-size: 13px; line-height: 1.5; margin: 20px 0 0; text-align: center;">
              This link will expire in 24 hours. If you didn't expect this invitation, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background-color: #f8f7f5; padding: 30px 40px; border-top: 1px solid #e8e5df;">
            <table role="presentation" style="width: 100%;">
              <tr>
                <td style="text-align: center;">
                  <img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Powered by Croo" style="height: 28px; width: auto; margin-bottom: 12px; opacity: 0.7;" />
                  <p style="color: #aaa; font-size: 12px; margin: 0;">Powered by Croo • Team management made simple</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `),
    });

    console.log("Invite email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, data: emailResponse }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error sending invite email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}

// ============= HANDLER: resend_invite =============

async function resendInviteEmail(payload: any): Promise<Response> {
  try {
    const { userId, newEmail } = payload;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (!userId) {
      throw new Error("User ID is required");
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();

    if (!profile) {
      throw new Error("User not found");
    }

    const emailToUse = newEmail || profile.email;

    if (newEmail && newEmail !== profile.email) {
      await supabaseAdmin.auth.admin.updateUserById(userId, { email: newEmail });
      await supabaseAdmin.from('profiles').update({ email: newEmail }).eq('id', userId);
    }

    const origin = Deno.env.get("SUPABASE_URL") || "";
    const redirectTo = `${origin}/reset-password`;

    const { data: resetData } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: emailToUse,
      options: { redirectTo },
    });

    console.log(`Password reset link generated for user ${userId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Invitation ${newEmail ? 'sent to new email' : 'resent'} successfully`,
        resetLink: resetData?.properties.action_link,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in resend-invite:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}

// ============= HANDLER: send_rejection =============

async function sendRejectionEmail(payload: any): Promise<Response> {
  try {
    const { applicationId, templateId, overrideEmail } = payload;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!applicationId || !templateId) {
      return new Response(
        JSON.stringify({ error: "applicationId and templateId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: application } = await supabase
      .from("job_applications")
      .select("id, full_name, email, organization_id")
      .eq("id", applicationId)
      .single();

    if (!application) {
      return new Response(
        JSON.stringify({ error: "Application not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: template } = await supabase
      .from("rejection_email_templates")
      .select("*")
      .eq("id", templateId)
      .eq("organization_id", application.organization_id)
      .single();

    if (!template) {
      return new Response(
        JSON.stringify({ error: "Template not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("name, logo_url, brand_name")
      .eq("id", application.organization_id)
      .single();

    const orgName = org?.brand_name || org?.name || "Our Team";
    const logoUrl = org?.logo_url || "";

    const subject = template.subject
      .replace(/{{name}}/gi, application.full_name)
      .replace(/{{first_name}}/gi, application.full_name.split(" ")[0])
      .replace(/{{organization}}/gi, orgName);

    const body = template.body
      .replace(/{{name}}/gi, application.full_name)
      .replace(/{{first_name}}/gi, application.full_name.split(" ")[0])
      .replace(/{{organization}}/gi, orgName);

    const htmlBody = body.replace(/\n/g, "<br>");

    const emailHtml = wrapEmail(`
      <tr>
        <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 30px 40px; text-align: center;">
          ${logoUrl ? `
            <img src="${logoUrl}" alt="${orgName}" style="max-height: 60px; max-width: 160px; width: auto; margin-bottom: 12px; border-radius: 8px;" />
          ` : `
            <img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height: 50px; width: auto; margin-bottom: 12px; filter: brightness(0) invert(1);" />
          `}
          <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 8px 0 0; font-weight: 500;">${orgName}</p>
        </td>
      </tr>
      <tr>
        <td style="padding: 30px 40px;">
          <div style="color: ${textColor}; font-size: 15px; line-height: 1.7;">
            ${htmlBody}
          </div>
        </td>
      </tr>
      <tr>
        <td style="background-color: #f8f7f5; padding: 24px 40px; border-top: 1px solid #e8e5df;">
          <table role="presentation" style="width: 100%;">
            <tr>
              <td style="text-align: center;">
                <img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Powered by Croo" style="height: 24px; width: auto; margin-bottom: 8px; opacity: 0.5;" />
                <p style="color: #aaa; font-size: 11px; margin: 0;">Powered by Croo • Team management made simple</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `);

    const recipientEmail = overrideEmail || application.email;
    const emailResponse = await resend.emails.send({
      from: "CrooHQ Hiring <hiring@croohq.email>",
      to: [recipientEmail],
      subject: subject,
      html: emailHtml,
    });

    console.log("Rejection email sent to:", recipientEmail);

    await supabase
      .from("job_applications")
      .update({
        rejection_template_id: templateId,
        rejection_email_sent_at: new Date().toISOString(),
      })
      .eq("id", applicationId);

    return new Response(
      JSON.stringify({ success: true, emailId: emailResponse.data?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in send-rejection-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// ============= HANDLER: send_test =============

async function sendTestEmail(payload: any): Promise<Response> {
  try {
    const { to, subject = "Welcome to Croo!" } = payload;

    if (!to) {
      return new Response(
        JSON.stringify({ error: "to is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailResponse = await resend.emails.send({
      from: "CrooHQ <hello@croohq.email>",
      to: [to],
      subject: subject,
      html: wrapEmail(`
        <tr>
          <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 40px 40px 30px; text-align: center;">
            <img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height: 80px; width: auto; margin-bottom: 16px; filter: brightness(0) invert(1);" />
            <h1 style="color: #ffffff; font-size: 28px; font-weight: 600; margin: 0;">Welcome to Croo!</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 40px;">
            <p style="color: ${textColor}; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
              Hey there! 👋
            </p>
            <p style="color: ${textColor}; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
              This is a test email from <strong style="color: ${primaryColor};">Croo</strong> — your all-in-one team management platform.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background-color: #f8f7f5; padding: 30px 40px; border-top: 1px solid #e8e5df;">
            <table role="presentation" style="width: 100%;">
              <tr>
                <td style="text-align: center;">
                  <p style="color: #888; font-size: 13px; margin: 0 0 10px;">Made with ❤️ by the Croo team</p>
                  <p style="color: #aaa; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} Croo. All rights reserved.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `),
    });

    console.log("Test email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, data: emailResponse }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error sending test email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}

// ============= HANDLER: send_notification =============

async function sendNotificationEmail(payload: any): Promise<Response> {
  // TODO: Implement full notification handler with types
  // For now, return a placeholder
  return new Response(
    JSON.stringify({ success: false, error: "Notification email handler coming soon" }),
    { status: 501, headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
}

// ============= HANDLER: send_interview_invite =============

async function sendInterviewInviteEmail(payload: any): Promise<Response> {
  // TODO: Implement interview invite handler
  return new Response(
    JSON.stringify({ success: false, error: "Interview invite handler coming soon" }),
    { status: 501, headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
}

// ============= HANDLER: send_support_resolution =============

async function sendSupportResolutionEmail(payload: any): Promise<Response> {
  // TODO: Implement support resolution handler
  return new Response(
    JSON.stringify({ success: false, error: "Support resolution handler coming soon" }),
    { status: 501, headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
}

// ============= HANDLER: send_schedule_update =============

async function sendScheduleUpdateEmail(payload: any): Promise<Response> {
  // TODO: Implement schedule update handler
  return new Response(
    JSON.stringify({ success: false, error: "Schedule update handler coming soon" }),
    { status: 501, headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
}

// ============= HANDLER: send_weekly_schedule =============

async function sendWeeklyScheduleEmail(payload: any): Promise<Response> {
  // TODO: Implement weekly schedule handler
  return new Response(
    JSON.stringify({ success: false, error: "Weekly schedule handler coming soon" }),
    { status: 501, headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
}

// ============= HANDLER: send_daily_logbook_summary =============

async function sendDailyLogbookSummaryEmail(payload: any): Promise<Response> {
  // TODO: Implement daily logbook summary handler
  return new Response(
    JSON.stringify({ success: false, error: "Daily logbook summary handler coming soon" }),
    { status: 501, headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
}

serve(handler);
