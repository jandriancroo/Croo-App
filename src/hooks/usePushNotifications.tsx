import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export const usePushNotifications = () => {
  const { user } = useAuth();

  useEffect(() => {
    console.log('[Push] Effect triggered, platform:', Capacitor.getPlatform(), 'isNative:', Capacitor.isNativePlatform(), 'user:', !!user);
    
    // Only initialize on native platforms
    if (!Capacitor.isNativePlatform()) {
      console.log('[Push] Not a native platform, skipping setup');
      return;
    }

    const setupPushNotifications = async () => {
      if (!user) {
        console.log('[Push] No user logged in, skipping setup');
        return;
      }

      console.log('[Push] Starting push notification setup for user:', user.id);

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

          if (!user) {
            console.log('[Push] ❌ No user during token save');
            return;
          }

          try {
            // Save token to database
            console.log('[Push] Saving token to database for user:', user.id);
            const { error } = await supabase
              .from('push_notification_tokens')
              .upsert({
                user_id: user.id,
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
                user_id: user.id,
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

        // Cleanup
        return () => {
          console.log('[Push] Cleaning up listeners');
          registrationListener.remove();
          errorListener.remove();
          receivedListener.remove();
          actionListener.remove();
        };
      } catch (error) {
        console.error('[Push] ❌ FATAL ERROR in setup:', error);
        console.error('[Push] Error stack:', error instanceof Error ? error.stack : 'No stack');
      }
    };

    const cleanup = setupPushNotifications();

    return () => {
      cleanup.then(fn => fn?.());
    };
  }, [user]);
};
