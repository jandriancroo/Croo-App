import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export const usePushNotifications = () => {
  const { user } = useAuth();

  useEffect(() => {
    // Only initialize on native platforms
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const setupPushNotifications = async () => {
      if (!user) return;

      try {
        // Request permission to use push notifications
        const permStatus = await PushNotifications.requestPermissions();
        
        if (permStatus.receive === 'granted') {
          // Register with Apple / Google to receive push via APNS/FCM
          await PushNotifications.register();
        }

        // Setup listeners
        const registrationListener = await PushNotifications.addListener('registration', async (token) => {
          console.log('Push registration success, token: ' + token.value);
          
          if (!user) return;

          try {
            // Save token to database
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
              console.error('Failed to save push token:', error);
            } else {
              console.log('Push token saved successfully');
            }

            // Create default notification preferences if they don't exist
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

            if (prefsError && prefsError.code !== '23505') { // Ignore duplicate key errors
              console.error('Failed to create notification preferences:', prefsError);
            }
          } catch (error) {
            console.error('Error handling push token:', error);
          }
        });

        const errorListener = await PushNotifications.addListener('registrationError', (error) => {
          console.error('Error on registration: ' + JSON.stringify(error));
        });

        const receivedListener = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('Push notification received: ', notification);
          toast({
            title: notification.title || 'New notification',
            description: notification.body,
          });
        });

        const actionListener = await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          console.log('Push notification action performed', notification);
          // Handle notification tap - navigate to relevant screen based on notification data
          const data = notification.notification.data;
          if (data?.type === 'chat' && data?.chatId) {
            window.location.href = `/messages?chat=${data.chatId}`;
          } else if (data?.type === 'checklist' && data?.checklistId) {
            window.location.href = `/complete/${data.checklistId}`;
          } else if (data?.type === 'alert') {
            window.location.href = '/alerts';
          }
        });

        // Cleanup
        return () => {
          registrationListener.remove();
          errorListener.remove();
          receivedListener.remove();
          actionListener.remove();
        };
      } catch (error) {
        console.error('Failed to setup push notifications:', error);
      }
    };

    const cleanup = setupPushNotifications();

    return () => {
      cleanup.then(fn => fn?.());
    };
  }, [user]);
};
