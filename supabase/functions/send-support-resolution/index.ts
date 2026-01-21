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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { ticketId } = await req.json();
    console.log("Processing resolution for ticket:", ticketId);

    // Get ticket details with user info
    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .select(`
        *,
        profiles:user_id (full_name, email)
      `)
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      console.error("Error fetching ticket:", ticketError);
      throw new Error("Ticket not found");
    }

    const ticketNumber = `#SUP-${String(ticket.ticket_number).padStart(3, '0')}`;
    const userEmail = ticket.profiles?.email;
    const userName = ticket.profiles?.full_name || "Team Member";
    const firstName = userName.split(' ')[0];

    console.log("Sending resolution email to:", userEmail);

    // Send email notification
    if (userEmail) {
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
              ✅ Ticket Resolved
            </h1>
          </td>
        </tr>
        
        <!-- Content -->
        <tr>
          <td style="padding: 30px 40px;">
            <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
              Good news, ${firstName}! 🎉
            </p>
            <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
              Your support ticket <strong style="color: ${primaryColor};">${ticketNumber}</strong> has been marked as resolved.
            </p>
            
            <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin-bottom: 24px; border-left: 4px solid ${primaryColor};">
              <p style="color: #666; font-size: 12px; text-transform: uppercase; margin: 0 0 8px;">Original Issue</p>
              <p style="color: ${textColor}; font-size: 14px; line-height: 1.5; margin: 0;">${ticket.description}</p>
            </div>
            
            <p style="color: #666; font-size: 14px; line-height: 1.5; margin: 0 0 24px;">
              If you're still experiencing issues or have any questions, feel free to create a new support ticket in the app.
            </p>
            
            <table role="presentation" style="width: 100%;">
              <tr>
                <td style="text-align: center;">
                  <a href="https://croohq.com" style="display: inline-block; background: linear-gradient(135deg, ${accentColor} 0%, #e06b10 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">
                    Open Croo
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
                  <p style="color: #666; font-size: 13px; margin: 0 0 8px;">Thank you for using Croo!</p>
                  <p style="color: #aaa; font-size: 11px; margin: 0;">
                    The Support Team
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `);

      const emailResponse = await resend.emails.send({
        from: "CrooHQ Support <support@croohq.email>",
        to: [userEmail],
        subject: `Your support ticket ${ticketNumber} has been resolved`,
        html: emailHtml,
      });

      console.log("Email sent:", emailResponse);
    }

    // Send push notification
    const { data: pushTokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("user_id", ticket.user_id);

    if (pushTokens && pushTokens.length > 0) {
      console.log("Sending push notification to user");
      
      await supabase.functions.invoke("send-push-notification", {
        body: {
          tokens: pushTokens.map(t => t.token),
          title: `Ticket ${ticketNumber} Resolved`,
          body: "Your support ticket has been resolved. Check the app for details.",
          data: {
            type: "support_resolved",
            ticketId: ticket.id,
          },
        },
      });
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-support-resolution:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
