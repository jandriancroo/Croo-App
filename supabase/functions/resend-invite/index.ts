import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ResendInviteRequest {
  userId: string;
  newEmail?: string;
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
      throw new Error("Only admins can resend invites");
    }

    const { userId, newEmail }: ResendInviteRequest = await req.json();

    if (!userId) {
      throw new Error("User ID is required");
    }

    // Get current user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new Error("User not found");
    }

    const emailToUse = newEmail || profile.email;

    // If new email is provided, update the user's email
    if (newEmail && newEmail !== profile.email) {
      const { error: updateEmailError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { email: newEmail }
      );

      if (updateEmailError) {
        throw updateEmailError;
      }

      // Update profile email
      const { error: updateProfileError } = await supabaseAdmin
        .from('profiles')
        .update({ email: newEmail })
        .eq('id', userId);

      if (updateProfileError) {
        console.error("Profile email update error:", updateProfileError);
      }
    }

    // Get the origin from the request to use as redirect URL
    const origin = req.headers.get('origin') || req.headers.get('referer')?.split('/').slice(0, 3).join('/') || supabaseUrl;
    const redirectTo = `${origin}/auth`;

    // Generate password reset link
    const { data: resetData, error: resetError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: emailToUse,
      options: {
        redirectTo,
      },
    });

    if (resetError) {
      throw resetError;
    }

    console.log(`Password reset link generated for user ${userId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Invitation ${newEmail ? 'sent to new email' : 'resent'} successfully`,
        resetLink: resetData.properties.action_link,
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
    console.error("Error in resend-invite function:", error);
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
