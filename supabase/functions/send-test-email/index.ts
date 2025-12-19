import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TestEmailRequest {
  to: string;
  subject?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, subject = "Welcome to Croo!" }: TestEmailRequest = await req.json();
    
    console.log(`Sending test email to: ${to}`);

    // Croo brand colors from the design system
    const primaryColor = "#0a7a8a"; // hsl(186 85% 30%) - teal
    const accentColor = "#f58220"; // hsl(28 95% 48%) - orange
    const backgroundColor = "#f0ebe1"; // hsl(40 33% 94%) - beige
    const textColor = "#0f1215"; // hsl(220 25% 5%) - dark

    const emailResponse = await resend.emails.send({
      from: "Croo <hello@croohq.email>",
      to: [to],
      subject: subject,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: ${backgroundColor}; font-family: 'Lexend', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
                  
                  <!-- Header with Logo -->
                  <tr>
                    <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 40px 40px 30px; text-align: center;">
                      <img 
                        src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/public-assets/croo-logo-white.png" 
                        alt="Croo" 
                        style="height: 50px; width: auto;"
                        onerror="this.style.display='none'"
                      />
                      <h1 style="color: #ffffff; font-size: 28px; font-weight: 600; margin: 20px 0 0; letter-spacing: -0.5px;">
                        Welcome to Croo!
                      </h1>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 40px;">
                      <p style="color: ${textColor}; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                        Hey there! 👋
                      </p>
                      <p style="color: ${textColor}; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                        This is a test email from <strong style="color: ${primaryColor};">Croo</strong> — your all-in-one team management platform. If you're seeing this, your email integration is working perfectly!
                      </p>
                      
                      <!-- Feature Highlights -->
                      <table role="presentation" style="width: 100%; margin: 30px 0; border-collapse: collapse;">
                        <tr>
                          <td style="padding: 15px; background-color: ${backgroundColor}; border-radius: 12px;">
                            <table role="presentation" style="width: 100%;">
                              <tr>
                                <td style="width: 40px; vertical-align: top;">
                                  <span style="font-size: 24px;">📅</span>
                                </td>
                                <td style="padding-left: 12px;">
                                  <strong style="color: ${textColor}; font-size: 14px;">Smart Scheduling</strong>
                                  <p style="color: #666; font-size: 13px; margin: 4px 0 0; line-height: 1.4;">Build schedules in seconds with intelligent templates</p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr><td style="height: 10px;"></td></tr>
                        <tr>
                          <td style="padding: 15px; background-color: ${backgroundColor}; border-radius: 12px;">
                            <table role="presentation" style="width: 100%;">
                              <tr>
                                <td style="width: 40px; vertical-align: top;">
                                  <span style="font-size: 24px;">⏰</span>
                                </td>
                                <td style="padding-left: 12px;">
                                  <strong style="color: ${textColor}; font-size: 14px;">Time Clock</strong>
                                  <p style="color: #666; font-size: 13px; margin: 4px 0 0; line-height: 1.4;">Track hours with GPS verification and break management</p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr><td style="height: 10px;"></td></tr>
                        <tr>
                          <td style="padding: 15px; background-color: ${backgroundColor}; border-radius: 12px;">
                            <table role="presentation" style="width: 100%;">
                              <tr>
                                <td style="width: 40px; vertical-align: top;">
                                  <span style="font-size: 24px;">✅</span>
                                </td>
                                <td style="padding-left: 12px;">
                                  <strong style="color: ${textColor}; font-size: 14px;">Task Management</strong>
                                  <p style="color: #666; font-size: 13px; margin: 4px 0 0; line-height: 1.4;">Keep your team on track with checklists and assignments</p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="color: ${textColor}; font-size: 16px; line-height: 1.6; margin: 20px 0;">
                        Ready to streamline your operations?
                      </p>
                      
                      <!-- CTA Button -->
                      <table role="presentation" style="width: 100%; margin: 30px 0;">
                        <tr>
                          <td style="text-align: center;">
                            <a href="https://croo.app" style="display: inline-block; background: linear-gradient(135deg, ${accentColor} 0%, #e06b10 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 12px rgba(245, 130, 32, 0.3);">
                              Open Croo Dashboard
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f8f7f5; padding: 30px 40px; border-top: 1px solid #e8e5df;">
                      <table role="presentation" style="width: 100%;">
                        <tr>
                          <td style="text-align: center;">
                            <p style="color: #888; font-size: 13px; margin: 0 0 10px;">
                              Made with ❤️ by the Croo team
                            </p>
                            <p style="color: #aaa; font-size: 12px; margin: 0;">
                              © ${new Date().getFullYear()} Croo. All rights reserved.
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

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error sending test email:", error);
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
