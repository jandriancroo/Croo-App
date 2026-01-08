import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

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

    console.log("Sending resolution email to:", userEmail);

    // Send email notification
    if (userEmail) {
      const emailResponse = await resend.emails.send({
        from: "Croo Support <support@croohq.email>",
        to: [userEmail],
        subject: `Your support ticket ${ticketNumber} has been resolved`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #333; font-size: 24px;">Good news, ${userName}! 🎉</h1>
            
            <p style="color: #666; font-size: 16px; line-height: 1.5;">
              Your support ticket <strong>${ticketNumber}</strong> has been marked as resolved.
            </p>
            
            <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 0 0 8px 0; color: #333; font-weight: 600;">Original Issue:</p>
              <p style="margin: 0; color: #666;">${ticket.description}</p>
            </div>
            
            <p style="color: #666; font-size: 16px; line-height: 1.5;">
              If you're still experiencing issues or have any questions, feel free to create a new support ticket in the app.
            </p>
            
            <p style="color: #999; font-size: 14px; margin-top: 30px;">
              Thank you for using Croo!<br>
              The Support Team
            </p>
          </div>
        `,
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
