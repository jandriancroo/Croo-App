import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { PageHeaderDivider } from '@/components/ui/page-header-divider';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Shield, UserCog, User, UserPlus, Camera, Key, Trash2, FileText, Check, CalendarIcon, Pencil, FlaskConical, RefreshCw } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useUserRole, type AppRole } from '@/hooks/useUserRole';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import React from 'react';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { InviteLinkCard } from '@/components/InviteLinkCard';
import { Copy } from 'lucide-react';
import { BulkActionsBar } from '@/components/users/BulkActionsBar';
import { BulkWageUpdateDialog } from '@/components/users/BulkWageUpdateDialog';
import { EmployeeProfileDialog } from '@/components/users/EmployeeProfileDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
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
import { getTodayInPST, getDateInPST } from '@/utils/dateUtils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { triggerForceReload, getCurrentAppVersion } from '@/hooks/useForceReload';

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
  appears_on_schedule: boolean;
  first_login_at: string | null;
  last_login_at?: string | null;
  app_version?: string | null;
  role?: AppRole;
  paid_hours?: number;
  unpaid_hours?: number;
  hourly_wage?: number;
  croo_cash_balance?: number;
  has_certification?: boolean;
}

const parseDateOnlyToLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

// Helper to get user status display
const getUserStatusDisplay = (user: UserProfile): { label: string; variant: 'default' | 'secondary' | 'outline' } => {
  if (!user.is_active) {
    return { label: 'Inactive', variant: 'secondary' };
  }
  if (!user.first_login_at) {
    return { label: 'Invite Sent', variant: 'outline' };
  }
  return { label: 'Active', variant: 'default' };
};

// Helper to get version display with color coding
const getVersionDisplay = (userVersion: string | null | undefined, currentVersion: string): { 
  text: string; 
  isCurrent: boolean;
  className: string;
} => {
  if (!userVersion) {
    return { text: 'Unknown', isCurrent: false, className: 'text-muted-foreground' };
  }
  const isCurrent = userVersion === currentVersion;
  return {
    text: userVersion,
    isCurrent,
    className: isCurrent ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
  };
};

export default function UserManagement() {
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('team_member');
  const [inviteProfilePhoto, setInviteProfilePhoto] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = React.useRef<HTMLInputElement>(null);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [tempImageSrc, setTempImageSrc] = useState<string>('');
  const [isInviteCrop, setIsInviteCrop] = useState(false);
  const [isResendDialogOpen, setIsResendDialogOpen] = useState(false);
  const [resendUser, setResendUser] = useState<UserProfile | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [isResetPasswordDialogOpen, setIsResetPasswordDialogOpen] = useState(false);
  const [resetPasswordLink, setResetPasswordLink] = useState<string>('');
  const [resetPasswordUserName, setResetPasswordUserName] = useState<string>('');
  const [isInviteLinkDialogOpen, setIsInviteLinkDialogOpen] = useState(false);
  const [inviteResetLink, setInviteResetLink] = useState<string>('');
  const [viewingUser, setViewingUser] = useState<UserProfile | null>(null);
  const [isTempPasswordDialogOpen, setIsTempPasswordDialogOpen] = useState(false);
  const [tempPasswordUser, setTempPasswordUser] = useState<UserProfile | null>(null);
  const [tempPassword, setTempPassword] = useState<string>('');
  const [settingTempPassword, setSettingTempPassword] = useState(false);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [isWageDialogOpen, setIsWageDialogOpen] = useState(false);
  const [editingWageUser, setEditingWageUser] = useState<UserProfile | null>(null);
  const [newWage, setNewWage] = useState<string>('');
  const [wageEffectiveDate, setWageEffectiveDate] = useState<string>(getTodayInPST());
  const [isWageHistoryDialogOpen, setIsWageHistoryDialogOpen] = useState(false);
  const [viewingWageHistory, setViewingWageHistory] = useState<string | null>(null);
  const [wageHistory, setWageHistory] = useState<any[]>([]);
  const [wageNotes, setWageNotes] = useState<string>('');
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [isBulkDeactivateOpen, setIsBulkDeactivateOpen] = useState(false);
  const [isBulkWageOpen, setIsBulkWageOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'inactive'>('active');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [updatingOutdated, setUpdatingOutdated] = useState(false);
  const [creatingTestUser, setCreatingTestUser] = useState(false);
  const [testUserCounter, setTestUserCounter] = useState(1);
  const { toast } = useToast();
  const { isAdmin, isManager, isSuperAdmin, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Managers and admins can access this page
  const canAccessPage = isAdmin || isManager;

  useEffect(() => {
    if (!roleLoading && !canAccessPage) {
      navigate('/dashboard');
      toast({
        title: 'Access Denied',
        description: 'You need manager or admin privileges to access this page.',
        variant: 'destructive',
      });
    }
  }, [canAccessPage, roleLoading, navigate, toast]);
 
  // Users query with React Query (cached, instant on revisit)
  const { data: users = [], isLoading: loading, refetch: refetchUsers } = useQuery({
    queryKey: ['user-management-users', currentLocation?.id],
    staleTime: 5 * 60 * 1000, // 5 min - user list doesn't change often
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 min
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      
      const perfStart = performance.now();
      console.log('[UserManagement] fetchUsers started');

      // Get users at current location
      const { data: userLocations } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', currentLocation.id);

      const userIds = userLocations?.map(ul => ul.user_id) || [];
      if (userIds.length === 0) return [];

      // Fetch profiles, roles, availability, wages, AND certifications in parallel
      const [profilesResult, rolesResult, availabilityResult, wageHistoryResult, certificationsResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .in('id', userIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('user_roles')
          .select('user_id, role'),
        supabase
          .from('availability_requests')
          .select('user_id, request_type, hours_requested, status')
          .eq('status', 'approved')
          .gte('start_date', `${new Date().getFullYear()}-01-01`)
          .lte('start_date', `${new Date().getFullYear()}-12-31`),
        supabase
          .from('wage_history')
          .select('user_id, hourly_wage, effective_date')
          .in('user_id', userIds)
          .lte('effective_date', getTodayInPST())
          .order('effective_date', { ascending: false }),
        supabase
          .from('certifications')
          .select('user_id, status, expiration_date')
          .in('user_id', userIds)
          .eq('status', 'approved')
          .gte('expiration_date', getTodayInPST())
      ]);

      if (profilesResult.error) throw profilesResult.error;
      if (rolesResult.error) throw rolesResult.error;
      if (availabilityResult.error) throw availabilityResult.error;

      const profiles = profilesResult.data;
      const roles = rolesResult.data;
      const availabilityData = availabilityResult.data;

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

      // Build wage map from bulk query (take first/most recent per user)
      const wageMap = new Map<string, number>();
      if (wageHistoryResult.data) {
        for (const wh of wageHistoryResult.data) {
          if (!wageMap.has(wh.user_id)) {
            wageMap.set(wh.user_id, wh.hourly_wage);
          }
        }
      }

      // Create map of user certifications (already fetched in parallel)
      const certificationMap = new Map(
        certificationsResult.data?.map(cert => [cert.user_id, true]) || []
      );

      // Merge profiles with their roles, hours, current wages, and certification status
      const usersWithRoles = profiles.map((profile) => ({
        ...profile,
        role: roles.find((r) => r.user_id === profile.id)?.role as AppRole || 'team_member',
        paid_hours: hoursByUser[profile.id]?.paid || 0,
        unpaid_hours: hoursByUser[profile.id]?.unpaid || 0,
        hourly_wage: wageMap.get(profile.id) ?? profile.hourly_wage ?? 15.00,
        has_certification: certificationMap.has(profile.id),
      }));

      console.log(`[UserManagement] fetchUsers completed: ${(performance.now() - perfStart).toFixed(0)}ms total`);
      return usersWithRoles as UserProfile[];
    },
    enabled: canAccessPage && !!currentLocation?.id,
  });

  // Locations query with React Query (cached)
  const { data: availableLocations = [] } = useQuery({
    queryKey: ['user-management-locations', user?.id, isSuperAdmin],
    staleTime: 10 * 60 * 1000, // 10 min - locations rarely change
    gcTime: 60 * 60 * 1000, // 1 hour cache
    queryFn: async () => {
      // Super admins see all locations
      if (isSuperAdmin) {
        const { data, error } = await supabase
          .from('locations')
          .select('*')
          .order('name', { ascending: true });
        if (error) throw error;
        return data || [];
      }

      // Check if user is an org admin (has organization membership)
      const { data: orgMembership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user?.id)
        .single();

      if (orgMembership?.organization_id) {
        // Org admins see all locations in their organization
        const { data, error } = await supabase
          .from('locations')
          .select('*')
          .eq('organization_id', orgMembership.organization_id)
          .order('name', { ascending: true });
        if (error) throw error;
        return data || [];
      }

      // Other admins/managers see only their assigned locations
      const { data: userLocationIds } = await supabase
        .from('user_locations')
        .select('location_id')
        .eq('user_id', user?.id);

      if (userLocationIds && userLocationIds.length > 0) {
        const locationIds = userLocationIds.map(ul => ul.location_id);
        const { data, error } = await supabase
          .from('locations')
          .select('*')
          .in('id', locationIds)
          .order('name', { ascending: true });
        if (error) throw error;
        return data || [];
      }
      
      return [];
    },
    enabled: canAccessPage && !!user?.id,
  });
  
  // Helper to check if current user can edit a specific user's profile
  const canEditUser = (userId: string) => {
    if (isAdmin) return true;
    // Managers can only edit their own profile
    return user?.id === userId;
  };

  useEffect(() => {
    if (viewingWageHistory) {
      fetchWageHistory(viewingWageHistory);
    }
  }, [viewingWageHistory]);

  // Note: Employee notes now managed in EmployeeProfileDialog

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

  // Helper function to invalidate users query (replaces old fetchUsers calls)
  const fetchUsers = () => {
    queryClient.invalidateQueries({ queryKey: ['user-management-users'] });
  };

  const handleCreateTestEmployee = async () => {
    if (!currentLocation) return;
    
    setCreatingTestUser(true);
    try {
      const testNames = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];
      const testName = testNames[(testUserCounter - 1) % testNames.length];
      const email = `test.${testName.toLowerCase()}${testUserCounter > 10 ? testUserCounter : ''}@example.com`;
      
      const { data, error } = await supabase.functions.invoke('utility-service?action=create-test-users', {
        body: { 
          location_id: currentLocation.id,
          single_user: {
            email,
            name: `Test Employee ${testName}`,
            role: 'team_member'
          }
        }
      });

      if (error) throw error;

      setTestUserCounter(prev => prev + 1);
      toast({
        title: 'Test employee created',
        description: `Created Test Employee ${testName}`,
      });
      fetchUsers();
    } catch (error: any) {
      console.error('Error creating test employee:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create test employee',
        variant: 'destructive',
      });
    } finally {
      setCreatingTestUser(false);
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

  // Note: fetchEmployeeNotes moved to EmployeeProfileDialog component

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
      case 'super_admin':
      case 'brand_admin':
      case 'org_admin':
      case 'admin':
        return <Shield className="h-4 w-4" />;
      case 'manager':
      case 'shift_manager':
        return <UserCog className="h-4 w-4" />;
      default:
        return <User className="h-4 w-4" />;
    }
  };

  const getRoleBadgeVariant = (role: AppRole) => {
    switch (role) {
      case 'super_admin':
        return 'destructive';
      case 'brand_admin':
      case 'org_admin':
      case 'admin':
        return 'default';
      case 'manager':
      case 'shift_manager':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const getRoleDisplayName = (role: AppRole) => {
    const names: Record<AppRole, string> = {
      super_admin: 'Super Admin',
      brand_admin: 'Brand Admin',
      org_admin: 'Org Admin',
      admin: 'Admin',
      manager: 'Manager',
      shift_manager: 'Shift Manager',
      team_member: 'Team Member',
    };
    return names[role] || String(role).replace('_', ' ');
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

  // Note: handleEditPhotoUpload moved to EmployeeProfileDialog

  const handleCropComplete = async (croppedBlob: Blob) => {
    try {
      setUploadingPhoto(true);
      
      const fileName = `temp/${Date.now()}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(fileName, croppedBlob);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(fileName);

      setInviteProfilePhoto(publicUrl);
      
      toast({ title: 'Success', description: 'Photo uploaded' });
    } catch (error: any) {
      toast({ title: 'Error', description: 'Failed to upload photo', variant: 'destructive' });
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Note: handleEditUser and handleUpdateUser moved to EmployeeProfileDialog component

  const handleToggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase.functions.invoke('user-service?action=toggle-status', {
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
          created_by: user?.id,
          notes: wageNotes.trim() || null,
        }, {
          onConflict: 'user_id,effective_date'
        });

      if (historyError) throw historyError;

      // Only update current wage in profiles if the effective date is today or in the past
      const today = getTodayInPST();
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
      setWageEffectiveDate(getTodayInPST());
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
 
      const { data, error } = await supabase.functions.invoke('user-service?action=resend-invite', {
        body: {
          userId: resendUser.id,
          newEmail: emailChanged ? newEmail.trim() : undefined,
        },
      });

      if (error) throw error;

      const response = data as { resetLink?: string | null } | null;
      const resetLink = response?.resetLink ?? null;

      if (resetLink) {
        // Show a dedicated dialog so the link can be copied without truncation/formatting issues.
        setResetPasswordLink(resetLink);
        setResetPasswordUserName(resendUser.full_name || resendUser.email || 'User');
        setIsResetPasswordDialogOpen(true);

        toast({
          title: 'Invitation link generated',
          description: emailChanged ? 'Sent to new email (and link is available to copy).' : 'Link is available to copy.',
        });
      } else {
        toast({
          title: 'Success',
          description: emailChanged ? 'Invitation sent to new email address' : 'Invitation resent successfully',
        });
      }

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
      const { data, error } = await supabase.functions.invoke('user-service?action=resend-invite', {
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

  const handleSetTempPassword = async () => {
    if (!tempPasswordUser || !tempPassword.trim()) return;
    
    if (tempPassword.length < 6) {
      toast({
        title: 'Error',
        description: 'Password must be at least 6 characters',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSettingTempPassword(true);
      
      const { data, error } = await supabase.functions.invoke('user-service?action=set-password', {
        body: { 
          userId: tempPasswordUser.id, 
          password: tempPassword 
        },
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Temporary password set. User can now log in and change it.',
      });
      
      setIsTempPasswordDialogOpen(false);
      setTempPassword('');
      setTempPasswordUser(null);
    } catch (error: any) {
      console.error('Error setting password:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to set password',
        variant: 'destructive',
      });
    } finally {
      setSettingTempPassword(false);
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

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteResetLink);
      toast({
        title: 'Copied!',
        description: 'Invite link copied to clipboard',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to copy link',
        variant: 'destructive',
      });
    }
  };

  // Note: handleAddEmployeeNote moved to EmployeeProfileDialog

  const handleBulkDeactivate = async () => {
    try {
      setBulkUpdating(true);
      
      for (const userId of selectedUsers) {
        await supabase.functions.invoke('user-service?action=toggle-status', {
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

  const handleBulkForceUpdate = async () => {
    try {
      setBulkUpdating(true);
      
      // Send force-reload signal to all selected users in parallel
      await Promise.all(
        Array.from(selectedUsers).map(userId => triggerForceReload(userId))
      );

      toast({
        title: 'Update signals sent',
        description: `Force update triggered for ${selectedUsers.size} user(s). They will refresh when their app is active.`,
      });

      setSelectedUsers(new Set());
    } catch (error: any) {
      console.error('Error bulk force updating:', error);
      toast({
        title: 'Error',
        description: 'Failed to send update signals',
        variant: 'destructive',
      });
    } finally {
      setBulkUpdating(false);
    }
  };

  // Get outdated users (those with version less than current)
  const currentVersion = getCurrentAppVersion();
  const outdatedUsers = users.filter(u => {
    if (!u.app_version || u.app_version === 'unknown') return false;
    return u.app_version.localeCompare(currentVersion, undefined, { numeric: true }) < 0;
  });

  const handleUpdateAllOutdated = async () => {
    if (outdatedUsers.length === 0) {
      toast({
        title: 'All up to date',
        description: 'No users are running an outdated version.',
      });
      return;
    }

    try {
      setUpdatingOutdated(true);
      
      // Send force-reload signal to all outdated users in parallel
      await Promise.all(
        outdatedUsers.map(u => triggerForceReload(u.id))
      );

      toast({
        title: 'Update signals sent',
        description: `Force update triggered for ${outdatedUsers.length} outdated user(s). They will refresh when their app is active.`,
      });
    } catch (error: any) {
      console.error('Error updating outdated users:', error);
      toast({
        title: 'Error',
        description: 'Failed to send update signals',
        variant: 'destructive',
      });
    } finally {
      setUpdatingOutdated(false);
    }
  };

  const handleBulkWageUpdate = async (wage: number, effectiveDate: Date, notes: string) => {
    try {
      setBulkUpdating(true);
      
      if (!user) throw new Error('Not authenticated');

      const effectiveDateStr = getDateInPST(effectiveDate);
      const today = getTodayInPST();
      const isEffectiveNow = effectiveDateStr <= today;

      for (const userId of selectedUsers) {
        // Upsert into wage_history (update if exists for this date, insert if new)
        await supabase
          .from('wage_history')
          .upsert({
            user_id: userId,
            hourly_wage: wage,
            effective_date: effectiveDateStr,
            created_by: user?.id,
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
    const filteredUsers = users.filter(u => u.is_active === (activeTab === 'active'));
    if (selectedUsers.size === filteredUsers.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map(u => u.id)));
    }
  };

  // Note: handleDeleteEmployeeNote moved to EmployeeProfileDialog

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
 
      const { data, error } = await supabase.functions.invoke('user-service?action=invite', {
        body: {
          email: inviteEmail.trim(),
          fullName: inviteFullName.trim(),
          role: inviteRole,
          profilePhotoUrl: inviteProfilePhoto,
          locationId: currentLocation?.id,
        },
      });
 
      if (error) throw error;
 
      const response = data as { resetLink?: string | null } | null;
      const resetLink = response?.resetLink ?? null;
 
      setInviteDialogOpen(false);
      setInviteEmail('');
      setInviteRole('team_member');
      setInviteProfilePhoto(null);
      fetchUsers();

      if (resetLink) {
        setInviteResetLink(resetLink);
        setIsInviteLinkDialogOpen(true);
      } else {
        toast({
          title: 'Success',
          description: `${inviteFullName} has been invited`,
        });
      }
      setInviteFullName('');
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
      const { data, error } = await supabase.functions.invoke('utility-service?action=create-test-users');

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

  if (roleLoading || !canAccessPage) {
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
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold">User Management</h1>
          <PageHeaderDivider />
        </div>
        {isAdmin && <InviteLinkCard />}
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <CardDescription>Manage user roles and permissions</CardDescription>
              {isAdmin && (
              <div className="flex items-center gap-2">
                {currentLocation?.name?.toLowerCase() === 'hemet' && (
                  <Button 
                    variant="outline" 
                    className="gap-2"
                    onClick={handleCreateTestEmployee}
                    disabled={creatingTestUser}
                  >
                    {creatingTestUser ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FlaskConical className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline">Add Test Employee</span>
                  </Button>
                )}
                {outdatedUsers.length > 0 && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={handleUpdateAllOutdated}
                    disabled={updatingOutdated}
                  >
                    {updatingOutdated ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline">Update {outdatedUsers.length} Outdated</span>
                    <span className="sm:hidden">{outdatedUsers.length}</span>
                  </Button>
                )}
                <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2 flex-1 md:flex-none">
                      <UserPlus className="h-4 w-4" />
                      <span className="hidden sm:inline">Invite User</span>
                      <span className="sm:hidden">Invite</span>
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
                          <SelectItem value="shift_manager">Shift Manager</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="org_admin">Org Admin</SelectItem>
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
              )}
          </div>
          </CardHeader>
          <CardContent className="px-2 sm:px-6">
            {/* Active/Inactive Tabs */}
            <div className="flex items-center justify-between mb-4">
            <Tabs value={activeTab} onValueChange={(v) => {
              setActiveTab(v as 'active' | 'inactive');
              setSelectedUsers(new Set());
              setBulkMode(false);
            }}>
              <TabsList>
                <TabsTrigger value="active">
                  Active ({users.filter(u => u.is_active).length})
                </TabsTrigger>
                <TabsTrigger value="inactive">
                  Inactive ({users.filter(u => !u.is_active).length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {isAdmin && !bulkMode && (
              <Button variant="ghost" size="sm" onClick={() => setBulkMode(true)}>
                Select
              </Button>
            )}
            {isAdmin && bulkMode && selectedUsers.size === 0 && (
              <Button variant="ghost" size="sm" onClick={() => setBulkMode(false)}>
                Cancel
              </Button>
            )}
            </div>
            
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <Table className="w-full table-fixed md:table-auto">
                <TableHeader>
                  <TableRow>
                    {isAdmin && bulkMode && (
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedUsers.size === users.filter(u => u.is_active === (activeTab === 'active')).length && users.filter(u => u.is_active === (activeTab === 'active')).length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    )}
                    <TableHead>User</TableHead>
                    <TableHead className="hidden md:table-cell">Status</TableHead>
                    <TableHead className="hidden md:table-cell">Role</TableHead>
                    {isSuperAdmin && (
                      <TableHead className="hidden md:table-cell">Version</TableHead>
                    )}
                    <TableHead className="hidden md:table-cell">Last Login</TableHead>
                    <TableHead className="hidden md:table-cell">Cert</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.filter(u => u.is_active === (activeTab === 'active')).map((user) => (
                    <TableRow 
                      key={user.id}
                      className="hover:bg-muted/50"
                    >
                      {isAdmin && bulkMode && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedUsers.has(user.id)}
                          onCheckedChange={() => toggleUserSelection(user.id)}
                        />
                      </TableCell>
                      )}
                      <TableCell
                        className="cursor-pointer w-full"
                        onClick={() => {
                          setViewingUser(user);
                          setIsProfileDialogOpen(true);
                        }}
                      >
                        <div className="flex items-center gap-3 w-full">
                          <Avatar className="h-10 w-10 flex-shrink-0">
                            <AvatarImage src={user.profile_photo_url || undefined} />
                            <AvatarFallback>
                              {user.full_name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0 overflow-hidden">
                            {/* Desktop view - stacked vertically */}
                            <div className="hidden md:block">
                              <div className="font-medium truncate">{user.full_name || 'No name'}</div>
                              <div className="text-sm text-muted-foreground truncate">{user.email}</div>
                            </div>
                            {/* Mobile view - name on top, status + role + croo cash below */}
                            <div className="md:hidden">
                              <div className="font-medium truncate">{user.full_name || 'No name'}</div>
                              <div className="text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
                                <Badge variant={getUserStatusDisplay(user).variant} className="text-[10px] px-1.5 py-0">
                                  {getUserStatusDisplay(user).label}
                                </Badge>
                                <span className="text-muted-foreground">•</span>
                                <span className="text-muted-foreground">{getRoleDisplayName(user.role!)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant={getUserStatusDisplay(user).variant}>
                          {getUserStatusDisplay(user).label}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant={getRoleBadgeVariant(user.role!)} className="gap-1">
                          {getRoleIcon(user.role!)}
                          {getRoleDisplayName(user.role!)}
                        </Badge>
                      </TableCell>
                      {isSuperAdmin && (
                        <TableCell className="hidden md:table-cell">
                          {(() => {
                            const currentVersion = getCurrentAppVersion();
                            const versionInfo = getVersionDisplay(user.app_version, currentVersion);
                            const isOutdated = !versionInfo.isCurrent && user.app_version;
                            return (
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-mono ${versionInfo.className}`}>
                                  {versionInfo.text}
                                </span>
                                {isOutdated && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    title="Force reload for this user"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      await triggerForceReload(user.id);
                                      toast({
                                        title: 'Update signal sent',
                                        description: `${user.full_name || 'User'} will reload on next active session.`,
                                      });
                                    }}
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>
                      )}
                      <TableCell className="hidden md:table-cell">
                        {user.last_login_at ? (
                          <span className="text-xs text-muted-foreground">
                            {new Date(user.last_login_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            <br />
                            {new Date(user.last_login_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Never</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex items-center justify-center">
                          {user.has_certification ? (
                            <Check className="h-5 w-5 text-green-500" />
                          ) : (
                            <span className="text-red-500 text-lg">×</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Certifications Section */}
        <div className="border-t pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Certifications</h2>
              <p className="text-sm text-muted-foreground">Track food handler cards and ServSafe certifications</p>
            </div>
            <Button onClick={() => navigate('/certifications')} variant="outline">
              Manage Certifications
            </Button>
          </div>
        </div>

        {/* Unified Employee Profile Dialog */}
        <EmployeeProfileDialog
          open={isProfileDialogOpen}
          onOpenChange={setIsProfileDialogOpen}
          user={viewingUser}
          availableLocations={availableLocations}
          currentLocationId={currentLocation?.id}
          onUserUpdated={fetchUsers}
          onResetPassword={handleResetPassword}
          onSetTempPassword={(user) => {
            setTempPasswordUser(user);
            setTempPassword('');
            setIsTempPasswordDialogOpen(true);
          }}
          onOpenWageDialog={(user) => {
            setEditingWageUser(user);
            setNewWage(user.hourly_wage?.toString() || '15.00');
            setIsWageDialogOpen(true);
          }}
          onOpenWageHistory={(userId) => {
            setViewingWageHistory(userId);
            setIsWageHistoryDialogOpen(true);
          }}
          onResendInvite={handleOpenResendDialog}
        />

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

        {/* Invite Link Dialog */}
        <Dialog open={isInviteLinkDialogOpen} onOpenChange={setIsInviteLinkDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>User Invited Successfully</DialogTitle>
              <DialogDescription>
                Share this link with the new team member so they can set up their password and access the app.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex-1 p-3 bg-muted rounded-md border font-mono text-xs break-all">
                  {inviteResetLink}
                </div>
                <Button variant="outline" size="icon" onClick={copyInviteLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Send this link via text, email, or any method you prefer. The link allows them to set their password.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setIsInviteLinkDialogOpen(false)}>
                Done
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
                  setWageEffectiveDate(getTodayInPST());
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

        {/* Bulk Actions Bar - Admin only */}
        {isAdmin && (
        <BulkActionsBar
          selectedCount={selectedUsers.size}
          onDeactivate={() => setIsBulkDeactivateOpen(true)}
          onWageUpdate={() => setIsBulkWageOpen(true)}
          onForceUpdate={handleBulkForceUpdate}
          onClearSelection={() => { setSelectedUsers(new Set()); setBulkMode(false); }}
          isUpdating={bulkUpdating}
        />
        )}

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

        {/* Bulk Wage Update Dialog */}
        <BulkWageUpdateDialog
          open={isBulkWageOpen}
          onOpenChange={setIsBulkWageOpen}
          selectedCount={selectedUsers.size}
          onConfirm={handleBulkWageUpdate}
          updating={bulkUpdating}
        />

        {/* Set Temporary Password Dialog */}
        <Dialog open={isTempPasswordDialogOpen} onOpenChange={(open) => {
          setIsTempPasswordDialogOpen(open);
          if (!open) {
            setTempPassword('');
            setTempPasswordUser(null);
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set Temporary Password</DialogTitle>
              <DialogDescription>
                Set a temporary password for {tempPasswordUser?.full_name || tempPasswordUser?.email}. They can change it after logging in.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="temp-password">Temporary Password</Label>
                <Input
                  id="temp-password"
                  type="text"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  placeholder="Enter temporary password"
                  minLength={6}
                />
                <p className="text-xs text-muted-foreground">
                  Password must be at least 6 characters. Share this password with the employee so they can log in.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsTempPasswordDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSetTempPassword}
                disabled={settingTempPassword || tempPassword.length < 6}
              >
                {settingTempPassword ? 'Setting...' : 'Set Password'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
