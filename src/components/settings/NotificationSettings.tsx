import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from '@/hooks/use-toast';
import { Bell, BellOff } from 'lucide-react';

interface NotificationPreferences {
  overdue_checklists: boolean;
  late_arrivals: boolean;
  announcements: boolean;
  chat_messages: boolean;
}

export const NotificationSettings = () => {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    overdue_checklists: true,
    late_arrivals: true,
    announcements: true,
    chat_messages: true,
  });
  const [loading, setLoading] = useState(true);

  // Only show on native iOS platform
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
    return null;
  }

  useEffect(() => {
    if (!user) return;

    const fetchPreferences = async () => {
      try {
        const { data, error } = await supabase
          .from('notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') { // Ignore "not found" error
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
  }, [user]);

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
        // Revert on error
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

  if (loading) {
    return null;
  }

  const allEnabled = Object.values(preferences).every(v => v);
  const allDisabled = Object.values(preferences).every(v => !v);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {allDisabled ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          <CardTitle>Push Notifications</CardTitle>
        </div>
        <CardDescription>
          Manage which notifications you receive on this device
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
      </CardContent>
    </Card>
  );
};