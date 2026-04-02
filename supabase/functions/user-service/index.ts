import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================================================
// EMAIL BRANDING (matches hiring-email-service styles)
// ============================================================================

const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";
const systemFontStack = "'Manrope', -apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:${systemFontStack};"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="width:100%;max-width:720px;margin:0 auto;background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f0ebe1;padding:30px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;padding-bottom:12px;"><div style="display:inline-flex;align-items:center;gap:10px;justify-content:center;"><span style="color:#3a5f7d;font-size:16px;font-weight:400;letter-spacing:-0.2px;">Powered by</span><img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="croo" style="height:24px;" /></div></td></tr><tr><td style="text-align:center;"><p style="color:#999;font-size:12px;margin:0;">&copy; 2026 Croo. All rights reserved.</p></td></tr></table></td></tr>`;
}

async function queueEmailDirect(supabaseAdmin: any, opts: { from: string; to: string[]; subject: string; html: string; source: string; dedupKey?: string }) {
  const { error } = await supabaseAdmin.from('email_queue').insert({
    from_address: opts.from,
    to_addresses: opts.to,
    subject: opts.subject,
    html: opts.html,
    source: opts.source,
    dedup_key: opts.dedupKey || null,
    metadata: {},
  });
  if (error) {
    console.error(`[user-service] Queue insert failed for "${opts.subject}":`, error);
    throw error;
  }
  console.log(`[user-service] Queued email: "${opts.subject}" → ${opts.to.join(', ')}`);
}

async function getOrgBranding(supabaseAdmin: any, locationId?: string) {
  let orgName = "your new team", locName = "", logoUrl = "", brandName = "";
  if (locationId) {
    const { data: loc } = await supabaseAdmin.from('locations').select('name, organization_id').eq('id', locationId).single();
    if (loc) {
      locName = loc.name;
      if (loc.organization_id) {
        const { data: org } = await supabaseAdmin.from('organizations').select('name, logo_url, brand_name').eq('id', loc.organization_id).single();
        if (org) { orgName = org.name; logoUrl = org.logo_url || ""; brandName = org.brand_name || org.name; }
      }
    }
  }
  return { orgName, locName, logoUrl, displayName: brandName || orgName };
}

// ============================================================================
// TYPES
// ============================================================================

interface InviteUserPayload {
  email: string;
  fullName: string;
  role: 'admin' | 'general_manager' | 'shift_manager' | 'manager' | 'team_member';
  profilePhotoUrl?: string;
  locationId?: string;
  phoneNumber?: string;
  hourlyWage?: number;
  birthday?: string;
}

interface ResendInvitePayload {
  userId: string;
  newEmail?: string;
}

interface DeleteUserPayload {
  userId: string;
}

interface ToggleStatusPayload {
  userId: string;
  isActive: boolean;
}

interface SetPasswordPayload {
  userId: string;
  password: string;
}

// ============================================================================
// SHARED UTILITIES
// ============================================================================

function getRequestingUserId(authHeader: string | null): string {
  if (!authHeader) {
    throw new Error("Missing authorization header");
  }
  
  const token = authHeader.replace('Bearer ', '');
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
  
  return userId;
}

async function verifyAdminRole(supabaseAdmin: any, userId: string): Promise<void> {
  const { data: roleData, error: roleError } = await supabaseAdmin
    .rpc('has_role', { _user_id: userId, _role: 'admin' });

  if (roleError || !roleData) {
    throw new Error("Only admins can perform this action");
  }
}

function getRedirectUrl(req: Request, supabaseUrl: string): string {
  const origin = req.headers.get('origin') || 
                 req.headers.get('referer')?.split('/').slice(0, 3).join('/') || 
                 supabaseUrl;
  return `${origin}/reset-password`;
}

// ============================================================================
// ACTION: invite
// ============================================================================

async function handleInvite(req: Request, supabaseAdmin: any, requestingUserId: string): Promise<Response> {
  await verifyAdminRole(supabaseAdmin, requestingUserId);
  
  const payload: InviteUserPayload = await req.json();
  const { email, fullName, role, profilePhotoUrl, locationId, phoneNumber, hourlyWage, birthday } = payload;

  if (!email || !fullName || !role) {
    throw new Error("Missing required fields: email, fullName, role");
  }

  // Create user with temporary password
  const temporaryPassword = crypto.randomUUID();
  
  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      profile_photo_url: profilePhotoUrl,
    },
  });

  if (createError) {
    if (createError.message.includes('already been registered')) {
      throw new Error('This email is already registered. Use "Re-invite" for existing users.');
    }
    throw createError;
  }

  if (!newUser.user) {
    throw new Error("Failed to create user");
  }

  const userId = newUser.user.id;

  // Create/update profile
  await supabaseAdmin.from('profiles').upsert({
    id: userId,
    email,
    full_name: fullName,
    profile_photo_url: profilePhotoUrl || null,
    phone_number: phoneNumber || null,
    hourly_wage: hourlyWage || null,
    birthday: birthday || null,
  });

  // Add wage history if provided
  if (hourlyWage) {
    const today = new Date().toISOString().split('T')[0];
    await supabaseAdmin.from('wage_history').upsert({
      user_id: userId,
      hourly_wage: hourlyWage,
      effective_date: today,
    });
  }

  // Assign role
  const { error: roleAssignError } = await supabaseAdmin
    .from('user_roles')
    .upsert({ user_id: userId, role }, { onConflict: 'user_id,role' });

  if (roleAssignError) throw roleAssignError;

  // Assign location if provided
  if (locationId) {
    await supabaseAdmin
      .from('user_locations')
      .upsert({ user_id: userId, location_id: locationId }, { onConflict: 'user_id,location_id' });
  }

  // Generate password reset link
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const redirectTo = getRedirectUrl(req, supabaseUrl);
  
  const { data: resetData, error: resetError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });

  if (resetError) {
    console.error("Password reset link generation failed:", resetError);
  }

  const resetLink = resetData?.properties?.action_link ?? null;

  // Send branded invite email via hiring-email-service
  if (resetLink) {
    try {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      await fetch(`${supabaseUrl}/functions/v1/hiring-email-service`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          action: 'send_invite',
          payload: { to: email, fullName, locationId, resetLink },
        }),
      });
    } catch (emailError) {
      console.error("Failed to send invite email:", emailError);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    userId,
    message: "User invited successfully",
    resetLink,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// ACTION: resend-invite
// ============================================================================

async function handleResendInvite(req: Request, supabaseAdmin: any, requestingUserId: string): Promise<Response> {
  await verifyAdminRole(supabaseAdmin, requestingUserId);
  
  const { userId, newEmail }: ResendInvitePayload = await req.json();

  if (!userId) {
    throw new Error("User ID is required");
  }

  // Get current profile
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    throw new Error("User not found");
  }

  const emailToUse = newEmail || profile.email;

  // Update email if changed
  if (newEmail && newEmail !== profile.email) {
    const { error: updateEmailError } = await supabaseAdmin.auth.admin.updateUserById(userId, { email: newEmail });
    if (updateEmailError) throw updateEmailError;

    await supabaseAdmin.from('profiles').update({ email: newEmail }).eq('id', userId);
  }

  // Generate reset link
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const redirectTo = getRedirectUrl(req, supabaseUrl);
  
  const { data: resetData, error: resetError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email: emailToUse,
    options: { redirectTo },
  });

  if (resetError) throw resetError;

  const resetLink = resetData.properties.action_link;

  // Get user's location for branding
  let locationId: string | null = null;
  try {
    const { data: userLoc } = await supabaseAdmin
      .from('user_locations')
      .select('location_id')
      .eq('user_id', userId)
      .limit(1)
      .single();
    locationId = userLoc?.location_id || null;
  } catch (_) {}

  // Send resend email via hiring-email-service (through Resend)
  try {
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    await fetch(`${supabaseUrl}/functions/v1/hiring-email-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        action: 'resend_invite',
        payload: { to: emailToUse, fullName: profile.full_name, resetLink, locationId },
      }),
    });
  } catch (emailError) {
    console.error("Failed to send resend email:", emailError);
  }

  return new Response(JSON.stringify({
    success: true,
    message: newEmail ? 'Invitation sent to new email' : 'Invitation resent',
    resetLink,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// ACTION: delete
// ============================================================================

async function handleDelete(req: Request, supabaseAdmin: any, requestingUserId: string): Promise<Response> {
  await verifyAdminRole(supabaseAdmin, requestingUserId);
  
  const { userId }: DeleteUserPayload = await req.json();

  if (!userId) {
    throw new Error("User ID is required");
  }

  // Check if user is deactivated
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('is_active')
    .eq('id', userId)
    .single();

  if (profileError) throw new Error("User not found");
  if (profile.is_active) throw new Error("User must be deactivated before deletion");

  // Delete related records in order
  const tables = [
    { table: 'employee_notes', column: 'user_id' },
    { table: 'employee_notes', column: 'created_by' },
    { table: 'certifications', column: 'user_id' },
    { table: 'availability_requests', column: 'user_id' },
    { table: 'time_punches', column: 'user_id' },
    { table: 'wage_history', column: 'user_id' },
    { table: 'checklist_submissions', column: 'submitted_by' },
    { table: 'message_reactions', column: 'user_id' },
    { table: 'message_read_receipts', column: 'user_id' },
    { table: 'announcement_reads', column: 'user_id' },
    { table: 'messages', column: 'sender_id' },
    { table: 'chat_members', column: 'user_id' },
    { table: 'shift_offers', column: 'offered_by_user_id' },
    { table: 'shift_offers', column: 'claimed_by_user_id' },
    { table: 'scheduled_shifts', column: 'user_id' },
    { table: 'logbook_entries', column: 'created_by' },
    { table: 'user_locations', column: 'user_id' },
    { table: 'user_roles', column: 'user_id' },
    { table: 'profiles', column: 'id' },
  ];

  for (const { table, column } of tables) {
    await supabaseAdmin.from(table).delete().eq(column, userId);
  }

  // Delete from auth.users
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteError) throw deleteError;

  console.log(`[user-service] User ${userId} permanently deleted`);

  return new Response(JSON.stringify({
    success: true,
    message: "User permanently deleted",
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// ACTION: toggle-status
// ============================================================================

async function handleToggleStatus(req: Request, supabaseAdmin: any, requestingUserId: string): Promise<Response> {
  await verifyAdminRole(supabaseAdmin, requestingUserId);
  
  const { userId, isActive }: ToggleStatusPayload = await req.json();

  if (!userId) {
    throw new Error("User ID is required");
  }

  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId);

  if (updateError) throw updateError;

  console.log(`[user-service] User ${userId} ${isActive ? 'activated' : 'deactivated'}`);

  return new Response(JSON.stringify({
    success: true,
    message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// ACTION: set-password
// ============================================================================

async function handleSetPassword(req: Request, supabaseAdmin: any, requestingUserId: string): Promise<Response> {
  await verifyAdminRole(supabaseAdmin, requestingUserId);
  
  const { userId, password }: SetPasswordPayload = await req.json();

  if (!userId || !password) {
    throw new Error("userId and password are required");
  }

  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });

  if (error) throw error;

  console.log(`[user-service] Password updated for user ${userId}`);

  return new Response(JSON.stringify({
    success: true,
    message: "Password updated successfully",
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// MAIN ROUTER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'invite';
    const authHeader = req.headers.get("Authorization");
    const requestingUserId = getRequestingUserId(authHeader);

    console.log(`[user-service] Action: ${action}, RequestedBy: ${requestingUserId}`);

    switch (action) {
      case 'invite':
        return await handleInvite(req, supabaseAdmin, requestingUserId);
      
      case 'resend-invite':
        return await handleResendInvite(req, supabaseAdmin, requestingUserId);
      
      case 'delete':
        return await handleDelete(req, supabaseAdmin, requestingUserId);
      
      case 'toggle-status':
        return await handleToggleStatus(req, supabaseAdmin, requestingUserId);
      
      case 'set-password':
        return await handleSetPassword(req, supabaseAdmin, requestingUserId);
      
      case 'delete-auth-user': {
        await verifyAdminRole(supabaseAdmin, requestingUserId);
        const { userId } = await req.json();
        if (!userId) throw new Error("userId is required");
        const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (authDelErr && !authDelErr.message.includes('not found')) throw authDelErr;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error: unknown) {
    console.error('[user-service] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
