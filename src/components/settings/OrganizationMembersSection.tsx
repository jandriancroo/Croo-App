import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Shield, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface OrganizationMembersSectionProps {
  organizationId: string;
}

export function OrganizationMembersSection({ organizationId }: OrganizationMembersSectionProps) {
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Fetch existing org admins
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['organization-members', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_members')
        .select(`
          id,
          org_role,
          user_id,
          profiles:user_id (
            id,
            full_name,
            email,
            profile_photo_url
          )
        `)
        .eq('organization_id', organizationId);
      if (error) throw error;
      return data;
    },
  });

  // Fetch eligible users: admins (or higher) assigned to any location in this org, not already org admins
  const { data: availableUsers = [] } = useQuery({
    queryKey: ['available-org-admins', organizationId, members.length],
    queryFn: async () => {
      // Get all locations in this org
      const { data: orgLocations, error: locErr } = await supabase
        .from('locations')
        .select('id')
        .eq('organization_id', organizationId);
      if (locErr) throw locErr;
      if (!orgLocations?.length) return [];

      const locationIds = orgLocations.map(l => l.id);

      // Get users assigned to any of these locations
      const { data: userLocs, error: ulErr } = await supabase
        .from('user_locations')
        .select('user_id')
        .in('location_id', locationIds);
      if (ulErr) throw ulErr;

      const uniqueUserIds = [...new Set(userLocs?.map(ul => ul.user_id) || [])];
      if (!uniqueUserIds.length) return [];

      // Get users who have admin-level roles
      const { data: adminRoles, error: roleErr } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('user_id', uniqueUserIds)
        .in('role', ['admin', 'org_admin', 'brand_admin', 'super_admin']);
      if (roleErr) throw roleErr;

      const adminUserIds = [...new Set(adminRoles?.map(r => r.user_id) || [])];
      if (!adminUserIds.length) return [];

      // Filter out already-added org admins
      const existingIds = members.map(m => m.user_id);
      const eligibleIds = adminUserIds.filter(id => !existingIds.includes(id));
      if (!eligibleIds.length) return [];

      // Fetch profiles
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, profile_photo_url')
        .in('id', eligibleIds)
        .eq('is_active', true)
        .order('full_name');
      if (profErr) throw profErr;

      return profiles || [];
    },
  });

  const handleAddOrgAdmin = async () => {
    if (!selectedUserId) {
      toast.error('Please select a user');
      return;
    }

    setIsAdding(true);
    try {
      // 1. Add to organization_members as admin
      const { error: insertErr } = await supabase
        .from('organization_members')
        .insert({
          organization_id: organizationId,
          user_id: selectedUserId,
          org_role: 'admin',
        });
      if (insertErr) throw insertErr;

      // 2. Auto-assign to ALL org locations with show_on_schedule = false
      const { data: orgLocations } = await supabase
        .from('locations')
        .select('id')
        .eq('organization_id', organizationId);

      if (orgLocations?.length) {
        const assignments = orgLocations.map(loc => ({
          user_id: selectedUserId,
          location_id: loc.id,
          show_on_schedule: false,
        }));

        // Use upsert to skip locations they're already assigned to
        const { error: locErr } = await supabase
          .from('user_locations')
          .upsert(assignments, { onConflict: 'user_id,location_id', ignoreDuplicates: true });
        if (locErr) {
          console.warn('Some location assignments may have failed:', locErr);
        }
      }

      // 3. Update their app role to org_admin if not already higher
      const { data: currentRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', selectedUserId)
        .single();

      const higherRoles = ['org_admin', 'brand_admin', 'super_admin'];
      if (currentRole && !higherRoles.includes(currentRole.role)) {
        await supabase
          .from('user_roles')
          .update({ role: 'org_admin' })
          .eq('user_id', selectedUserId);
      }

      toast.success('Org Admin added — assigned to all locations');
      queryClient.invalidateQueries({ queryKey: ['organization-members', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['available-org-admins', organizationId] });
      setIsAddDialogOpen(false);
      setSelectedUserId('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to add org admin');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    setRemovingId(memberId);
    try {
      const { error } = await supabase
        .from('organization_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

      toast.success('Org Admin removed');
      queryClient.invalidateQueries({ queryKey: ['organization-members', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['available-org-admins', organizationId] });
    } catch (error: any) {
      toast.error(error.message || 'Failed to remove org admin');
    } finally {
      setRemovingId(null);
    }
  };

  const getInitials = (name: string | null) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 pb-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Shield className="h-4 w-4 flex-shrink-0" />
          <span className="text-base font-semibold truncate">Org Admins</span>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="icon" className="flex-shrink-0 h-8 w-8">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Org Admin</DialogTitle>
              <DialogDescription>
                Select from existing Admins across this organization's locations. They'll automatically get access to all locations (hidden from schedules by default).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Admin</label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an admin" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        <div className="flex items-center gap-2">
                          <span>{user.full_name || user.email}</span>
                        </div>
                      </SelectItem>
                    ))}
                    {availableUsers.length === 0 && (
                      <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                        No eligible admins found
                      </div>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Only users with Admin role or higher at an org location are shown
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddOrgAdmin} disabled={isAdding || !selectedUserId}>
                  {isAdding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add Org Admin
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {members.length} org admin{members.length !== 1 ? 's' : ''}
      </p>
      <div className="space-y-2">
        {membersLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No org admins yet. Promote existing Admins to give them org-wide access.
          </p>
        ) : (
          members.map((member) => {
            const profile = member.profiles as any;
            return (
              <div
                key={member.id}
                className="flex items-center gap-2 p-2 rounded-lg border bg-card w-full overflow-hidden"
              >
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarImage src={profile?.profile_photo_url || ''} />
                  <AvatarFallback className="text-xs">
                    {getInitials(profile?.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="text-sm font-medium truncate">
                    {profile?.full_name || 'Unknown'}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-xs text-muted-foreground px-2">Org Admin</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive flex-shrink-0"
                    onClick={() => handleRemoveMember(member.id)}
                    disabled={removingId === member.id}
                  >
                    {removingId === member.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
