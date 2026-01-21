import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Croo brand colors
const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

interface NotifyApplicationRequest {
  applicationId: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string;
  locationId?: string;
  organizationId: string;
  templateName: string;
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

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      applicationId,
      applicantName, 
      applicantEmail, 
      applicantPhone,
      locationId, 
      organizationId,
      templateName 
    }: NotifyApplicationRequest = await req.json();

    console.log("Received new application notification request:", {
      applicationId,
      applicantName,
      applicantEmail,
      locationId,
      organizationId,
      templateName
    });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get organization name and logo
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("name, brand_name, logo_url")
      .eq("id", organizationId)
      .single();

    const orgDisplayName = org?.brand_name || org?.name || "Your Organization";
    const logoUrl = org?.logo_url || "";

    // Get location name if provided
    let locationName = "Any Location";
    if (locationId) {
      const { data: location } = await supabaseAdmin
        .from("locations")
        .select("name")
        .eq("id", locationId)
        .single();
      locationName = location?.name || "Unknown Location";
    }

    // Get all admins and general managers for this location/organization
    let recipientQuery = supabaseAdmin
      .from("profiles")
      .select(`
        id,
        email,
        full_name,
        user_roles!inner(role),
        user_locations!inner(location_id)
      `)
      .in("user_roles.role", ["admin", "general_manager"]);

    // Filter by location if specified, otherwise get all org admins
    if (locationId) {
      recipientQuery = recipientQuery.eq("user_locations.location_id", locationId);
    }

    const { data: recipients, error: recipientError } = await recipientQuery;

    if (recipientError) {
      console.error("Error fetching recipients:", recipientError);
      throw recipientError;
    }

    // Get unique emails (a user might have multiple roles/locations)
    const uniqueEmails = [...new Set(recipients?.map(r => r.email).filter(Boolean))] as string[];

    console.log("Sending notification to:", uniqueEmails);

    if (uniqueEmails.length === 0) {
      console.log("No recipients found for notification");
      return new Response(
        JSON.stringify({ success: true, message: "No recipients to notify" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Build the application review URL
    const appUrl = Deno.env.get("SITE_URL") || "https://croo.app";
    const reviewUrl = `${appUrl}/hiring`;

    const emailHtml = wrapEmail(`
      <!-- Header -->
      <tr>
        <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 30px 40px; text-align: center;">
          ${logoUrl ? `
            <img 
              src="${logoUrl}" 
              alt="${orgDisplayName}" 
              style="max-height: 60px; max-width: 160px; width: auto; margin-bottom: 12px; border-radius: 8px;"
            />
          ` : `
            <img 
              src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
              alt="Croo" 
              style="height: 50px; width: auto; margin-bottom: 12px; filter: brightness(0) invert(1);" 
            />
          `}
          <h1 style="color: #ffffff; font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.5px;">
            📋 New Job Application
          </h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 14px; margin: 8px 0 0;">
            ${orgDisplayName}
          </p>
        </td>
      </tr>
      
      <!-- Content -->
      <tr>
        <td style="padding: 30px 40px;">
          <h2 style="color: ${textColor}; font-size: 18px; font-weight: 600; margin: 0 0 20px;">
            Applicant Details
          </h2>
          
          <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 20px; margin-bottom: 24px;">
            <table role="presentation" style="width: 100%;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e8e5df;">
                  <span style="color: #666; font-size: 12px; text-transform: uppercase;">Name</span><br/>
                  <strong style="color: ${textColor}; font-size: 16px;">${applicantName}</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e8e5df;">
                  <span style="color: #666; font-size: 12px; text-transform: uppercase;">Email</span><br/>
                  <a href="mailto:${applicantEmail}" style="color: ${primaryColor}; font-size: 14px; text-decoration: none;">${applicantEmail}</a>
                </td>
              </tr>
              ${applicantPhone ? `
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e8e5df;">
                  <span style="color: #666; font-size: 12px; text-transform: uppercase;">Phone</span><br/>
                  <a href="tel:${applicantPhone}" style="color: ${primaryColor}; font-size: 14px; text-decoration: none;">${applicantPhone}</a>
                </td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e8e5df;">
                  <span style="color: #666; font-size: 12px; text-transform: uppercase;">Position</span><br/>
                  <strong style="color: ${textColor}; font-size: 14px;">${templateName}</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">
                  <span style="color: #666; font-size: 12px; text-transform: uppercase;">Location</span><br/>
                  <strong style="color: ${textColor}; font-size: 14px;">${locationName}</strong>
                </td>
              </tr>
            </table>
          </div>
          
          <table role="presentation" style="width: 100%;">
            <tr>
              <td style="text-align: center;">
                <a href="${reviewUrl}" style="display: inline-block; background: linear-gradient(135deg, ${accentColor} 0%, #e06b10 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">
                  Review Application
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
                  Powered by Croo • Team management made simple
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `);

    // Send email to all recipients
    const emailPromises = uniqueEmails.map(email => 
      resend.emails.send({
        from: "CrooHQ Hiring <hiring@croohq.email>",
        to: [email],
        subject: `📋 New Application: ${applicantName} - ${templateName}`,
        html: emailHtml,
      })
    );

    const results = await Promise.allSettled(emailPromises);
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log(`Email notifications sent: ${successful} successful, ${failed} failed`);

    if (failed > 0) {
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          console.error(`Failed to send to ${uniqueEmails[i]}:`, result.reason);
        }
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        sent: successful, 
        failed,
        recipients: uniqueEmails.length 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in notify-new-application:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
