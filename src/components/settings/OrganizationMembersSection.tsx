import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Users, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface OrganizationMembersSectionProps {
  organizationId: string;
}

export function OrganizationMembersSection({ organizationId }: OrganizationMembersSectionProps) {
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState('member');
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Fetch existing organization members
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

  // Fetch all users who are NOT already members of this organization
  const { data: availableUsers = [] } = useQuery({
    queryKey: ['available-users-for-org', organizationId],
    queryFn: async () => {
      // Get all profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, email, profile_photo_url')
        .eq('is_active', true)
        .order('full_name');
      if (profilesError) throw profilesError;

      // Filter out users who are already members
      const memberUserIds = members.map(m => m.user_id);
      return profiles.filter(p => !memberUserIds.includes(p.id));
    },
    enabled: members.length >= 0, // Re-run when members change
  });

  const handleAddMember = async () => {
    if (!selectedUserId) {
      toast.error('Please select a user');
      return;
    }

    setIsAdding(true);
    try {
      const { error } = await supabase
        .from('organization_members')
        .insert({
          organization_id: organizationId,
          user_id: selectedUserId,
          org_role: selectedRole,
        });

      if (error) throw error;

      toast.success('Member added to organization');
      queryClient.invalidateQueries({ queryKey: ['organization-members', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['available-users-for-org', organizationId] });
      setIsAddDialogOpen(false);
      setSelectedUserId('');
      setSelectedRole('member');
    } catch (error: any) {
      toast.error(error.message || 'Failed to add member');
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

      toast.success('Member removed from organization');
      queryClient.invalidateQueries({ queryKey: ['organization-members', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['available-users-for-org', organizationId] });
    } catch (error: any) {
      toast.error(error.message || 'Failed to remove member');
    } finally {
      setRemovingId(null);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    try {
      const { error } = await supabase
        .from('organization_members')
        .update({ org_role: newRole })
        .eq('id', memberId);

      if (error) throw error;

      toast.success('Role updated');
      queryClient.invalidateQueries({ queryKey: ['organization-members', organizationId] });
    } catch (error: any) {
      toast.error(error.message || 'Failed to update role');
    }
  };

  const getInitials = (name: string | null) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-2 pb-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Users className="h-4 w-4 flex-shrink-0" />
          <span className="text-base font-semibold truncate">Organization Members</span>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="icon" className="flex-shrink-0 h-8 w-8">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Organization Member</DialogTitle>
              <DialogDescription>
                Select a user to add to this organization and assign their role.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">User</label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a user" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        <div className="flex items-center gap-2">
                          <span>{user.full_name || user.email}</span>
                          {user.full_name && (
                            <span className="text-muted-foreground text-xs">({user.email})</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                    {availableUsers.length === 0 && (
                      <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                        No available users to add
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Organization Role</label>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Admins can manage all locations within this organization
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddMember} disabled={isAdding || !selectedUserId}>
                  {isAdding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add Member
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {members.length} member{members.length !== 1 ? 's' : ''} in this organization
      </p>
      <div className="space-y-2">
        {membersLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No members yet. Add users to give them access to this organization.
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
                  <div className="text-xs text-muted-foreground truncate">
                    {profile?.email}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Select
                    value={member.org_role}
                    onValueChange={(value) => handleRoleChange(member.id, value)}
                  >
                    <SelectTrigger className="w-[70px] h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
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

