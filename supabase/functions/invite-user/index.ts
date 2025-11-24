import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InviteUserRequest {
  email: string;
  fullName: string;
  role: 'admin' | 'manager' | 'team_member';
  profilePhotoUrl?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey) {
      throw new Error("Missing Supabase environment variables");
    }

    // Verify the requesting user is an admin using anon key client
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Create client with anon key for auth verification
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    // Create admin client for privileged operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Check if user has admin role
    const { data: roleData, error: roleError } = await supabaseAdmin
      .rpc('has_role', { _user_id: user.id, _role: 'admin' });

    if (roleError || !roleData) {
      throw new Error("Only admins can invite users");
    }

    const { email, fullName, role, profilePhotoUrl }: InviteUserRequest = await req.json();

    // Validate input
    if (!email || !fullName || !role) {
      throw new Error("Missing required fields");
    }

    // Create the user with a temporary password
    const temporaryPassword = crypto.randomUUID();
    
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        profile_photo_url: profilePhotoUrl,
      },
    });

    if (createError) {
      throw createError;
    }

    if (!newUser.user) {
      throw new Error("Failed to create user");
    }

    // Create profile (should be handled by trigger, but adding as backup)
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUser.user.id,
        email: email,
        full_name: fullName,
        profile_photo_url: profilePhotoUrl || null,
      });

    if (profileError) {
      console.error("Profile creation error:", profileError);
    }

    // Assign role
    const { error: roleAssignError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: newUser.user.id,
        role: role,
      });

    if (roleAssignError) {
      console.error("Role assignment error:", roleAssignError);
      throw roleAssignError;
    }

    // Send password reset email so user can set their own password
    const { error: resetError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email,
    });

    if (resetError) {
      console.error("Password reset email error:", resetError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        userId: newUser.user.id,
        message: "User invited successfully. They will receive an email to set their password.",
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
    console.error("Error in invite-user function:", error);
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
