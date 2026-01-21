import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Croo brand colors
const primaryColor = "#0a7a8a";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

interface NotifyHiringMessageRequest {
  conversationId: string;
  messageContent: string;
  senderName: string;
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

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { conversationId, messageContent, senderName }: NotifyHiringMessageRequest = await req.json();

    if (!conversationId || !messageContent) {
      return new Response(
        JSON.stringify({ error: "conversationId and messageContent are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch conversation with application and org details
    const { data: conversation, error: convError } = await supabase
      .from("hiring_conversations")
      .select(`
        id,
        access_token,
        application:job_applications(
          id,
          full_name,
          email,
          organization_id,
          organization:organizations(name, logo_url, brand_name)
        )
      `)
      .eq("id", conversationId)
      .single();

    if (convError || !conversation) {
      console.error("Error fetching conversation:", convError);
      return new Response(
        JSON.stringify({ error: "Conversation not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const application = conversation.application as any;
    const org = application?.organization;
    const applicantEmail = application?.email;
    const applicantName = application?.full_name || "Applicant";
    const orgName = org?.brand_name || org?.name || "Hiring Team";
    const logoUrl = org?.logo_url || "";

    if (!applicantEmail) {
      return new Response(
        JSON.stringify({ error: "Applicant has no email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the chat URL
    const chatUrl = `https://kitchen-check-mate.lovable.app/hiring-chat/${conversation.access_token}`;

    const emailHtml = wrapEmail(`
      <!-- Header -->
      <tr>
        <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 30px 40px; text-align: center;">
          ${logoUrl ? `
            <img 
              src="${logoUrl}" 
              alt="${orgName}" 
              style="max-height: 60px; max-width: 160px; width: auto; margin-bottom: 12px; border-radius: 8px;"
            />
          ` : `
            <img 
              src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
              alt="Croo" 
              style="height: 50px; width: auto; margin-bottom: 12px; filter: brightness(0) invert(1);" 
            />
          `}
          <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 8px 0 0; font-weight: 500;">
            ${orgName}
          </p>
        </td>
      </tr>
      
      <!-- Content -->
      <tr>
        <td style="padding: 30px 40px;">
          <p style="color: ${textColor}; font-size: 15px; line-height: 1.7; margin: 0 0 20px;">
            Hi ${applicantName.split(" ")[0]},
          </p>
          
          <p style="color: #666; font-size: 14px; margin: 0 0 16px;">
            <strong>${senderName}</strong> from ${orgName} sent you a message:
          </p>
          
          <!-- Message Box -->
          <div style="background-color: #f8f7f5; border-left: 4px solid ${primaryColor}; padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 0 0 24px;">
            <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0; white-space: pre-wrap;">
              ${messageContent.replace(/\n/g, "<br>")}
            </p>
          </div>
          
          <!-- CTA Button -->
          <div style="text-align: center; margin: 24px 0;">
            <a href="${chatUrl}" style="display: inline-block; background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 15px;">
              Reply to Message
            </a>
          </div>
          
          <!-- Instructions -->
          <div style="background-color: #f0f9fa; border-radius: 8px; padding: 16px 20px; margin-top: 24px;">
            <p style="color: ${primaryColor}; font-size: 13px; font-weight: 600; margin: 0 0 8px;">
              📱 Get instant notifications on your phone:
            </p>
            <ol style="color: #666; font-size: 13px; line-height: 1.6; margin: 0; padding-left: 20px;">
              <li>Click the link above to open your chat</li>
              <li>Tap the <strong>Share</strong> button in your browser</li>
              <li>Select <strong>"Add to Home Screen"</strong></li>
              <li>Enable notifications when prompted</li>
            </ol>
          </div>
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
                  Powered by Croo • Team management made simple
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `);

    // Send the email
    const emailResponse = await resend.emails.send({
      from: "CrooHQ Hiring <hiring@croohq.email>",
      to: [applicantEmail],
      subject: `New message from ${orgName}`,
      html: emailHtml,
    });

    console.log("Hiring message notification sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailId: emailResponse.data?.id }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in notify-hiring-message function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
