import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotifyApplicationRequest {
  applicationId: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string;
  locationId?: string;
  organizationId: string;
  templateName: string;
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

    // Get organization name
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("name, brand_name")
      .eq("id", organizationId)
      .single();

    const orgDisplayName = org?.brand_name || org?.name || "Your Organization";

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

    // Send email to all recipients
    const emailPromises = uniqueEmails.map(email => 
      resend.emails.send({
        from: "Croo Hiring <hiring@croohq.email>",
        to: [email],
        subject: `📋 New Application: ${applicantName} - ${templateName}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">New Job Application</h1>
                <p style="color: #a0a0a0; margin: 10px 0 0 0;">${orgDisplayName}</p>
              </div>
              
              <div style="background: #ffffff; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h2 style="color: #333; margin: 0 0 20px 0; font-size: 20px;">Applicant Details</h2>
                
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666; width: 120px;">Name:</td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #333; font-weight: 500;">${applicantName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666;">Email:</td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #333;">
                      <a href="mailto:${applicantEmail}" style="color: #2563eb; text-decoration: none;">${applicantEmail}</a>
                    </td>
                  </tr>
                  ${applicantPhone ? `
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666;">Phone:</td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #333;">
                      <a href="tel:${applicantPhone}" style="color: #2563eb; text-decoration: none;">${applicantPhone}</a>
                    </td>
                  </tr>
                  ` : ''}
                  <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666;">Position:</td>
                    <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #333;">${templateName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 0; color: #666;">Location:</td>
                    <td style="padding: 12px 0; color: #333;">${locationName}</td>
                  </tr>
                </table>
                
                <div style="margin-top: 30px; text-align: center;">
                  <a href="${reviewUrl}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                    Review Application
                  </a>
                </div>
                
                <p style="color: #888; font-size: 12px; margin-top: 30px; text-align: center;">
                  This notification was sent by Croo. You can manage your notification preferences in the app settings.
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
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
