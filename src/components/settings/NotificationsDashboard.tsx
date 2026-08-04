import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Bell, Shield, Users, UserCheck } from 'lucide-react';
import { toast } from 'sonner';

type AppRole = 'super_admin' | 'brand_admin' | 'org_admin' | 'admin' | 'manager' | 'shift_manager' | 'shift_manager_in_training' | 'team_member';

interface NotificationSetting {
  id: string;
  role: AppRole;
  notification_type: string;
  notification_label: string;
  enabled: boolean;
}

const roleConfig: { role: AppRole; label: string; icon: React.ReactNode; description: string }[] = [
  { role: 'org_admin', label: 'Org Admin', icon: <Shield className="h-4 w-4" />, description: 'Organization-wide oversight' },
  { role: 'admin', label: 'Admin', icon: <Shield className="h-4 w-4" />, description: 'Full location access' },
  { role: 'manager', label: 'Manager', icon: <UserCheck className="h-4 w-4" />, description: 'Management notifications' },
  { role: 'shift_manager', label: 'Shift Manager', icon: <UserCheck className="h-4 w-4" />, description: 'Shift supervisory notifications' },
  { role: 'team_member', label: 'Team Member', icon: <Users className="h-4 w-4" />, description: 'Basic notifications' },
];

export function NotificationsDashboard() {
  const [settings, setSettings] = useState<NotificationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('role_notification_settings')
        .select('*')
        .order('role')
        .order('notification_type');

      if (error) throw error;
      setSettings((data || []) as NotificationSetting[]);
    } catch (error) {
      console.error('Error fetching notification settings:', error);
      toast.error('Failed to load notification settings');
    } finally {
      setLoading(false);
    }
  };

  const toggleSetting = async (settingId: string, currentValue: boolean) => {
    setUpdating(settingId);
    try {
      const { error } = await supabase
        .from('role_notification_settings')
        .update({ enabled: !currentValue })
        .eq('id', settingId);

      if (error) throw error;

      setSettings(prev => prev.map(s => 
        s.id === settingId ? { ...s, enabled: !currentValue } : s
      ));
      toast.success('Setting updated');
    } catch (error) {
      console.error('Error updating setting:', error);
      toast.error('Failed to update setting');
    } finally {
      setUpdating(null);
    }
  };

  const getSettingsForRole = (role: AppRole) => {
    return settings.filter(s => s.role === role);
  };

  if (loading) {
    return (
      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <CardTitle>Notification Permissions</CardTitle>
        </div>
        <CardDescription>
          Configure which notifications each role receives. Users inherit permissions from their assigned role.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {roleConfig.map(({ role, label, icon, description }) => (
          <div key={role} className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="flex items-center gap-1.5 px-2.5 py-1">
                {icon}
                {label}
              </Badge>
              <span className="text-xs text-muted-foreground">{description}</span>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-4">
              {getSettingsForRole(role).map((setting) => (
                <div 
                  key={setting.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50"
                >
                  <Label 
                    htmlFor={setting.id} 
                    className="text-sm cursor-pointer flex-1"
                  >
                    {setting.notification_label}
                  </Label>
                  <Switch
                    id={setting.id}
                    checked={setting.enabled}
                    onCheckedChange={() => toggleSetting(setting.id, setting.enabled)}
                    disabled={updating === setting.id}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
