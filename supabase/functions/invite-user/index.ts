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
  locationId?: string;
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

    // Get the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Extract the JWT token
    const token = authHeader.replace('Bearer ', '');

    // Decode JWT payload (Supabase already verified this token before invoking the function)
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) {
      throw new Error("Invalid token");
    }

    const payloadJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson);
    const userId = payload.sub as string | undefined;

    if (!userId) {
      throw new Error("Unauthorized");
    }

    console.log("Authenticated user:", userId);

    // Create admin client for privileged operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Check if user has admin role via has_role function
    const { data: roleData, error: roleError } = await supabaseAdmin
      .rpc('has_role', { _user_id: userId, _role: 'admin' });

    if (roleError || !roleData) {
      console.error("Role check failed:", roleError);
      throw new Error("Only admins can invite users");
    }

    console.log("User is admin, proceeding with invitation");

    const { email, fullName, role, profilePhotoUrl, locationId }: InviteUserRequest = await req.json();

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
      // Handle duplicate email error with a clearer message
      if (createError.message.includes('already been registered')) {
        throw new Error('This email address is already registered. Use the "Re-invite" button to resend an invitation to existing users.');
      }
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

    // Assign role (upsert to handle existing role from trigger)
    const { error: roleAssignError } = await supabaseAdmin
      .from('user_roles')
      .upsert({
        user_id: newUser.user.id,
        role: role,
      }, {
        onConflict: 'user_id,role',
      });

    if (roleAssignError) {
      console.error("Role assignment error:", roleAssignError);
      throw roleAssignError;
    }

    // Assign to location if provided
    if (locationId) {
      const { error: locationAssignError } = await supabaseAdmin
        .from('user_locations')
        .upsert({
          user_id: newUser.user.id,
          location_id: locationId,
        }, {
          onConflict: 'user_id,location_id',
        });

      if (locationAssignError) {
        console.error("Location assignment error:", locationAssignError);
      }
    }

    // Get the origin from the request to use as redirect URL
    const origin = req.headers.get('origin') || req.headers.get('referer')?.split('/').slice(0, 3).join('/') || supabaseUrl;
    const redirectTo = `${origin}/reset-password`;

    // Send password reset email so user can set their own password
    const { data: resetData, error: resetError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo,
      },
    });
 
    if (resetError) {
      console.error("Password reset email error:", resetError);
    }
 
    return new Response(
      JSON.stringify({
        success: true,
        userId: newUser.user.id,
        message: "User invited successfully. They will receive an email to set their password.",
        resetLink: resetData?.properties?.action_link ?? null,
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
