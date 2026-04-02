import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Queue an email for reliable delivery via email_queue table
async function queueEmail(opts: { from: string; to: string[]; subject: string; html: string; source: string; dedupKey?: string; metadata?: Record<string, any> }) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { error } = await supabase.from('email_queue').insert({
    from_address: opts.from,
    to_addresses: opts.to,
    subject: opts.subject,
    html: opts.html,
    source: opts.source,
    dedup_key: opts.dedupKey || null,
    metadata: opts.metadata || {},
  });
  if (error) {
    console.error(`[hiring-email] Queue insert failed for "${opts.subject}":`, error);
    throw error;
  }
  console.log(`[hiring-email] Queued: "${opts.subject}" → ${opts.to.join(', ')}`);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

// ============ WEB PUSH UTILITIES ============

function base64UrlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function createVapidAuthHeader(
  audience: string,
  subject: string,
  publicKey: string,
  privateKey: string
): Promise<{ authorization: string; cryptoKey: string }> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 12 * 60 * 60,
    sub: subject,
  };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const pubKeyBytes = base64UrlDecode(publicKey);
  const xBytes = pubKeyBytes.slice(1, 33);
  const yBytes = pubKeyBytes.slice(33, 65);

  const properJwk = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKey,
    x: base64UrlEncode(xBytes),
    y: base64UrlEncode(yBytes),
  };

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    properJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const jwt = `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;

  return {
    authorization: `vapid t=${jwt}, k=${publicKey}`,
    cryptoKey: publicKey,
  };
}

async function encryptPayload(
  payload: string,
  p256dhKey: string,
  authSecret: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; localPublicKey: Uint8Array }> {
  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const localPublicKeyBuffer = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);
  const localPublicKey = new Uint8Array(localPublicKeyBuffer);

  const subscriberPublicKeyBytes = base64UrlDecode(p256dhKey);
  const subscriberPublicKey = await crypto.subtle.importKey(
    'raw',
    subscriberPublicKeyBytes.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subscriberPublicKey },
    localKeyPair.privateKey,
    256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  const authSecretBytes = base64UrlDecode(authSecret);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyInfo = new Uint8Array(
    'WebPush: info\0'.length + subscriberPublicKeyBytes.length + localPublicKey.length
  );
  const encoder = new TextEncoder();
  let offset = 0;
  keyInfo.set(encoder.encode('WebPush: info\0'), offset);
  offset += 'WebPush: info\0'.length;
  keyInfo.set(subscriberPublicKeyBytes, offset);
  offset += subscriberPublicKeyBytes.length;
  keyInfo.set(localPublicKey, offset);

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits']
  );

  const ikmBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: authSecretBytes.buffer as ArrayBuffer,
      info: keyInfo,
    },
    hkdfKey,
    256
  );
  const ikm = new Uint8Array(ikmBits);

  const ikmKey = await crypto.subtle.importKey(
    'raw',
    ikm.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits']
  );

  const cekBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt.buffer as ArrayBuffer,
      info: encoder.encode('Content-Encoding: aes128gcm\0'),
    },
    ikmKey,
    128
  );
  const cek = new Uint8Array(cekBits);

  const nonceBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt.buffer as ArrayBuffer,
      info: encoder.encode('Content-Encoding: nonce\0'),
    },
    ikmKey,
    96
  );
  const nonce = new Uint8Array(nonceBits);

  const aesKey = await crypto.subtle.importKey(
    'raw',
    cek.buffer as ArrayBuffer,
    'AES-GCM',
    false,
    ['encrypt']
  );

  const payloadBytes = encoder.encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 1);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 2;

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    paddedPayload
  );

  return {
    ciphertext: new Uint8Array(ciphertextBuffer),
    salt,
    localPublicKey,
  };
}

async function sendWebPushNotification(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<Response> {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const vapidHeaders = await createVapidAuthHeader(
    audience,
    'mailto:support@croohq.com',
    vapidPublicKey,
    vapidPrivateKey
  );

  const { ciphertext, salt, localPublicKey } = await encryptPayload(
    payload,
    subscription.keys.p256dh,
    subscription.keys.auth
  );

  const recordSize = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize, false);
  header[20] = 65;
  header.set(localPublicKey, 21);

  const body = new Uint8Array(header.length + ciphertext.length);
  body.set(header);
  body.set(ciphertext, header.length);

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': vapidHeaders.authorization,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body,
  });

  return response;
}

// ============ EMAIL HELPERS ============

const systemFontStack = "'Manrope', -apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:${systemFontStack};"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="width:100%;max-width:720px;margin:0 auto;background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

function getEmailHeader(title: string, logoUrl?: string, orgName?: string): string {
  const logoHtml = logoUrl 
    ? `<img src="${logoUrl}" alt="${orgName || 'Logo'}" style="max-height:60px;max-width:160px;margin-bottom:12px;border-radius:8px;"/>`
    : `<img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:50px;margin-bottom:12px;"/>`;
  return `<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;">${logoHtml}<h1 style="color:#fff;font-size:28px;font-weight:600;margin:0;font-family:${systemFontStack};text-transform:uppercase;letter-spacing:0.5px;">${title}</h1></td></tr>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f0ebe1;padding:30px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;padding-bottom:12px;"><div style="display:inline-flex;align-items:center;gap:10px;justify-content:center;"><span style="color:#3a5f7d;font-size:16px;font-weight:400;letter-spacing:-0.2px;">Powered by</span><img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-transparent.webp" alt="CrooHQ" style="height:44px;" /></div></td></tr><tr><td style="text-align:center;"><p style="color:#999;font-size:12px;margin:0;">&copy; 2026 Croo. All rights reserved.</p></td></tr></table></td></tr>`;
}

function getCTAButton(url: string, text: string): string {
  return `<div style="text-align:center;"><a href="${url}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">${text}</a></div>`;
}

function generateICS(date: string, time: string, orgName: string, locationName: string, locationAddress: string | undefined): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, day, hours + 8, minutes));
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  const formatICSDate = (d: Date): string => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const uid = `interview-${date}-${time}-${Date.now()}@croohq.email`;
  const location = locationAddress || locationName;
  return `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//CrooHQ//Interview//EN\nBEGIN:VEVENT\nUID:${uid}\nDTSTAMP:${formatICSDate(new Date())}\nDTSTART:${formatICSDate(startDate)}\nDTEND:${formatICSDate(endDate)}\nSUMMARY:Interview at ${orgName}\nLOCATION:${location}\nSTATUS:CONFIRMED\nEND:VEVENT\nEND:VCALENDAR`;
}

// ============ EMAIL ACTIONS ============

async function sendInviteEmail(payload: any): Promise<Response> {
  if (payload.preview) {
    const html = wrapEmail(`
      <!-- HEADER -->
      <tr><td style="background-color:${primaryColor};padding:20px 32px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="vertical-align:middle;text-align:left;width:180px;">
              <img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:40px;" />
            </td>
            <td style="vertical-align:middle;text-align:center;">
              <h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Welcome to the Team!</h1>
            </td>
            <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;">
              <p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">Sample Organization</p>
              <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${systemFontStack};">Sample Location</p>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <div style="text-align:center;margin-bottom:24px;font-size:48px;">🎉</div>
        <p style="color:${textColor};font-size:18px;margin:0 0 20px;">Hey Jane!</p>
        <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;"><strong>Congratulations!</strong> You've been invited to join <strong style="color:${primaryColor};">Sample Organization</strong> at the <strong>Sample Location</strong> location.</p>
        <div style="background:#fafaf8;border-radius:16px;padding:24px;margin-bottom:24px;">
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Next Steps</p>
          <p style="color:${textColor};font-size:14px;line-height:1.6;margin:0;">Click the button below to set your password and get started. Once you're in, your manager will add you to the schedule.</p>
        </div>
        <div style="text-align:center;margin:28px 0;">
          <a href="#" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Set Your Password</a>
        </div>
        <p style="color:#999;font-size:12px;text-align:center;">This link expires in 24 hours.</p>
      </td></tr>
      ${getEmailFooter()}`);
    return new Response(JSON.stringify({ html }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const { to, fullName, locationId, resetLink } = payload;
  if (!to || !fullName || !resetLink) {
    return new Response(JSON.stringify({ error: "to, fullName, resetLink required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let orgName = "your new team", locName = "", logoUrl = "", brandName = "";
  if (locationId) {
    const { data: loc } = await supabase.from('locations').select('name, organization_id').eq('id', locationId).single();
    if (loc) {
      locName = loc.name;
      if (loc.organization_id) {
        const { data: org } = await supabase.from('organizations').select('name, logo_url, brand_name').eq('id', loc.organization_id).single();
        if (org) { orgName = org.name; logoUrl = org.logo_url || ""; brandName = org.brand_name || org.name; }
      }
    }
  }

  const firstName = fullName.split(' ')[0];
  const displayName = brandName || orgName;
  const logoHtml = logoUrl ? `<img src="${logoUrl}" alt="${displayName}" style="max-height:100px;max-width:200px;margin-bottom:20px;border-radius:8px;"/>` : `<div style="font-size:48px;margin-bottom:16px;">🎉</div>`;

  await queueEmail({
    from: "CrooHQ Hiring <hiring@croohq.email>",
    to: [to],
    subject: `Welcome to ${displayName}${locName ? ` - ${locName}` : ''}!`,
    html: wrapEmail(`
      <tr><td style="background-color:${primaryColor};padding:20px 32px;">
        <table style="width:100%;border-collapse:collapse;"><tr>
          <td style="vertical-align:middle;text-align:left;width:180px;">${logoHtml.replace('margin-bottom:20px;', '').replace('margin-bottom:16px;', '').replace(/style="[^"]*"/, `style="max-height:40px;max-width:120px;"`)}</td>
          <td style="vertical-align:middle;text-align:center;"><h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Welcome to the Team!</h1></td>
          <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;"><p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">${displayName}</p>${locName ? `<p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${systemFontStack};">${locName}</p>` : ''}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <div style="text-align:center;margin-bottom:24px;font-size:48px;">🎉</div>
        <p style="color:${textColor};font-size:18px;margin:0 0 20px;">Hey ${firstName}!</p>
        <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;"><strong>Congratulations!</strong> You've been invited to join <strong style="color:${primaryColor};">${displayName}</strong>${locName ? ` at the <strong>${locName}</strong> location` : ''}.</p>
        <div style="background:#fafaf8;border-radius:16px;padding:24px;margin-bottom:24px;">
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Next Steps</p>
          <p style="color:${textColor};font-size:14px;line-height:1.6;margin:0;">Click the button below to set your password and get started. Once you're in, your manager will add you to the schedule.</p>
        </div>
        <div style="text-align:center;margin:28px 0;"><a href="${resetLink}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Set Your Password</a></div>
        <p style="color:#999;font-size:12px;text-align:center;">This link expires in 24 hours.</p>
      </td></tr>
      ${getEmailFooter()}`),
    source: 'invite',
    dedupKey: `invite_${to}_${Date.now()}`,
  });

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

async function resendInviteEmail(payload: any): Promise<Response> {
  const { to, fullName, resetLink, locationId } = payload;

  if (!to || !fullName || !resetLink) {
    return new Response(JSON.stringify({ error: "to, fullName, resetLink required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let orgName = "your team", locName = "", logoUrl = "", brandName = "";
  if (locationId) {
    const { data: loc } = await supabase.from('locations').select('name, organization_id').eq('id', locationId).single();
    if (loc) {
      locName = loc.name;
      if (loc.organization_id) {
        const { data: org } = await supabase.from('organizations').select('name, logo_url, brand_name').eq('id', loc.organization_id).single();
        if (org) { orgName = org.name; logoUrl = org.logo_url || ""; brandName = org.brand_name || org.name; }
      }
    }
  }

  const firstName = fullName.split(' ')[0];
  const displayName = brandName || orgName;

  await queueEmail({
    from: "CrooHQ <hiring@croohq.email>",
    to: [to],
    subject: `Your CrooHQ Invite - ${displayName}`,
    html: wrapEmail(`
      <tr><td style="background-color:${primaryColor};padding:20px 32px;">
        <table style="width:100%;border-collapse:collapse;"><tr>
          <td style="vertical-align:middle;text-align:left;width:180px;"><img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="max-height:40px;max-width:120px;" /></td>
          <td style="vertical-align:middle;text-align:center;"><h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Set Your Password</h1></td>
          <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;"><p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">${displayName}</p>${locName ? `<p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${systemFontStack};">${locName}</p>` : ''}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <p style="color:${textColor};font-size:18px;margin:0 0 20px;">Hey ${firstName}!</p>
        <p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 24px;">Your manager has re-sent your invite to <strong style="color:${primaryColor};">${displayName}</strong>. Click below to set your password and get started.</p>
        <div style="text-align:center;margin:28px 0;"><a href="${resetLink}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:600;font-size:15px;">Set Your Password</a></div>
        <p style="color:#999;font-size:12px;text-align:center;">This link expires in 24 hours.</p>
      </td></tr>
      ${getEmailFooter()}`),
    source: 'resend_invite',
    dedupKey: `resend_invite_${to}_${Date.now()}`,
  });

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

async function sendRejectionEmail(payload: any): Promise<Response> {
  if (payload.preview) {
    const orgName = "Blaze Pizza";
    const sampleBody = "Dear Jane,<br><br>Thank you for taking the time to apply to Blaze Pizza. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our current needs.<br><br>We appreciate your interest in our team and encourage you to apply again in the future.<br><br>Best regards,<br>The Blaze Pizza Team";
    const html = wrapEmail(`
      <!-- HEADER -->
      <tr><td style="background-color:${primaryColor};padding:20px 32px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="vertical-align:middle;text-align:left;width:180px;">
              <img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:40px;" />
            </td>
            <td style="vertical-align:middle;text-align:center;">
              <h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Application Update</h1>
            </td>
            <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;">
              <p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">${orgName}</p>
              <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${systemFontStack};">Standard Template</p>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <div style="background:#fafaf8;border-radius:16px;padding:24px;margin-bottom:20px;">
          <div style="color:${textColor};font-size:15px;line-height:1.7;">${sampleBody}</div>
        </div>
      </td></tr>
      ${getEmailFooter()}`);
    return new Response(JSON.stringify({ html }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const { applicationId, templateId, overrideEmail } = payload;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (!applicationId || !templateId) {
    return new Response(JSON.stringify({ error: "applicationId and templateId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: app } = await supabase.from("job_applications").select("id, full_name, email, organization_id").eq("id", applicationId).single();
  if (!app) return new Response(JSON.stringify({ error: "Application not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: template } = await supabase.from("rejection_email_templates").select("*").eq("id", templateId).eq("organization_id", app.organization_id).single();
  if (!template) return new Response(JSON.stringify({ error: "Template not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: org } = await supabase.from("organizations").select("name, logo_url, brand_name").eq("id", app.organization_id).single();
  const orgName = org?.brand_name || org?.name || "Our Team";
  const logoUrl = org?.logo_url || "";

  const subject = template.subject.replace(/{{name}}/gi, app.full_name).replace(/{{first_name}}/gi, app.full_name.split(" ")[0]).replace(/{{organization}}/gi, orgName);
  const body = template.body.replace(/{{name}}/gi, app.full_name).replace(/{{first_name}}/gi, app.full_name.split(" ")[0]).replace(/{{organization}}/gi, orgName).replace(/\n/g, "<br>");

  const logoHtml = logoUrl ? `<img src="${logoUrl}" alt="${orgName}" style="max-height:60px;max-width:160px;margin-bottom:12px;border-radius:8px;"/>` : `<img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:50px;margin-bottom:12px;"/>`;

  await queueEmail({
    from: "CrooHQ Hiring <hiring@croohq.email>",
    to: [overrideEmail || app.email],
    subject,
    html: wrapEmail(`
      <tr><td style="background-color:${primaryColor};padding:20px 32px;">
        <table style="width:100%;border-collapse:collapse;"><tr>
          <td style="vertical-align:middle;text-align:left;width:180px;">${logoHtml.replace(/style="[^"]*"/, `style="max-height:40px;max-width:120px;"`)}</td>
          <td style="vertical-align:middle;text-align:center;"><h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Application Update</h1></td>
          <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;"><p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">${orgName}</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <div style="background:#fafaf8;border-radius:16px;padding:24px;">
          <div style="color:${textColor};font-size:15px;line-height:1.7;">${body}</div>
        </div>
      </td></tr>
      ${getEmailFooter()}`),
    source: 'rejection',
    dedupKey: `rejection_${applicationId}_${templateId}`,
  });

  await supabase.from("job_applications").update({ rejection_template_id: templateId, rejection_email_sent_at: new Date().toISOString() }).eq("id", applicationId);

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function sendInterviewInvite(payload: any): Promise<Response> {
  if (payload.preview) {
    const html = wrapEmail(`
      <!-- HEADER -->
      <tr><td style="background-color:${primaryColor};padding:20px 32px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="vertical-align:middle;text-align:left;width:180px;">
              <img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:40px;" />
            </td>
            <td style="vertical-align:middle;text-align:center;">
              <h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Interview Invitation</h1>
            </td>
            <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;">
              <p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">Sample Organization</p>
              <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${systemFontStack};">Sample Location</p>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Hi Jane,</p>
        <p style="color:${textColor};font-size:15px;margin:0 0 24px;"><strong>John Manager</strong> would like to invite you for an interview at <strong>Sample Organization</strong>.</p>
        <div style="background:#fafaf8;border-radius:16px;padding:24px;margin:0 0 24px;text-align:center;">
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Interview Details</p>
          <p style="color:${textColor};font-size:20px;font-weight:700;margin:0 0 4px;">Wednesday, February 19, 2026</p>
          <p style="color:${primaryColor};font-size:24px;font-weight:700;margin:0 0 12px;">2:00 PM</p>
          <p style="color:#666;font-size:14px;margin:0;">Sample Location</p>
        </div>
        <div style="text-align:center;margin:24px 0;">
          <a href="#" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">Accept Interview</a>
        </div>
      </td></tr>
      ${getEmailFooter()}`);
    return new Response(JSON.stringify({ html }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const { conversationId, interviewDate, interviewTime, locationName, locationAddress, scheduledByName } = payload;
  if (!conversationId || !interviewDate || !interviewTime) {
    return new Response(JSON.stringify({ error: "conversationId, interviewDate, interviewTime required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: conversation } = await supabase.from("hiring_conversations").select("id, access_token, application:job_applications(id, full_name, email, organization_id, organization:organizations(name, logo_url, brand_name))").eq("id", conversationId).single();
  if (!conversation) return new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const application = conversation.application as any;
  const org = application?.organization;
  const applicantEmail = application?.email;
  const applicantName = application?.full_name || "Applicant";
  const firstName = applicantName.split(" ")[0];
  const orgName = org?.brand_name || org?.name || "Hiring Team";
  const logoUrl = org?.logo_url || "";
  if (!applicantEmail) return new Response(JSON.stringify({ error: "Applicant has no email" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const chatUrl = `https://croohq.lovable.app/hiring-chat/${conversation.access_token}`;
  const dateObj = new Date(interviewDate + 'T12:00:00');
  const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const [hours, mins] = interviewTime.split(':').map(Number);
  const hour12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedTime = `${hour12}:${mins.toString().padStart(2, '0')} ${ampm}`;
  const icsContent = generateICS(interviewDate, interviewTime, orgName, locationName, locationAddress);
  const logoHtml = logoUrl ? `<img src="${logoUrl}" alt="${orgName}" style="max-height:60px;max-width:160px;margin-bottom:12px;border-radius:8px;"/>` : `<img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:50px;margin-bottom:12px;"/>`;

  await queueEmail({
    from: "CrooHQ Hiring <hiring@croohq.email>",
    to: [applicantEmail],
    subject: `Interview Invitation - ${orgName} on ${formattedDate}`,
    html: wrapEmail(`
      <tr><td style="background-color:${primaryColor};padding:20px 32px;">
        <table style="width:100%;border-collapse:collapse;"><tr>
          <td style="vertical-align:middle;text-align:left;width:180px;">${logoHtml.replace(/style="[^"]*"/, `style="max-height:40px;max-width:120px;"`)}</td>
          <td style="vertical-align:middle;text-align:center;"><h1 style="color:#fff;font-size:26px;font-weight:700;margin:0;letter-spacing:0.5px;font-family:${systemFontStack};">Interview Invitation</h1></td>
          <td style="vertical-align:middle;text-align:right;white-space:nowrap;width:180px;"><p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${systemFontStack};">${orgName}</p><p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${systemFontStack};">${locationName}</p></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Hi ${firstName},</p>
        <p style="color:${textColor};font-size:15px;margin:0 0 24px;"><strong>${scheduledByName}</strong> would like to invite you for an interview at <strong>${orgName}</strong>.</p>
        <div style="background:#fafaf8;border-radius:16px;padding:24px;margin:0 0 24px;text-align:center;">
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Interview Details</p>
          <p style="color:${textColor};font-size:20px;font-weight:700;margin:0 0 4px;">${formattedDate}</p>
          <p style="color:${primaryColor};font-size:24px;font-weight:700;margin:0 0 12px;">${formattedTime}</p>
          <p style="color:#666;font-size:14px;margin:0;">${locationName}</p>
          ${locationAddress ? `<p style="color:#888;font-size:13px;margin:4px 0 0;">${locationAddress}</p>` : ''}
        </div>
        <div style="text-align:center;margin:24px 0;"><a href="${chatUrl}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">Accept Interview</a></div>
      </td></tr>
      ${getEmailFooter()}`),
    source: 'interview_invite',
    dedupKey: `interview_${conversationId}_${interviewDate}_${interviewTime}`,
    metadata: { attachments: [{ filename: "interview.ics", content: btoa(icsContent) }] },
  });

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function sendApplicantNotification(payload: any): Promise<Response> {
  const { conversation_id, title, body, data } = payload;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (!conversation_id) {
    return new Response(JSON.stringify({ error: "conversation_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: subscriptions, error: subError } = await supabase.from('applicant_push_subscriptions').select('subscription_data').eq('conversation_id', conversation_id);

  if (subError) {
    console.error('Error fetching subscriptions:', subError);
    return new Response(JSON.stringify({ error: "Failed to fetch subscriptions" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log('No push subscriptions found for conversation:', conversation_id);
    return new Response(JSON.stringify({ message: "No subscriptions found" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error('VAPID keys not configured');
    return new Response(JSON.stringify({ error: "Push notification keys not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results = { success: 0, failed: 0, expired: 0 };
  const expiredSubscriptionIds: string[] = [];

  for (const sub of subscriptions) {
    try {
      const subscription = JSON.parse(sub.subscription_data);
      const pushPayload = JSON.stringify({
        title: `💬 ${title}`,
        body,
        tag: `hiring-${conversation_id}`,
        data: { ...data, type: 'hiring_message', conversation_id },
      });

      const response = await sendWebPushNotification(subscription, pushPayload, vapidPublicKey, vapidPrivateKey);

      if (response.ok || response.status === 201) {
        results.success++;
        console.log('Push sent successfully');
      } else if (response.status === 410 || response.status === 404) {
        results.expired++;
        expiredSubscriptionIds.push(sub.subscription_data);
        console.log('Subscription expired, will remove');
      } else {
        results.failed++;
        console.error('Push failed:', response.status, await response.text());
      }
    } catch (err) {
      results.failed++;
      console.error('Error sending push:', err);
    }
  }

  if (expiredSubscriptionIds.length > 0) {
    await supabase.from('applicant_push_subscriptions').delete().in('subscription_data', expiredSubscriptionIds);
    console.log(`Cleaned up ${expiredSubscriptionIds.length} expired subscriptions`);
  }

  return new Response(JSON.stringify({ message: "Notifications sent", results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function notifyNewApplication(payload: any): Promise<Response> {
  const { applicationId, applicantName, applicantEmail, applicantPhone, locationId, organizationId, templateName } = payload;
  if (!applicationId || !applicantName || !organizationId || !templateName) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: org } = await supabase.from("organizations").select("name, brand_name, logo_url").eq("id", organizationId).single();
  const orgDisplayName = org?.brand_name || org?.name || "Your Organization";
  const logoUrl = org?.logo_url || "";

  let locationName = "Any Location";
  if (locationId) {
    const { data: location } = await supabase.from("locations").select("name").eq("id", locationId).single();
    locationName = location?.name || "Unknown Location";
  }

  let recipientQuery = supabase.from("profiles").select("id, email, full_name, user_roles!inner(role), user_locations!inner(location_id)").in("user_roles.role", ["admin", "general_manager"]);

  if (locationId) {
    recipientQuery = recipientQuery.eq("user_locations.location_id", locationId);
  }

  const { data: recipients } = await recipientQuery;
  const uniqueEmails = [...new Set(recipients?.map(r => r.email).filter(Boolean))] as string[];

  if (uniqueEmails.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No recipients to notify" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const reviewUrl = "https://croohq.com/hiring";
  const emailHtml = wrapEmail(`${getEmailHeader("New Job Application", logoUrl, orgDisplayName)}<tr><td style="padding:30px 40px;"><h2 style="color:${textColor};font-size:18px;font-weight:600;margin:0 0 20px;">Applicant Details</h2><div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;"><table style="width:100%;"><tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Name</span><br/><strong style="color:${textColor};font-size:16px;">${applicantName}</strong></td></tr><tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Email</span><br/><a href="mailto:${applicantEmail}" style="color:${primaryColor};font-size:14px;text-decoration:none;">${applicantEmail}</a></td></tr>${applicantPhone ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Phone</span><br/><a href="tel:${applicantPhone}" style="color:${primaryColor};font-size:14px;text-decoration:none;">${applicantPhone}</a></td></tr>` : ''}<tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Position</span><br/><strong style="color:${textColor};font-size:14px;">${templateName}</strong></td></tr><tr><td style="padding:8px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">${locationName}</strong></td></tr></table></div>${getCTAButton(reviewUrl, "Review Application")}</td></tr>${getEmailFooter()}`);

  const emailPromises = uniqueEmails.map(email => queueEmail({
    from: "CrooHQ Hiring <hiring@croohq.email>",
    to: [email],
    subject: `New Application Received - ${applicantName}`,
    html: emailHtml,
    source: 'new_application',
    dedupKey: `new_app_${applicationId}_${email}`,
  }));

  const results = await Promise.allSettled(emailPromises);
  const successful = results.filter(r => r.status === 'fulfilled').length;

  console.log(`New application notifications queued: ${successful}/${uniqueEmails.length}`);
  return new Response(JSON.stringify({ success: true, message: `Notifications queued for ${successful} managers` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function notifyEmployeeJoined(payload: any): Promise<Response> {
  const { userId } = payload;
  if (!userId) {
    return new Response(JSON.stringify({ error: "userId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Get the new employee's profile
  const { data: profile } = await supabase.from("profiles").select("id, full_name, email").eq("id", userId).single();
  if (!profile) {
    return new Response(JSON.stringify({ success: true, message: "Profile not found" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Get their locations
  const { data: userLocations } = await supabase.from("user_locations").select("location_id").eq("user_id", userId);
  if (!userLocations || userLocations.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No locations" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const locationIds = userLocations.map(ul => ul.location_id);

  // Get location names
  const { data: locations } = await supabase.from("locations").select("id, name").in("id", locationIds);
  const locationNames = (locations || []).map(l => l.name).join(", ");

  // Get managers at those locations
  const { data: locationUsers } = await supabase.from("user_locations").select("user_id").in("location_id", locationIds);
  const managerCandidateIds = [...new Set((locationUsers || []).map(u => u.user_id))].filter(id => id !== userId);

  if (managerCandidateIds.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No managers" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: roles } = await supabase.from("user_roles").select("user_id, role").in("user_id", managerCandidateIds);
  const managerRoles = ["admin", "org_admin", "super_admin", "manager", "general_manager"];
  const managerIds = (roles || []).filter(r => managerRoles.includes(r.role)).map(r => r.user_id);

  if (managerIds.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No managers found" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: managerProfiles } = await supabase.from("profiles").select("id, email, full_name").in("id", managerIds);
  const managerEmails = [...new Set((managerProfiles || []).map(p => p.email).filter(Boolean))] as string[];

  if (managerEmails.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No manager emails" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const employeeName = profile.full_name || "New Employee";
  const emailHtml = wrapEmail(`
    ${getEmailHeader("New Team Member")}
    <tr><td style="padding:30px 40px;">
      <p style="color:${textColor};font-size:15px;margin:0 0 20px;"><strong style="color:${primaryColor};">${employeeName}</strong> just logged in to Croo for the first time!</p>
      <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;">
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Name</span><br/><strong style="color:${textColor};font-size:16px;">${employeeName}</strong></td></tr>
          ${profile.email ? `<tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Email</span><br/><span style="color:${textColor};font-size:14px;">${profile.email}</span></td></tr>` : ''}
          <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Location</span><br/><strong style="color:${textColor};font-size:14px;">${locationNames}</strong></td></tr>
        </table>
      </div>
      <p style="color:#666;font-size:13px;">They're ready to be added to schedules and assigned tasks.</p>
      ${getCTAButton("https://croohq.com/user-management", "View Team")}
    </td></tr>
    ${getEmailFooter()}
  `);

  for (const email of managerEmails) {
    try {
      await queueEmail({
        from: "CrooHQ Hiring <hiring@croohq.email>",
        to: [email],
        subject: `${employeeName} just joined the team!`,
        html: emailHtml,
        source: "employee_joined",
        dedupKey: `employee_joined_${userId}_${email}`,
      });
    } catch (e) {
      console.error(`[hiring-email] Failed to queue employee_joined for ${email}:`, e);
    }
  }

  return new Response(JSON.stringify({ success: true, message: `Notified ${managerEmails.length} managers` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function notifyHiringMessage(payload: any): Promise<Response> {
  return new Response(JSON.stringify({ success: true, message: "Hiring message notification" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ============ HANDLER ============

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...payload } = await req.json();

    if (!action) {
      return new Response(JSON.stringify({ error: "action parameter required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    switch (action) {
      case "send_invite": return await sendInviteEmail(payload);
      case "resend_invite": return await resendInviteEmail(payload);
      case "send_rejection": return await sendRejectionEmail(payload);
      case "send_interview_invite": return await sendInterviewInvite(payload);
      case "send_applicant_notification": return await sendApplicantNotification(payload);
      case "new_application": return await notifyNewApplication(payload);
      case "employee_joined": return await notifyEmployeeJoined(payload);
      case "hiring_message": return await notifyHiringMessage(payload);
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (error: any) {
    console.error('Error in hiring-email-service:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

serve(handler);
