import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InviteEmailRequest {
  to: string;
  fullName: string;
  locationId?: string;
  resetLink: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const { to, fullName, locationId, resetLink }: InviteEmailRequest = await req.json();
    
    console.log(`Sending invite email to: ${to} for location: ${locationId}`);

    // Get organization and location details
    let organizationName = "your new team";
    let locationName = "";
    let logoUrl = "";
    let brandName = "";

    if (locationId) {
      const { data: location, error: locationError } = await supabaseAdmin
        .from('locations')
        .select('name, organization_id')
        .eq('id', locationId)
        .single();

      if (!locationError && location) {
        locationName = location.name;
        
        if (location.organization_id) {
          const { data: org, error: orgError } = await supabaseAdmin
            .from('organizations')
            .select('name, logo_url, brand_name')
            .eq('id', location.organization_id)
            .single();

          if (!orgError && org) {
            organizationName = org.name;
            logoUrl = org.logo_url || "";
            brandName = org.brand_name || org.name;
          }
        }
      }
    }

    // Get first name for greeting
    const firstName = fullName.split(' ')[0];

    // Croo brand colors from the design system
    const primaryColor = "#0a7a8a"; // teal
    const accentColor = "#f58220"; // orange
    const backgroundColor = "#f0ebe1"; // beige
    const textColor = "#0f1215"; // dark

    const emailResponse = await resend.emails.send({
      from: "Croo <hello@croohq.email>",
      to: [to],
      subject: `🎉 Welcome to ${brandName || organizationName}${locationName ? ` - ${locationName}` : ''}!`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to the Team!</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: ${backgroundColor}; font-family: 'Lexend', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
                  
                  <!-- Header with Brand Logo -->
                  <tr>
                    <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 50px 40px 40px; text-align: center;">
                      ${logoUrl ? `
                        <img 
                          src="${logoUrl}" 
                          alt="${brandName || organizationName}" 
                          style="max-height: 100px; max-width: 200px; width: auto; margin-bottom: 20px; border-radius: 8px;"
                        />
                      ` : `
                        <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
                      `}
                      <h1 style="color: #ffffff; font-size: 32px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">
                        Welcome to the Team!
                      </h1>
                      <p style="color: rgba(255,255,255,0.9); font-size: 18px; margin: 12px 0 0; font-weight: 400;">
                        ${brandName || organizationName}${locationName ? ` • ${locationName}` : ''}
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 40px;">
                      <p style="color: ${textColor}; font-size: 18px; line-height: 1.6; margin: 0 0 20px;">
                        Hey ${firstName}! 👋
                      </p>
                      <p style="color: ${textColor}; font-size: 16px; line-height: 1.7; margin: 0 0 20px;">
                        <strong>Congratulations!</strong> You've been invited to join <strong style="color: ${primaryColor};">${brandName || organizationName}</strong>${locationName ? ` at the <strong>${locationName}</strong> location` : ''}. We're thrilled to have you on the team!
                      </p>
                      
                      <!-- What's Next Section -->
                      <div style="background: linear-gradient(135deg, ${backgroundColor} 0%, #e8e3d9 100%); border-radius: 12px; padding: 24px; margin: 30px 0;">
                        <h2 style="color: ${textColor}; font-size: 16px; font-weight: 600; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.5px;">
                          🚀 Getting Started
                        </h2>
                        <ol style="color: ${textColor}; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
                          <li style="margin-bottom: 8px;"><strong>Set your password</strong> using the button below</li>
                          <li style="margin-bottom: 8px;"><strong>Download the Croo app</strong> or visit croohq.com</li>
                          <li style="margin-bottom: 8px;"><strong>Check your schedule</strong> and get ready for your first shift!</li>
                        </ol>
                      </div>
                      
                      <!-- CTA Button -->
                      <table role="presentation" style="width: 100%; margin: 35px 0;">
                        <tr>
                          <td style="text-align: center;">
                            <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, ${accentColor} 0%, #e06b10 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 6px 20px rgba(245, 130, 32, 0.35);">
                              Set Your Password
                            </a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="color: #888; font-size: 13px; line-height: 1.5; margin: 20px 0 0; text-align: center;">
                        This link will expire in 24 hours. If you didn't expect this invitation, you can safely ignore this email.
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f8f7f5; padding: 30px 40px; border-top: 1px solid #e8e5df;">
                      <table role="presentation" style="width: 100%;">
                        <tr>
                          <td style="text-align: center;">
                            <img 
                              src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
                              alt="Powered by Croo" 
                              style="height: 28px; width: auto; margin-bottom: 12px; opacity: 0.7;"
                            />
                            <p style="color: #aaa; font-size: 12px; margin: 0;">
                              Powered by Croo • Team management made simple
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });

    console.log("Invite email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error sending invite email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
