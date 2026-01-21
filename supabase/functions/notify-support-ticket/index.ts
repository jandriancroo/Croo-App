import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// Croo brand colors
const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

// Hardcoded support admins who receive all support notifications
const SUPPORT_ADMIN_EMAILS = ["jordan@jo-pizza.com"];

interface NotifySupportRequest {
  ticket_id: string;
  event_type: "new_ticket" | "new_message" | "status_change";
  message_content?: string;
  sender_name?: string;
}

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { ticket_id, event_type, message_content, sender_name }: NotifySupportRequest = await req.json();
    console.log("Support notification request:", { ticket_id, event_type, message_content, sender_name });

    // Get ticket details
    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .select(`
        *,
        profiles:user_id (full_name, email)
      `)
      .eq("id", ticket_id)
      .single();

    if (ticketError || !ticket) {
      console.error("Error fetching ticket:", ticketError);
      throw new Error("Ticket not found");
    }

    const ticketNumber = `#SUP-${String(ticket.ticket_number).padStart(3, '0')}`;
    const userName = ticket.profiles?.full_name || "Unknown User";
    const categoryLabels: Record<string, string> = {
      ui_glitch: 'UI Glitch',
      broken_feature: 'Broken Feature',
      login_issues: 'Login Issues',
      data_sync_issues: 'Data/Sync Issues',
      notification_issues: 'Notification Issues',
      scheduling_issues: 'Scheduling Issues',
      other: 'Other',
    };
    const categoryLabel = categoryLabels[ticket.category] || ticket.category;

    // Prepare notification content based on event type
    let emailSubject = "";
    let emailContent = "";
    let pushTitle = "";
    let pushBody = "";
    let headerEmoji = "🎫";

    switch (event_type) {
      case "new_ticket":
        headerEmoji = "🎫";
        emailSubject = `New Support Ticket ${ticketNumber} from ${userName}`;
        pushTitle = `New Support Ticket ${ticketNumber}`;
        pushBody = `${userName} reported: ${categoryLabel}`;
        emailContent = `
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
            A new support ticket has been submitted.
          </p>
          
          <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 20px; margin-bottom: 24px;">
            <table role="presentation" style="width: 100%;">
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px; text-transform: uppercase;">Ticket</span><br/>
                  <strong style="color: ${primaryColor}; font-size: 16px;">${ticketNumber}</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px; text-transform: uppercase;">Category</span><br/>
                  <strong style="color: ${textColor}; font-size: 14px;">${categoryLabel}</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">
                  <span style="color: #666; font-size: 12px; text-transform: uppercase;">From</span><br/>
                  <strong style="color: ${textColor}; font-size: 14px;">${userName}</strong>
                </td>
              </tr>
            </table>
          </div>
          
          <div style="background-color: #fafafa; border-radius: 10px; padding: 16px; border-left: 4px solid ${primaryColor};">
            <p style="color: #666; font-size: 12px; text-transform: uppercase; margin: 0 0 8px;">Description</p>
            <p style="color: ${textColor}; font-size: 14px; line-height: 1.5; margin: 0;">${ticket.description}</p>
          </div>
        `;
        break;

      case "new_message":
        headerEmoji = "💬";
        emailSubject = `New message on ${ticketNumber} from ${sender_name || userName}`;
        pushTitle = `Message on ${ticketNumber}`;
        pushBody = message_content?.substring(0, 100) || "New message received";
        emailContent = `
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 8px;">
            New message on <strong style="color: ${primaryColor};">${ticketNumber}</strong>
          </p>
          <p style="color: #666; font-size: 13px; margin: 0 0 20px;">
            From: ${sender_name || userName}
          </p>
          
          <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; border-left: 4px solid ${primaryColor};">
            <p style="color: ${textColor}; font-size: 14px; line-height: 1.5; margin: 0;">${message_content || "(no content)"}</p>
          </div>
        `;
        break;

      default:
        console.log("Unknown event type:", event_type);
        return new Response(JSON.stringify({ success: true, message: "No action taken" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
    }

    const emailHtml = wrapEmail(`
      <!-- Header -->
      <tr>
        <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 30px 40px; text-align: center;">
          <img 
            src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
            alt="Croo" 
            style="height: 50px; width: auto; margin-bottom: 12px; filter: brightness(0) invert(1);" 
          />
          <h1 style="color: #ffffff; font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.5px;">
            ${headerEmoji} Support Notification
          </h1>
        </td>
      </tr>
      
      <!-- Content -->
      <tr>
        <td style="padding: 30px 40px;">
          ${emailContent}
          
          <table role="presentation" style="width: 100%; margin-top: 24px;">
            <tr>
              <td style="text-align: center;">
                <a href="https://croohq.com" style="display: inline-block; background: linear-gradient(135deg, ${accentColor} 0%, #e06b10 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">
                  View in Croo
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      
      <!-- Footer -->
      <tr>
        <td style="background-color: #f8f7f5; padding: 24px 40px; border-top: 1px solid #e8e5df;">
          <table role="presentation" style="width: 100%;">
            <tr>
              <td style="text-align: center;">
                <img 
                  src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
                  alt="Powered by Croo" 
                  style="height: 24px; width: auto; margin-bottom: 8px; opacity: 0.5;"
                />
                <p style="color: #aaa; font-size: 11px; margin: 0;">
                  © ${new Date().getFullYear()} Croo. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `);

    // Get support admins by email
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("email", SUPPORT_ADMIN_EMAILS);

    const adminIds = adminProfiles?.map(p => p.id) || [];
    const adminEmails = adminProfiles?.map(p => p.email).filter(Boolean) || [];

    console.log("Notifying support admins:", adminEmails);

    // Send email notifications
    for (const email of adminEmails) {
      try {
        await resend.emails.send({
          from: "CrooHQ Support <support@croohq.email>",
          to: [email],
          subject: emailSubject,
          html: emailHtml,
        });
        console.log("Email sent to:", email);
      } catch (emailError) {
        console.error("Error sending email to", email, emailError);
      }
    }

    // Send push notifications to admins
    if (adminIds.length > 0) {
      try {
        await supabase.functions.invoke("send-push-notification", {
          body: {
            user_ids: adminIds,
            title: pushTitle,
            body: pushBody,
            data: {
              type: "support_ticket",
              ticketId: ticket.id,
            },
            notification_type: "support_tickets",
          },
        });
        console.log("Push notifications sent to admin IDs:", adminIds);
      } catch (pushError) {
        console.error("Error sending push notifications:", pushError);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in notify-support-ticket:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
