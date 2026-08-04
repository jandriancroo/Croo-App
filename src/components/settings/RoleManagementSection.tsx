import { useState, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Shield, User, Bell } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

type AppRole = 'super_admin' | 'brand_admin' | 'org_admin' | 'admin' | 'manager' | 'shift_manager' | 'shift_manager_in_training' | 'team_member';
type DbRole = AppRole | 'fbc' | 'general_manager';

type RolePermission = {
  id: string;
  role: DbRole;
  permission_key: string;
  permission_label: string;
  enabled: boolean;
};

type NotificationSetting = {
  id: string;
  role: AppRole;
  notification_type: string;
  notification_label: string;
  enabled: boolean;
};

interface RoleManagementSectionProps {
  organizationId?: string;
}

export function RoleManagementSection({ organizationId }: RoleManagementSectionProps) {
  
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [notifications, setNotifications] = useState<NotificationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<AppRole>('org_admin');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [permRes, notifRes] = await Promise.all([
        supabase
          .from('role_permissions')
          .select('*')
          .order('role', { ascending: true })
          .order('permission_label', { ascending: true }),
        supabase
          .from('role_notification_settings')
          .select('*')
          .order('role')
          .order('notification_type')
      ]);

      if (permRes.error) throw permRes.error;
      if (notifRes.error) throw notifRes.error;

      setPermissions(permRes.data || []);
      setNotifications((notifRes.data || []) as NotificationSetting[]);
    } catch (error: any) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load role settings');
    } finally {
      setLoading(false);
    }
  };

  const handlePermissionToggle = async (permissionId: string, currentEnabled: boolean) => {
    setSavingId(permissionId);
    try {
      const { error } = await supabase
        .from('role_permissions')
        .update({ enabled: !currentEnabled })
        .eq('id', permissionId);

      if (error) throw error;

      setPermissions(prev => prev.map(p => 
        p.id === permissionId ? { ...p, enabled: !currentEnabled } : p
      ));
      toast.success('Permission updated');
    } catch (error: any) {
      console.error('Error updating permission:', error);
      toast.error('Failed to update permission');
    } finally {
      setSavingId(null);
    }
  };

  const handleNotificationToggle = async (settingId: string, currentEnabled: boolean) => {
    setSavingId(settingId);
    try {
      const { error } = await supabase
        .from('role_notification_settings')
        .update({ enabled: !currentEnabled })
        .eq('id', settingId);

      if (error) throw error;

      setNotifications(prev => prev.map(n => 
        n.id === settingId ? { ...n, enabled: !currentEnabled } : n
      ));
      toast.success('Notification setting updated');
    } catch (error: any) {
      console.error('Error updating notification:', error);
      toast.error('Failed to update notification setting');
    } finally {
      setSavingId(null);
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'super_admin': return 'Super Admin';
      case 'brand_admin': return 'Brand Admin';
      case 'org_admin': return 'Org Admin';
      case 'admin': return 'Admin (Location)';
      case 'manager': return 'Manager';
      case 'shift_manager': return 'Shift Manager';
      case 'shift_manager_in_training': return 'Shift Manager in Training';
      default: return 'Team Member';
    }
  };

  // Roles that can have their dashboard configured by org admin

  const rolePermissions = permissions.filter((p) => p.role === selectedRole);
  const roleNotifications = notifications.filter((n) => n.role === selectedRole);

  if (loading) {
    return (
      <p className="text-muted-foreground text-sm py-2">Loading...</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Role selector buttons */}
      <div className="flex flex-wrap gap-2">
        {(['org_admin', 'admin', 'manager', 'shift_manager', 'shift_manager_in_training', 'team_member'] as AppRole[]).map((r) => (
          <Button
            key={r}
            variant={selectedRole === r ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedRole(r)}
          >
            {r === 'admin' ? 'Admin' : getRoleLabel(r)}
          </Button>
        ))}
      </div>

      {/* Two column layout for Permissions and Notifications */}
      <div className="grid grid-cols-1 gap-4">
        {/* Permissions Column */}
        <div className="border rounded-lg p-4 bg-muted/50">
          <h4 className="font-semibold mb-3 flex items-center gap-2">
            <User className="h-4 w-4" />
            {getRoleLabel(selectedRole)} Permissions
          </h4>
          <div className="space-y-3">
            {rolePermissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No permissions configured</p>
            ) : (
              rolePermissions.map((permission) => (
                <div key={permission.id} className="flex items-center gap-3">
                  <Checkbox
                    id={permission.id}
                    checked={permission.enabled}
                    disabled={savingId === permission.id}
                    onCheckedChange={() =>
                      handlePermissionToggle(permission.id, permission.enabled)
                    }
                  />
                  <label
                    htmlFor={permission.id}
                    className={`text-sm cursor-pointer ${
                      permission.enabled ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {permission.permission_label}
                  </label>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Notifications Column */}
        <div className="border rounded-lg p-4 bg-muted/50">
          <h4 className="font-semibold mb-3 flex items-center gap-2">
            <Bell className="h-4 w-4" />
            {getRoleLabel(selectedRole)} Notifications
          </h4>
          <div className="space-y-3">
            {roleNotifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notification settings configured</p>
            ) : (
              roleNotifications.map((notification) => (
                <div key={notification.id} className="flex items-center gap-3">
                  <Checkbox
                    id={notification.id}
                    checked={notification.enabled}
                    disabled={savingId === notification.id}
                    onCheckedChange={() =>
                      handleNotificationToggle(notification.id, notification.enabled)
                    }
                  />
                  <label
                    htmlFor={notification.id}
                    className={`text-sm cursor-pointer ${
                      notification.enabled ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {notification.notification_label}
                  </label>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

