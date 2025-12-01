import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PushNotificationRequest {
  user_ids: string[];
  title: string;
  body: string;
  data?: Record<string, any>;
  notification_type?: 'overdue_checklists' | 'late_arrivals' | 'announcements' | 'chat_messages';
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

    const { user_ids, title, body, data, notification_type }: PushNotificationRequest = await req.json();

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

    // Get push tokens for enabled users
    const { data: tokens, error: tokensError } = await supabaseClient
      .from('push_notification_tokens')
      .select('token')
      .in('user_id', enabledUserIds);

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

    const fcmServerKey = Deno.env.get("FCM_SERVER_KEY");
    if (!fcmServerKey) {
      console.error('FCM_SERVER_KEY not configured');
      return new Response(
        JSON.stringify({ error: "Push notifications not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send notifications via FCM
    const results = await Promise.allSettled(
      tokens.map(async ({ token }) => {
        const fcmResponse = await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'Authorization': `key=${fcmServerKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: token,
            notification: {
              title,
              body,
              sound: 'default',
            },
            data: data || {},
          }),
        });

        if (!fcmResponse.ok) {
          const error = await fcmResponse.text();
          console.error('FCM error:', error);
          throw new Error(`FCM request failed: ${error}`);
        }

        return await fcmResponse.json();
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return new Response(
      JSON.stringify({ 
        message: `Sent ${successful} notifications, ${failed} failed`,
        successful,
        failed,
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