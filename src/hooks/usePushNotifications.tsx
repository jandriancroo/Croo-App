import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { toast } from '@/components/ui/sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import {
  getVapidPublicKey,
  ensureSubscriptionForKey,
  urlBase64ToUint8Array,
} from '@/utils/pushVapid';


// Decode hex string to UTF-8 string (for FCM token from native)
const hexToString = (hex: string): string => {
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return str;
};

export const usePushNotifications = () => {
  const { user, loading } = useAuth();

  useEffect(() => {
    const userId = user?.id;
    const isNative = Capacitor.isNativePlatform();
    console.log('[Push] Effect triggered, platform:', Capacitor.getPlatform(), 'isNative:', isNative, 'userId:', userId, 'loading:', loading);
    
    // Wait for auth to finish loading before attempting push setup
    if (loading) {
      console.log('[Push] Auth still loading, waiting...');
      return;
    }
    
    if (!userId) {
      console.log('[Push] No user logged in after auth loaded, skipping setup');
      return;
    }

    const setupWebPush = async () => {
      // Auth check already done at top of effect
      if (!userId) return;

      // VAPID public key comes from the backend so it can never drift from the
      // key `send-push-notification` signs with (cause of VapidPkHashMismatch).


      console.log('[Push Web] ✅ Starting web push setup for user:', userId);
      console.log('[Push Web] ✅ Starting web push setup for user:', userId);

      try {
        // Check if service worker is supported
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          console.log('[Push Web] ❌ Service Worker or Push API not supported');
          return;
        }

        // Check current permission state first
        const currentPermission = Notification.permission;
        console.log('[Push Web] Current permission state:', currentPermission);
        
        let permission = currentPermission;
        
        if (currentPermission === 'denied') {
          // On iOS Safari PWA, denied permission cannot be re-prompted
          // User must manually enable in iOS Settings
          console.log('[Push Web] ❌ Permission was previously denied - user must enable in iOS Settings');
          console.log('[Push Web] iOS: Settings → Safari → [This Website] → Notifications');
          console.log('[Push Web] Or: Settings → Notifications → Safari');
          
          // Only show toast once per session to avoid spam
          if (!sessionStorage.getItem('push_denied_toast_shown')) {
            sessionStorage.setItem('push_denied_toast_shown', 'true');
            toast.error("Notifications Disabled — Go to iOS Settings → Safari → Notifications to enable");
          }
          return;
        }
        
        if (currentPermission === 'default') {
          // Permission hasn't been decided yet - we can request
          console.log('[Push Web] Requesting notification permission...');
          permission = await Notification.requestPermission();
          console.log('[Push Web] Permission result:', permission);
        }

        if (permission !== 'granted') {
          console.log('[Push Web] ❌ Notification permission not granted:', permission);
          return;
        }

        // Wait for service worker to be ready (PWA already registers it)
        console.log('[Push Web] Waiting for service worker...');
        const registration = await navigator.serviceWorker.ready;
        console.log('[Push Web] ✅ Service worker ready');

        // Check for existing subscription first - reuse if valid
        let subscription = await (registration as any).pushManager.getSubscription();
        
        if (subscription) {
          console.log('[Push Web] ✅ Reusing existing subscription:', subscription.endpoint);
        } else {
          // Only create new subscription if none exists
          console.log('[Push Web] Creating new push subscription...');
          subscription = await (registration as any).pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
          });
          console.log('[Push Web] ✅ New push subscription created:', subscription.endpoint);
        }

        // Save subscription to database - deduplicate by endpoint
        const subscriptionData = JSON.stringify(subscription);
        const endpoint = subscription.endpoint;
        console.log('[Push Web] Saving subscription to database...');
        
        // Delete any old tokens for this user with the same endpoint (different keys)
        // This prevents duplicate tokens for the same browser
        await supabase
          .from('push_notification_tokens')
          .delete()
          .eq('user_id', userId)
          .like('token', `%${endpoint.substring(0, 80)}%`);
        
        // Limit tokens per user to prevent accumulation (keep latest 10 per user)
        const { data: userTokens } = await supabase
          .from('push_notification_tokens')
          .select('id, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        
        if (userTokens && userTokens.length >= 10) {
          const tokensToDelete = userTokens.slice(9).map(t => t.id);
          if (tokensToDelete.length > 0) {
            await supabase
              .from('push_notification_tokens')
              .delete()
              .in('id', tokensToDelete);
            console.log(`[Push Web] Cleaned up ${tokensToDelete.length} old tokens`);
          }
        }
        
        // Upsert the current token
        const { error } = await supabase
          .from('push_notification_tokens')
          .upsert({
            user_id: userId,
            token: subscriptionData,
            platform: 'web',
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id,token'
          });

        if (error) {
          // If upsert fails (no unique constraint), try insert
          const { error: insertError } = await supabase
            .from('push_notification_tokens')
            .insert({
              user_id: userId,
              token: subscriptionData,
              platform: 'web',
            });
          if (insertError) {
            console.error('[Push Web] ❌ Failed to save subscription:', insertError);
            throw insertError;
          }
        }

        console.log('[Push Web] ✅ Subscription saved to database');

        // Create default notification preferences if they don't exist
        const { error: prefsError } = await supabase
          .from('notification_preferences')
          .upsert({
            user_id: userId,
            overdue_checklists: true,
            late_arrivals: true,
            announcements: true,
            chat_messages: true,
          }, {
            onConflict: 'user_id'
          });

        if (prefsError) {
          console.error('[Push Web] ⚠️ Failed to save notification preferences:', prefsError);
        }

        // Only show toast once per session
        if (!sessionStorage.getItem('push_notifications_toast_shown')) {
          sessionStorage.setItem('push_notifications_toast_shown', 'true');
          toast.success("Notifications Enabled");
        }

        console.log('[Push Web] ✅ Web push setup complete!');

      } catch (error) {
        console.error('[Push Web] ❌ Error in web push setup:', error);
        // Don't show error toast for expected failures (missing keys, denied permission, etc.)
        // Those are already handled with early returns above
      }
    };

    const setupNativePush = async () => {
      // Auth check already done at top of effect
      if (!userId) return;

      console.log('[Push Native] ✅ Starting native push setup for user:', userId);

      try {
        // Request permission to use push notifications
        console.log('[Push] Requesting permissions...');
        const permStatus = await PushNotifications.requestPermissions();
        console.log('[Push] Permission status:', JSON.stringify(permStatus));

        if (permStatus.receive !== 'granted') {
          console.log('[Push] Permission not granted:', permStatus.receive);
          console.log('[Push] Stopping setup - permission denied');
          return;
        }

        console.log('[Push] ✅ Permission granted! Setting up listeners...');

        const registrationListener = await PushNotifications.addListener('registration', async (token) => {
          console.log('[Push] 🎉 REGISTRATION CALLBACK FIRED!');
          console.log('[Push] Token object:', JSON.stringify(token));
          console.log('[Push] Raw token value:', token?.value);

          if (!token || !token.value) {
            console.error('[Push] ❌ Token is undefined or missing value');
            return;
          }

          if (!userId) {
            console.log('[Push] ❌ No user during token save');
            return;
          }

          try {
            // Decode hex-encoded FCM token from native bridge
            let fcmToken = token.value;
            
            // Check if this looks like a hex-encoded string (all hex chars, even length)
            if (/^[0-9A-Fa-f]+$/.test(fcmToken) && fcmToken.length % 2 === 0 && fcmToken.length > 100) {
              console.log('[Push] Detected hex-encoded token, decoding...');
              fcmToken = hexToString(fcmToken);
              console.log('[Push] Decoded FCM token:', fcmToken);
            }
            
            // Verify it looks like an FCM token (contains :APA91b)
            if (!fcmToken.includes(':APA91b')) {
              console.warn('[Push] ⚠️ Token does not look like FCM format, might be APNs token');
            }

            // Save token to database - use token as unique key to support multiple devices
            console.log('[Push] Saving FCM token to database for user:', userId);
            
            // First try to find existing token for this exact device
            const { data: existingToken } = await supabase
              .from('push_notification_tokens')
              .select('id')
              .eq('user_id', userId)
              .eq('token', fcmToken)
              .maybeSingle();
            
            let error;
            if (existingToken) {
              // Update existing token (updates updated_at)
              const result = await supabase
                .from('push_notification_tokens')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', existingToken.id);
              error = result.error;
            } else {
              // Insert new token for this device
              const result = await supabase
                .from('push_notification_tokens')
                .insert({
                  user_id: userId,
                  token: fcmToken,
                  platform: Capacitor.getPlatform(),
                });
              error = result.error;
            }

            if (error) {
              console.error('[Push] ❌ Failed to save push token:', error);
            } else {
              console.log('[Push] ✅ Token saved successfully!');
            }

            // Create default notification preferences if they don't exist
            console.log('[Push] Setting up notification preferences...');
            const { error: prefsError } = await supabase
              .from('notification_preferences')
              .upsert({
                user_id: userId,
                overdue_checklists: true,
                late_arrivals: true,
                announcements: true,
                chat_messages: true,
              }, {
                onConflict: 'user_id',
                ignoreDuplicates: true
              });

            if (prefsError && prefsError.code !== '23505') {
              console.error('[Push] Failed to create notification preferences:', prefsError);
            } else {
              console.log('[Push] ✅ Notification preferences set up successfully');
            }
          } catch (error) {
            console.error('[Push] Error handling push token:', error);
          }
        });

        const errorListener = await PushNotifications.addListener('registrationError', (error) => {
          console.error('[Push] ❌ REGISTRATION ERROR CALLBACK FIRED!');
          console.error('[Push] Error object:', JSON.stringify(error));
          console.error('[Push] Error message:', error?.error);
        });

        const receivedListener = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('[Push] Notification received:', notification);
          toast({
            title: notification.title || 'New notification',
            description: notification.body,
          });
        });

        const actionListener = await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          console.log('[Push] Notification tapped:', notification);
          const data = notification.notification.data;
          // Handle chat_id or chatId (different sources use different formats)
          const chatId = data?.chat_id || data?.chatId;
          const checklistId = data?.checklist_id || data?.checklistId;
          
          if ((data?.type === 'chat' || data?.type === 'announcement' || data?.type === 'chat_message') && chatId) {
            window.location.href = `/messages?chat=${chatId}`;
          } else if (data?.type === 'checklist' && checklistId) {
            window.location.href = `/complete/${checklistId}`;
          } else if (data?.type === 'alert' || data?.type === 'overdue_checklist' || data?.type === 'late_arrival') {
            window.location.href = '/alerts';
          }
        });

        console.log('[Push] ✅ All 4 listeners attached successfully');
        console.log('[Push] 📱 Now calling PushNotifications.register()...');
        
        await PushNotifications.register();
        
        console.log('[Push] ✅ register() call completed');
        console.log('[Push] ⏳ Waiting for registration callback from iOS...');

        // Don't cleanup - let listeners persist
        console.log('[Push] ✅ Setup complete, listeners will remain active');
      } catch (error) {
        console.error('[Push] ❌ FATAL ERROR in setup:', error);
        console.error('[Push] Error stack:', error instanceof Error ? error.stack : 'No stack');
      }
    };

    // Choose setup based on platform
    if (isNative) {
      setupNativePush();
    } else {
      setupWebPush();
    }
  }, [user?.id, loading]);
};
