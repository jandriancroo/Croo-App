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

interface NotifyRequest {
  userId: string;
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { userId }: NotifyRequest = await req.json();
    console.log("Processing employee joined notification for user:", userId);

    // Get the new employee's profile
    const { data: newEmployee, error: employeeError } = await supabase
      .from("profiles")
      .select("id, full_name, email, invited_by, first_login_at")
      .eq("id", userId)
      .single();

    if (employeeError || !newEmployee) {
      console.error("Error fetching employee:", employeeError);
      return new Response(
        JSON.stringify({ error: "Employee not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already processed (first_login_at already set)
    if (newEmployee.first_login_at) {
      console.log("Employee already processed, skipping notification");
      return new Response(
        JSON.stringify({ message: "Already processed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update first_login_at
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ first_login_at: new Date().toISOString() })
      .eq("id", userId);

    if (updateError) {
      console.error("Error updating first_login_at:", updateError);
    }

    // Get the user's location(s)
    const { data: userLocations } = await supabase
      .from("user_locations")
      .select("location_id, locations(id, name, organization_id)")
      .eq("user_id", userId);

    if (!userLocations || userLocations.length === 0) {
      console.log("No locations found for user, skipping notification");
      return new Response(
        JSON.stringify({ message: "No locations found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const locationIds = userLocations.map(ul => ul.location_id);
    const locationNames = userLocations.map(ul => (ul.locations as any)?.name).filter(Boolean);

    // Get managers/admins at these locations who should be notified
    // First get all users at these locations (except the new user)
    const { data: locationUsers, error: locationUsersError } = await supabase
      .from("user_locations")
      .select(`user_id`)
      .in("location_id", locationIds)
      .neq("user_id", userId);

    if (locationUsersError) {
      console.error("Error fetching location users:", locationUsersError);
    }

    if (!locationUsers || locationUsers.length === 0) {
      console.log("No other users found at locations");
      return new Response(
        JSON.stringify({ message: "No users at locations" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userIds = [...new Set(locationUsers.map(u => u.user_id))];
    console.log(`Found ${userIds.length} users at locations`);

    // Get roles for these users (filter to manager roles)
    const managerRoles = ["super_admin", "org_admin", "admin", "general_manager", "manager"];
    const { data: managerRoleData, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", userIds)
      .in("role", managerRoles);

    if (rolesError) {
      console.error("Error fetching roles:", rolesError);
    }

    if (!managerRoleData || managerRoleData.length === 0) {
      console.log("No managers found at locations");
      return new Response(
        JSON.stringify({ message: "No managers to notify" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const managerUserIds = [...new Set(managerRoleData.map(r => r.user_id))];
    console.log(`Found ${managerUserIds.length} managers to notify`);

    // Get profiles for these managers
    const { data: managerProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", managerUserIds);

    if (profilesError) {
      console.error("Error fetching manager profiles:", profilesError);
    }

    // Get unique manager emails
    const uniqueManagers = new Map<string, { email: string; name: string }>();
    for (const profile of managerProfiles || []) {
      if (profile?.email && !uniqueManagers.has(profile.email)) {
        uniqueManagers.set(profile.email, { 
          email: profile.email, 
          name: profile.full_name || "Manager" 
        });
      }
    }

    console.log(`Sending notifications to ${uniqueManagers.size} managers`);

    // Send email to each manager
    const emailPromises = Array.from(uniqueManagers.values()).map(async (manager) => {
      try {
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
                🎉 New Team Member!
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 30px 40px;">
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                Hey ${manager.name.split(' ')[0]}! 👋
              </p>
              <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
                Great news! <strong style="color: ${primaryColor};">${newEmployee.full_name || "A new team member"}</strong> has completed their account setup and joined the team${locationNames.length > 0 ? ` at <strong>${locationNames.join(", ")}</strong>` : ""}.
              </p>
              
              <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 20px; margin-bottom: 24px;">
                <table role="presentation" style="width: 100%;">
                  <tr>
                    <td style="padding: 6px 0;">
                      <span style="color: #666; font-size: 12px; text-transform: uppercase;">Name</span><br/>
                      <strong style="color: ${textColor}; font-size: 15px;">${newEmployee.full_name || "Not provided"}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0;">
                      <span style="color: #666; font-size: 12px; text-transform: uppercase;">Email</span><br/>
                      <a href="mailto:${newEmployee.email}" style="color: ${primaryColor}; font-size: 14px; text-decoration: none;">${newEmployee.email || "Not provided"}</a>
                    </td>
                  </tr>
                </table>
              </div>
              
              <p style="color: #666; font-size: 14px; margin: 0 0 24px;">
                You can now add them to the schedule and assign tasks.
              </p>
              
              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="https://croohq.com/users" style="display: inline-block; background: linear-gradient(135deg, ${accentColor} 0%, #e06b10 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">
                      View Team
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

        const emailResponse = await resend.emails.send({
          from: "CrooHQ <hello@croohq.email>",
          to: [manager.email],
          subject: `🎉 ${newEmployee.full_name || "New team member"} has joined!`,
          html: emailHtml,
        });
        console.log(`Email sent to ${manager.email}:`, emailResponse);
        return { success: true, email: manager.email };
      } catch (error) {
        console.error(`Failed to send email to ${manager.email}:`, error);
        return { success: false, email: manager.email, error };
      }
    });

    const results = await Promise.all(emailPromises);
    const successCount = results.filter(r => r.success).length;

    console.log(`Successfully sent ${successCount}/${results.length} notifications`);

    return new Response(
      JSON.stringify({ 
        message: "Notifications sent",
        sent: successCount,
        total: results.length
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in notify-employee-joined:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
