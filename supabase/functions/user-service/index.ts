// @ts-nocheck
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
  return `<tr><td style="background-color:#f0ebe1;padding:30px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;padding-bottom:12px;"><div style="display:inline-flex;align-items:center;gap:10px;justify-content:center;"><span style="color:#3a5f7d;font-size:16px;font-weight:400;letter-spacing:-0.2px;">Powered by</span><img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-transparent.webp" alt="CrooHQ" style="height:44px;" /></div></td></tr><tr><td style="text-align:center;"><p style="color:#999;font-size:12px;margin:0;">&copy; 2026 Croo. All rights reserved.</p></td></tr></table></td></tr>`;
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

async function getRequestingUserId(supabaseAdmin: any, authHeader: string | null): Promise<string> {
  if (!authHeader) {
    throw new Error("Missing authorization header");
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    throw new Error("Invalid token");
  }

  // Verify the JWT signature server-side — never trust the decoded payload.
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw new Error("Unauthorized");
  }

  return data.user.id as string;
}


async function verifyAdminRole(supabaseAdmin: any, userId: string): Promise<void> {
  const { data: roleData, error: roleError } = await supabaseAdmin
    .rpc('has_role', { _user_id: userId, _role: 'admin' });

  if (roleError || !roleData) {
    throw new Error("Only admins can perform this action");
  }
}

// Always send invite/reset links to the production app so users don't land on
// the Lovable preview gate. Allow croohq.com subdomains (e.g. kiosk.croohq.com)
// to keep their own origin, but ignore *.lovable.app / *.lovableproject.com /
// localhost which would otherwise expire or be inaccessible to new hires.
const PRODUCTION_APP_URL = 'https://croohq.com';

function getRedirectUrl(req: Request, _supabaseUrl: string): string {
  const origin =
    req.headers.get('origin') ||
    req.headers.get('referer')?.split('/').slice(0, 3).join('/') ||
    '';

  try {
    const host = new URL(origin).hostname;
    // Only honor the request origin if it's the production app or a croohq subdomain
    if (host === 'croohq.com' || host.endsWith('.croohq.com')) {
      return `${origin}/reset-password`;
    }
  } catch {
    // fall through to production default
  }

  return `${PRODUCTION_APP_URL}/reset-password`;
}

// ============================================================================
// ACTION: invite
// ============================================================================

async function handleInvite(payload: InviteUserPayload, req: Request, supabaseAdmin: any, requestingUserId: string): Promise<Response> {
  await verifyAdminRole(supabaseAdmin, requestingUserId);
  
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

    // If role is org_admin, auto-add to organization_members so they see the org in the picker
    if (role === 'org_admin') {
      const { data: locData } = await supabaseAdmin
        .from('locations')
        .select('organization_id')
        .eq('id', locationId)
        .single();
      
      if (locData?.organization_id) {
        await supabaseAdmin
          .from('organization_members')
          .upsert(
            { user_id: userId, organization_id: locData.organization_id, org_role: 'admin' },
            { onConflict: 'user_id,organization_id' }
          );
      }
    }
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

  // Send branded invite email directly via email_queue
  if (resetLink) {
    try {
      const branding = await getOrgBranding(supabaseAdmin, locationId);
      const firstName = fullName.split(' ')[0];
      const logoHtml = branding.logoUrl
        ? `<img src="${branding.logoUrl}" alt="${branding.displayName}" style="max-height:40px;max-width:120px;border-radius:8px;"/>`
        : `<img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="max-height:40px;max-width:120px;" />`;

      await queueEmailDirect(supabaseAdmin, {
        from: "CrooHQ Hiring <hiring@croohq.email>",
        to: [email],
        subject: `Welcome to ${branding.displayName}${branding.locName ? ` - ${branding.locName}` : ''}!`,
        html: wrapEmail(`
          <tr><td style="background-color:${primaryColor};padding:20px 32px;">
            <table style="width:100%;border-collapse:collapse;"><tr>
              <td style="vertical-align:middle;text-align:left;width:180px;">${logoHtml}</td>
              <td style="vertical-align:middle;text-align:center;"><h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Welcome to the Team!</h1></td>
              <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;"><p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">${branding.displayName}</p>${branding.locName ? `<p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${systemFontStack};">${branding.locName}</p>` : ''}</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:28px 32px;">
            <div style="text-align:center;margin-bottom:24px;font-size:48px;">🎉</div>
            <p style="color:${textColor};font-size:18px;margin:0 0 20px;">Hey ${firstName}!</p>
            <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;"><strong>Congratulations!</strong> You've been invited to join <strong style="color:${primaryColor};">${branding.displayName}</strong>${branding.locName ? ` at the <strong>${branding.locName}</strong> location` : ''}.</p>
            <div style="background:#fafaf8;border-radius:16px;padding:24px;margin-bottom:24px;">
              <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Next Steps</p>
              <p style="color:${textColor};font-size:14px;line-height:1.6;margin:0;">Click the button below to set your password and get started. Once you're in, your manager will add you to the schedule.</p>
            </div>
            <div style="text-align:center;margin:28px 0;"><a href="${resetLink}" style="display:inline-block;background:${accentColor};color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Set Your Password</a></div>
            <p style="color:#999;font-size:12px;text-align:center;">This link expires in 24 hours.</p>
          </td></tr>
          ${getEmailFooter()}`),
        source: 'invite',
        dedupKey: `invite_${email}_${Date.now()}`,
      });
    } catch (emailError) {
      console.error("Failed to queue invite email:", emailError);
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

  // Send resend email directly via email_queue
  try {
    const branding = await getOrgBranding(supabaseAdmin, locationId);
    const firstName = (profile.full_name || '').split(' ')[0] || 'there';

    await queueEmailDirect(supabaseAdmin, {
      from: "CrooHQ <hiring@croohq.email>",
      to: [emailToUse],
      subject: `Your CrooHQ Invite - ${branding.displayName}`,
      html: wrapEmail(`
        <tr><td style="background-color:${primaryColor};padding:20px 32px;">
          <table style="width:100%;border-collapse:collapse;"><tr>
            <td style="vertical-align:middle;text-align:left;width:180px;"><img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="max-height:40px;max-width:120px;" /></td>
            <td style="vertical-align:middle;text-align:center;"><h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Set Your Password</h1></td>
            <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;"><p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">${branding.displayName}</p>${branding.locName ? `<p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${systemFontStack};">${branding.locName}</p>` : ''}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <p style="color:${textColor};font-size:18px;margin:0 0 20px;">Hey ${firstName}!</p>
          <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">Your manager has re-sent your invite to <strong style="color:${primaryColor};">${branding.displayName}</strong>. Click below to set your password and get started.</p>
          <div style="text-align:center;margin:28px 0;"><a href="${resetLink}" style="display:inline-block;background:${accentColor};color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Set Your Password</a></div>
          <p style="color:#999;font-size:12px;text-align:center;">This link expires in 24 hours.</p>
        </td></tr>
        ${getEmailFooter()}`),
      source: 'resend_invite',
      dedupKey: `resend_invite_${emailToUse}_${Date.now()}`,
    });
  } catch (emailError) {
    console.error("Failed to queue resend email:", emailError);
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

    // Parse body once - action can come from query string OR body
    const url = new URL(req.url);
    const queryAction = url.searchParams.get('action');
    
    // Clone request so body can be read by handlers too
    const bodyText = await req.text();
    const body = bodyText ? JSON.parse(bodyText) : {};
    const action = queryAction || body.action || 'invite';
    
    // Create a new request with the same body for handlers that call req.json()
    const clonedReq = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: bodyText,
    });

    const authHeader = req.headers.get("Authorization");
    const requestingUserId = await getRequestingUserId(supabaseAdmin, authHeader);

    console.log(`[user-service] Action: ${action}, RequestedBy: ${requestingUserId}`);

    switch (action) {
      case 'invite':
        return await handleInvite(body as InviteUserPayload, clonedReq, supabaseAdmin, requestingUserId);
      
      case 'resend-invite':
        return await handleResendInvite(clonedReq, supabaseAdmin, requestingUserId);
      
      case 'delete':
        return await handleDelete(clonedReq, supabaseAdmin, requestingUserId);
      
      case 'toggle-status':
        return await handleToggleStatus(clonedReq, supabaseAdmin, requestingUserId);
      
      case 'set-password':
        return await handleSetPassword(clonedReq, supabaseAdmin, requestingUserId);
      
      case 'delete-auth-user': {
        await verifyAdminRole(supabaseAdmin, requestingUserId);
        const { userId } = body;
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
    // Auth failures must surface as 401/403 so smoke checks and callers can
    // distinguish "not allowed" from "bad request".
    const authFailures = ['Missing authorization header', 'Invalid token', 'Unauthorized'];
    const forbidden = errorMessage.toLowerCase().includes('admin');
    const status = authFailures.includes(errorMessage) ? 401 : forbidden ? 403 : 400;
    return new Response(JSON.stringify({ error: errorMessage }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

});
