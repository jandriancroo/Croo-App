import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// Hardcoded support admins who receive all support notifications
const SUPPORT_ADMIN_EMAILS = ["jordan@jo-pizza.com"];

interface NotifySupportRequest {
  ticket_id: string;
  event_type: "new_ticket" | "new_message" | "status_change";
  message_content?: string;
  sender_name?: string;
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
    let emailBody = "";
    let pushTitle = "";
    let pushBody = "";

    switch (event_type) {
      case "new_ticket":
        emailSubject = `New Support Ticket ${ticketNumber} from ${userName}`;
        pushTitle = `New Support Ticket ${ticketNumber}`;
        pushBody = `${userName} reported: ${categoryLabel}`;
        emailBody = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #333; font-size: 24px;">New Support Ticket 🎫</h1>
            
            <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">Ticket ${ticketNumber}</p>
              <p style="margin: 0 0 8px 0; color: #333; font-weight: 600; font-size: 16px;">${categoryLabel}</p>
              <p style="margin: 0 0 8px 0; color: #333;">From: ${userName}</p>
              <p style="margin: 0; color: #666;">${ticket.description}</p>
            </div>
            
            <p style="color: #666; font-size: 14px;">
              Log in to CrooHQ to respond to this ticket.
            </p>
          </div>
        `;
        break;

      case "new_message":
        emailSubject = `New message on ${ticketNumber} from ${sender_name || userName}`;
        pushTitle = `Message on ${ticketNumber}`;
        pushBody = message_content?.substring(0, 100) || "New message received";
        emailBody = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #333; font-size: 24px;">New Message on ${ticketNumber} 💬</h1>
            
            <p style="color: #666; font-size: 14px;">From: ${sender_name || userName}</p>
            
            <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 0; color: #333;">${message_content || "(no content)"}</p>
            </div>
            
            <p style="color: #666; font-size: 14px;">
              Log in to CrooHQ to view and respond.
            </p>
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
          from: "Croo Support <support@croohq.email>",
          to: [email],
          subject: emailSubject,
          html: emailBody,
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
