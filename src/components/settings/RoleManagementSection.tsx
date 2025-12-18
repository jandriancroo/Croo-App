import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Shield, User } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

type AppRole = 'super_admin' | 'brand_admin' | 'fbc' | 'org_admin' | 'admin' | 'general_manager' | 'shift_manager' | 'manager' | 'team_member';

type RolePermission = {
  id: string;
  role: AppRole;
  permission_key: string;
  permission_label: string;
  enabled: boolean;
};

export function RoleManagementSection() {
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<AppRole>('admin');
  const [savingPermission, setSavingPermission] = useState<string | null>(null);

  useEffect(() => {
    fetchPermissions();
  }, []);

  const fetchPermissions = async () => {
    try {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('*')
        .order('role', { ascending: true })
        .order('permission_label', { ascending: true });

      if (error) throw error;
      setPermissions(data || []);
    } catch (error: any) {
      console.error('Error fetching permissions:', error);
      toast.error('Failed to load permissions');
    } finally {
      setLoading(false);
    }
  };

  const handlePermissionToggle = async (permissionId: string, currentEnabled: boolean) => {
    setSavingPermission(permissionId);
    try {
      const { error } = await supabase
        .from('role_permissions')
        .update({ enabled: !currentEnabled })
        .eq('id', permissionId);

      if (error) throw error;

      toast.success('Permission updated');
      fetchPermissions();
    } catch (error: any) {
      console.error('Error updating permission:', error);
      toast.error('Failed to update permission');
    } finally {
      setSavingPermission(null);
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Admin';
      case 'general_manager':
        return 'General Manager';
      case 'shift_manager':
        return 'Shift Manager';
      case 'manager':
        return 'Shift Manager';
      default:
        return 'Team Member';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Role Permissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Role Permissions
        </CardTitle>
        <CardDescription>
          Configure permissions for each role - plan access rules for future implementation
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <Button
              variant={selectedRole === 'admin' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedRole('admin')}
              className="mr-2"
            >
              Admin
            </Button>
            <Button
              variant={selectedRole === 'general_manager' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedRole('general_manager')}
              className="mr-2"
            >
              General Manager
            </Button>
            <Button
              variant={selectedRole === 'shift_manager' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedRole('shift_manager')}
              className="mr-2"
            >
              Shift Manager
            </Button>
            <Button
              variant={selectedRole === 'team_member' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedRole('team_member')}
            >
              Team Member
            </Button>
          </div>

          <div className="border rounded-lg p-4 bg-muted/50">
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <User className="h-4 w-4" />
              {getRoleLabel(selectedRole)} Permissions
            </h4>
            <div className="space-y-3">
              {permissions
                .filter((p) => p.role === selectedRole)
                .map((permission) => (
                  <div key={permission.id} className="flex items-center gap-3">
                    <Checkbox
                      id={permission.id}
                      checked={permission.enabled}
                      disabled={savingPermission === permission.id}
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
                ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
