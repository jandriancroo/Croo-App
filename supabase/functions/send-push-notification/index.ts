import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Firebase Admin SDK utilities
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
  
  // Import the private key
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  // Sign the JWT
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signatureInput)
  );
  
  const jwt = `${signatureInput}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  
  // Exchange JWT for access token
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
  return bytes.buffer;
}


interface PushNotificationRequest {
  user_ids: string[];
  title: string;
  body: string;
  data?: Record<string, any>;
  notification_type?: 'overdue_checklists' | 'late_arrivals' | 'announcements' | 'chat_messages';
  badge_count?: number;
}

// Get notification sound based on type
function getNotificationSound(type?: string): string {
  switch (type) {
    case 'announcements':
      return 'default';
    case 'chat_messages':
      return 'default';
    case 'overdue_checklists':
      return 'default';
    case 'late_arrivals':
      return 'default';
    default:
      return 'default';
  }
}

// Format notification content based on type
function formatNotificationContent(type: string | undefined, title: string, body: string): { title: string; body: string } {
  switch (type) {
    case 'announcements':
      return {
        title: `📢 ${title}`,
        body: body
      };
    case 'chat_messages':
      return {
        title: `💬 ${title}`,
        body: body
      };
    case 'overdue_checklists':
      return {
        title: `⚠️ ${title}`,
        body: body
      };
    case 'late_arrivals':
      return {
        title: `🚨 ${title}`,
        body: body
      };
    default:
      return { title, body };
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { user_ids, title, body, data, notification_type, badge_count }: PushNotificationRequest = await req.json();

    // Format content based on notification type
    const formattedContent = formatNotificationContent(notification_type, title, body);
    const notificationSound = getNotificationSound(notification_type);

    console.log('Push notification request:', { 
      user_ids_count: user_ids?.length, 
      title: formattedContent.title, 
      body: formattedContent.body?.substring(0, 50),
      notification_type,
      badge_count,
      sound: notificationSound
    });

    if (!user_ids || user_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "user_ids is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user preferences and tokens
    const { data: preferences, error: prefsError } = await supabaseClient
      .from('notification_preferences')
      .select('user_id, overdue_checklists, late_arrivals, announcements, chat_messages')
      .in('user_id', user_ids);

    if (prefsError) {
      console.error('Error fetching preferences:', prefsError);
    }

    // Filter users based on their notification preferences
    const enabledUserIds = user_ids.filter(userId => {
      const userPref = preferences?.find(p => p.user_id === userId);
      if (!userPref) return true; // Send if no preferences set (default enabled)
      
      // Check if notification type is enabled for this user
      if (notification_type && userPref[notification_type] === false) {
        return false;
      }
      
      return true;
    });

    if (enabledUserIds.length === 0) {
      return new Response(
        JSON.stringify({ message: "No users have this notification type enabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get push tokens for enabled users (only native iOS for now)
    const { data: tokens, error: tokensError } = await supabaseClient
      .from('push_notification_tokens')
      .select('token, platform')
      .in('user_id', enabledUserIds)
      .eq('platform', 'ios');

    console.log('Push tokens found:', tokens?.length || 0);

    if (tokensError) {
      console.error('Error fetching tokens:', tokensError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch push tokens" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!tokens || tokens.length === 0) {
      console.log('No push tokens found for users:', enabledUserIds);
      return new Response(
        JSON.stringify({ message: "No push tokens found for users" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Sending to ${tokens.length} native iOS devices`);

    const results = [];

    // Send native FCM notifications
    const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") || "{}");
    if (!serviceAccount.project_id) {
      console.error('FIREBASE_SERVICE_ACCOUNT not configured');
      return new Response(
        JSON.stringify({ error: "Firebase not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get OAuth2 access token
    console.log('Getting Firebase access token...');
    const accessToken = await getAccessToken();
    console.log('Access token obtained');

    const fcmResults = await Promise.allSettled(
      tokens.map(async ({ token }) => {
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
                data: Object.keys(data || {}).reduce((acc, key) => {
                  acc[key] = String((data || {})[key]);
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
                android: {
                  notification: {
                    sound: notificationSound,
                    notification_count: badge_count ?? 1,
                  },
                },
              },
            }),
          }
        );

        if (!fcmResponse.ok) {
          const error = await fcmResponse.text();
          console.error('FCM error:', error);
          throw new Error(`FCM request failed: ${error}`);
        }

        return await fcmResponse.json();
      })
    );
    results.push(...fcmResults);

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`Push notification results: ${successful} successful, ${failed} failed`);

    return new Response(
      JSON.stringify({ 
        message: `Sent ${successful} notifications, ${failed} failed`,
        successful,
        failed,
        native: tokens.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in send-push-notification:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
