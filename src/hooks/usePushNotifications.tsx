import { useEffect, useRef } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export const usePushNotifications = () => {
  const { user } = useAuth();
  const hasRegisteredRef = useRef(false);

  useEffect(() => {
    const userId = user?.id;
    const isNative = Capacitor.isNativePlatform();
    console.log('[Push] Effect triggered, platform:', Capacitor.getPlatform(), 'isNative:', isNative, 'userId:', userId);

    const setupWebPush = async () => {
      if (!userId) {
        console.log('[Push Web] No user logged in, skipping setup');
        return;
      }

      // Check if VAPID keys are configured
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        console.log('[Push Web] VAPID keys not configured, skipping web push setup');
        return;
      }

      if (hasRegisteredRef.current) {
        console.log('[Push Web] ⚠️ Already registered, skipping duplicate setup');
        return;
      }

      hasRegisteredRef.current = true;
      console.log('[Push Web] ✅ Starting web push setup for user:', userId);

      try {
        // Check if service worker is supported
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          console.log('[Push Web] ❌ Service Worker or Push API not supported');
          return;
        }

        // Request notification permission
        console.log('[Push Web] Requesting notification permission...');
        const permission = await Notification.requestPermission();
        console.log('[Push Web] Permission result:', permission);

        if (permission !== 'granted') {
          console.log('[Push Web] ❌ Notification permission denied');
          toast({
            title: "Notifications Blocked",
            description: "Please enable notifications in your browser settings.",
            variant: "destructive",
          });
          hasRegisteredRef.current = false;
          return;
        }

        // Register service worker
        console.log('[Push Web] Registering service worker...');
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        console.log('[Push Web] ✅ Service worker registered');

        // Subscribe to push notifications
        console.log('[Push Web] Creating push subscription...');
        
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
        });

        console.log('[Push Web] ✅ Push subscription created:', subscription.endpoint);

        // Save subscription to database
        const subscriptionData = JSON.stringify(subscription);
        console.log('[Push Web] Saving subscription to database...');
        
        const { error } = await supabase
          .from('push_notification_tokens')
          .upsert({
            user_id: userId,
            token: subscriptionData,
            platform: 'web',
          }, {
            onConflict: 'user_id,platform'
          });

        if (error) {
          console.error('[Push Web] ❌ Failed to save subscription:', error);
          throw error;
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

        toast({
          title: "Notifications Enabled",
          description: "You'll receive push notifications for important updates.",
        });

        console.log('[Push Web] ✅ Web push setup complete!');

      } catch (error) {
        console.error('[Push Web] ❌ FATAL ERROR in setup:', error);
        hasRegisteredRef.current = false;
        toast({
          title: "Notification Setup Failed",
          description: "Unable to enable notifications. Please try again.",
          variant: "destructive",
        });
      }
    };

    const setupNativePush = async () => {
      if (!userId) {
        console.log('[Push Native] No user logged in, skipping setup');
        return;
      }

      if (hasRegisteredRef.current) {
        console.log('[Push Native] ⚠️ Already registered, skipping duplicate setup');
        return;
      }

      hasRegisteredRef.current = true;
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
          console.log('[Push] Token value:', token?.value);

          if (!token || !token.value) {
            console.error('[Push] ❌ Token is undefined or missing value');
            return;
          }

          if (!userId) {
            console.log('[Push] ❌ No user during token save');
            return;
          }

          try {
            // Save token to database
            console.log('[Push] Saving token to database for user:', userId);
            const { error } = await supabase
              .from('push_notification_tokens')
              .upsert({
                user_id: userId,
                token: token.value,
                platform: Capacitor.getPlatform(),
              }, {
                onConflict: 'user_id,token'
              });

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
          if (data?.type === 'chat' && data?.chatId) {
            window.location.href = `/messages?chat=${data.chatId}`;
          } else if (data?.type === 'checklist' && data?.checklistId) {
            window.location.href = `/complete/${data.checklistId}`;
          } else if (data?.type === 'alert') {
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
        hasRegisteredRef.current = false; // Reset on error
      }
    };

    // Choose setup based on platform
    if (isNative) {
      setupNativePush();
    } else {
      setupWebPush();
    }
  }, [user?.id]);
};
