import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { EmployeeRecordsSection } from '@/components/users/EmployeeRecordsSection';
import { EmployeeNewPinField } from '@/components/users/EmployeeNewPinField';
import { I9DocumentsSection } from '@/components/users/I9DocumentsSection';
import { I9RequestDialog } from '@/components/users/I9RequestDialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth';
import { useUserRole, type AppRole } from '@/hooks/useUserRole';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { getTodayInPST } from '@/utils/dateUtils';
import {
  Camera,
  CalendarIcon,
  Loader2,
  Key,
  FileText,
  Trash2,
  User,
  UserCog,
  Shield,
} from 'lucide-react';

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
  role?: AppRole;
  paid_hours?: number;
  unpaid_hours?: number;
  hourly_wage?: number;
}

interface EmployeeProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserProfile | null;
  availableLocations: { id: string; name: string; org_name?: string | null; brand_name?: string | null }[];
  currentLocationId?: string;
  onUserUpdated: () => void;
  onResetPassword: (userId: string, userName: string) => void;
  onSetTempPassword: (user: UserProfile) => void;
  onOpenWageDialog: (user: UserProfile) => void;
  onOpenWageHistory: (userId: string) => void;
  onResendInvite: (user: UserProfile) => void;
}

const parseDateOnlyToLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const RESERVED_MASTER_PIN = '0223';

const getRoleIcon = (role: AppRole) => {
  switch (role) {
    case 'super_admin':
    case 'brand_admin':
    case 'org_admin':
    case 'admin':
      return <Shield className="h-3 w-3" />;
    case 'manager':
    case 'shift_manager':
    case 'shift_manager_in_training':
      return <UserCog className="h-3 w-3" />;
    default:
      return <User className="h-3 w-3" />;
  }
};

const getRoleBadgeVariant = (role: AppRole): 'default' | 'secondary' | 'outline' | 'destructive' => {
  switch (role) {
    case 'super_admin':
      return 'destructive';
    case 'brand_admin':
    case 'org_admin':
    case 'admin':
      return 'default';
    case 'manager':
    case 'shift_manager':
    case 'shift_manager_in_training':
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
    shift_manager_in_training: 'Shift Manager in Training',
    team_member: 'Team Member',
  };
  return names[role] || String(role).replace('_', ' ');
};

const getUserStatusDisplay = (user: UserProfile): { label: string; variant: 'default' | 'secondary' | 'outline' } => {
  if (!user.is_active) {
    return { label: 'Inactive', variant: 'secondary' };
  }
  if (!user.first_login_at) {
    return { label: 'Invite Sent', variant: 'outline' };
  }
  return { label: 'Active', variant: 'default' };
};

export function EmployeeProfileDialog({
  open,
  onOpenChange,
  user,
  availableLocations,
  currentLocationId,
  onUserUpdated,
  onResetPassword,
  onSetTempPassword,
  onOpenWageDialog,
  onOpenWageHistory,
  onResendInvite,
}: EmployeeProfileDialogProps) {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const { isAdmin, isManager } = useUserRole();
  const queryClient = useQueryClient();
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [fullName, setFullName] = useState('');
  const [nickname, setNickname] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [birthday, setBirthday] = useState<Date | undefined>();
  const [employeePin, setEmployeePin] = useState('');
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [role, setRole] = useState<AppRole>('team_member');
  const [appearsOnSchedule, setAppearsOnSchedule] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [userLocations, setUserLocations] = useState<string[]>([]);
  const [locationScheduleVisibility, setLocationScheduleVisibility] = useState<Record<string, boolean>>({});
  const [allLocationsEnabled, setAllLocationsEnabled] = useState(false);

  // Notes state
  const [employeeNotes, setEmployeeNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // UI state
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [tempImageSrc, setTempImageSrc] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [i9RequestOpen, setI9RequestOpen] = useState(false);

  // Initialize form when user changes
  useEffect(() => {
    if (user && open) {
      setFullName(user.full_name || '');
      setNickname((user as any).nickname || '');
      setPhoneNumber(user.phone_number || '');
      setBirthday(user.birthday ? parseDateOnlyToLocalDate(user.birthday) : undefined);
      // Legacy 4-digit PIN is not readable from `profiles` — admin-only RPC.
      setEmployeePin('');
      supabase
        .rpc('admin_get_employee_pin', { _user_id: user.id })
        .then(({ data }) => setEmployeePin((data as string) || ''));
      setProfilePhotoUrl(user.profile_photo_url);
      setRole(user.role || 'team_member');
      setAppearsOnSchedule(user.appears_on_schedule);
      setIsActive(user.is_active);
      setHasChanges(false);

      // Fetch locations and notes
      fetchUserLocations(user.id);
      fetchEmployeeNotes(user.id);
    }
  }, [user, open]);

  const fetchUserLocations = async (userId: string) => {
    try {
      const [locResult, profileResult] = await Promise.all([
        supabase
          .from('user_locations')
          .select('location_id, show_on_schedule')
          .eq('user_id', userId),
        supabase
          .from('profiles')
          .select('all_locations_enabled')
          .eq('id', userId)
          .single()
      ]);

      if (locResult.error) throw locResult.error;
      setUserLocations(locResult.data?.map(ul => ul.location_id) || []);
      const visibilityMap: Record<string, boolean> = {};
      locResult.data?.forEach(ul => {
        visibilityMap[ul.location_id] = ul.show_on_schedule !== false;
      });
      setLocationScheduleVisibility(visibilityMap);
      setAllLocationsEnabled(profileResult.data?.all_locations_enabled || false);
    } catch (error) {
      console.error('Error fetching user locations:', error);
      setUserLocations([]);
      setAllLocationsEnabled(false);
    }
  };

  const fetchEmployeeNotes = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('employee_notes')
        .select(`*, creator:created_by(full_name)`)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setEmployeeNotes(data || []);
    } catch (error) {
      console.error('Error fetching employee notes:', error);
    }
  };

  const canEditUser = (userId: string) => {
    if (isAdmin) return true;
    return currentUser?.id === userId;
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    if (!user) return;

    try {
      setUploadingPhoto(true);
      const fileName = `${user.id}/${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(fileName, croppedBlob);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(fileName);

      setProfilePhotoUrl(publicUrl);
      setHasChanges(true);
      toast({ title: 'Photo uploaded' });
    } catch (error: any) {
      toast({ title: 'Error', description: 'Failed to upload photo', variant: 'destructive' });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRoleChange = async (newRole: AppRole) => {
    if (!user) return;

    try {
      await supabase.from('user_roles').delete().eq('user_id', user.id);
      const { error } = await supabase.from('user_roles').insert({ user_id: user.id, role: newRole });
      if (error) throw error;

      setRole(newRole);
      toast({ title: 'Role updated' });
    } catch (error) {
      console.error('Error updating role:', error);
      toast({ title: 'Error', description: 'Failed to update role', variant: 'destructive' });
    }
  };

  const handleToggleStatus = async () => {
    if (!user) return;

    try {
      const { error } = await supabase.functions.invoke('user-service', {
        body: { action: 'toggle-status', userId: user.id, isActive: !isActive },
      });

      if (error) throw error;

      setIsActive(!isActive);
      toast({ title: `User ${!isActive ? 'activated' : 'deactivated'}` });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleToggleScheduleVisibility = async () => {
    if (!user) return;

    try {
      const newValue = !appearsOnSchedule;

      if (!newValue) {
        const today = new Date().toISOString().split('T')[0];
        await supabase
          .from('scheduled_shifts')
          .delete()
          .eq('user_id', user.id)
          .gte('shift_date', today);
      }

      const { error } = await supabase
        .from('profiles')
        .update({ appears_on_schedule: newValue })
        .eq('id', user.id);

      if (error) throw error;

      setAppearsOnSchedule(newValue);
      toast({ title: newValue ? 'Visible on schedule' : 'Hidden from schedule' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleAddNote = async () => {
    if (!user || !newNote.trim()) return;

    try {
      setAddingNote(true);
      const { error } = await supabase.from('employee_notes').insert({
        user_id: user.id,
        note: newNote.trim(),
        created_by: currentUser?.id,
      });

      if (error) throw error;

      setNewNote('');
      fetchEmployeeNotes(user.id);
      toast({ title: 'Note added' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setAddingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const { error } = await supabase.from('employee_notes').delete().eq('id', noteId);
      if (error) throw error;
      setEmployeeNotes(employeeNotes.filter(n => n.id !== noteId));
      toast({ title: 'Note deleted' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleSave = async () => {
    if (!user || !fullName.trim()) {
      toast({ title: 'Error', description: 'Name is required', variant: 'destructive' });
      return;
    }

    if (employeePin.trim() === RESERVED_MASTER_PIN) {
      toast({ title: 'Error', description: 'This PIN is reserved', variant: 'destructive' });
      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          nickname: nickname.trim() || null,
          profile_photo_url: profilePhotoUrl,
          phone_number: phoneNumber.trim() || null,
          birthday: birthday ? format(birthday, 'yyyy-MM-dd') : null,
          employee_pin: employeePin.trim() || null,
          all_locations_enabled: allLocationsEnabled,
        })
        .eq('id', user.id);

      if (error) throw error;

      // Update location assignments
      await supabase.from('user_locations').delete().eq('user_id', user.id);

      if (userLocations.length > 0) {
        const { error: insertError } = await supabase
          .from('user_locations')
          .insert(userLocations.map(locationId => ({ 
            user_id: user.id, 
            location_id: locationId,
            show_on_schedule: locationScheduleVisibility[locationId] !== false
          })));

        if (insertError) throw insertError;
      }

      toast({ title: 'Profile saved' });
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['schedule-stable'] });
      onUserUpdated();
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  const canEdit = canEditUser(user.id);
  const statusDisplay = getUserStatusDisplay(user);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0 pb-4 border-b border-border">
            <DialogTitle className="text-lg">Employee Profile</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto overscroll-contain py-4 space-y-6">
            {/* Header with Avatar and Basic Info */}
            <div className="flex items-start gap-4">
              <div className="relative">
                <Avatar className="h-20 w-20 ring-2 ring-border">
                  <AvatarImage src={profilePhotoUrl || undefined} />
                  <AvatarFallback className="text-2xl bg-muted text-muted-foreground">
                    {fullName?.charAt(0) || user.email.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {canEdit && (
                  <>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full p-0"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={uploadingPhoto}
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={getRoleBadgeVariant(role)} className="gap-1">
                    {getRoleIcon(role)}
                    {getRoleDisplayName(role)}
                  </Badge>
                  <Badge variant={statusDisplay.variant}>{statusDisplay.label}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{user.email}</p>
                <p className="text-xs text-muted-foreground">
                  Member since {new Date(user.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>

            {/* Editable Fields */}
            <div className="grid gap-4">
              {/* Name */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground">Full Name</Label>
                <Input
                  value={fullName}
                  onChange={(e) => { setFullName(e.target.value); setHasChanges(true); }}
                  disabled={!canEdit}
                  className="bg-background"
                />
              </div>

              {/* Nickname */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground">Nickname</Label>
                <Input
                  value={nickname}
                  onChange={(e) => { setNickname(e.target.value); setHasChanges(true); }}
                  disabled={!canEdit}
                  placeholder="Preferred first name (optional)"
                  className="bg-background"
                />
                <p className="text-xs text-muted-foreground">If set, replaces first name in display</p>
              </div>

              {/* Phone & Birthday Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Phone Number</Label>
                  <Input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => { setPhoneNumber(e.target.value); setHasChanges(true); }}
                    disabled={!canEdit}
                    placeholder="(555) 123-4567"
                    className="bg-background"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Birthday</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={!canEdit}
                        className={cn(
                          "w-full justify-start text-left font-normal bg-background",
                          !birthday && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {birthday ? format(birthday, "PPP") : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 z-[200]" align="start">
                      <Calendar
                        mode="single"
                        selected={birthday}
                        onSelect={(date) => { setBirthday(date); setHasChanges(true); }}
                        disabled={(date) => date > new Date()}
                        captionLayout="dropdown-buttons"
                        fromYear={1940}
                        toYear={new Date().getFullYear()}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* PIN & Wage Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Punch Clock PIN</Label>
                  <Input
                    type="text"
                    maxLength={4}
                    value={employeePin}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '');
                      setEmployeePin(value);
                      setHasChanges(true);
                    }}
                    disabled={!canEdit}
                    placeholder="0000"
                    className="text-center tracking-widest font-mono bg-background"
                  />
                  <p className="text-xs text-muted-foreground">4-digit PIN for punch clock</p>
                </div>

                <EmployeeNewPinField userId={user.id} />


                {(isAdmin || currentUser?.id === user.id) && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">Hourly Wage</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-10 px-3 flex items-center border rounded-md bg-muted/50 text-foreground font-semibold">
                        ${user.hourly_wage?.toFixed(2) || '15.00'}/hr
                      </div>
                      {isAdmin && (
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenWageDialog(user)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenWageHistory(user.id)}
                          >
                            History
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Hours Info (Read-only) */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-muted/50 border border-border">
                  <Label className="text-xs text-muted-foreground">Paid Hours (YTD)</Label>
                  <p className="text-lg font-semibold text-foreground">{user.paid_hours || 0}h</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 border border-border">
                  <Label className="text-xs text-muted-foreground">Unpaid Hours (YTD)</Label>
                  <p className="text-lg font-semibold text-foreground">{user.unpaid_hours || 0}h</p>
                </div>
              </div>


              {/* Admin Actions */}
              {isAdmin && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium text-foreground">Admin Controls</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={role} onValueChange={handleRoleChange}>
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="team_member">Team Member</SelectItem>
                        <SelectItem value="shift_manager_in_training">Shift Manager in Training</SelectItem>
                        <SelectItem value="shift_manager">Shift Manager</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="org_admin">Org Admin</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button variant="outline" onClick={handleToggleStatus}>
                      {isActive ? 'Deactivate' : 'Activate'}
                    </Button>

                    <Button variant="outline" onClick={() => { onOpenChange(false); onResendInvite(user); }}>
                      Re-invite
                    </Button>

                    <Button variant="outline" onClick={() => { onOpenChange(false); onResetPassword(user.id, user.full_name || user.email); }}>
                      <Key className="h-4 w-4 mr-2" />
                      Reset Password
                    </Button>

                    <Button variant="outline" onClick={() => { onOpenChange(false); onSetTempPassword(user); }}>
                      <Key className="h-4 w-4 mr-2" />
                      Set Temp Password
                    </Button>
                  </div>
                </div>
              )}

              {/* Location Access */}
              {availableLocations.length > 0 && isAdmin && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-foreground">Location Access</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">All Locations</span>
                      <Switch
                        checked={allLocationsEnabled}
                        onCheckedChange={(checked) => { setAllLocationsEnabled(checked); setHasChanges(true); }}
                      />
                    </div>
                  </div>

                  {!allLocationsEnabled && (
                    <div className="border border-border rounded-lg p-3 space-y-2 bg-background">
                      {(() => {
                        const nameCounts = availableLocations.reduce<Record<string, number>>((acc, l) => {
                          acc[l.name] = (acc[l.name] || 0) + 1;
                          return acc;
                        }, {});
                        return availableLocations.map((location) => {
                          const isDupe = (nameCounts[location.name] || 0) > 1;
                          const subtitle = location.brand_name || location.org_name;
                          return (
                        <div key={location.id} className="flex items-center justify-between gap-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={`loc-${location.id}`}
                              checked={userLocations.includes(location.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setUserLocations([...userLocations, location.id]);
                                  setLocationScheduleVisibility(prev => ({ ...prev, [location.id]: true }));
                                } else {
                                  setUserLocations(userLocations.filter(id => id !== location.id));
                                }
                                setHasChanges(true);
                              }}
                            />
                            <label htmlFor={`loc-${location.id}`} className="text-sm text-foreground cursor-pointer">
                              {location.name}
                              {isDupe && subtitle && (
                                <span className="ml-2 text-xs text-muted-foreground">· {subtitle}</span>
                              )}
                            </label>
                          </div>
                          {userLocations.includes(location.id) && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-muted-foreground">On Schedule</span>
                              <Switch
                                className="scale-75"
                                checked={locationScheduleVisibility[location.id] !== false}
                                onCheckedChange={(checked) => {
                                  setLocationScheduleVisibility(prev => ({ ...prev, [location.id]: checked }));
                                  setHasChanges(true);
                                }}
                              />
                            </div>
                          )}
                        </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
              )}

              {/* Employee Notes */}
              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Employee Notes
                  </Label>
                  <span className="text-xs text-muted-foreground">Admin/Manager Only</span>
                </div>

                <div className="flex gap-2">
                  <Textarea
                    placeholder="Add a note..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    className="min-h-[60px] flex-1 bg-background"
                  />
                  <Button
                    onClick={handleAddNote}
                    disabled={addingNote || !newNote.trim()}
                    size="sm"
                    className="self-end"
                  >
                    Add
                  </Button>
                </div>

                <div className="space-y-2 max-h-[150px] overflow-y-auto">
                  {employeeNotes.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">No notes yet</p>
                  ) : (
                    employeeNotes.map((note) => (
                      <div key={note.id} className="p-2 border border-border rounded bg-muted/30 text-xs space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex-1 text-foreground">{note.note}</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteNote(note.id)}
                            className="h-5 w-5 p-0"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-muted-foreground">
                          {note.creator?.full_name || 'Unknown'} • {new Date(note.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Employee Records (Corrective Actions + Signed Documents) */}
              {user && <EmployeeRecordsSection userId={user.id} employeeName={user.full_name || user.email} />}

              {/* Hiring Documents Section */}
              {user && canEdit && (
                <>
                  <I9DocumentsSection userId={user.id} employeeName={user.full_name || user.email} />
                  <div className="pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => setI9RequestOpen(true)}
                    >
                      <Shield className="h-4 w-4" />
                      Request Hiring Documents
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Save Button */}
          {canEdit && (
            <div className="flex-shrink-0 pt-4 border-t border-border">
              <Button
                className="w-full"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ImageCropDialog
        open={cropDialogOpen}
        onOpenChange={setCropDialogOpen}
        imageSrc={tempImageSrc}
        onCropComplete={handleCropComplete}
      />

      {user && (
        <I9RequestDialog
          open={i9RequestOpen}
          onOpenChange={setI9RequestOpen}
          employee={{ id: user.id, full_name: user.full_name || user.email }}
        />
      )}
    </>
  );
}
