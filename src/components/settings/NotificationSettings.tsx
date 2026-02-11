import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from '@/hooks/use-toast';
import { Bell, BellOff, Smartphone, MapPin } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface NotificationPreferences {
  overdue_checklists: boolean;
  late_arrivals: boolean;
  announcements: boolean;
  chat_messages: boolean;
  schedule_updates: boolean;
  shift_approvals: boolean;
  certification_expiring: boolean;
  arcade_scores: boolean;
}

interface UserLocation {
  location_id: string;
  location_name: string;
}

interface LocationNotificationPrefs {
  [notificationType: string]: boolean;
}

const LOCATION_NOTIFICATION_TYPES = [
  { key: 'overdue_checklists', label: 'Overdue Checklists' },
  { key: 'late_arrivals', label: 'Late Arrivals' },
  { key: 'certification_expiring', label: 'Cert Expiring' },
] as const;

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
    schedule_updates: true,
    shift_approvals: true,
    certification_expiring: true,
    arcade_scores: false,
  });
  const [userLocations, setUserLocations] = useState<UserLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [locationNotifPrefs, setLocationNotifPrefs] = useState<Record<string, LocationNotificationPrefs>>({});
  const [loading, setLoading] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | null>(null);
  const [isEnabling, setIsEnabling] = useState(false);

  const isNative = Capacitor.isNativePlatform();
  const isPWA = isInstalledPWA();
  const isIOSDevice = isIOS();

  // Debug logging
  console.log('[NotificationSettings] isNative:', isNative);
  console.log('[NotificationSettings] isPWA:', isPWA);
  console.log('[NotificationSettings] isIOSDevice:', isIOSDevice);
  console.log('[NotificationSettings] display-mode standalone:', window.matchMedia('(display-mode: standalone)').matches);
  console.log('[NotificationSettings] navigator.standalone:', (window.navigator as any).standalone);

  // Show for all users (web push support detection happens inside)
  const shouldShow = true;

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
        // Fetch notification preferences
        const { data, error } = await supabase
          .from('notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Failed to fetch notification preferences:', error);
        }

        if (data) {
          setPreferences({
            overdue_checklists: data.overdue_checklists,
            late_arrivals: data.late_arrivals,
            announcements: data.announcements,
            chat_messages: data.chat_messages,
            schedule_updates: data.schedule_updates ?? true,
            shift_approvals: data.shift_approvals ?? true,
            certification_expiring: data.certification_expiring ?? true,
            arcade_scores: data.arcade_scores ?? false,
          });
        }

        // Fetch user's assigned locations
        const { data: locationsData } = await supabase
          .from('user_locations')
          .select('location_id, locations(id, name)')
          .eq('user_id', user.id);

        if (locationsData && locationsData.length > 0) {
          const locs: UserLocation[] = locationsData.map((ul: any) => ({
            location_id: ul.location_id,
            location_name: ul.locations?.name || 'Unknown',
          }));
          setUserLocations(locs);
          
          // Auto-select first location
          if (locs.length === 1) {
            setSelectedLocationId(locs[0].location_id);
          }

          // Fetch existing location notification preferences (per type)
          const { data: existingPrefs } = await supabase
            .from('user_location_notifications')
            .select('*')
            .eq('user_id', user.id);

          // Build a nested map: locationId -> { notificationType -> enabled }
          const prefsMap: Record<string, LocationNotificationPrefs> = {};
          locs.forEach(loc => {
            prefsMap[loc.location_id] = {};
            LOCATION_NOTIFICATION_TYPES.forEach(nt => {
              prefsMap[loc.location_id][nt.key] = true; // Default all to enabled
            });
          });

          existingPrefs?.forEach((p: any) => {
            if (prefsMap[p.location_id]) {
              prefsMap[p.location_id][p.notification_type] = p.enabled;
            }
          });

          setLocationNotifPrefs(prefsMap);
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
      const subscription = await (registration as any).pushManager.subscribe({
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

  const updateLocationNotifPreference = async (locationId: string, notificationType: string, enabled: boolean) => {
    if (!user) return;

    // Optimistic update
    setLocationNotifPrefs(prev => ({
      ...prev,
      [locationId]: {
        ...prev[locationId],
        [notificationType]: enabled,
      }
    }));

    try {
      const { error } = await supabase
        .from('user_location_notifications')
        .upsert({
          user_id: user.id,
          location_id: locationId,
          notification_type: notificationType,
          enabled: enabled,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,location_id,notification_type'
        });

      if (error) {
        console.error('Failed to update location preference:', error);
        toast({
          title: 'Error',
          description: 'Failed to update setting',
          variant: 'destructive',
        });
        // Revert on error
        setLocationNotifPrefs(prev => ({
          ...prev,
          [locationId]: {
            ...prev[locationId],
            [notificationType]: !enabled,
          }
        }));
      }
    } catch (error) {
      console.error('Error updating location preference:', error);
      setLocationNotifPrefs(prev => ({
        ...prev,
        [locationId]: {
          ...prev[locationId],
          [notificationType]: !enabled,
        }
      }));
    }
  };

  // Always render for debugging
  console.log('[NotificationSettings] Rendering, loading:', loading, 'shouldShow:', shouldShow);

  const allDisabled = Object.values(preferences).every(v => !v);
  const needsPermission = !isNative && notificationPermission !== 'granted';

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          {allDisabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          <CardTitle className="text-base">Push Notifications</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Show enable button for PWA users who haven't granted permission */}
        {needsPermission && (
          <div className="p-3 bg-muted rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Enable Push Notifications</span>
            </div>
            <Button 
              onClick={enableNotifications} 
              disabled={isEnabling}
              size="sm"
              className="w-full"
            >
              {isEnabling ? "Enabling..." : "Enable Notifications"}
            </Button>
            {notificationPermission === 'denied' && (
              <p className="text-xs text-destructive">
                Notifications are blocked. Enable in device settings.
              </p>
            )}
          </div>
        )}

        {/* Show preferences if permission granted or on native */}
        {(!needsPermission || isNative) && (
          <>
            {/* Personal Notifications - follow you everywhere */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground mb-2">Personal — these follow you everywhere</p>
              <div className="grid grid-cols-1 gap-1">
                <div className="flex items-center justify-between py-1.5">
                  <Label htmlFor="chat-messages" className="text-sm font-normal">Chat Messages</Label>
                  <Switch
                    id="chat-messages"
                    checked={preferences.chat_messages}
                    onCheckedChange={(checked) => updatePreference('chat_messages', checked)}
                  />
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <Label htmlFor="announcements" className="text-sm font-normal">Announcements</Label>
                  <Switch
                    id="announcements"
                    checked={preferences.announcements}
                    onCheckedChange={(checked) => updatePreference('announcements', checked)}
                  />
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <Label htmlFor="schedule-updates" className="text-sm font-normal">Schedule Updates</Label>
                  <Switch
                    id="schedule-updates"
                    checked={preferences.schedule_updates}
                    onCheckedChange={(checked) => updatePreference('schedule_updates', checked)}
                  />
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <Label htmlFor="shift-approvals" className="text-sm font-normal">Shift Approvals</Label>
                  <Switch
                    id="shift-approvals"
                    checked={preferences.shift_approvals}
                    onCheckedChange={(checked) => updatePreference('shift_approvals', checked)}
                  />
                </div>

                <div className="flex items-center justify-between py-1.5">
                  <Label htmlFor="arcade-scores" className="text-sm font-normal">Arcade Scores</Label>
                  <Switch
                    id="arcade-scores"
                    checked={preferences.arcade_scores}
                    onCheckedChange={(checked) => updatePreference('arcade_scores', checked)}
                  />
                </div>
              </div>
            </div>

            <Separator className="my-3" />

            {/* Operational Alerts - location-based */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Operational — select location</p>
              </div>
              
              <Select
                value={selectedLocationId || ''}
                onValueChange={(value) => setSelectedLocationId(value)}
              >
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Select a location" />
                </SelectTrigger>
                <SelectContent>
                  {userLocations.map((loc) => (
                    <SelectItem key={loc.location_id} value={loc.location_id}>
                      {loc.location_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedLocationId && locationNotifPrefs[selectedLocationId] && (
                <div className="grid grid-cols-1 gap-1">
                  {LOCATION_NOTIFICATION_TYPES.map((nt) => (
                    <div key={nt.key} className="flex items-center justify-between py-1.5">
                      <Label htmlFor={`loc-${selectedLocationId}-${nt.key}`} className="text-sm font-normal">
                        {nt.label}
                      </Label>
                      <Switch
                        id={`loc-${selectedLocationId}-${nt.key}`}
                        checked={locationNotifPrefs[selectedLocationId][nt.key] ?? true}
                        onCheckedChange={(checked) => updateLocationNotifPreference(selectedLocationId, nt.key, checked)}
                      />
                    </div>
                  ))}
                </div>
              )}
              
              {userLocations.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No locations assigned</p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
