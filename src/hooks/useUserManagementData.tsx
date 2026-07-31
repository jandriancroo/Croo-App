import { useEffect, useState } from 'react';
import React from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useUserRole, type AppRole } from '@/hooks/useUserRole';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { getTodayInPST, getDateInPST } from '@/utils/dateUtils';
import { triggerForceReload, getCurrentAppVersion } from '@/hooks/useForceReload';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  nickname?: string | null;
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

export const getUserStatusDisplay = (user: UserProfile): { label: string; variant: 'default' | 'secondary' | 'outline' } => {
  if (!user.is_active) return { label: 'Inactive', variant: 'secondary' };
  if (!user.first_login_at) return { label: 'Invite Sent', variant: 'outline' };
  return { label: 'Active', variant: 'default' };
};

export const getVersionDisplay = (userVersion: string | null | undefined, currentVersion: string) => {
  if (!userVersion) return { text: 'Unknown', isCurrent: false, className: 'text-muted-foreground' };
  const isCurrent = userVersion === currentVersion;
  return {
    text: userVersion,
    isCurrent,
    className: isCurrent ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
  };
};

export const getRoleDisplayName = (role: AppRole) => {
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

export const useUserManagementData = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isAdmin, isManager, isSuperAdmin, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const canAccessPage = isAdmin || isManager;

  // ── State ──
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
  const [isBulkI9Open, setIsBulkI9Open] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'inactive'>('active');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [updatingOutdated, setUpdatingOutdated] = useState(false);
  const [creatingTestUser, setCreatingTestUser] = useState(false);
  const [testUserCounter, setTestUserCounter] = useState(1);

  // ── Access control redirect ──
  useEffect(() => {
    if (!roleLoading && !canAccessPage) {
      navigate('/dashboard');
      toast({ title: 'Access Denied', description: 'You need manager or admin privileges to access this page.', variant: 'destructive' });
    }
  }, [canAccessPage, roleLoading, navigate, toast]);

  // ── Queries ──
  const { data: users = [], isLoading: loading } = useQuery({
    queryKey: ['user-management-users', currentLocation?.id],
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      const perfStart = performance.now();
      console.log('[UserManagement] fetchUsers started');

      const { data: userLocations } = await supabase
        .from('user_locations').select('user_id').eq('location_id', currentLocation.id);
      const userIds = userLocations?.map(ul => ul.user_id) || [];
      if (userIds.length === 0) return [];

      const [profilesResult, rolesResult, availabilityResult, wageHistoryResult, certificationsResult] = await Promise.all([
        supabase.from('profiles').select(PROFILE_SAFE_COLUMNS).in('id', userIds).order('created_at', { ascending: false }),
        supabase.from('user_roles').select('user_id, role'),
        supabase.from('availability_requests').select('user_id, request_type, hours_requested, status')
          .eq('status', 'approved').gte('start_date', `${new Date().getFullYear()}-01-01`).lte('start_date', `${new Date().getFullYear()}-12-31`),
        // Wages are never selectable from profiles directly — role-checked RPC only.
        supabase.rpc('get_current_wages_batch', { p_user_ids: userIds, p_date: getTodayInPST() }),
        supabase.from('certifications').select('user_id, status, expiration_date')
          .in('user_id', userIds).eq('status', 'approved').gte('expiration_date', getTodayInPST())
      ]);

      if (profilesResult.error) throw profilesResult.error;
      if (rolesResult.error) throw rolesResult.error;
      if (availabilityResult.error) throw availabilityResult.error;

      const hoursByUser = (availabilityResult.data || []).reduce((acc: any, req: any) => {
        if (!acc[req.user_id]) acc[req.user_id] = { paid: 0, unpaid: 0 };
        if (req.request_type === 'paid') acc[req.user_id].paid += req.hours_requested;
        else acc[req.user_id].unpaid += req.hours_requested;
        return acc;
      }, {});

      const wageMap = new Map<string, number>();
      if (wageHistoryResult.data) {
        for (const wh of wageHistoryResult.data) {
          if (!wageMap.has(wh.user_id)) wageMap.set(wh.user_id, wh.hourly_wage);
        }
      }

      const certificationMap = new Map(certificationsResult.data?.map(cert => [cert.user_id, true]) || []);

      const usersWithRoles = profilesResult.data.map((profile) => ({
        ...profile,
        role: rolesResult.data.find((r) => r.user_id === profile.id)?.role as AppRole || 'team_member',
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

  const { data: availableLocations = [] } = useQuery({
    queryKey: ['user-management-locations', user?.id, isSuperAdmin],
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      const select = '*, organizations(name, brand_name, brands(name))';
      const shape = (rows: any[]) => (rows || []).map((l: any) => ({
        ...l,
        org_name: l.organizations?.name || null,
        brand_name: l.organizations?.brand_name || l.organizations?.brands?.name || null,
      }));
      if (isSuperAdmin) {
        const { data, error } = await supabase.from('locations').select(select).order('name', { ascending: true });
        if (error) throw error;
        return shape(data || []);
      }
      const { data: orgMembership } = await supabase.from('organization_members').select('organization_id').eq('user_id', user?.id).single();
      if (orgMembership?.organization_id) {
        const { data, error } = await supabase.from('locations').select(select).eq('organization_id', orgMembership.organization_id).order('name', { ascending: true });
        if (error) throw error;
        return shape(data || []);
      }
      const { data: userLocationIds } = await supabase.from('user_locations').select('location_id').eq('user_id', user?.id);
      if (userLocationIds && userLocationIds.length > 0) {
        const locationIds = userLocationIds.map(ul => ul.location_id);
        const { data, error } = await supabase.from('locations').select(select).in('id', locationIds).order('name', { ascending: true });
        if (error) throw error;
        return shape(data || []);
      }
      return [];
    },
    enabled: canAccessPage && !!user?.id,
  });

  // ── Derived ──
  const currentVersion = getCurrentAppVersion();
  const outdatedUsers = users.filter(u => {
    if (!u.app_version || u.app_version === 'unknown') return false;
    return u.app_version.localeCompare(currentVersion, undefined, { numeric: true }) < 0;
  });

  const canEditUser = (userId: string) => isAdmin ? true : user?.id === userId;

  // ── Handlers ──
  const fetchUsers = () => queryClient.invalidateQueries({ queryKey: ['user-management-users'] });

  const fetchWageHistory = async (userId: string) => {
    try {
      const { data, error } = await supabase.from('wage_history').select('*').eq('user_id', userId).order('effective_date', { ascending: false });
      if (error) throw error;
      setWageHistory(data || []);
    } catch (error: any) {
      console.error('Error fetching wage history:', error);
      toast({ title: 'Error', description: 'Failed to load wage history', variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (viewingWageHistory) fetchWageHistory(viewingWageHistory);
  }, [viewingWageHistory]);

  // Handle opening user profile from navigation state
  useEffect(() => {
    const state = location.state as { viewUserId?: string } | null;
    if (state?.viewUserId && users.length > 0) {
      const u = users.find(usr => usr.id === state.viewUserId);
      if (u) {
        setViewingUser(u);
        setIsProfileDialogOpen(true);
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [location.state, users, navigate, location.pathname]);

  const handleDeleteWageHistory = async (historyId: string) => {
    try {
      const { error } = await supabase.from('wage_history').delete().eq('id', historyId);
      if (error) throw error;
      toast({ title: 'Success', description: 'Wage history entry deleted' });
      if (viewingWageHistory) fetchWageHistory(viewingWageHistory);
    } catch (error: any) {
      console.error('Error deleting wage history:', error);
      toast({ title: 'Error', description: 'Failed to delete wage history entry', variant: 'destructive' });
    }
  };

  const handleRoleChange = async (userId: string, newRole: AppRole) => {
    try {
      await supabase.from('user_roles').delete().eq('user_id', userId);
      const { error } = await supabase.from('user_roles').insert({ user_id: userId, role: newRole });
      if (error) throw error;
      toast({ title: 'Success', description: 'User role updated successfully' });
      fetchUsers();
    } catch (error) {
      console.error('Error updating role:', error);
      toast({ title: 'Error', description: 'Failed to update user role', variant: 'destructive' });
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
    const reader = new FileReader();
    reader.onloadend = () => {
      setTempImageSrc(reader.result as string);
      setCropDialogOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    try {
      setUploadingPhoto(true);
      const fileName = `temp/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage.from('profile-photos').upload(fileName, croppedBlob);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(fileName);
      setInviteProfilePhoto(publicUrl);
      toast({ title: 'Success', description: 'Photo uploaded' });
    } catch (error: any) {
      toast({ title: 'Error', description: 'Failed to upload photo', variant: 'destructive' });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleToggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase.functions.invoke('user-service', { body: { action: 'toggle-status', userId, isActive: !currentStatus } });
      if (error) throw error;
      toast({ title: 'Success', description: `User ${!currentStatus ? 'activated' : 'deactivated'} successfully` });
      fetchUsers();
    } catch (error: any) {
      console.error('Error toggling user status:', error);
      toast({ title: 'Error', description: error.message || 'Failed to update user status', variant: 'destructive' });
    }
  };

  const handleUpdateWage = async () => {
    if (!editingWageUser) return;
    const wageValue = parseFloat(newWage);
    if (isNaN(wageValue) || wageValue < 0) {
      toast({ title: 'Validation Error', description: 'Please enter a valid wage amount', variant: 'destructive' });
      return;
    }
    if (!wageEffectiveDate) {
      toast({ title: 'Validation Error', description: 'Please select an effective date', variant: 'destructive' });
      return;
    }
    try {
      const { error: historyError } = await supabase.from('wage_history').upsert({
        user_id: editingWageUser.id, hourly_wage: wageValue, effective_date: wageEffectiveDate, created_by: user?.id, notes: wageNotes.trim() || null,
      }, { onConflict: 'user_id,effective_date' });
      if (historyError) throw historyError;
      const today = getTodayInPST();
      const isEffectiveNow = wageEffectiveDate <= today;
      if (isEffectiveNow) {
        const { error: profileError } = await supabase.from('profiles').update({ hourly_wage: wageValue }).eq('id', editingWageUser.id);
        if (profileError) throw profileError;
      }
      toast({ title: 'Success', description: isEffectiveNow ? 'Hourly wage updated successfully' : 'Future wage scheduled successfully' });
      setIsWageDialogOpen(false);
      setEditingWageUser(null);
      setNewWage('');
      setWageNotes('');
      setWageEffectiveDate(getTodayInPST());
      fetchUsers();
      if (viewingUser?.id === editingWageUser.id) setViewingUser({ ...viewingUser, hourly_wage: wageValue });
    } catch (error: any) {
      console.error('Error updating wage:', error);
      toast({ title: 'Error', description: error.message || 'Failed to update wage', variant: 'destructive' });
    }
  };

  const handleOpenResendDialog = (u: UserProfile) => {
    setResendUser(u);
    setNewEmail(u.email);
    setIsResendDialogOpen(true);
  };

  const handleResendInvite = async () => {
    if (!resendUser) return;
    try {
      const emailChanged = newEmail.trim() !== resendUser.email;
      if (emailChanged && !newEmail.trim()) {
        toast({ title: 'Validation Error', description: 'Please provide a valid email address.', variant: 'destructive' });
        return;
      }
      const { data, error } = await supabase.functions.invoke('user-service', {
        body: { action: 'resend-invite', userId: resendUser.id, newEmail: emailChanged ? newEmail.trim() : undefined },
      });
      if (error) throw error;
      const response = data as { resetLink?: string | null } | null;
      const resetLink = response?.resetLink ?? null;
      if (resetLink) {
        setResetPasswordLink(resetLink);
        setResetPasswordUserName(resendUser.full_name || resendUser.email || 'User');
        setIsResetPasswordDialogOpen(true);
        toast({ title: 'Invitation link generated', description: emailChanged ? 'Sent to new email (and link is available to copy).' : 'Link is available to copy.' });
      } else {
        toast({ title: 'Success', description: emailChanged ? 'Invitation sent to new email address' : 'Invitation resent successfully' });
      }
      setIsResendDialogOpen(false);
      setResendUser(null);
      setNewEmail('');
      fetchUsers();
    } catch (error: any) {
      console.error('Error resending invite:', error);
      toast({ title: 'Error', description: error.message || 'Failed to resend invitation', variant: 'destructive' });
    }
  };

  const handleResetPassword = async (userId: string, userName: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('user-service', { body: { action: 'resend-invite', userId } });
      if (error) throw error;
      const response = data as { resetLink?: string | null } | null;
      const resetLink = response?.resetLink ?? null;
      if (resetLink) {
        setResetPasswordLink(resetLink);
        setResetPasswordUserName(userName);
        setIsResetPasswordDialogOpen(true);
        toast({ title: 'Success', description: 'Password reset link generated' });
      } else {
        throw new Error('No reset link returned');
      }
    } catch (error: any) {
      console.error('Error generating password reset:', error);
      toast({ title: 'Error', description: error.message || 'Failed to generate password reset link', variant: 'destructive' });
    }
  };

  const handleSetTempPassword = async () => {
    if (!tempPasswordUser || !tempPassword.trim()) return;
    if (tempPassword.length < 6) {
      toast({ title: 'Error', description: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }
    try {
      setSettingTempPassword(true);
      const { data, error } = await supabase.functions.invoke('user-service', {
        body: { action: 'set-password', userId: tempPasswordUser.id, password: tempPassword },
      });
      if (error) throw error;
      toast({ title: 'Success', description: 'Temporary password set. User can now log in and change it.' });
      setIsTempPasswordDialogOpen(false);
      setTempPassword('');
      setTempPasswordUser(null);
    } catch (error: any) {
      console.error('Error setting password:', error);
      toast({ title: 'Error', description: error.message || 'Failed to set password', variant: 'destructive' });
    } finally {
      setSettingTempPassword(false);
    }
  };

  const copyResetLink = async () => {
    try {
      await navigator.clipboard.writeText(resetPasswordLink);
      toast({ title: 'Copied!', description: 'Reset link copied to clipboard' });
    } catch { toast({ title: 'Error', description: 'Failed to copy link', variant: 'destructive' }); }
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteResetLink);
      toast({ title: 'Copied!', description: 'Invite link copied to clipboard' });
    } catch { toast({ title: 'Error', description: 'Failed to copy link', variant: 'destructive' }); }
  };

  const handleCreateTestEmployee = async () => {
    if (!currentLocation) return;
    setCreatingTestUser(true);
    try {
      const testNames = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];
      const testName = testNames[(testUserCounter - 1) % testNames.length];
      const email = `test.${testName.toLowerCase()}${testUserCounter > 10 ? testUserCounter : ''}@example.com`;
      const { data, error } = await supabase.functions.invoke('utility-service?action=create-test-users', {
        body: { location_id: currentLocation.id, single_user: { email, name: `Test Employee ${testName}`, role: 'team_member' } }
      });
      if (error) throw error;
      setTestUserCounter(prev => prev + 1);
      toast({ title: 'Test employee created', description: `Created Test Employee ${testName}` });
      fetchUsers();
    } catch (error: any) {
      console.error('Error creating test employee:', error);
      toast({ title: 'Error', description: error.message || 'Failed to create test employee', variant: 'destructive' });
    } finally {
      setCreatingTestUser(false);
    }
  };

  const handleBulkDeactivate = async () => {
    try {
      setBulkUpdating(true);
      for (const userId of selectedUsers) {
        await supabase.functions.invoke('user-service', { body: { action: 'toggle-status', userId, isActive: false } });
      }
      toast({ title: 'Success', description: `${selectedUsers.size} user(s) deactivated` });
      setSelectedUsers(new Set());
      setIsBulkDeactivateOpen(false);
      fetchUsers();
    } catch (error: any) {
      console.error('Error bulk deactivating:', error);
      toast({ title: 'Error', description: 'Failed to deactivate users', variant: 'destructive' });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleBulkForceUpdate = async () => {
    try {
      setBulkUpdating(true);
      await Promise.all(Array.from(selectedUsers).map(userId => triggerForceReload(userId)));
      toast({ title: 'Update signals sent', description: `Force update triggered for ${selectedUsers.size} user(s). They will refresh when their app is active.` });
      setSelectedUsers(new Set());
    } catch (error: any) {
      console.error('Error bulk force updating:', error);
      toast({ title: 'Error', description: 'Failed to send update signals', variant: 'destructive' });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleUpdateAllOutdated = async () => {
    if (outdatedUsers.length === 0) {
      toast({ title: 'All up to date', description: 'No users are running an outdated version.' });
      return;
    }
    try {
      setUpdatingOutdated(true);
      await Promise.all(outdatedUsers.map(u => triggerForceReload(u.id)));
      toast({ title: 'Update signals sent', description: `Force update triggered for ${outdatedUsers.length} outdated user(s). They will refresh when their app is active.` });
    } catch (error: any) {
      console.error('Error updating outdated users:', error);
      toast({ title: 'Error', description: 'Failed to send update signals', variant: 'destructive' });
    } finally {
      setUpdatingOutdated(false);
    }
  };

  const handleUpdateAllOutdatedGlobal = async () => {
    if (!isSuperAdmin) return;
    try {
      setUpdatingOutdated(true);
      const cv = getCurrentAppVersion();
      const { data: allProfiles } = await supabase
        .from('profiles')
        .select('id, app_version')
        .eq('is_active', true)
        .not('app_version', 'is', null)
        .not('app_version', 'eq', 'unknown');
      
      const globalOutdated = (allProfiles || []).filter(p => 
        p.app_version && p.app_version.localeCompare(cv, undefined, { numeric: true }) < 0
      );
      
      if (globalOutdated.length === 0) {
        toast({ title: 'All up to date', description: 'No users across any location are running an outdated version.' });
        return;
      }
      
      await Promise.all(globalOutdated.map(u => triggerForceReload(u.id)));
      toast({ title: 'Global update sent', description: `Force update triggered for ${globalOutdated.length} user(s) across all locations.` });
    } catch (error: any) {
      console.error('Error global updating:', error);
      toast({ title: 'Error', description: 'Failed to send global update signals', variant: 'destructive' });
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
        await supabase.from('wage_history').upsert({
          user_id: userId, hourly_wage: wage, effective_date: effectiveDateStr, created_by: user?.id, notes: notes.trim() || null,
        }, { onConflict: 'user_id,effective_date' });
        if (isEffectiveNow) {
          await supabase.from('profiles').update({ hourly_wage: wage }).eq('id', userId);
        }
      }
      toast({ title: 'Success', description: isEffectiveNow ? `Wages updated for ${selectedUsers.size} user(s)` : `Future wages scheduled for ${selectedUsers.size} user(s)` });
      setSelectedUsers(new Set());
      setIsBulkWageOpen(false);
      fetchUsers();
    } catch (error: any) {
      console.error('Error bulk updating wages:', error);
      toast({ title: 'Error', description: 'Failed to update wages', variant: 'destructive' });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleInviteUser = async () => {
    if (!inviteEmail.trim() || !inviteFullName.trim()) {
      toast({ title: 'Validation Error', description: 'Please provide both email and full name.', variant: 'destructive' });
      return;
    }
    try {
      setInviting(true);
      const { data, error } = await supabase.functions.invoke('user-service', {
        body: { action: 'invite', email: inviteEmail.trim(), fullName: inviteFullName.trim(), role: inviteRole, profilePhotoUrl: inviteProfilePhoto, locationId: currentLocation?.id },
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
        toast({ title: 'Success', description: `${inviteFullName} has been invited` });
      }
      setInviteFullName('');
    } catch (error: any) {
      console.error('Error inviting user:', error);
      toast({ title: 'Error', description: error.message || 'Failed to invite user', variant: 'destructive' });
    } finally {
      setInviting(false);
    }
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) newSet.delete(userId);
      else newSet.add(userId);
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    const filteredUsers = users.filter(u => u.is_active === (activeTab === 'active'));
    if (selectedUsers.size === filteredUsers.length) setSelectedUsers(new Set());
    else setSelectedUsers(new Set(filteredUsers.map(u => u.id)));
  };

  return {
    // Auth / role
    isAdmin, isManager, isSuperAdmin, roleLoading, canAccessPage, user, currentLocation, navigate,
    canEditUser,
    // Queries
    users, loading, availableLocations, currentVersion, outdatedUsers,
    // Tab / bulk
    activeTab, setActiveTab, bulkMode, setBulkMode, selectedUsers, setSelectedUsers,
    toggleUserSelection, toggleSelectAll,
    bulkUpdating, updatingOutdated,
    // Invite
    inviting, inviteDialogOpen, setInviteDialogOpen, inviteEmail, setInviteEmail,
    inviteFullName, setInviteFullName, inviteRole, setInviteRole,
    inviteProfilePhoto, uploadingPhoto, photoInputRef, handlePhotoUpload,
    handleInviteUser,
    // Crop
    cropDialogOpen, setCropDialogOpen, tempImageSrc, handleCropComplete,
    // Profile dialog
    viewingUser, setViewingUser, isProfileDialogOpen, setIsProfileDialogOpen,
    // Resend
    isResendDialogOpen, setIsResendDialogOpen, resendUser, newEmail, setNewEmail,
    handleOpenResendDialog, handleResendInvite,
    // Reset password
    isResetPasswordDialogOpen, setIsResetPasswordDialogOpen, resetPasswordLink, resetPasswordUserName,
    handleResetPassword, copyResetLink,
    // Invite link
    isInviteLinkDialogOpen, setIsInviteLinkDialogOpen, inviteResetLink, copyInviteLink,
    // Temp password
    isTempPasswordDialogOpen, setIsTempPasswordDialogOpen, tempPasswordUser, setTempPasswordUser,
    tempPassword, setTempPassword, settingTempPassword, handleSetTempPassword,
    // Wage
    isWageDialogOpen, setIsWageDialogOpen, editingWageUser, setEditingWageUser,
    newWage, setNewWage, wageEffectiveDate, setWageEffectiveDate, wageNotes, setWageNotes,
    handleUpdateWage,
    // Wage history
    isWageHistoryDialogOpen, setIsWageHistoryDialogOpen, viewingWageHistory, setViewingWageHistory,
    wageHistory, handleDeleteWageHistory,
    // Bulk actions
    isBulkDeactivateOpen, setIsBulkDeactivateOpen, handleBulkDeactivate,
    isBulkWageOpen, setIsBulkWageOpen, handleBulkWageUpdate,
    isBulkI9Open, setIsBulkI9Open,
    handleBulkForceUpdate, handleUpdateAllOutdated, handleUpdateAllOutdatedGlobal,
    // Test users
    creatingTestUser, handleCreateTestEmployee,
    // Other handlers
    handleRoleChange, handleToggleUserStatus, fetchUsers,
  };
};
