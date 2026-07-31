import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useLocation } from '@/hooks/useLocation';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from '@/hooks/use-toast';
import { Bell, BellOff, Smartphone, MapPin, AlertCircle, BellRing, Mail } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { getVapidPublicKey, ensureSubscriptionForKey } from '@/utils/pushVapid';

interface NotificationSetting {
  notification_type: string;
  location_id: string;
  alert_enabled: boolean;
  push_enabled: boolean;
  email_enabled: boolean;
}

// All notification types - now all location-based
const NOTIFICATION_TYPES = [
  { key: 'chat_messages', label: 'Chat Messages', description: 'New messages in location chats', category: 'general' },
  { key: 'announcements', label: 'Announcements', description: 'Team announcements', category: 'general' },
  { key: 'schedule_updates', label: 'Schedule Updates', description: 'Changes to your schedule', category: 'general' },
  { key: 'shift_reminders', label: 'Shift Reminders', description: '30 minutes before your shift starts', category: 'general' },
  { key: 'shift_approvals', label: 'Shift Approvals', description: 'When your shifts are approved', category: 'general' },
  { key: 'overdue_checklists', label: 'Overdue Checklists', description: 'When checklists are past due', category: 'general' },
  { key: 'late_arrivals', label: 'Late Arrivals', description: 'When team members are late', category: 'general' },
  { key: 'shift_overstay', label: 'Shift Overstay', description: '>5 min past scheduled shift end', category: 'general' },
  { key: 'certification_expiring', label: 'Cert Expiring', description: 'Expiring certifications', category: 'general' },
  { key: 'hourly_sales_pulse', label: 'Hourly Pulse', description: 'Hourly sales + labor pace', category: 'pulse', managerOnly: true },
  { key: 'day_part_pulse', label: 'Day Part Pulse', description: 'AM at cutoff, PM at close', category: 'pulse', managerOnly: true },
  { key: 'cash_drawer_count', label: 'Drawer Counts', description: 'Drawer count submissions', category: 'cash', managerOnly: true },
  { key: 'cash_safe_count', label: 'Safe Counts', description: 'Safe count submissions', category: 'cash', managerOnly: true },
  { key: 'cash_bank_deposit', label: 'Bank Deposits', description: 'Bank deposit submissions', category: 'cash', managerOnly: true },
] as const;


export const UnifiedNotificationSettings = () => {
  const { user } = useAuth();
  const { currentLocation } = useLocation();
  const { isAdmin, isManager, isShiftManager, isGeneralManager } = useUserRole();
  const [settings, setSettings] = useState<NotificationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | null>(null);
  const [isEnabling, setIsEnabling] = useState(false);
  const [amCutoff, setAmCutoff] = useState<string>('16:00');

  const isManagerOrAbove = isShiftManager || isManager || isGeneralManager || isAdmin;
  const isNative = Capacitor.isNativePlatform();
  const needsPermission = !isNative && notificationPermission !== 'granted';

  // Always use currentLocation — no multi-location selector needed
  const selectedLocationId = currentLocation?.id ?? null;

  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (!user || !selectedLocationId) {
      setLoading(false);
      return;
    }
    fetchData();
  }, [user, selectedLocationId]);

  const fetchData = async () => {
    if (!user || !selectedLocationId) return;
    
    try {
      // Fetch existing notification settings for this location only
      const { data: existingSettings } = await supabase
        .from('user_notification_settings')
        .select('*')
        .eq('user_id', user.id)
        .eq('location_id', selectedLocationId);

      // Fetch AM cutoff for this location
      const { data: locSettings } = await (supabase as any)
        .from('location_settings')
        .select('day_part_am_cutoff')
        .eq('location_id', selectedLocationId)
        .maybeSingle();
      if (locSettings?.day_part_am_cutoff) {
        setAmCutoff(String(locSettings.day_part_am_cutoff).slice(0, 5));
      }

      // Build settings with defaults for this location
      const allSettings: NotificationSetting[] = NOTIFICATION_TYPES.map(nt => {
        const existing = existingSettings?.find(s => s.notification_type === nt.key);
        const isCashNotification = nt.category === 'cash';
        const defaultEmailEnabled = isCashNotification && isManagerOrAbove;
        return {
          notification_type: nt.key,
          location_id: selectedLocationId,
          alert_enabled: existing?.alert_enabled ?? true,
          push_enabled: existing?.push_enabled ?? true,
          email_enabled: existing?.email_enabled ?? defaultEmailEnabled,
        };
      });

      setSettings(allSettings);
    } catch (error) {
      console.error('Error fetching notification settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveAmCutoff = async (next: string) => {
    if (!selectedLocationId) return;
    setAmCutoff(next);
    const { error } = await (supabase as any)
      .from('location_settings')
      .update({ day_part_am_cutoff: `${next}:00` })
      .eq('location_id', selectedLocationId);
    if (error) {
      toast({ title: 'Error', description: 'Failed to update AM cutoff', variant: 'destructive' });
    }
  };

  const enableNotifications = async () => {
    if (!user) return;
    
    setIsEnabling(true);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        toast({
          title: "Not Supported",
          description: "Push notifications are not supported on this device.",
          variant: "destructive",
        });
        return;
      }

      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);

      if (permission !== 'granted') {
        toast({
          title: "Permission Denied",
          description: "Please enable notifications in your device settings.",
          variant: "destructive",
        });
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const vapidPublicKey = await getVapidPublicKey();
      const { subscription, staleEndpoint } = await ensureSubscriptionForKey(
        registration,
        vapidPublicKey
      );

      // Drop any stored token that pointed at the replaced subscription
      if (staleEndpoint) {
        await supabase
          .from('push_notification_tokens')
          .delete()
          .eq('user_id', user.id)
          .like('token', `%${staleEndpoint.substring(0, 80)}%`);
      }

      await supabase
        .from('push_notification_tokens')
        .upsert({
          user_id: user.id,
          token: JSON.stringify(subscription),
          platform: 'web',
        }, {
          onConflict: 'user_id,platform'
        });


      toast({
        title: "Notifications Enabled!",
        description: "You'll receive push notifications for important updates.",
      });

    } catch (error) {
      console.error('Error enabling notifications:', error);
      toast({
        title: "Error",
        description: "Failed to enable notifications. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsEnabling(false);
    }
  };

  const updateSetting = async (
    notificationType: string, 
    locationId: string, 
    channel: 'alert_enabled' | 'push_enabled' | 'email_enabled', 
    value: boolean
  ) => {
    if (!user) return;

    // Optimistic update
    setSettings(prev => prev.map(s => 
      s.notification_type === notificationType && s.location_id === locationId
        ? { ...s, [channel]: value }
        : s
    ));

    try {
      const currentSetting = settings.find(
        s => s.notification_type === notificationType && s.location_id === locationId
      );
      
      const { error } = await supabase
        .from('user_notification_settings')
        .upsert({
          user_id: user.id,
          notification_type: notificationType,
          location_id: locationId,
          alert_enabled: channel === 'alert_enabled' ? value : (currentSetting?.alert_enabled ?? true),
          push_enabled: channel === 'push_enabled' ? value : (currentSetting?.push_enabled ?? true),
          email_enabled: channel === 'email_enabled' ? value : (currentSetting?.email_enabled ?? false),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,notification_type,location_id'
        });

      if (error) throw error;
    } catch (error) {
      console.error('Failed to update setting:', error);
      // Revert on error
      setSettings(prev => prev.map(s => 
        s.notification_type === notificationType && s.location_id === locationId
          ? { ...s, [channel]: !value }
          : s
      ));
      toast({
        title: 'Error',
        description: 'Failed to update setting',
        variant: 'destructive',
      });
    }
  };

  const getSetting = (notificationType: string, locationId: string) => {
    return settings.find(s => s.notification_type === notificationType && s.location_id === locationId);
  };

  const handleBulkUpdate = async (enable: boolean) => {
    if (!user || !selectedLocationId) return;

    // Optimistic update
    setSettings(prev => prev.map(s => 
      s.location_id === selectedLocationId
        ? { ...s, alert_enabled: enable, push_enabled: enable, email_enabled: enable }
        : s
    ));

    try {
      // Build upsert data for all notification types
      const upsertData = NOTIFICATION_TYPES.map(nt => ({
        user_id: user.id,
        notification_type: nt.key,
        location_id: selectedLocationId,
        alert_enabled: enable,
        push_enabled: enable,
        email_enabled: enable,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('user_notification_settings')
        .upsert(upsertData, {
          onConflict: 'user_id,notification_type,location_id'
        });

      if (error) throw error;
    } catch (error) {
      console.error('Failed to bulk update settings:', error);
      // Revert on error by refetching
      fetchData();
      toast({
        title: 'Error',
        description: 'Failed to update settings',
        variant: 'destructive',
      });
    }
  };

  const currentLocationSettings = settings.filter(s => s.location_id === selectedLocationId);
  const allDisabled = currentLocationSettings.every(s => !s.alert_enabled && !s.push_enabled && !s.email_enabled);

  if (loading) {
    return (
      <div className="space-y-4 p-1">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {/* Enable push notifications button */}
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

        {/* No location selected */}
        {!selectedLocationId ? (
          <div className="text-center py-6 text-muted-foreground">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No location selected</p>
          </div>
        ) : (
          <>
            {/* Location label */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              <span>{currentLocation?.name}</span>
            </div>

            {/* Select All / Deselect All buttons */}
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => handleBulkUpdate(true)}
              >
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => handleBulkUpdate(false)}
              >
                Deselect All
              </Button>
            </div>

            {/* Channel headers */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center text-xs text-muted-foreground px-1 pt-2">
              <span></span>
              <div className="w-10 text-center" title="In-app alerts">
                <AlertCircle className="h-3.5 w-3.5 mx-auto" />
              </div>
              <div className="w-10 text-center" title="Push notifications">
                <BellRing className="h-3.5 w-3.5 mx-auto" />
              </div>
              <div className="w-10 text-center" title="Email">
                <Mail className="h-3.5 w-3.5 mx-auto" />
              </div>
            </div>

            {/* General notification type rows */}
            <div className="space-y-1">
              {NOTIFICATION_TYPES.filter(nt => nt.category === 'general').map(nt => {
                const setting = getSetting(nt.key, selectedLocationId);
                return (
                  <div
                    key={nt.key}
                    className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center py-2 px-1 rounded hover:bg-muted/50"
                  >
                    <div>
                      <span className="text-sm">{nt.label}</span>
                    </div>
                    <div className="w-10 flex justify-center">
                      <Checkbox
                        checked={setting?.alert_enabled ?? true}
                        onCheckedChange={(checked) =>
                          updateSetting(nt.key, selectedLocationId, 'alert_enabled', !!checked)
                        }
                      />
                    </div>
                    <div className="w-10 flex justify-center">
                      <Checkbox
                        checked={setting?.push_enabled ?? true}
                        onCheckedChange={(checked) =>
                          updateSetting(nt.key, selectedLocationId, 'push_enabled', !!checked)
                        }
                        disabled={needsPermission}
                      />
                    </div>
                    <div className="w-10 flex justify-center">
                      <Checkbox
                        checked={setting?.email_enabled ?? false}
                        onCheckedChange={(checked) =>
                          updateSetting(nt.key, selectedLocationId, 'email_enabled', !!checked)
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Sales Pulse section - only for managers and above */}
            {isManagerOrAbove && (
              <>
                <Separator className="my-4" />
                <div className="text-sm font-medium text-muted-foreground mb-2">Sales Pulse</div>
                <div className="space-y-1">
                  {NOTIFICATION_TYPES.filter(nt => nt.category === 'pulse').map(nt => {
                    const setting = getSetting(nt.key, selectedLocationId);
                    return (
                      <div key={nt.key}>
                        <div
                          className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center py-2 px-1 rounded hover:bg-muted/50"
                        >
                          <div>
                            <span className="text-sm">{nt.label}</span>
                          </div>
                          <div className="w-10 flex justify-center">
                            <Checkbox
                              checked={setting?.alert_enabled ?? true}
                              onCheckedChange={(checked) =>
                                updateSetting(nt.key, selectedLocationId, 'alert_enabled', !!checked)
                              }
                            />
                          </div>
                          <div className="w-10 flex justify-center">
                            <Checkbox
                              checked={setting?.push_enabled ?? true}
                              onCheckedChange={(checked) =>
                                updateSetting(nt.key, selectedLocationId, 'push_enabled', !!checked)
                              }
                              disabled={needsPermission}
                            />
                          </div>
                          <div className="w-10 flex justify-center">
                            <Checkbox
                              checked={setting?.email_enabled ?? false}
                              onCheckedChange={(checked) =>
                                updateSetting(nt.key, selectedLocationId, 'email_enabled', !!checked)
                              }
                            />
                          </div>
                        </div>
                        {nt.key === 'day_part_pulse' && (
                          <div className="ml-1 pl-3 py-1 border-l-2 border-muted space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium">Day Part Cutoff</span>
                              <input
                                type="time"
                                value={amCutoff}
                                onChange={(e) => saveAmCutoff(e.target.value)}
                                className="text-xs bg-background border border-input rounded px-1.5 py-0.5 h-6"
                              />
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-tight">
                              AM fires at this time; PM fires at closing.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Cash Handling section - only for managers and above */}
            {isManagerOrAbove && (
              <>
                <Separator className="my-4" />
                <div className="text-sm font-medium text-muted-foreground mb-2">Cash Handling</div>
                <div className="space-y-1">
                  {NOTIFICATION_TYPES.filter(nt => nt.category === 'cash').map(nt => {
                    const setting = getSetting(nt.key, selectedLocationId);
                    return (
                      <div
                        key={nt.key}
                        className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center py-2 px-1 rounded hover:bg-muted/50"
                      >
                        <div>
                          <span className="text-sm">{nt.label}</span>
                        </div>
                        <div className="w-10 flex justify-center">
                          <Checkbox
                            checked={setting?.alert_enabled ?? true}
                            onCheckedChange={(checked) =>
                              updateSetting(nt.key, selectedLocationId, 'alert_enabled', !!checked)
                            }
                          />
                        </div>
                        <div className="w-10 flex justify-center">
                          <Checkbox
                            checked={setting?.push_enabled ?? true}
                            onCheckedChange={(checked) =>
                              updateSetting(nt.key, selectedLocationId, 'push_enabled', !!checked)
                            }
                            disabled={needsPermission}
                          />
                        </div>
                        <div className="w-10 flex justify-center">
                          <Checkbox
                            checked={setting?.email_enabled ?? true}
                            onCheckedChange={(checked) =>
                              updateSetting(nt.key, selectedLocationId, 'email_enabled', !!checked)
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
