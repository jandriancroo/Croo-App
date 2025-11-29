import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Shield, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

type UserRole = {
  user_id: string;
  role: 'admin' | 'manager' | 'team_member';
  profiles: {
    full_name: string;
    email: string;
    profile_photo_url: string | null;
  };
};

const rolePermissions = {
  admin: [
    'Full system access',
    'Manage all users and roles',
    'Create and manage locations',
    'Publish schedules',
    'Manage checklists and templates',
    'View all reports and analytics',
    'Manage certifications',
    'Access payroll and labor data',
  ],
  manager: [
    'View and edit schedules',
    'Manage availability requests',
    'View team timecards',
    'Create and assign tasks',
    'View labor reports',
    'Manage shift templates',
  ],
  team_member: [
    'View own schedule',
    'Submit availability requests',
    'Clock in/out',
    'Complete assigned checklists',
    'View own timecard',
    'Participate in shift marketplace',
  ],
};

export function RoleManagementSection() {
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<'admin' | 'manager' | 'team_member' | null>(null);

  useEffect(() => {
    fetchUserRoles();
  }, []);

  const fetchUserRoles = async () => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select(`
          user_id,
          role,
          profiles:user_id (
            full_name,
            email,
            profile_photo_url
          )
        `)
        .order('role', { ascending: true });

      if (error) throw error;
      setUserRoles(data as any || []);
    } catch (error: any) {
      console.error('Error fetching user roles:', error);
      toast.error('Failed to load user roles');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'manager' | 'team_member') => {
    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ role: newRole })
        .eq('user_id', userId);

      if (error) throw error;

      toast.success('Role updated successfully');
      fetchUserRoles();
    } catch (error: any) {
      console.error('Error updating role:', error);
      toast.error('Failed to update role');
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-red-500';
      case 'manager':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Admin';
      case 'manager':
        return 'Manager';
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
            Role Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Role Management
          </CardTitle>
          <CardDescription>
            Manage user roles and view permissions for each role
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Current Role</TableHead>
                  <TableHead>Change Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userRoles.map((userRole) => (
                  <TableRow key={userRole.user_id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={userRole.profiles.profile_photo_url || undefined} />
                          <AvatarFallback>
                            {userRole.profiles.full_name?.split(' ').map(n => n[0]).join('') || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{userRole.profiles.full_name || 'Unknown'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {userRole.profiles.email}
                    </TableCell>
                    <TableCell>
                      <Badge className={getRoleBadgeColor(userRole.role)}>
                        {getRoleLabel(userRole.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={userRole.role}
                        onValueChange={(value: 'admin' | 'manager' | 'team_member') =>
                          handleRoleChange(userRole.user_id, value)
                        }
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="team_member">Team Member</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role Permissions</CardTitle>
          <CardDescription>
            View what each role can access and manage
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Button
                variant={selectedRole === 'admin' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedRole(selectedRole === 'admin' ? null : 'admin')}
                className="mr-2"
              >
                Admin
              </Button>
              <Button
                variant={selectedRole === 'manager' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedRole(selectedRole === 'manager' ? null : 'manager')}
                className="mr-2"
              >
                Manager
              </Button>
              <Button
                variant={selectedRole === 'team_member' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedRole(selectedRole === 'team_member' ? null : 'team_member')}
              >
                Team Member
              </Button>
            </div>

            {selectedRole && (
              <div className="border rounded-lg p-4 bg-muted/50">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  {getRoleLabel(selectedRole)} Permissions
                </h4>
                <ul className="space-y-2">
                  {rolePermissions[selectedRole].map((permission, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <span className="text-green-500 mt-0.5">✓</span>
                      <span>{permission}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
