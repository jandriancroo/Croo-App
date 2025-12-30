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

    // Parse request body for location_id
    const body = await req.json().catch(() => ({}));
    const locationId = body.location_id;

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

    // Test user data - 6 new test employees
    const testUsers = [
      { email: 'test.alpha@example.com', name: 'Test Employee Alpha', role: 'team_member' },
      { email: 'test.beta@example.com', name: 'Test Employee Beta', role: 'team_member' },
      { email: 'test.gamma@example.com', name: 'Test Employee Gamma', role: 'team_member' },
      { email: 'test.delta@example.com', name: 'Test Employee Delta', role: 'team_member' },
      { email: 'test.echo@example.com', name: 'Test Employee Echo', role: 'team_member' },
      { email: 'test.foxtrot@example.com', name: 'Test Employee Foxtrot', role: 'team_member' },
    ];

    const createdUsers = [];
    const errors = [];

    for (const testUser of testUsers) {
      try {
        // Check if user already exists
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(u => u.email === testUser.email);
        
        let userId: string;
        
        if (existingUser) {
          console.log(`User ${testUser.email} already exists, skipping creation`);
          userId = existingUser.id;
        } else {
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
          userId = authUser.user.id;
          console.log(`Created auth user for ${testUser.email}`);
        }

        // Update profile with scheduling info
        const { error: profileError } = await supabaseAdmin
          .from('profiles')
          .update({
            is_active: true,
            appears_on_schedule: true,
            min_weekly_hours: 20,
            max_weekly_hours: 39,
          })
          .eq('id', userId);

        if (profileError) {
          console.error(`Profile update error for ${testUser.email}:`, profileError);
        }

        // Assign role
        const { error: roleInsertError } = await supabaseAdmin
          .from('user_roles')
          .upsert({
            user_id: userId,
            role: testUser.role,
          }, { onConflict: 'user_id,role' });

        if (roleInsertError) {
          console.error(`Role assignment error for ${testUser.email}:`, roleInsertError);
        }

        // Assign to location if provided
        if (locationId) {
          const { error: locationError } = await supabaseAdmin
            .from('user_locations')
            .upsert({
              user_id: userId,
              location_id: locationId,
            }, { onConflict: 'user_id,location_id' });

          if (locationError) {
            console.error(`Location assignment error for ${testUser.email}:`, locationError);
          } else {
            console.log(`Assigned ${testUser.email} to location ${locationId}`);
          }
        }

        createdUsers.push({ email: testUser.email, id: userId, name: testUser.name });
      } catch (error: any) {
        console.error(`Error creating ${testUser.email}:`, error);
        errors.push({ email: testUser.email, error: error.message });
      }
    }

    console.log(`Created/updated ${createdUsers.length} test users`);

    return new Response(
      JSON.stringify({
        success: true,
        created: createdUsers.length,
        users: createdUsers,
        errors,
        locationId,
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
