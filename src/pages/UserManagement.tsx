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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Users, Shield, UserCog, User, UserPlus, Camera, Key } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useUserRole, type AppRole } from '@/hooks/useUserRole';
import { useNavigate } from 'react-router-dom';
import React from 'react';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { InviteLinkCard } from '@/components/InviteLinkCard';
import { Copy } from 'lucide-react';

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  profile_photo_url: string | null;
  created_at: string;
  is_active: boolean;
  role?: AppRole;
  paid_hours?: number;
  unpaid_hours?: number;
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('team_member');
  const [inviteProfilePhoto, setInviteProfilePhoto] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = React.useRef<HTMLInputElement>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editProfilePhoto, setEditProfilePhoto] = useState<string | null>(null);
  const [updatingUser, setUpdatingUser] = useState(false);
  const editPhotoInputRef = React.useRef<HTMLInputElement>(null);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [tempImageSrc, setTempImageSrc] = useState<string>('');
  const [isInviteCrop, setIsInviteCrop] = useState(false);
  const [isResendDialogOpen, setIsResendDialogOpen] = useState(false);
  const [resendUser, setResendUser] = useState<UserProfile | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [isResetPasswordDialogOpen, setIsResetPasswordDialogOpen] = useState(false);
  const [resetPasswordLink, setResetPasswordLink] = useState<string>('');
  const [resetPasswordUserName, setResetPasswordUserName] = useState<string>('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserProfile | null>(null);
  const [viewingUser, setViewingUser] = useState<UserProfile | null>(null);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
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

      // Fetch availability hours for the current year
      const currentYear = new Date().getFullYear();
      const { data: availabilityData, error: availabilityError } = await supabase
        .from('availability_requests')
        .select('user_id, request_type, hours_requested, status')
        .eq('status', 'approved')
        .gte('start_date', `${currentYear}-01-01`)
        .lte('start_date', `${currentYear}-12-31`);

      if (availabilityError) throw availabilityError;

      // Calculate total hours by user and type
      const hoursByUser = (availabilityData || []).reduce((acc: any, req: any) => {
        if (!acc[req.user_id]) {
          acc[req.user_id] = { paid: 0, unpaid: 0 };
        }
        if (req.request_type === 'paid') {
          acc[req.user_id].paid += req.hours_requested;
        } else {
          acc[req.user_id].unpaid += req.hours_requested;
        }
        return acc;
      }, {});

      // Merge profiles with their roles and hours
      const usersWithRoles = profiles.map((profile) => ({
        ...profile,
        role: roles.find((r) => r.user_id === profile.id)?.role as AppRole || 'team_member',
        paid_hours: hoursByUser[profile.id]?.paid || 0,
        unpaid_hours: hoursByUser[profile.id]?.unpaid || 0,
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

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: 'Error', description: 'Please select an image file', variant: 'destructive' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Error', description: 'Image must be less than 5MB', variant: 'destructive' });
      return;
    }

    // Read file as data URL for cropping
    const reader = new FileReader();
    reader.onloadend = () => {
      setTempImageSrc(reader.result as string);
      setIsInviteCrop(true);
      setCropDialogOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleEditPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: 'Error', description: 'Please select an image file', variant: 'destructive' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Error', description: 'Image must be less than 5MB', variant: 'destructive' });
      return;
    }

    // Read file as data URL for cropping
    const reader = new FileReader();
    reader.onloadend = () => {
      setTempImageSrc(reader.result as string);
      setIsInviteCrop(false);
      setCropDialogOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    try {
      setUploadingPhoto(true);
      
      const fileName = isInviteCrop
        ? `temp/${Date.now()}.jpg`
        : `${editingUser?.id}/${Date.now()}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(fileName, croppedBlob);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(fileName);

      if (isInviteCrop) {
        setInviteProfilePhoto(publicUrl);
      } else {
        setEditProfilePhoto(publicUrl);
      }
      
      toast({ title: 'Success', description: 'Photo uploaded' });
    } catch (error: any) {
      toast({ title: 'Error', description: 'Failed to upload photo', variant: 'destructive' });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleEditUser = (user: UserProfile) => {
    setEditingUser(user);
    setEditFullName(user.full_name || '');
    setEditProfilePhoto(user.profile_photo_url);
    setEditDialogOpen(true);
  };

  const handleUpdateUser = async () => {
    if (!editingUser || !editFullName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please provide a full name.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setUpdatingUser(true);

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: editFullName.trim(),
          profile_photo_url: editProfilePhoto,
        })
        .eq('id', editingUser.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'User profile updated successfully',
      });

      setEditDialogOpen(false);
      setEditingUser(null);
      setEditFullName('');
      setEditProfilePhoto(null);
      fetchUsers();
    } catch (error: any) {
      console.error('Error updating user:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update user profile',
        variant: 'destructive',
      });
    } finally {
      setUpdatingUser(false);
    }
  };

  const handleToggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase.functions.invoke('toggle-user-status', {
        body: {
          userId,
          isActive: !currentStatus,
        },
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: `User ${!currentStatus ? 'activated' : 'deactivated'} successfully`,
      });

      fetchUsers();
    } catch (error: any) {
      console.error('Error toggling user status:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update user status',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;

    try {
      const { error } = await supabase.functions.invoke('delete-user', {
        body: {
          userId: deletingUser.id,
        },
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'User permanently deleted',
      });

      setIsDeleteDialogOpen(false);
      setDeletingUser(null);
      fetchUsers();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete user',
        variant: 'destructive',
      });
    }
  };

  const handleOpenResendDialog = (user: UserProfile) => {
    setResendUser(user);
    setNewEmail(user.email);
    setIsResendDialogOpen(true);
  };

  const handleResendInvite = async () => {
    if (!resendUser) return;

    try {
      const emailChanged = newEmail.trim() !== resendUser.email;
       
      if (emailChanged && !newEmail.trim()) {
        toast({
          title: 'Validation Error',
          description: 'Please provide a valid email address.',
          variant: 'destructive',
        });
        return;
      }
 
      const { data, error } = await supabase.functions.invoke('resend-invite', {
        body: {
          userId: resendUser.id,
          newEmail: emailChanged ? newEmail.trim() : undefined,
        },
      });
 
      if (error) throw error;
 
      const response = data as { resetLink?: string | null } | null;
      const resetLink = response?.resetLink ?? null;
 
      if (resetLink) {
        console.log('Resend invite reset link:', resetLink);
      }
 
      toast({
        title: 'Success',
        description: resetLink
          ? (emailChanged
              ? 'Invitation sent to new email. Copy this link and share it manually: ' + resetLink
              : 'Invitation resent. Copy this link and share it manually: ' + resetLink)
          : emailChanged
            ? 'Invitation sent to new email address'
            : 'Invitation resent successfully',
      });

      setIsResendDialogOpen(false);
      setResendUser(null);
      setNewEmail('');
      fetchUsers();
    } catch (error: any) {
      console.error('Error resending invite:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to resend invitation',
        variant: 'destructive',
      });
    }
  };

  const handleResetPassword = async (userId: string, userName: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('resend-invite', {
        body: { userId },
      });

      if (error) throw error;

      const response = data as { resetLink?: string | null } | null;
      const resetLink = response?.resetLink ?? null;

      if (resetLink) {
        setResetPasswordLink(resetLink);
        setResetPasswordUserName(userName);
        setIsResetPasswordDialogOpen(true);
        toast({
          title: 'Success',
          description: 'Password reset link generated',
        });
      } else {
        throw new Error('No reset link returned');
      }
    } catch (error: any) {
      console.error('Error generating password reset:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate password reset link',
        variant: 'destructive',
      });
    }
  };

  const copyResetLink = async () => {
    try {
      await navigator.clipboard.writeText(resetPasswordLink);
      toast({
        title: 'Copied!',
        description: 'Reset link copied to clipboard',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to copy link',
        variant: 'destructive',
      });
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
          profilePhotoUrl: inviteProfilePhoto,
        },
      });
 
      if (error) throw error;
 
      const response = data as { resetLink?: string | null } | null;
      const resetLink = response?.resetLink ?? null;
 
      if (resetLink) {
        console.log('Invite reset link:', resetLink);
      }
 
      toast({
        title: 'Success',
        description: resetLink
          ? 'User invited. Copy this password setup link and share it manually: ' + resetLink
          : 'User invited successfully',
      });

      setInviteDialogOpen(false);
      setInviteEmail('');
      setInviteFullName('');
      setInviteRole('team_member');
      setInviteProfilePhoto(null);
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

  const handleCreateTestUsers = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('create-test-users');

      if (error) throw error;

      toast({
        title: 'Success',
        description: `Created ${data.created} test users`,
      });

      fetchUsers();
    } catch (error: any) {
      console.error('Error creating test users:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create test users',
        variant: 'destructive',
      });
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
        <InviteLinkCard />
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
              <div className="flex items-center gap-2">
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
                      <Label>Profile Photo (Optional)</Label>
                      <div className="flex flex-col items-center gap-4">
                        <Avatar className="h-20 w-20">
                          <AvatarImage src={inviteProfilePhoto || undefined} />
                          <AvatarFallback>
                            <Camera className="h-6 w-6 text-muted-foreground" />
                          </AvatarFallback>
                        </Avatar>
                        <input
                          ref={photoInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handlePhotoUpload}
                          className="hidden"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => photoInputRef.current?.click()}
                          disabled={uploadingPhoto}
                          size="sm"
                        >
                          <Camera className="mr-2 h-4 w-4" />
                          {inviteProfilePhoto ? 'Change Photo' : 'Add Photo'}
                        </Button>
                      </div>
                    </div>
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
              <Button variant="outline" onClick={handleCreateTestUsers} className="gap-2">
                <Users className="h-4 w-4" />
                Create Test Users
              </Button>
            </div>
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
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow 
                      key={user.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        setViewingUser(user);
                        setIsProfileDialogOpen(true);
                      }}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={user.profile_photo_url || undefined} />
                            <AvatarFallback>
                              {user.full_name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{user.full_name || 'No name'}</div>
                            <div className="text-sm text-muted-foreground">{user.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(user.role!)} className="gap-1">
                          {getRoleIcon(user.role!)}
                          {user.role?.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.is_active ? "default" : "secondary"}>
                          {user.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingUser(user);
                            setIsProfileDialogOpen(true);
                          }}
                        >
                          View Profile
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* User Profile Details Dialog */}
        <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>User Profile</DialogTitle>
              <DialogDescription>
                View and manage user details
              </DialogDescription>
            </DialogHeader>
            {viewingUser && (
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src={viewingUser.profile_photo_url || undefined} />
                    <AvatarFallback className="text-2xl">
                      {viewingUser.full_name?.charAt(0) || viewingUser.email.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-1">
                    <h3 className="text-xl font-semibold">{viewingUser.full_name || 'No name'}</h3>
                    <p className="text-sm text-muted-foreground">{viewingUser.email}</p>
                    <div className="flex items-center gap-2 pt-2">
                      <Badge variant={getRoleBadgeVariant(viewingUser.role!)} className="gap-1">
                        {getRoleIcon(viewingUser.role!)}
                        {viewingUser.role?.replace('_', ' ')}
                      </Badge>
                      <Badge variant={viewingUser.is_active ? "default" : "secondary"}>
                        {viewingUser.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 p-4 border rounded-lg">
                    <Label className="text-sm text-muted-foreground">Member Since</Label>
                    <p className="text-lg font-medium">
                      {new Date(viewingUser.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="space-y-2 p-4 border rounded-lg">
                    <Label className="text-sm text-muted-foreground">Accrued Hours (YTD)</Label>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Paid:</span>
                        <span className="font-medium">{viewingUser.paid_hours || 0}h</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Unpaid:</span>
                        <span className="font-medium">{viewingUser.unpaid_hours || 0}h</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Actions</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground">Change Role</Label>
                      <Select
                        value={viewingUser.role}
                        onValueChange={(value: AppRole) => {
                          handleRoleChange(viewingUser.id, value);
                          setViewingUser({ ...viewingUser, role: value });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="team_member">Team Member</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground">Status</Label>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          handleToggleUserStatus(viewingUser.id, viewingUser.is_active);
                          setViewingUser({ ...viewingUser, is_active: !viewingUser.is_active });
                        }}
                      >
                        {viewingUser.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsProfileDialogOpen(false);
                        handleEditUser(viewingUser);
                      }}
                    >
                      <Camera className="h-4 w-4 mr-2" />
                      Edit Profile
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsProfileDialogOpen(false);
                        handleOpenResendDialog(viewingUser);
                      }}
                    >
                      Re-invite
                    </Button>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setIsProfileDialogOpen(false);
                      handleResetPassword(viewingUser.id, viewingUser.full_name || viewingUser.email);
                    }}
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Reset Password
                  </Button>

                  {!viewingUser.is_active && (
                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={() => {
                        setIsProfileDialogOpen(false);
                        setDeletingUser(viewingUser);
                        setIsDeleteDialogOpen(true);
                      }}
                    >
                      Delete User Permanently
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit User Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User Profile</DialogTitle>
              <DialogDescription>
                Update user information and profile photo
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Profile Photo</Label>
                <div className="flex flex-col items-center gap-4">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src={editProfilePhoto || undefined} />
                    <AvatarFallback>
                      <Camera className="h-6 w-6 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>
                  <input
                    ref={editPhotoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleEditPhotoUpload}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => editPhotoInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    size="sm"
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    {editProfilePhoto ? 'Change Photo' : 'Add Photo'}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-name">Full Name</Label>
                <Input
                  id="edit-name"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={editingUser?.email || ''} disabled />
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setEditDialogOpen(false)}
                disabled={updatingUser}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleUpdateUser}
                disabled={updatingUser}
              >
                {updatingUser ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Resend Invite Dialog */}
        <Dialog open={isResendDialogOpen} onOpenChange={setIsResendDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Re-invite User</DialogTitle>
              <DialogDescription>
                Send a new invitation to this user. You can optionally change their email address.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="resend-email">Email Address</Label>
                <Input
                  id="resend-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  {newEmail !== resendUser?.email 
                    ? "A new invitation will be sent to this email address" 
                    : "The invitation will be resent to the current email"}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsResendDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleResendInvite}>
                Send Invitation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Password Reset Dialog */}
        <Dialog open={isResetPasswordDialogOpen} onOpenChange={setIsResetPasswordDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Password Reset Link for {resetPasswordUserName}</DialogTitle>
              <DialogDescription>
                Share this link with the user so they can reset their password. The link expires after use.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex-1 p-3 bg-muted rounded-md border font-mono text-xs break-all">
                  {resetPasswordLink}
                </div>
                <Button variant="outline" size="icon" onClick={copyResetLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Send this link to the user via your preferred method. They can use it to set a new password.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setIsResetPasswordDialogOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* User Profile Details Dialog */}
        <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>User Profile</DialogTitle>
              <DialogDescription>
                View and manage user details
              </DialogDescription>
            </DialogHeader>
            {viewingUser && (
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src={viewingUser.profile_photo_url || undefined} />
                    <AvatarFallback className="text-2xl">
                      {viewingUser.full_name
                        ?.split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase() || '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-1">
                    <h3 className="text-xl font-semibold">{viewingUser.full_name || 'No name'}</h3>
                    <p className="text-sm text-muted-foreground">{viewingUser.email}</p>
                    <div className="flex items-center gap-2 pt-2">
                      <Badge variant={getRoleBadgeVariant(viewingUser.role!)}>
                        {getRoleIcon(viewingUser.role!)}
                        {viewingUser.role?.replace('_', ' ')}
                      </Badge>
                      <Badge variant={viewingUser.is_active ? "default" : "secondary"}>
                        {viewingUser.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 p-4 border rounded-lg">
                    <Label className="text-sm text-muted-foreground">Member Since</Label>
                    <p className="text-lg font-medium">
                      {new Date(viewingUser.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="space-y-2 p-4 border rounded-lg">
                    <Label className="text-sm text-muted-foreground">Accrued Hours</Label>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Paid:</span>
                        <span className="font-medium">{viewingUser.paid_hours || 0}h</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Unpaid:</span>
                        <span className="font-medium">{viewingUser.unpaid_hours || 0}h</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Actions</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground">Change Role</Label>
                      <Select
                        value={viewingUser.role}
                        onValueChange={(value: AppRole) => {
                          handleRoleChange(viewingUser.id, value);
                          setViewingUser({ ...viewingUser, role: value });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="team_member">Team Member</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground">Status</Label>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          handleToggleUserStatus(viewingUser.id, viewingUser.is_active);
                          setViewingUser({ ...viewingUser, is_active: !viewingUser.is_active });
                        }}
                      >
                        {viewingUser.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsProfileDialogOpen(false);
                        handleEditUser(viewingUser);
                      }}
                    >
                      <Camera className="h-4 w-4 mr-2" />
                      Edit Profile
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsProfileDialogOpen(false);
                        handleOpenResendDialog(viewingUser);
                      }}
                    >
                      Re-invite
                    </Button>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setIsProfileDialogOpen(false);
                      handleResetPassword(viewingUser.id, viewingUser.full_name || viewingUser.email);
                    }}
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Reset Password
                  </Button>

                  {!viewingUser.is_active && (
                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={() => {
                        setIsProfileDialogOpen(false);
                        setDeletingUser(viewingUser);
                        setIsDeleteDialogOpen(true);
                      }}
                    >
                      Delete User Permanently
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete User Confirmation Dialog */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete User Permanently</DialogTitle>
              <DialogDescription>
                Are you sure you want to permanently delete {deletingUser?.full_name || deletingUser?.email}? 
                This action cannot be undone and will remove all user data.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsDeleteDialogOpen(false);
                  setDeletingUser(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteUser}
              >
                Delete Permanently
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Image Crop Dialog */}
        <ImageCropDialog
          open={cropDialogOpen}
          onOpenChange={setCropDialogOpen}
          imageSrc={tempImageSrc}
          onCropComplete={handleCropComplete}
        />
      </div>
    </Layout>
  );
}
