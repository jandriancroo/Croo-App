import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotifyRequest {
  userId: string;
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
        const emailResponse = await resend.emails.send({
          from: "Croo <hello@croohq.email>",
          to: [manager.email],
          subject: `🎉 ${newEmployee.full_name || "New team member"} has joined!`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
              <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 30px; text-align: center;">
                  <h1 style="color: white; margin: 0; font-size: 24px;">New Team Member! 🎉</h1>
                </div>
                <div style="padding: 30px;">
                  <p style="font-size: 16px; color: #374151; margin: 0 0 20px;">
                    Hi ${manager.name},
                  </p>
                  <p style="font-size: 16px; color: #374151; margin: 0 0 20px;">
                    Great news! <strong>${newEmployee.full_name || "A new team member"}</strong> has completed their account setup and joined the team${locationNames.length > 0 ? ` at <strong>${locationNames.join(", ")}</strong>` : ""}.
                  </p>
                  <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <p style="margin: 0; color: #6b7280; font-size: 14px;">
                      <strong>Email:</strong> ${newEmployee.email || "Not provided"}
                    </p>
                  </div>
                  <p style="font-size: 14px; color: #6b7280; margin: 20px 0 0;">
                    You can now add them to the schedule and assign tasks.
                  </p>
                </div>
                <div style="background: #f9fafb; padding: 20px; text-align: center;">
                  <a href="https://croohq.com/users" style="display: inline-block; background: #10b981; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                    View Team
                  </a>
                </div>
              </div>
            </body>
            </html>
          `,
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