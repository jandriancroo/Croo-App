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
import { Loader2, Users, Shield, UserCog, User, UserPlus, Camera, Key, Trash2, FileText, Check, CalendarIcon } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useUserRole, type AppRole } from '@/hooks/useUserRole';
import { useNavigate, useLocation } from 'react-router-dom';
import React from 'react';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { InviteLinkCard } from '@/components/InviteLinkCard';
import { Copy } from 'lucide-react';
import { BulkActionsBar } from '@/components/users/BulkActionsBar';
import { BulkWageUpdateDialog } from '@/components/users/BulkWageUpdateDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  profile_photo_url: string | null;
  phone_number: string | null;
  birthday: string | null;
  employee_pin: string | null;
  created_at: string;
  is_active: boolean;
  role?: AppRole;
  paid_hours?: number;
  unpaid_hours?: number;
  hourly_wage?: number;
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
  const [isWageDialogOpen, setIsWageDialogOpen] = useState(false);
  const [editingWageUser, setEditingWageUser] = useState<UserProfile | null>(null);
  const [newWage, setNewWage] = useState<string>('');
  const [wageEffectiveDate, setWageEffectiveDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isWageHistoryDialogOpen, setIsWageHistoryDialogOpen] = useState(false);
  const [viewingWageHistory, setViewingWageHistory] = useState<string | null>(null);
  const [wageHistory, setWageHistory] = useState<any[]>([]);
  const [wageNotes, setWageNotes] = useState<string>('');
  const [employeeNotes, setEmployeeNotes] = useState<any[]>([]);
  const [newEmployeeNote, setNewEmployeeNote] = useState<string>('');
  const [addingNote, setAddingNote] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [isBulkDeactivateOpen, setIsBulkDeactivateOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isBulkWageOpen, setIsBulkWageOpen] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [editPhoneNumber, setEditPhoneNumber] = useState('');
  const [editBirthday, setEditBirthday] = useState<Date | undefined>();
  const [editEmployeePin, setEditEmployeePin] = useState<string>('');
  const { toast } = useToast();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();
  const location = useLocation();

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

  useEffect(() => {
    if (viewingWageHistory) {
      fetchWageHistory(viewingWageHistory);
    }
  }, [viewingWageHistory]);

  useEffect(() => {
    if (viewingUser) {
      fetchEmployeeNotes(viewingUser.id);
    }
  }, [viewingUser]);

  // Handle opening user profile from navigation state
  useEffect(() => {
    const state = location.state as { viewUserId?: string } | null;
    if (state?.viewUserId && users.length > 0) {
      const user = users.find(u => u.id === state.viewUserId);
      if (user) {
        setViewingUser(user);
        setIsProfileDialogOpen(true);
        // Clear the state to prevent reopening on subsequent renders
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [location.state, users, navigate, location.pathname]);

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

  const fetchWageHistory = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('wage_history')
        .select('*')
        .eq('user_id', userId)
        .order('effective_date', { ascending: false });

      if (error) throw error;

      setWageHistory(data || []);
    } catch (error: any) {
      console.error('Error fetching wage history:', error);
      toast({
        title: 'Error',
        description: 'Failed to load wage history',
        variant: 'destructive',
      });
    }
  };

  const fetchEmployeeNotes = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('employee_notes')
        .select(`
          *,
          creator:created_by(full_name)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setEmployeeNotes(data || []);
    } catch (error: any) {
      console.error('Error fetching employee notes:', error);
      toast({
        title: 'Error',
        description: 'Failed to load employee notes',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteWageHistory = async (historyId: string) => {
    try {
      const { error } = await supabase
        .from('wage_history')
        .delete()
        .eq('id', historyId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Wage history entry deleted',
      });

      if (viewingWageHistory) {
        fetchWageHistory(viewingWageHistory);
      }
    } catch (error: any) {
      console.error('Error deleting wage history:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete wage history entry',
        variant: 'destructive',
      });
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
    setEditPhoneNumber(user.phone_number || '');
    setEditBirthday(user.birthday ? new Date(user.birthday) : undefined);
    setEditEmployeePin(user.employee_pin || '');
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
          phone_number: editPhoneNumber.trim() || null,
          birthday: editBirthday ? editBirthday.toISOString().split('T')[0] : null,
          employee_pin: editEmployeePin.trim() || null,
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
      setEditPhoneNumber('');
      setEditBirthday(undefined);
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

  const handleUpdateWage = async () => {
    if (!editingWageUser) return;

    const wageValue = parseFloat(newWage);
    if (isNaN(wageValue) || wageValue < 0) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a valid wage amount',
        variant: 'destructive',
      });
      return;
    }

    if (!wageEffectiveDate) {
      toast({
        title: 'Validation Error',
        description: 'Please select an effective date',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Upsert into wage_history (update if exists for this date, insert if new)
      const { error: historyError } = await supabase
        .from('wage_history')
        .upsert({
          user_id: editingWageUser.id,
          hourly_wage: wageValue,
          effective_date: wageEffectiveDate,
          created_by: (await supabase.auth.getUser()).data.user?.id,
          notes: wageNotes.trim() || null,
        }, {
          onConflict: 'user_id,effective_date'
        });

      if (historyError) throw historyError;

      // Only update current wage in profiles if the effective date is today or in the past
      const today = new Date().toISOString().split('T')[0];
      const isEffectiveNow = wageEffectiveDate <= today;
      
      if (isEffectiveNow) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ hourly_wage: wageValue })
          .eq('id', editingWageUser.id);

        if (profileError) throw profileError;
      }

      toast({
        title: 'Success',
        description: isEffectiveNow 
          ? 'Hourly wage updated successfully'
          : 'Future wage scheduled successfully',
      });

      setIsWageDialogOpen(false);
      setEditingWageUser(null);
      setNewWage('');
      setWageNotes('');
      setWageEffectiveDate(new Date().toISOString().split('T')[0]);
      fetchUsers();
      
      // Update viewing user if open
      if (viewingUser?.id === editingWageUser.id) {
        setViewingUser({ ...viewingUser, hourly_wage: wageValue });
      }
    } catch (error: any) {
      console.error('Error updating wage:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update wage',
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

  const handleAddEmployeeNote = async () => {
    if (!viewingUser || !newEmployeeNote.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a note',
        variant: 'destructive',
      });
      return;
    }

    try {
      setAddingNote(true);

      const { error } = await supabase
        .from('employee_notes')
        .insert({
          user_id: viewingUser.id,
          note: newEmployeeNote.trim(),
          created_by: (await supabase.auth.getUser()).data.user?.id,
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Note added successfully',
      });

      setNewEmployeeNote('');
      fetchEmployeeNotes(viewingUser.id);
    } catch (error: any) {
      console.error('Error adding note:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to add note',
        variant: 'destructive',
      });
    } finally {
      setAddingNote(false);
    }
  };

  const handleBulkDeactivate = async () => {
    try {
      setBulkUpdating(true);
      
      for (const userId of selectedUsers) {
        await supabase.functions.invoke('toggle-user-status', {
          body: { userId, isActive: false },
        });
      }

      toast({
        title: 'Success',
        description: `${selectedUsers.size} user(s) deactivated`,
      });

      setSelectedUsers(new Set());
      setIsBulkDeactivateOpen(false);
      fetchUsers();
    } catch (error: any) {
      console.error('Error bulk deactivating:', error);
      toast({
        title: 'Error',
        description: 'Failed to deactivate users',
        variant: 'destructive',
      });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleBulkDelete = async () => {
    try {
      setBulkUpdating(true);
      
      for (const userId of selectedUsers) {
        await supabase.functions.invoke('delete-user', {
          body: { userId },
        });
      }

      toast({
        title: 'Success',
        description: `${selectedUsers.size} user(s) deleted`,
      });

      setSelectedUsers(new Set());
      setIsBulkDeleteOpen(false);
      fetchUsers();
    } catch (error: any) {
      console.error('Error bulk deleting:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete users',
        variant: 'destructive',
      });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleBulkWageUpdate = async (wage: number, effectiveDate: Date, notes: string) => {
    try {
      setBulkUpdating(true);
      
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not authenticated');

      const effectiveDateStr = effectiveDate.toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      const isEffectiveNow = effectiveDateStr <= today;

      for (const userId of selectedUsers) {
        // Upsert into wage_history (update if exists for this date, insert if new)
        await supabase
          .from('wage_history')
          .upsert({
            user_id: userId,
            hourly_wage: wage,
            effective_date: effectiveDateStr,
            created_by: currentUser.id,
            notes: notes.trim() || null,
          }, {
            onConflict: 'user_id,effective_date'
          });

        // Only update current wage in profiles if effective date is today or in the past
        if (isEffectiveNow) {
          await supabase
            .from('profiles')
            .update({ hourly_wage: wage })
            .eq('id', userId);
        }
      }

      toast({
        title: 'Success',
        description: isEffectiveNow
          ? `Wages updated for ${selectedUsers.size} user(s)`
          : `Future wages scheduled for ${selectedUsers.size} user(s)`,
      });

      setSelectedUsers(new Set());
      setIsBulkWageOpen(false);
      fetchUsers();
    } catch (error: any) {
      console.error('Error bulk updating wages:', error);
      toast({
        title: 'Error',
        description: 'Failed to update wages',
        variant: 'destructive',
      });
    } finally {
      setBulkUpdating(false);
    }
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedUsers.size === users.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(users.map(u => u.id)));
    }
  };

  const handleDeleteEmployeeNote = async (noteId: string) => {
    try {
      const { error } = await supabase
        .from('employee_notes')
        .delete()
        .eq('id', noteId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Note deleted',
      });

      if (viewingUser) {
        fetchEmployeeNotes(viewingUser.id);
      }
    } catch (error: any) {
      console.error('Error deleting note:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete note',
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
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedUsers.size === users.length && users.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
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
                      className="hover:bg-muted/50"
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedUsers.has(user.id)}
                          onCheckedChange={() => toggleUserSelection(user.id)}
                        />
                      </TableCell>
                      <TableCell
                        className="cursor-pointer"
                        onClick={() => {
                          setViewingUser(user);
                          setIsProfileDialogOpen(true);
                        }}
                      >
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
                  <div className="space-y-2 p-4 border rounded-lg">
                    <Label className="text-sm text-muted-foreground">Employee PIN</Label>
                    <p className="text-2xl font-mono font-bold tracking-wider">
                      {viewingUser.employee_pin || 'Not Set'}
                    </p>
                    <p className="text-xs text-muted-foreground">Used for punch clock</p>
                  </div>
                  <div className="space-y-2 p-4 border rounded-lg col-span-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">Current Hourly Wage</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingWageUser(viewingUser);
                          setNewWage(viewingUser.hourly_wage?.toString() || '15.00');
                          setIsWageDialogOpen(true);
                        }}
                      >
                        Add/Edit
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">${viewingUser.hourly_wage?.toFixed(2) || '15.00'}</span>
                      <span className="text-sm text-muted-foreground">/hour</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => {
                        setViewingWageHistory(viewingUser.id);
                        setIsWageHistoryDialogOpen(true);
                      }}
                    >
                      View Wage History
                    </Button>
                  </div>
                </div>

                {/* Employee Notes Section */}
                <div className="space-y-3 border-t pt-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <Label>Employee Notes</Label>
                    <span className="text-xs text-muted-foreground">(Admin & Manager Only)</span>
                  </div>
                  
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Add a note about this employee..."
                      value={newEmployeeNote}
                      onChange={(e) => setNewEmployeeNote(e.target.value)}
                      className="min-h-[80px]"
                    />
                    <Button
                      onClick={handleAddEmployeeNote}
                      disabled={addingNote || !newEmployeeNote.trim()}
                      size="sm"
                      className="w-full"
                    >
                      {addingNote ? 'Adding...' : 'Add Note'}
                    </Button>
                  </div>

                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {employeeNotes.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No notes yet</p>
                    ) : (
                      employeeNotes.map((note) => (
                        <div key={note.id} className="p-3 border rounded-lg space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm flex-1">{note.note}</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteEmployeeNote(note.id)}
                              className="h-6 w-6 p-0"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{note.creator?.full_name || 'Unknown'}</span>
                            <span>•</span>
                            <span>{new Date(note.created_at).toLocaleString()}</span>
                          </div>
                        </div>
                      ))
                    )}
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
                <Label htmlFor="edit-phone">Phone Number</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={editPhoneNumber}
                  onChange={(e) => setEditPhoneNumber(e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-birthday">Birthday</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !editBirthday && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {editBirthday ? format(editBirthday, "PPP") : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={editBirthday}
                      onSelect={setEditBirthday}
                      disabled={(date) => date > new Date()}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-pin">Employee PIN (4 digits)</Label>
                <Input
                  id="edit-pin"
                  type="text"
                  maxLength={4}
                  value={editEmployeePin}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    setEditEmployeePin(value);
                  }}
                  placeholder="0000"
                  className="text-center tracking-widest text-lg font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Used for punch clock. Must be unique.
                </p>
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

        {/* Edit Wage Dialog */}
        <Dialog open={isWageDialogOpen} onOpenChange={setIsWageDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Update Hourly Wage</DialogTitle>
              <DialogDescription>
                Set a new hourly wage with an effective date for {editingWageUser?.full_name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="wage-input">Hourly Wage ($)</Label>
                <Input
                  id="wage-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={newWage}
                  onChange={(e) => setNewWage(e.target.value)}
                  placeholder="15.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wage-date">Effective Date</Label>
                <Input
                  id="wage-date"
                  type="date"
                  value={wageEffectiveDate}
                  onChange={(e) => setWageEffectiveDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wage-notes">Internal Notes (Optional)</Label>
                <Textarea
                  id="wage-notes"
                  placeholder="Reason for wage change (admin/manager only)..."
                  value={wageNotes}
                  onChange={(e) => setWageNotes(e.target.value)}
                  className="min-h-[80px]"
                />
                <p className="text-xs text-muted-foreground">
                  Only visible to admins and managers
                </p>
              </div>
            </div>
            <DialogFooter>
                <Button
                variant="outline"
                onClick={() => {
                  setIsWageDialogOpen(false);
                  setEditingWageUser(null);
                  setNewWage('');
                  setWageNotes('');
                  setWageEffectiveDate(new Date().toISOString().split('T')[0]);
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleUpdateWage}>
                Save Wage
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Wage History Dialog */}
        <Dialog open={isWageHistoryDialogOpen} onOpenChange={(open) => {
          setIsWageHistoryDialogOpen(open);
          if (!open) {
            setViewingWageHistory(null);
            setWageHistory([]);
          }
        }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Wage History</DialogTitle>
              <DialogDescription>
                View all wage changes for this employee
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {wageHistory.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No wage history found</p>
              ) : (
                <div className="space-y-3">
                  {wageHistory.map((entry) => (
                    <div key={entry.id} className="p-3 border rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-semibold">${parseFloat(entry.hourly_wage).toFixed(2)}</span>
                            <span className="text-sm text-muted-foreground">/hour</span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Effective: {new Date(entry.effective_date).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteWageHistory(entry.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {entry.notes && (
                        <div className="pt-2 border-t">
                          <p className="text-xs text-muted-foreground mb-1">Internal Notes:</p>
                          <p className="text-sm">{entry.notes}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setIsWageHistoryDialogOpen(false)}>
                Close
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

        {/* Bulk Actions Bar */}
        <BulkActionsBar
          selectedCount={selectedUsers.size}
          onDeactivate={() => setIsBulkDeactivateOpen(true)}
          onDelete={() => setIsBulkDeleteOpen(true)}
          onWageUpdate={() => setIsBulkWageOpen(true)}
          onClearSelection={() => setSelectedUsers(new Set())}
        />

        {/* Bulk Deactivate Confirmation */}
        <AlertDialog open={isBulkDeactivateOpen} onOpenChange={setIsBulkDeactivateOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Bulk Deactivate Users</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to deactivate {selectedUsers.size} user(s)? They will no longer be able to access the system.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleBulkDeactivate} disabled={bulkUpdating}>
                {bulkUpdating ? 'Deactivating...' : 'Deactivate'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk Delete Confirmation */}
        <AlertDialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Bulk Delete Users</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to permanently delete {selectedUsers.size} user(s)? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleBulkDelete}
                disabled={bulkUpdating}
                className="bg-destructive text-destructive-foreground"
              >
                {bulkUpdating ? 'Deleting...' : 'Delete Permanently'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk Wage Update Dialog */}
        <BulkWageUpdateDialog
          open={isBulkWageOpen}
          onOpenChange={setIsBulkWageOpen}
          selectedCount={selectedUsers.size}
          onConfirm={handleBulkWageUpdate}
          updating={bulkUpdating}
        />
      </div>
    </Layout>
  );
}
