import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  notification_type?: 'overdue_checklists' | 'late_arrivals' | 'announcements' | 'chat_messages' | 'schedule_updates' | 'shift_approvals' | 'certification_expiring' | 'logbook_entry' | 'catering_order' | 'drawer_count' | 'safe_count' | 'arcade_scores' | 'cash_drawer_count' | 'cash_safe_count' | 'cash_bank_deposit' | 'alarm_task' | 'quick_task';
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

// ============ Main Handler ============

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { user_ids: providedUserIds, roles, location_id, title, body, data, notification_type, badge_count, sender_id }: PushNotificationRequest = await req.json();

    // Chat message throttle: max 1 push per chat per 3 minutes
    if (notification_type === 'chat_messages' && data?.chat_id) {
      if (isChatThrottled(data.chat_id)) {
        console.log(`[chat-throttle] Skipping push for chat ${data.chat_id} (within 3-min window)`);
        return new Response(
          JSON.stringify({ message: "Throttled - chat push sent recently" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const formattedContent = formatNotificationContent(notification_type, title, body);
    const notificationSound = getNotificationSound(notification_type);

    // If roles are provided, fetch user_ids from those roles at the specified location
    let user_ids = providedUserIds || [];
    
    // Filter out sender_id if provided (prevents sender from receiving their own notification)
    if (sender_id && user_ids.length > 0) {
      const originalCount = user_ids.length;
      user_ids = user_ids.filter(id => id !== sender_id);
      if (user_ids.length < originalCount) {
        console.log(`Filtered out sender ${sender_id} from recipients`);
      }
    }
    
    if (roles && roles.length > 0 && location_id) {
      console.log(`Fetching users by roles ${roles.join(', ')} at location ${location_id}`);
      
      // Get users with matching roles at the specified location
      const { data: userLocations, error: locError } = await supabaseClient
        .from('user_locations')
        .select('user_id')
        .eq('location_id', location_id);
        
      if (locError) {
        console.error('Error fetching user locations:', locError);
      }
      
      const locationUserIds = userLocations?.map(ul => ul.user_id) || [];
      
      if (locationUserIds.length > 0) {
        const { data: matchingUsers, error: rolesErr } = await supabaseClient
          .from('user_roles')
          .select('user_id')
          .in('role', roles)
          .in('user_id', locationUserIds);
          
        if (rolesErr) {
          console.error('Error fetching users by role:', rolesErr);
        }
        
        user_ids = matchingUsers?.map(u => u.user_id) || [];
        console.log(`Found ${user_ids.length} users matching roles at location`);
      }
    } else if (roles && roles.length > 0 && !location_id) {
      // No location specified, get all users with matching roles
      const { data: matchingUsers, error: rolesErr } = await supabaseClient
        .from('user_roles')
        .select('user_id')
        .in('role', roles);
        
      if (rolesErr) {
        console.error('Error fetching users by role:', rolesErr);
      }
      
      user_ids = matchingUsers?.map(u => u.user_id) || [];
    }

    console.log('Push notification request:', { 
      user_ids_count: user_ids?.length, 
      title: formattedContent.title, 
      body: formattedContent.body?.substring(0, 50),
      notification_type,
    });

    if (!user_ids || user_ids.length === 0) {
      return new Response(
        JSON.stringify({ message: "No users found for notification" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user roles for all requested users
    const { data: userRoles, error: rolesError } = await supabaseClient
      .from('user_roles')
      .select('user_id, role')
      .in('user_id', user_ids);

    if (rolesError) {
      console.error('Error fetching user roles:', rolesError);
    }

    // Get role notification settings
    const { data: roleSettings, error: roleSettingsError } = await supabaseClient
      .from('role_notification_settings')
      .select('role, notification_type, enabled');

    if (roleSettingsError) {
      console.error('Error fetching role notification settings:', roleSettingsError);
    }

    // Filter users based on their role's notification permissions
    const enabledUserIds = user_ids.filter(userId => {
      const userRole = userRoles?.find(r => r.user_id === userId);
      if (!userRole) return true; // Default to enabled if no role found
      
      // Check if this notification type is enabled for this role
      if (notification_type && roleSettings) {
        const roleSetting = roleSettings.find(
          rs => rs.role === userRole.role && rs.notification_type === notification_type
        );
        if (roleSetting && !roleSetting.enabled) {
          console.log(`Filtering out user ${userId} - ${notification_type} disabled for ${userRole.role}`);
          return false;
        }
      }
      return true;
    });

    console.log(`Filtered to ${enabledUserIds.length} users based on role permissions`);

    // Map edge function notification types to user_notification_settings keys
    const notificationTypeToSettingsKey: Record<string, string> = {
      'safe_count': 'cash_safe_count',
      'drawer_count': 'cash_drawer_count',
      'cash_safe_count': 'cash_safe_count',
      'cash_drawer_count': 'cash_drawer_count',
      'cash_bank_deposit': 'cash_bank_deposit',
    };

    // Also filter by user notification preferences
    let finalUserIds = enabledUserIds;
    if (notification_type) {
      // First check the new location-based user_notification_settings table
      const settingsKey = notificationTypeToSettingsKey[notification_type] || notification_type;
      
      if (location_id) {
        // For location-specific notifications, check user_notification_settings
        const { data: locationPrefs, error: locationPrefsError } = await supabaseClient
          .from('user_notification_settings')
          .select('user_id, push_enabled')
          .eq('notification_type', settingsKey)
          .eq('location_id', location_id)
          .in('user_id', enabledUserIds);
        
        if (!locationPrefsError && locationPrefs && locationPrefs.length > 0) {
          console.log(`Found ${locationPrefs.length} location-based preferences for ${settingsKey} at location ${location_id}`);
          
          finalUserIds = enabledUserIds.filter(userId => {
            const userPref = locationPrefs.find((p: any) => p.user_id === userId);
            // If no preference record for this location/type, default to enabled
            if (!userPref) return true;
            // Check if push_enabled is explicitly false
            if (userPref.push_enabled === false) {
              console.log(`Filtering out user ${userId} - ${settingsKey} push disabled for location ${location_id}`);
              return false;
            }
            return true;
          });
          console.log(`Filtered to ${finalUserIds.length} users based on location notification settings`);
        }
      }
      
      // Also check the legacy notification_preferences table for non-cash notifications
      if (!notificationTypeToSettingsKey[notification_type]) {
        const { data: userPrefs, error: prefsError } = await supabaseClient
          .from('notification_preferences')
          .select('*')
          .in('user_id', finalUserIds);
        
        if (!prefsError && userPrefs) {
          finalUserIds = finalUserIds.filter(userId => {
            const userPref = userPrefs.find((p: any) => p.user_id === userId);
            // If no preference record, default to enabled
            if (!userPref) return true;
            // Check if this specific notification type is enabled
            const prefValue = (userPref as any)[notification_type];
            if (prefValue === false) {
              console.log(`Filtering out user ${userId} - ${notification_type} disabled in legacy preferences`);
              return false;
            }
            return true;
          });
          console.log(`Filtered to ${finalUserIds.length} users based on legacy preferences`);
        }
      }
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
          console.error('[visual-alert-queue] insert failed:', vaErr);
        } else {
          console.log(`[visual-alert-queue] queued ${rows.length} alerts (${visualAlertNotificationId})`);
        }
      }
    } catch (vaCatch) {
      console.error('[visual-alert-queue] unexpected error:', vaCatch);
    }

    // Augment payload data with notification_id so SW can deep-link to the right card
    const payloadData = {
      ...(data || {}),
      ...(visualAlertNotificationId ? { notification_id: visualAlertNotificationId } : {}),
    };

    // Get push tokens WITH user info for detailed logging
    const { data: tokens, error: tokensError } = await supabaseClient
      .from('push_notification_tokens')
      .select('token, platform, user_id')
      .in('user_id', finalUserIds);

    // Get user names for logging
    const { data: userProfiles } = await supabaseClient
      .from('profiles')
      .select('id, full_name, email')
      .in('id', finalUserIds);

    const userNameMap = new Map(userProfiles?.map(u => [u.id, u.full_name || u.email]) || []);

    console.log('Push tokens found:', tokens?.length || 0);
    tokens?.forEach(t => {
      const userName = userNameMap.get(t.user_id) || 'Unknown';
      const tokenPreview = typeof t.token === 'string' ? t.token.substring(0, 50) : JSON.stringify(t.token).substring(0, 50);
      console.log(`  - ${userName} (${t.platform}): ${tokenPreview}...`);
    });

    if (tokensError) {
      console.error('Error fetching tokens:', tokensError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch push tokens" }),
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
              console.log(`[${userName}] Endpoint: ${endpoint.substring(0, 80)}...`);
              
              const response = await sendWebPushNotification(
                subscription,
                webPayload,
                vapidPublicKey,
                vapidPrivateKey
              );
              
              console.log(`[${userName}] Response status: ${response.status} ${response.statusText}`);
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error(`[${userName}] Web push FAILED: ${response.status} - ${errorText}`);
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
                throw new Error(`Web push failed: ${response.status} - ${errorText}`);
              }


              
              console.log(`[${userName}] ✅ Web push sent successfully`);
              return { success: true, user: userName };
            } catch (err) {
              console.error(`[${userName}] ❌ Web push error:`, err);
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
            console.log(`[${userName}] Token: ${token.substring(0, 50)}...`);
            
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
              console.error(`[${userName}] ❌ FCM error:`, error);
              throw new Error(`FCM request failed: ${error}`);
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error in send-push-notification:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
