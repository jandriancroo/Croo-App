import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

    // Get the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Extract the JWT token and decode to get user ID
    const token = authHeader.replace('Bearer ', '');
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) {
      throw new Error("Invalid token");
    }

    const payloadJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson);
    const requestingUserId = payload.sub as string | undefined;

    if (!requestingUserId) {
      throw new Error("Unauthorized");
    }

    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Check if requesting user is admin
    const { data: roleData, error: roleError } = await supabaseAdmin
      .rpc('has_role', { _user_id: requestingUserId, _role: 'admin' });

    if (roleError || !roleData) {
      console.error("Role check failed:", roleError);
      throw new Error("Only admins can create test users");
    }

    // Test user data
    const testUsers = [
      { email: 'john.smith@test.com', name: 'John Smith', role: 'team_member' },
      { email: 'sarah.johnson@test.com', name: 'Sarah Johnson', role: 'team_member' },
      { email: 'michael.williams@test.com', name: 'Michael Williams', role: 'manager' },
      { email: 'emily.brown@test.com', name: 'Emily Brown', role: 'team_member' },
      { email: 'david.jones@test.com', name: 'David Jones', role: 'team_member' },
      { email: 'jessica.garcia@test.com', name: 'Jessica Garcia', role: 'manager' },
      { email: 'james.martinez@test.com', name: 'James Martinez', role: 'team_member' },
      { email: 'lisa.rodriguez@test.com', name: 'Lisa Rodriguez', role: 'team_member' },
      { email: 'robert.davis@test.com', name: 'Robert Davis', role: 'team_member' },
      { email: 'amanda.miller@test.com', name: 'Amanda Miller', role: 'manager' },
      { email: 'christopher.wilson@test.com', name: 'Christopher Wilson', role: 'team_member' },
      { email: 'jennifer.moore@test.com', name: 'Jennifer Moore', role: 'team_member' },
      { email: 'matthew.taylor@test.com', name: 'Matthew Taylor', role: 'team_member' },
      { email: 'ashley.anderson@test.com', name: 'Ashley Anderson', role: 'team_member' },
      { email: 'daniel.thomas@test.com', name: 'Daniel Thomas', role: 'team_member' },
    ];

    const createdUsers = [];
    const errors = [];

    for (const testUser of testUsers) {
      try {
        // Create auth user
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: testUser.email,
          password: 'TestPassword123!',
          email_confirm: true,
          user_metadata: {
            full_name: testUser.name,
          },
        });

        if (authError) throw authError;

        // Profile will be created automatically by trigger
        // Just need to assign role
        const { error: roleError } = await supabaseAdmin
          .from('user_roles')
          .upsert({
            user_id: authUser.user.id,
            role: testUser.role,
          });

        if (roleError) throw roleError;

        createdUsers.push({ email: testUser.email, id: authUser.user.id });
      } catch (error: any) {
        errors.push({ email: testUser.email, error: error.message });
      }
    }

    console.log(`Created ${createdUsers.length} test users`);

    return new Response(
      JSON.stringify({
        success: true,
        created: createdUsers.length,
        users: createdUsers,
        errors,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error("Error in create-test-users function:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "An error occurred",
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
};

serve(handler);
