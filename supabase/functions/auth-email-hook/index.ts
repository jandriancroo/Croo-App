import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// BRANDING (matches hiring-email-service / user-service styles)
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

function getHeader(title: string): string {
  return `<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:24px 32px;text-align:center;">
    <img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="CrooHQ" style="height:36px;margin-bottom:12px;filter:brightness(0) invert(1);" />
    <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0;font-family:${systemFontStack};">${title}</h1>
  </td></tr>`;
}

function buildAuthEmail(type: string, actionUrl: string, email: string): { subject: string; html: string } {
  switch (type) {
    case 'recovery':
      return {
        subject: 'Reset Your CrooHQ Password',
        html: wrapEmail(`
          ${getHeader('Reset Your Password')}
          <tr><td style="padding:28px 32px;">
            <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 20px;">We received a request to reset the password for your CrooHQ account (<strong>${email}</strong>).</p>
            <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">Click the button below to set a new password:</p>
            <div style="text-align:center;margin:28px 0;"><a href="${actionUrl}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Reset Password</a></div>
            <p style="color:#999;font-size:12px;text-align:center;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
          </td></tr>
          ${getEmailFooter()}`),
      };

    case 'magiclink':
      return {
        subject: 'Your CrooHQ Login Link',
        html: wrapEmail(`
          ${getHeader('Sign In to CrooHQ')}
          <tr><td style="padding:28px 32px;">
            <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">Click the button below to sign in to your CrooHQ account:</p>
            <div style="text-align:center;margin:28px 0;"><a href="${actionUrl}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Sign In</a></div>
            <p style="color:#999;font-size:12px;text-align:center;">This link expires in 1 hour.</p>
          </td></tr>
          ${getEmailFooter()}`),
      };

    case 'signup':
    case 'email_confirmation':
      return {
        subject: 'Confirm Your CrooHQ Email',
        html: wrapEmail(`
          ${getHeader('Confirm Your Email')}
          <tr><td style="padding:28px 32px;">
            <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">Please confirm your email address (<strong>${email}</strong>) to complete your CrooHQ account setup:</p>
            <div style="text-align:center;margin:28px 0;"><a href="${actionUrl}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Confirm Email</a></div>
            <p style="color:#999;font-size:12px;text-align:center;">This link expires in 24 hours.</p>
          </td></tr>
          ${getEmailFooter()}`),
      };

    case 'invite':
      return {
        subject: 'You\'ve Been Invited to CrooHQ',
        html: wrapEmail(`
          ${getHeader('You\'re Invited!')}
          <tr><td style="padding:28px 32px;">
            <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">You've been invited to join CrooHQ. Click the button below to accept the invitation and set up your account:</p>
            <div style="text-align:center;margin:28px 0;"><a href="${actionUrl}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Accept Invitation</a></div>
            <p style="color:#999;font-size:12px;text-align:center;">This link expires in 24 hours.</p>
          </td></tr>
          ${getEmailFooter()}`),
      };

    case 'email_change':
      return {
        subject: 'Confirm Your New Email - CrooHQ',
        html: wrapEmail(`
          ${getHeader('Confirm Email Change')}
          <tr><td style="padding:28px 32px;">
            <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">You requested to change your email address. Click below to confirm:</p>
            <div style="text-align:center;margin:28px 0;"><a href="${actionUrl}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Confirm Email Change</a></div>
            <p style="color:#999;font-size:12px;text-align:center;">If you didn't request this, you can safely ignore this email.</p>
          </td></tr>
          ${getEmailFooter()}`),
      };

    default:
      // Fallback for any unknown auth email type
      return {
        subject: 'CrooHQ - Action Required',
        html: wrapEmail(`
          ${getHeader('Action Required')}
          <tr><td style="padding:28px 32px;">
            <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">Click the button below to continue:</p>
            <div style="text-align:center;margin:28px 0;"><a href="${actionUrl}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Continue</a></div>
          </td></tr>
          ${getEmailFooter()}`),
      };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log(`[auth-email-hook] Received auth email event: type=${payload.type || 'unknown'}, email=${payload.email || 'unknown'}`);

    // Supabase sends: { type, email, confirmation_url/action_link, token_hash, ... }
    const emailType = payload.type || 'unknown';
    const recipientEmail = payload.email || '';
    const actionUrl = payload.confirmation_url || payload.action_link || '';

    if (!recipientEmail || !actionUrl) {
      console.error('[auth-email-hook] Missing email or action URL in payload:', JSON.stringify(payload));
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { subject, html } = buildAuthEmail(emailType, actionUrl, recipientEmail);

    // Queue directly to email_queue for Resend delivery
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error: queueError } = await supabase.from('email_queue').insert({
      from_address: 'CrooHQ <noreply@croohq.email>',
      to_addresses: [recipientEmail],
      subject,
      html,
      source: `auth_${emailType}`,
      dedup_key: `auth_${emailType}_${recipientEmail}_${Date.now()}`,
      metadata: { auth_type: emailType },
    });

    if (queueError) {
      console.error('[auth-email-hook] Failed to queue email:', queueError);
      throw queueError;
    }

    console.log(`[auth-email-hook] ✅ Queued ${emailType} email → ${recipientEmail}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[auth-email-hook] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
