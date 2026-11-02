import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { gateRecipient, settingsKey, isLocked, PULSE_KEYS } from "../_shared/notificationGate.ts";
import { clockedInUserIds } from "../_shared/onClock.ts";
import { requireCaller, type Caller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============ Web Push Implementation ============

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

  // Import private key for signing (VAPID private key is raw 32 bytes)
  const privateKeyBytes = base64UrlDecode(privateKey);
  
  // For ECDSA P-256, we need to import as PKCS8 or use JWK format
  // The VAPID private key is just the raw 32-byte D value, so we need to construct a JWK
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKey,
    x: publicKey.slice(0, 43), // First 32 bytes of uncompressed public key (base64url)
    y: publicKey.slice(43), // Last 32 bytes
  };

  // Actually, let's decode the public key properly
  const pubKeyBytes = base64UrlDecode(publicKey);
  // Public key is 65 bytes: 0x04 || x (32) || y (32)
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
  // Generate local key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  // Export local public key
  const localPublicKeyBuffer = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);
  const localPublicKey = new Uint8Array(localPublicKeyBuffer);

  // Import subscriber's public key
  const subscriberPublicKeyBytes = base64UrlDecode(p256dhKey);
  const subscriberPublicKey = await crypto.subtle.importKey(
    'raw',
    subscriberPublicKeyBytes.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Derive shared secret
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subscriberPublicKey },
    localKeyPair.privateKey,
    256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // Auth secret
  const authSecretBytes = base64UrlDecode(authSecret);

  // Generate salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Create info for IKM derivation
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

  // Import shared secret for HKDF
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits']
  );

  // Derive IKM using auth secret as salt
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

  // Import IKM for CEK and nonce derivation
  const ikmKey = await crypto.subtle.importKey(
    'raw',
    ikm.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits']
  );

  // Derive CEK
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

  // Derive nonce
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

  // Import CEK for AES-GCM
  const aesKey = await crypto.subtle.importKey(
    'raw',
    cek.buffer as ArrayBuffer,
    'AES-GCM',
    false,
    ['encrypt']
  );

  // Add padding delimiter (0x02)
  const payloadBytes = encoder.encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 1);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 2; // Delimiter

  // Encrypt
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

  // Create VAPID header
  const vapidHeaders = await createVapidAuthHeader(
    audience,
    'mailto:support@croohq.com',
    vapidPublicKey,
    vapidPrivateKey
  );

  // Encrypt payload
  const { ciphertext, salt, localPublicKey } = await encryptPayload(
    payload,
    subscription.keys.p256dh,
    subscription.keys.auth
  );

  // Build the body with aes128gcm header
  // Header: salt (16) + rs (4) + idlen (1) + keyid (65)
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

// ============ Firebase FCM Implementation ============

async function getAccessToken() {
  const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") || "{}");
  
  const jwtHeader = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  
  const now = Math.floor(Date.now() / 1000);
  const jwtClaimSet = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const jwtClaimSetEncoded = btoa(JSON.stringify(jwtClaimSet));
  
  const signatureInput = `${jwtHeader}.${jwtClaimSetEncoded}`;
  
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signatureInput)
  );
  
  const jwt = `${signatureInput}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  
  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

// ============ Notification Formatting ============

interface PushNotificationRequest {
  user_ids?: string[];
  roles?: string[];
  location_id?: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  notification_type?: string;
  badge_count?: number;
  sender_id?: string; // Optional: exclude this user from receiving the notification
}

function getNotificationSound(_type?: string): string {
  return 'default';
}

function formatNotificationContent(type: string | undefined, title: string, body: string): { title: string; body: string } {
  switch (type) {
    case 'announcements':
      return { title: `📢 ${title}`, body };
    case 'chat_messages':
      return { title: `💬 ${title}`, body };
    case 'overdue_checklists':
      return { title: `⚠️ ${title}`, body };
    case 'late_arrivals':
      return { title: `🚨 ${title}`, body };
    case 'schedule_updates':
      return { title: `📅 ${title}`, body };
    case 'shift_approvals':
      return { title: `✅ ${title}`, body };
    case 'certification_expiring':
      return { title: `📜 ${title}`, body };
    case 'logbook_entry':
      return { title: `📝 ${title}`, body };
    case 'catering_order':
      return { title: `🍽️ ${title}`, body };
    case 'drawer_count':
      return { title: `💵 ${title}`, body };
    case 'safe_count':
      return { title: `🔐 ${title}`, body };
    case 'arcade_scores':
      return { title: `🕹️ ${title}`, body };
    case 'new_job_application':
      return { title: `🧑‍🍳 ${title}`, body };
    default:
      return { title, body };
  }
}

// ============ Chat Throttle (3-minute per chat_id) ============

const chatThrottleMap = new Map<string, number>();
const CHAT_THROTTLE_MS = 3 * 60 * 1000; // 3 minutes

function isChatThrottled(chatId: string): boolean {
  const now = Date.now();
  const lastSent = chatThrottleMap.get(chatId);
  if (lastSent && now - lastSent < CHAT_THROTTLE_MS) {
    return true;
  }
  chatThrottleMap.set(chatId, now);
  // Cleanup old entries to prevent memory leak
  if (chatThrottleMap.size > 500) {
    const cutoff = now - CHAT_THROTTLE_MS;
    for (const [key, ts] of chatThrottleMap) {
      if (ts < cutoff) chatThrottleMap.delete(key);
    }
  }
  return false;
}

// ============ Caller authorization (one catalog, no caller-provided email) ============
export const KNOWN_NOTIFICATION_TYPES = [
  'chat_messages', 'announcements', 'schedule_updates', 'shift_approvals',
  'logbook_entry', 'drawer_count', 'safe_count', 'waste_log', 'catering_order',
  'task_assigned', 'quick_task', 'test', 'overdue_checklists', 'overdue_checklist',
  'late_arrivals', 'late_arrival', 'monthly_checklist', 'certificate_expiry',
  'certification_expiring', 'arcade_scores', 'new_job_application', 'alarm_task',
  'alarm', 'quick_nudge', 'shift_reminders', 'schedule_published', 'schedule_approval',
  'shift_offer', 'shift_overstay', 'toast_late_clock_in', 'toast_no_clock_out',
  'toast_robot_down', 'vendor_sku_health', 'day_part_pulse', 'hourly_sales_pulse',
  'cash_bank_deposit', 'cash_drawer_count', 'cash_safe_count', 'hiring_doc_uploaded',
  'hiring_interview_response', 'support_tickets', 'labor_rules_proposal', 'qr_task_report',
  'time_off_weekly_digest', 'employee_write_up', 'read_and_sign', 'training_approval',
  'personal', 'logbook_86_68_menu_items', 'logbook_bank_deposit', 'logbook_drawer_count',
  'logbook_employee_write_up', 'logbook_guest_remakes', 'logbook_incidents',
  'logbook_maintenance', 'logbook_manager_notes', 'logbook_online_refunds',
  'logbook_pass_down', 'logbook_performance_review', 'logbook_read_sign',
  'logbook_safe_count', 'logbook_waste_log', 'logbook_weekly_summary',
] as const;
const USER_TYPES = new Set<string>([
  'chat_messages', 'announcements', 'schedule_updates', 'shift_approvals',
  'logbook_entry', 'drawer_count', 'safe_count', 'waste_log', 'catering_order',
  'task_assigned', 'quick_task', 'test',
]);
const MANAGER_TYPES = new Set<string>([
  'announcements', 'schedule_updates', 'shift_approvals', 'logbook_entry',
  'drawer_count', 'safe_count', 'waste_log', 'catering_order', 'task_assigned', 'quick_task',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const managerRoles = new Set(['shift_manager', 'shift_manager_in_training', 'scheduling_manager',
  'manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']);
export function plainPushText(value: string, limit: number): string {
  return Array.from(value.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
type AuthResult = { caller: Caller } | { response: Response };
export interface HandlerDependencies {
  authenticate?: (req: Request) => Promise<AuthResult>;
  client?: () => any;
  clockedIn?: (client: any, location: string) => Promise<string[]>;
  // In-memory test transport only; never selected by a request body/flag.
  deliver?: (ids: string[], content: { title: string; body: string }, data: Record<string, unknown>) => Promise<Response>;
  throttle?: (chatId: string) => boolean;
  rejectLog?: (line: string) => void;
}
export function createHandler(deps: HandlerDependencies = {}) {
return async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  let caller: Caller | null = null;
  let loggedType = 'unparsed';
  let loggedLocation = 'none';
  const reject = (reason: string, error: 'Forbidden' | 'Unauthorized' | 'Unknown notification type' = 'Forbidden', status = 403) => {
    (deps.rejectLog ?? console.warn)(JSON.stringify({ caller_id: caller?.userId ?? (caller?.kind === 'service' ? 'service' : 'unknown'),
      type: loggedType, location: loggedLocation, reason }));
    return json({ error }, status);
  };
  try {
    const auth = await (deps.authenticate ? deps.authenticate(req) : requireCaller(req, corsHeaders));
    if ('response' in auth) return reject('authentication', 'Unauthorized', 401);
    caller = auth.caller;
    let input: any;
    try { input = await req.json(); } catch { return reject('invalid_body'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return reject('invalid_body');
    // A fixed unknown marker avoids reflecting arbitrary request text into logs.
    const notification_type = input.notification_type;
    loggedType = typeof notification_type === 'string' && (KNOWN_NOTIFICATION_TYPES as readonly string[]).includes(notification_type) ? notification_type : 'unknown';
    loggedLocation = typeof input.location_id === 'string' && UUID.test(input.location_id) ? input.location_id : 'none';
    if (loggedType === 'unknown') return reject('unknown_type', 'Unknown notification type');
    if (caller.kind === 'user' && !USER_TYPES.has(notification_type)) return reject('user_type_not_allowed');
    if (typeof input.title !== 'string' || typeof input.body !== 'string' ||
        (input.user_ids !== undefined && (!Array.isArray(input.user_ids) || input.user_ids.length > 2000 || input.user_ids.some((id: unknown) => typeof id !== 'string' || !UUID.test(id)))) ||
        (input.roles !== undefined && (!Array.isArray(input.roles) || input.roles.length > 30 || input.roles.some((r: unknown) => typeof r !== 'string' || !/^[a-z_]{1,40}$/.test(r)))) ||
        (input.location_id !== undefined && (typeof input.location_id !== 'string' || !UUID.test(input.location_id)))) return reject('invalid_body');
    const supabaseClient = deps.client ? deps.client() : createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const roles: string[] = input.roles ?? [];
    const providedUserIds: string[] = input.user_ids ?? [];
    let location_id: string | undefined = input.location_id;
    // Explicitly discard html/subject/email_* both at the top level and in data.
    const data: Record<string, any> = input.data && typeof input.data === 'object' && !Array.isArray(input.data)
      ? Object.fromEntries(Object.entries(input.data).filter(([key]) => !/^(?:html|subject|email_)/i.test(key))) : {};
    const badge_count = typeof input.badge_count === 'number' ? input.badge_count : undefined;
    const sender_id = caller.kind === 'user' ? caller.userId : input.sender_id;
    const title = caller.kind === 'user' ? plainPushText(input.title, 80) : input.title;
    const body = caller.kind === 'user' ? plainPushText(input.body, 200) : input.body;
    const rpcBool = async (name: string, args: Record<string, unknown>) => {
      const result = await supabaseClient.rpc(name, args);
      if (result.error) throw new Error('authorization_lookup');
      return result.data === true;
    };
    const row = async (table: string, columns: string, id: string) => {
      if (!UUID.test(id)) throw new Error('invalid_record');
      const result = await supabaseClient.from(table).select(columns).eq('id', id).maybeSingle();
      if (result.error || !result.data) throw new Error('record_lookup');
      return result.data;
    };
    const locationAccess = (id: string) => rpcBool('has_location_access', { _user_id: id, _location_id: location_id });
    const chatId = data.chat_id ?? data.chatId;
    let supportTicket: any = null;
    let hiringLocation: string | undefined;
    if (caller.kind === 'user') {
      if (notification_type === 'chat_messages' && chatId !== undefined) {
        if (typeof chatId !== 'string' || !UUID.test(chatId)) return reject('invalid_chat');
        data.chat_id = chatId;
        const chat = await row('chats', 'location_id', chatId);
        if (!location_id && chat.location_id) location_id = chat.location_id;
      }
      if (notification_type === 'chat_messages' && data.type === 'hiring_message' && data.conversation_id) {
        const conv = await row('hiring_conversations', 'application_id', data.conversation_id);
        const app = await row('job_applications', 'location_id', conv.application_id);
        hiringLocation = app.location_id;
        if (location_id && hiringLocation !== location_id) return reject('hiring_location_mismatch');
        location_id = hiringLocation;
      }
      if (notification_type === 'chat_messages' && data.type === 'support_message' && data.ticket_id) {
        supportTicket = await row('support_tickets', 'user_id', data.ticket_id);
      }
      if (!location_id && !supportTicket) {
        if (data.schedule_id) location_id = (await row('schedules', 'location_id', data.schedule_id)).location_id;
        else if (data.post_id || data.postId) location_id = (await row('announcement_posts', 'location_id', data.post_id ?? data.postId)).location_id;
        else if (chatId) location_id = (await row('chats', 'location_id', chatId)).location_id;
        else if (notification_type === 'test' && providedUserIds.length === 1 && providedUserIds[0] === caller.userId && roles.length === 0)
          location_id = (await row('profiles', 'default_location_id', caller.userId)).default_location_id;
      }
      loggedLocation = location_id ?? 'none';
      if (!location_id && !supportTicket && !(notification_type === 'chat_messages' && chatId)) return reject('location_required');
      if (MANAGER_TYPES.has(notification_type)) {
        if (!await locationAccess(caller.userId)) return reject('caller_store_access');
        const result = await supabaseClient.rpc('get_user_role', { _user_id: caller.userId });
        if (result.error || !managerRoles.has(result.data)) return reject('manager_required');
      }
    }
    // Expand before checking every target, including targets later excluded as sender.
    let user_ids = [...providedUserIds];
    if (roles.length) {
      let query = supabaseClient.from('user_roles').select('user_id').in('role', roles);
      if (location_id) {
        const assigned = await supabaseClient.from('user_locations').select('user_id').eq('location_id', location_id);
        if (assigned.error) return reject('role_location_lookup');
        const ids = (assigned.data ?? []).map((r: any) => r.user_id);
        if (ids.length) query = query.in('user_id', ids);
        else query = query.in('user_id', []);
      } else if (caller.kind === 'user') return reject('role_location_required');
      const expanded = await query;
      if (expanded.error) return reject('role_lookup');
      const ids = (expanded.data ?? []).map((r: any) => r.user_id);
      user_ids = caller.kind === 'service' ? ids : [...user_ids, ...ids];
    }
    user_ids = [...new Set(user_ids)];
    if (caller.kind === 'user') {
      if (notification_type === 'test' && (roles.length || user_ids.length !== 1 || user_ids[0] !== caller.userId)) return reject('test_self_only');
      if (supportTicket) {
        const isSupportAdmin = async (id: string) => {
          const result = await supabaseClient.from('user_roles').select('role').eq('user_id', id).in('role', ['admin', 'super_admin']);
          if (result.error) throw new Error('support_role_lookup');
          return (result.data ?? []).length > 0;
        };
        const callerAdmin = await isSupportAdmin(caller.userId);
        if (!callerAdmin && supportTicket.user_id !== caller.userId) return reject('support_caller');
        for (const target of user_ids) {
          const targetAdmin = await isSupportAdmin(target);
          if (!(targetAdmin || (callerAdmin && target === supportTicket.user_id))) return reject('support_target');
        }
      } else if (notification_type === 'chat_messages' && chatId && !hiringLocation) {
        if (!await rpcBool('is_chat_member', { _user_id: caller.userId, _chat_id: chatId })) return reject('caller_chat_membership');
        for (const target of user_ids) if (!await rpcBool('is_chat_member', { _user_id: target, _chat_id: chatId })) return reject('target_chat_membership');
      } else {
        if (!await locationAccess(caller.userId)) return reject('caller_store_access');
        for (const target of user_ids) if (!await locationAccess(target)) return reject('target_store_access');
      }
    }
    // Existing service delivery scoping stays unchanged; user scoping above never drops targets.
    if (caller.kind === 'service' && location_id && user_ids.length) {
      const assigned = await supabaseClient.from('user_locations').select('user_id').eq('location_id', location_id).in('user_id', user_ids);
      if (!assigned.error) {
        const allowed = new Set((assigned.data ?? []).map((r: any) => r.user_id));
        user_ids = user_ids.filter(id => allowed.has(id));
      }
    }
    if (sender_id) user_ids = user_ids.filter(id => id !== sender_id);
    if (!user_ids.length) return json({ message: 'No users found for notification' });
    // Authorization precedes throttle so unauthorized calls cannot silence a chat.
    if (notification_type === 'chat_messages' && data.chat_id && (deps.throttle ?? isChatThrottled)(data.chat_id)) return json({ message: 'Throttled - chat push sent recently' });
    const formattedContent = formatNotificationContent(notification_type, title, body);
    if (caller.kind === 'user') formattedContent.title = plainPushText(formattedContent.title, 80);
    const notificationSound = getNotificationSound(notification_type);

    // Get user roles for all requested users
    const { data: userRoles, error: rolesError } = await supabaseClient
      .from('user_roles')
      .select('user_id, role')
      .in('user_id', user_ids);

    if (rolesError) {
      console.error('Error fetching user roles:');
    }

    // Role notification settings are per organization (D3). Resolve the org from the
    // request's location, else from each recipient; fall back to the default template
    // so a missing org row never silences a notification.
    let requestOrgId: string | null = null;
    if (location_id) {
      const { data: locRow } = await supabaseClient
        .from('locations').select('organization_id').eq('id', location_id).maybeSingle();
      requestOrgId = (locRow as any)?.organization_id ?? null;
    }

    const recipientOrg = new Map<string, string>();
    if (!requestOrgId) {
      const { data: memberRows } = await supabaseClient
        .from('organization_members').select('user_id, organization_id').in('user_id', user_ids);
      (memberRows || []).forEach((m: any) => { if (!recipientOrg.has(m.user_id)) recipientOrg.set(m.user_id, m.organization_id); });
      const missing = user_ids.filter(id => !recipientOrg.has(id));
      if (missing.length > 0) {
        const { data: ulRows } = await supabaseClient
          .from('user_locations').select('user_id, locations(organization_id)').in('user_id', missing);
        (ulRows || []).forEach((u: any) => {
          const org = u.locations?.organization_id;
          if (org && !recipientOrg.has(u.user_id)) recipientOrg.set(u.user_id, org);
        });
      }
    }

    const orgIds = Array.from(new Set([requestOrgId, ...recipientOrg.values()].filter(Boolean))) as string[];
    // One gate for every recipient: enabled + "From home" (_shared/notificationGate.ts).
    let finalUserIds = user_ids;
    if (notification_type) {
      const key = settingsKey(notification_type);
      const typeKeys = Array.from(new Set([key, notification_type]));
      const pick = (rows: any[], match: (r: any) => boolean) =>
        rows.find(r => match(r) && r.notification_type === key) ?? rows.find(r => match(r));

      let orgSettings: any[] = [];
      if (orgIds.length > 0) {
        const { data, error: roleSettingsError } = await supabaseClient
          .from('role_notification_settings')
          .select('organization_id, role, notification_type, enabled, from_home')
          .in('notification_type', typeKeys)
          .in('organization_id', orgIds);
        if (roleSettingsError) console.error('Error fetching role notification settings:');
        orgSettings = data || [];
      }
      const { data: tplData, error: tplErr } = await supabaseClient
        .from('role_notification_settings_template')
        .select('role, notification_type, enabled, from_home')
        .in('notification_type', typeKeys);
      if (tplErr) console.error('Error fetching role notification defaults:');
      const templateSettings = tplData || [];

      let userPrefs: any[] = [];
      if (location_id) {
        const { data, error } = await supabaseClient
          .from('user_notification_settings')
          .select('user_id, push_enabled, from_home')
          .eq('notification_type', key)
          .eq('location_id', location_id)
          .in('user_id', user_ids);
        if (error) console.error('Error fetching user notification settings:');
        userPrefs = data || [];
      }

      // Legacy notification_preferences columns still apply to non-cash, non-hiring types.
      const legacyChecked = !['cash_safe_count', 'cash_drawer_count', 'cash_bank_deposit', 'new_job_application'].includes(key);
      let legacyRows: any[] = [];
      if (legacyChecked) {
        const { data } = await supabaseClient.from('notification_preferences').select('*').in('user_id', user_ids);
        legacyRows = data || [];
      }

      let teamMemberViewSales = false;
      if (PULSE_KEYS.has(key) && location_id) {
        const { data } = await supabaseClient.rpc('_org_role_permission_enabled', { _location_id: location_id, _role: 'team_member', _key: 'view_sales' });
        teamMemberViewSales = data === true;
      }

      let clockedIn: Set<string> | null = null;
      if (location_id && !isLocked(notification_type)) {
        try {
          clockedIn = new Set(await (deps.clockedIn ?? clockedInUserIds)(supabaseClient, location_id));
        } catch (e) {
          console.error('[from-home] clock lookup failed, skipping clock check:');
        }
      } else if (!location_id) {
        console.log(`[from-home] no location_id on ${notification_type} push; clock check skipped`);
      }

      const skipped: Record<string, number> = {};
      finalUserIds = user_ids.filter((userId: string) => {
        const role = userRoles?.find(r => r.user_id === userId)?.role ?? null;
        const org = requestOrgId ?? recipientOrg.get(userId) ?? null;
        const roleRow = role
          ? (org ? pick(orgSettings, rs => rs.organization_id === org && rs.role === role) : undefined)
            ?? pick(templateSettings, rs => rs.role === role)
          : undefined;
        const userRow = userPrefs.find((p: any) => p.user_id === userId);
        const legacyVal = legacyRows.find((p: any) => p.user_id === userId)?.[notification_type];
        const res = gateRecipient({
          type: notification_type,
          role,
          roleEnabled: roleRow?.enabled,
          roleFromHome: roleRow?.from_home,
          userPush: userRow?.push_enabled,
          userFromHome: userRow?.from_home,
          legacyEnabled: legacyVal === false ? false : null,
          teamMemberViewSales,
          clockedIn: clockedIn ? clockedIn.has(userId) : null,
        });
        if (!res.send) skipped[res.reason] = (skipped[res.reason] || 0) + 1;
        return res.send;
      });
      console.log(`[gate] ${notification_type}: ${finalUserIds.length}/${user_ids.length} pass`, skipped);
    }

    // Filter out sender_id AFTER all other filtering (ensures sender doesn't get notified on any device)
    if (sender_id) {
      const beforeCount = finalUserIds.length;
      finalUserIds = finalUserIds.filter(id => id !== sender_id);
      if (finalUserIds.length < beforeCount) {
        console.log(`Filtered out sender ${sender_id} from final recipients (was in ${beforeCount}, now ${finalUserIds.length})`);
      }
    }

    if (finalUserIds.length === 0) {
      return new Response(
        JSON.stringify({ message: "No users have this notification type enabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ Visual Alert Queue ============
    // For Quick Tasks (alarm_task / quick_task) and Overdue Checklists,
    // queue a row per user so the in-app dialog stack can greet them
    // even if they don't tap the push.
    let visualAlertNotificationId: string | undefined;
    try {
      const isQuickTask =
        notification_type === 'alarm_task' ||
        notification_type === 'quick_task' ||
        data?.type === 'alarm_task' ||
        data?.type === 'quick_task';
      const isOverdueChecklist =
        notification_type === 'overdue_checklists' && !!data?.checklist_id;
      const refId = isQuickTask
        ? (data?.task_id || data?.ref_id)
        : (data?.checklist_id);

      if ((isQuickTask || isOverdueChecklist) && refId) {
        visualAlertNotificationId =
          data?.notification_id ||
          `${isQuickTask ? 'task' : 'checklist'}:${refId}:${data?.interval_key || new Date().toISOString().slice(0, 10)}`;

        const rows = finalUserIds.map(uid => ({
          user_id: uid,
          alert_type: isQuickTask ? 'quick_task' : 'overdue_checklist',
          ref_id: refId,
          notification_id: visualAlertNotificationId,
          title: title,
          body: body,
          location_id: location_id || null,
        }));

        const { error: vaErr } = await supabaseClient
          .from('visual_alert_queue')
          .upsert(rows, { onConflict: 'user_id,notification_id', ignoreDuplicates: true });

        if (vaErr) {
          console.error('[visual-alert-queue] insert failed:');
        } else {
          console.log(`[visual-alert-queue] queued ${rows.length} alerts (${visualAlertNotificationId})`);
        }
      }
    } catch (vaCatch) {
      console.error('[visual-alert-queue] unexpected error:');
    }

    // Augment payload data with notification_id so SW can deep-link to the right card
    const payloadData = {
      ...(data || {}),
      ...(visualAlertNotificationId ? { notification_id: visualAlertNotificationId } : {}),
    } as Record<string, unknown>;
    {
      const postId = (payloadData.post_id || payloadData.postId) as string | undefined;
      if (!payloadData.url && postId && !payloadData.chat_id && !payloadData.chatId) {
        payloadData.url = `/messages?post=${encodeURIComponent(String(postId))}`;
      }
    }

    if (deps.deliver) return await deps.deliver(finalUserIds, formattedContent, payloadData);

    // Get push tokens WITH user info for detailed logging
    const { data: tokens, error: tokensError } = await supabaseClient
      .from('push_notification_tokens')
      .select('token, platform, user_id')
      .in('user_id', finalUserIds);

    const userNameMap = new Map(finalUserIds.map(id => [id, id]));
    console.log('Push tokens found:', tokens?.length || 0);

    if (tokensError) {
      console.error('Error fetching tokens:');
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ message: "No push tokens found for users" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Separate web and native tokens
    const webTokens = tokens.filter(t => t.platform === 'web');
    const nativeTokens = tokens.filter(t => t.platform === 'ios');

    console.log(`Sending to ${webTokens.length} web and ${nativeTokens.length} native iOS devices`);

    const results: PromiseSettledResult<unknown>[] = [];

    // Send Web Push notifications
    if (webTokens.length > 0) {
      const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
      const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');

      if (vapidPublicKey && vapidPrivateKey) {
        const webPayload = JSON.stringify({
          title: formattedContent.title,
          body: formattedContent.body,
          data: payloadData,
          icon: '/favicon.png',
        });

        const webResults = await Promise.allSettled(
          webTokens.map(async ({ token, user_id }) => {
            const userName = userNameMap.get(user_id) || 'Unknown';
            try {
              const subscription = JSON.parse(token);
              const endpoint = subscription.endpoint || 'unknown';
              const pushService = endpoint.includes('apple') ? 'Apple' : 
                                  endpoint.includes('fcm.googleapis') ? 'FCM' : 
                                  endpoint.includes('mozilla') ? 'Mozilla' : 'Unknown';
              
              console.log(`[${userName}] Sending web push via ${pushService}...`);

              
              const response = await sendWebPushNotification(
                subscription,
                webPayload,
                vapidPublicKey,
                vapidPrivateKey
              );
              
              console.log(`[${userName}] Response status: ${response.status} ${response.statusText}`);
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error(`[${userName}] Web push failed: HTTP ${response.status}`);
                // Auto-prune dead subscriptions: 410 Gone = unsubscribed/expired, 404 = not found.
                // Also prune VapidPkHashMismatch — the browser subscribed with a different
                // applicationServerKey than we sign with, so this token can never be delivered.
                // The client re-subscribes with the server key on next load.
                const isVapidMismatch = /VapidPkHashMismatch/i.test(errorText);
                if (response.status === 410 || response.status === 404 || isVapidMismatch) {
                  console.log(`[${userName}] 🗑️ Pruning unusable subscription (${response.status}${isVapidMismatch ? ' VapidPkHashMismatch' : ''})`);
                  await supabaseClient
                    .from('push_notification_tokens')
                    .delete()
                    .eq('token', token);
                }
                throw new Error(`Web push failed: HTTP ${response.status}`);
              }


              
              console.log(`[${userName}] ✅ Web push sent successfully`);
              return { success: true, user: userName };
            } catch (err) {
              console.error(`[${userName}] Web push failed`);
              throw err;
            }
          })
        );
        results.push(...webResults);
      } else {
        console.log('VAPID keys not configured, skipping web push');
      }
    }

    // Send native FCM notifications
    if (nativeTokens.length > 0) {
      const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") || "{}");
      if (!serviceAccount.project_id) {
        console.error('FIREBASE_SERVICE_ACCOUNT not configured');
      } else {
        console.log('Getting Firebase access token...');
        const accessToken = await getAccessToken();
        console.log('Access token obtained');

        const fcmResults = await Promise.allSettled(
          nativeTokens.map(async ({ token, user_id }) => {
            const userName = userNameMap.get(user_id) || 'Unknown';
            console.log(`[${userName}] Sending native iOS push via FCM...`);

            
            const fcmResponse = await fetch(
              `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  message: {
                    token,
                    notification: {
                      title: formattedContent.title,
                      body: formattedContent.body,
                    },
                    data: Object.entries(payloadData as Record<string, unknown>).reduce((acc, [key, value]) => {
                      acc[key] = String(value);
                      return acc;
                    }, {} as Record<string, string>),

                    apns: {
                      payload: {
                        aps: {
                          sound: notificationSound,
                          badge: badge_count ?? 1,
                          'mutable-content': 1,
                        },
                      },
                    },
                  },
                }),
              }
            );

            console.log(`[${userName}] FCM Response status: ${fcmResponse.status} ${fcmResponse.statusText}`);
            
            if (!fcmResponse.ok) {
              const error = await fcmResponse.text();
              console.error(`[${userName}] FCM failed: HTTP ${fcmResponse.status}`);
              throw new Error(`FCM failed: HTTP ${fcmResponse.status}`);
            }
            
            const result = await fcmResponse.json();
            console.log(`[${userName}] ✅ FCM push sent successfully`);
            return result;
          })
        );
        results.push(...fcmResults);
      }
    }

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`Push notification results: ${successful} successful, ${failed} failed`);

    return new Response(
      JSON.stringify({ 
        message: `Sent ${successful} notifications, ${failed} failed`,
        successful,
        failed,
        web: webTokens.length,
        native: nativeTokens.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    return reject('request_or_lookup_failed');
  }
};
}

export const handler = createHandler();
if (import.meta.main) serve(handler);
