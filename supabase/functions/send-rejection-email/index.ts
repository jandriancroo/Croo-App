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
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

interface RejectionEmailRequest {
  applicationId: string;
  templateId: string;
  overrideEmail?: string; // For testing - send to different email
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

    const { applicationId, templateId, overrideEmail }: RejectionEmailRequest = await req.json();

    if (!applicationId || !templateId) {
      return new Response(
        JSON.stringify({ error: "applicationId and templateId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the application
    const { data: application, error: appError } = await supabase
      .from("job_applications")
      .select("id, full_name, email, organization_id")
      .eq("id", applicationId)
      .single();

    if (appError || !application) {
      console.error("Error fetching application:", appError);
      return new Response(
        JSON.stringify({ error: "Application not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the template
    const { data: template, error: templateError } = await supabase
      .from("rejection_email_templates")
      .select("*")
      .eq("id", templateId)
      .eq("organization_id", application.organization_id)
      .single();

    if (templateError || !template) {
      console.error("Error fetching template:", templateError);
      return new Response(
        JSON.stringify({ error: "Template not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch organization for branding
    const { data: org } = await supabase
      .from("organizations")
      .select("name, logo_url, brand_name")
      .eq("id", application.organization_id)
      .single();

    const orgName = org?.brand_name || org?.name || "Our Team";
    const logoUrl = org?.logo_url || "";

    // Replace placeholders in template
    const subject = template.subject
      .replace(/{{name}}/gi, application.full_name)
      .replace(/{{first_name}}/gi, application.full_name.split(" ")[0])
      .replace(/{{organization}}/gi, orgName);

    const body = template.body
      .replace(/{{name}}/gi, application.full_name)
      .replace(/{{first_name}}/gi, application.full_name.split(" ")[0])
      .replace(/{{organization}}/gi, orgName);

    // Convert newlines to HTML breaks for email
    const htmlBody = body.replace(/\n/g, "<br>");

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
          <div style="color: ${textColor}; font-size: 15px; line-height: 1.7;">
            ${htmlBody}
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

    // Send the email (use override email for testing if provided)
    const recipientEmail = overrideEmail || application.email;
    const emailResponse = await resend.emails.send({
      from: "CrooHQ Hiring <hiring@croohq.email>",
      to: [recipientEmail],
      subject: subject,
      html: emailHtml,
    });

    console.log("Rejection email sent to:", recipientEmail, emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailId: emailResponse.data?.id }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in send-rejection-email function:", error);
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
