import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Users, Shield, UserCog, User, UserPlus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useUserRole, type AppRole } from '@/hooks/useUserRole';
import { useNavigate } from 'react-router-dom';

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  profile_photo_url: string | null;
  created_at: string;
  role?: AppRole;
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('team_member');
  const { toast } = useToast();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      navigate('/dashboard');
      toast({
        title: 'Access Denied',
        description: 'You need admin privileges to access this page.',
        variant: 'destructive',
      });
    }
  }, [isAdmin, roleLoading, navigate, toast]);

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      
      // Fetch all profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch all user roles
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (rolesError) throw rolesError;

      // Merge profiles with their roles
      const usersWithRoles = profiles.map((profile) => ({
        ...profile,
        role: roles.find((r) => r.user_id === profile.id)?.role as AppRole || 'team_member',
      }));

      setUsers(usersWithRoles);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast({
        title: 'Error',
        description: 'Failed to load users',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: AppRole) => {
    try {
      // Delete existing role
      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

      // Insert new role
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: newRole });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'User role updated successfully',
      });

      // Refresh users list
      fetchUsers();
    } catch (error) {
      console.error('Error updating role:', error);
      toast({
        title: 'Error',
        description: 'Failed to update user role',
        variant: 'destructive',
      });
    }
  };

  const getRoleIcon = (role: AppRole) => {
    switch (role) {
      case 'admin':
        return <Shield className="h-4 w-4" />;
      case 'manager':
        return <UserCog className="h-4 w-4" />;
      default:
        return <User className="h-4 w-4" />;
    }
  };

  const getRoleBadgeVariant = (role: AppRole) => {
    switch (role) {
      case 'admin':
        return 'default';
      case 'manager':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const handleInviteUser = async () => {
    if (!inviteEmail.trim() || !inviteFullName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please provide both email and full name.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setInviting(true);

      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          email: inviteEmail.trim(),
          fullName: inviteFullName.trim(),
          role: inviteRole,
        },
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'User invited successfully',
      });

      setInviteDialogOpen(false);
      setInviteEmail('');
      setInviteFullName('');
      setInviteRole('team_member');
      fetchUsers();
    } catch (error: any) {
      console.error('Error inviting user:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to invite user',
        variant: 'destructive',
      });
    } finally {
      setInviting(false);
    }
  };

  if (roleLoading || !isAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto p-6 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-6 w-6 text-primary" />
                <div>
                  <CardTitle>User Management</CardTitle>
                  <CardDescription>Manage user roles and permissions</CardDescription>
                </div>
              </div>
              <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <UserPlus className="h-4 w-4" />
                    Invite User
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Invite New User</DialogTitle>
                    <DialogDescription>
                      Send an invitation to a new user to join the platform
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="invite-email">Email</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="user@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invite-name">Full Name</Label>
                      <Input
                        id="invite-name"
                        value={inviteFullName}
                        onChange={(e) => setInviteFullName(e.target.value)}
                        placeholder="John Doe"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invite-role">Role</Label>
                      <Select
                        value={inviteRole}
                        onValueChange={(value: AppRole) => setInviteRole(value)}
                      >
                        <SelectTrigger id="invite-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="team_member">Team Member</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setInviteDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleInviteUser}
                      disabled={inviting}
                    >
                      {inviting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Inviting...
                        </>
                      ) : (
                        'Send Invitation'
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Photo</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={user.profile_photo_url || undefined} />
                          <AvatarFallback>
                            {user.full_name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell className="font-medium">
                        {user.full_name || 'No name'}
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(user.role!)} className="gap-1">
                          {getRoleIcon(user.role!)}
                          {user.role?.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(user.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Select
                          value={user.role}
                          onValueChange={(value: AppRole) => handleRoleChange(user.id, value)}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="team_member">Team Member</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
