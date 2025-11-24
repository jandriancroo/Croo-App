import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DeleteUserRequest {
  userId: string;
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
      throw new Error("Only admins can delete users");
    }

    const { userId }: DeleteUserRequest = await req.json();

    if (!userId) {
      throw new Error("User ID is required");
    }

    // Check if user is deactivated
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('is_active')
      .eq('id', userId)
      .single();

    if (profileError) {
      throw new Error("User not found");
    }

    if (profile.is_active) {
      throw new Error("User must be deactivated before deletion");
    }

    // Delete all related records first to avoid foreign key constraints
    // Delete in order to respect foreign key dependencies
    
    // Delete user-created content
    await supabaseAdmin.from('employee_notes').delete().eq('user_id', userId);
    await supabaseAdmin.from('employee_notes').delete().eq('created_by', userId);
    await supabaseAdmin.from('certifications').delete().eq('user_id', userId);
    await supabaseAdmin.from('availability_requests').delete().eq('user_id', userId);
    await supabaseAdmin.from('time_punches').delete().eq('user_id', userId);
    await supabaseAdmin.from('wage_history').delete().eq('user_id', userId);
    await supabaseAdmin.from('checklist_submissions').delete().eq('submitted_by', userId);
    
    // Delete messaging related records
    await supabaseAdmin.from('message_reactions').delete().eq('user_id', userId);
    await supabaseAdmin.from('message_read_receipts').delete().eq('user_id', userId);
    await supabaseAdmin.from('announcement_reads').delete().eq('user_id', userId);
    await supabaseAdmin.from('messages').delete().eq('sender_id', userId);
    await supabaseAdmin.from('chat_members').delete().eq('user_id', userId);
    
    // Delete schedule related records
    await supabaseAdmin.from('shift_offers').delete().eq('offered_by_user_id', userId);
    await supabaseAdmin.from('shift_offers').delete().eq('claimed_by_user_id', userId);
    await supabaseAdmin.from('scheduled_shifts').delete().eq('user_id', userId);
    
    // Delete logbook entries
    await supabaseAdmin.from('logbook_entries').delete().eq('created_by', userId);
    
    // Delete user locations
    await supabaseAdmin.from('user_locations').delete().eq('user_id', userId);
    
    // Delete user roles
    await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
    
    // Finally delete the profile
    await supabaseAdmin.from('profiles').delete().eq('id', userId);
    
    // Delete user from auth.users
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteError) {
      throw deleteError;
    }

    console.log(`User ${userId} permanently deleted with all related records`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "User permanently deleted",
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
    console.error("Error in delete-user function:", error);
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
