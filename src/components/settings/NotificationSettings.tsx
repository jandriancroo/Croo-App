import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from '@/hooks/use-toast';
import { Bell, BellOff, Smartphone } from 'lucide-react';

interface NotificationPreferences {
  overdue_checklists: boolean;
  late_arrivals: boolean;
  announcements: boolean;
  chat_messages: boolean;
}

// Helper to detect if running as installed PWA
const isInstalledPWA = () => {
  return window.matchMedia('(display-mode: standalone)').matches || 
         (window.navigator as any).standalone === true;
};

// Helper to detect iOS
const isIOS = () => {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export const NotificationSettings = () => {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    overdue_checklists: true,
    late_arrivals: true,
    announcements: true,
    chat_messages: true,
  });
  const [loading, setLoading] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | null>(null);
  const [isEnabling, setIsEnabling] = useState(false);

  const isNative = Capacitor.isNativePlatform();
  const isPWA = isInstalledPWA();
  const isIOSDevice = isIOS();
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // Debug logging
  console.log('[NotificationSettings] isNative:', isNative);
  console.log('[NotificationSettings] isPWA:', isPWA);
  console.log('[NotificationSettings] isIOSDevice:', isIOSDevice);
  console.log('[NotificationSettings] isMobile:', isMobile);
  console.log('[NotificationSettings] display-mode standalone:', window.matchMedia('(display-mode: standalone)').matches);
  console.log('[NotificationSettings] navigator.standalone:', (window.navigator as any).standalone);

  // Show for native iOS, PWA, or any mobile device
  const shouldShow = (isNative && Capacitor.getPlatform() === 'ios') || isPWA || isMobile;
  console.log('[NotificationSettings] shouldShow:', shouldShow);

  useEffect(() => {
    // Check notification permission status
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (!user || !shouldShow) {
      setLoading(false);
      return;
    }

    const fetchPreferences = async () => {
      try {
        const { data, error } = await supabase
          .from('notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Failed to fetch notification preferences:', error);
          return;
        }

        if (data) {
          setPreferences({
            overdue_checklists: data.overdue_checklists,
            late_arrivals: data.late_arrivals,
            announcements: data.announcements,
            chat_messages: data.chat_messages,
          });
        }
      } catch (error) {
        console.error('Error fetching preferences:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPreferences();
  }, [user, shouldShow]);

  const enableNotifications = async () => {
    if (!user) return;
    
    setIsEnabling(true);
    console.log('[Push Settings] User tapped Enable Notifications');

    try {
      // Check if service worker and push are supported
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        toast({
          title: "Not Supported",
          description: "Push notifications are not supported on this device.",
          variant: "destructive",
        });
        return;
      }

      // Request permission (must be triggered by user gesture on iOS)
      console.log('[Push Settings] Requesting permission...');
      const permission = await Notification.requestPermission();
      console.log('[Push Settings] Permission result:', permission);
      setNotificationPermission(permission);

      if (permission !== 'granted') {
        toast({
          title: "Permission Denied",
          description: "Please enable notifications in your device settings.",
          variant: "destructive",
        });
        return;
      }

      // Wait for service worker
      console.log('[Push Settings] Getting service worker...');
      const registration = await navigator.serviceWorker.ready;
      console.log('[Push Settings] Service worker ready');

      // Subscribe to push
      const vapidPublicKey = 'BA4iHtMMThy4LwpxYB7cIokOK9dVRTLZbSqySIlYNuXpVRZn9zNBSg3OJOZ4m_ruFWzzjRGZiwtIGHn9B7a35_M';
      
      const urlBase64ToUint8Array = (base64String: string) => {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
      };

      console.log('[Push Settings] Creating push subscription...');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      console.log('[Push Settings] Subscription created:', subscription.endpoint);

      // Save to database
      const { error } = await supabase
        .from('push_notification_tokens')
        .upsert({
          user_id: user.id,
          token: JSON.stringify(subscription),
          platform: 'web',
        }, {
          onConflict: 'user_id,platform'
        });

      if (error) {
        console.error('[Push Settings] Failed to save subscription:', error);
        throw error;
      }

      // Create default preferences
      await supabase
        .from('notification_preferences')
        .upsert({
          user_id: user.id,
          overdue_checklists: true,
          late_arrivals: true,
          announcements: true,
          chat_messages: true,
        }, {
          onConflict: 'user_id'
        });

      toast({
        title: "Notifications Enabled!",
        description: "You'll receive push notifications for important updates.",
      });

    } catch (error) {
      console.error('[Push Settings] Error enabling notifications:', error);
      toast({
        title: "Error",
        description: "Failed to enable notifications. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsEnabling(false);
    }
  };

  const updatePreference = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!user) return;

    setPreferences(prev => ({ ...prev, [key]: value }));

    try {
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: user.id,
          [key]: value,
        }, {
          onConflict: 'user_id'
        });

      if (error) {
        console.error('Failed to update preference:', error);
        toast({
          title: 'Error',
          description: 'Failed to update notification preference',
          variant: 'destructive',
        });
        setPreferences(prev => ({ ...prev, [key]: !value }));
      } else {
        toast({
          title: 'Updated',
          description: 'Notification preference saved',
        });
      }
    } catch (error) {
      console.error('Error updating preference:', error);
      setPreferences(prev => ({ ...prev, [key]: !value }));
    }
  };

  if (!shouldShow) {
    return null;
  }

  if (loading) {
    return null;
  }

  const allDisabled = Object.values(preferences).every(v => !v);
  const needsPermission = !isNative && notificationPermission !== 'granted';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {allDisabled ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          <CardTitle>Push Notifications</CardTitle>
        </div>
        <CardDescription>
          {isPWA && !isNative 
            ? "Enable notifications to stay updated on important events"
            : "Manage which notifications you receive on this device"
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Show enable button for PWA users who haven't granted permission */}
        {needsPermission && (
          <div className="p-4 bg-muted rounded-lg space-y-3">
            <div className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" />
              <span className="font-medium">Enable Push Notifications</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {isIOSDevice 
                ? "Tap the button below to enable notifications. You'll need to allow notifications when prompted."
                : "Click to enable push notifications for this app."
              }
            </p>
            <Button 
              onClick={enableNotifications} 
              disabled={isEnabling}
              className="w-full"
            >
              {isEnabling ? "Enabling..." : "Enable Notifications"}
            </Button>
            {notificationPermission === 'denied' && (
              <p className="text-xs text-destructive">
                Notifications are blocked. Please enable them in your device settings.
              </p>
            )}
          </div>
        )}

        {/* Show preferences if permission granted or on native */}
        {(!needsPermission || isNative) && (
          <>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="overdue-checklists">Overdue Checklists</Label>
                <p className="text-sm text-muted-foreground">
                  Get notified when checklists pass their due time
                </p>
              </div>
              <Switch
                id="overdue-checklists"
                checked={preferences.overdue_checklists}
                onCheckedChange={(checked) => updatePreference('overdue_checklists', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="late-arrivals">Late Arrivals</Label>
                <p className="text-sm text-muted-foreground">
                  Get notified when employees are late to shifts
                </p>
              </div>
              <Switch
                id="late-arrivals"
                checked={preferences.late_arrivals}
                onCheckedChange={(checked) => updatePreference('late_arrivals', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="announcements">Announcements</Label>
                <p className="text-sm text-muted-foreground">
                  Get notified when new announcements are posted
                </p>
              </div>
              <Switch
                id="announcements"
                checked={preferences.announcements}
                onCheckedChange={(checked) => updatePreference('announcements', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="chat-messages">Chat Messages</Label>
                <p className="text-sm text-muted-foreground">
                  Get notified when you receive new messages
                </p>
              </div>
              <Switch
                id="chat-messages"
                checked={preferences.chat_messages}
                onCheckedChange={(checked) => updatePreference('chat_messages', checked)}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
