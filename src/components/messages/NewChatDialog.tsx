import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useUserRole, ASSIGNABLE_ROLE_OPTIONS } from '@/hooks/useUserRole';
import { Badge } from '@/components/ui/badge';
import { Users, ChevronDown, ChevronUp } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  role?: string;
}

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChatCreated: (chatId: string) => void;
  canCreateGroup: boolean;
  locationId?: string;
  locationName?: string;
}

const ROLE_OPTIONS = ASSIGNABLE_ROLE_OPTIONS;

export function NewChatDialog({ open, onOpenChange, onChatCreated, canCreateGroup, locationId, locationName }: NewChatDialogProps) {
  const { isSuperAdmin, isOrgAdmin, isAdmin } = useUserRole();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [chatTitle, setChatTitle] = useState('');
  const [isGroup, setIsGroup] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showIndividualSelection, setShowIndividualSelection] = useState(false);

  useEffect(() => {
    if (open) {
      fetchProfiles();
      setSelectedUsers([]);
      setSelectedRoles([]);
      setShowIndividualSelection(false);
    }
  }, [open, isSuperAdmin, isOrgAdmin, locationId]);

  const fetchProfiles = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // For location-scoped chat, only get users at that location
      if (locationId) {
        const { data: locationUsers } = await supabase
          .from('user_locations')
          .select('user_id')
          .eq('location_id', locationId);

        const userIds = locationUsers?.map(u => u.user_id) || [];
        
        if (userIds.length === 0) {
          setProfiles([]);
          return;
        }

        const { data: profileData, error } = await supabase
          .from('profiles')
          .select('id, full_name, profile_photo_url')
          .eq('is_active', true)
          .eq('appears_on_schedule', true)
          .neq('id', user.id)
          .in('id', userIds)
          .order('full_name');

        if (error) throw error;

        // Get roles for these users
        const { data: roles } = await supabase
          .from('user_roles')
          .select('user_id, role');

        const profilesWithRoles = (profileData || []).map(p => ({
          ...p,
          role: roles?.find(r => r.user_id === p.id)?.role || 'team_member'
        }));

        setProfiles(profilesWithRoles);
        return;
      }

      // Fallback for super admins without location context
      if (isSuperAdmin) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, profile_photo_url')
          .eq('is_active', true)
          .eq('appears_on_schedule', true)
          .neq('id', user.id)
          .order('full_name');

        if (error) throw error;
        
        const { data: roles } = await supabase
          .from('user_roles')
          .select('user_id, role');

        const profilesWithRoles = (data || []).map(p => ({
          ...p,
          role: roles?.find(r => r.user_id === p.id)?.role || 'team_member'
        }));

        setProfiles(profilesWithRoles);
        return;
      }

      setProfiles([]);
    } catch (error: any) {
      console.error('Error fetching profiles:', error);
      toast.error('Failed to load users');
    }
  };

  // Get final recipient list based on role selection + individual selection
  const getFinalRecipients = (): string[] => {
    const recipients = new Set<string>();
    
    // Add users matching selected roles
    if (selectedRoles.length > 0) {
      profiles
        .filter(p => selectedRoles.includes(p.role || 'team_member'))
        .forEach(p => recipients.add(p.id));
    }
    
    // Add individually selected users
    selectedUsers.forEach(id => recipients.add(id));
    
    return Array.from(recipients);
  };

  const handleSelectAllAtLocation = () => {
    setSelectedUsers(profiles.map(p => p.id));
    setSelectedRoles([]);
  };

  const toggleRole = (role: string) => {
    setSelectedRoles(prev =>
      prev.includes(role)
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  const handleCreate = async () => {
    const recipients = isGroup ? getFinalRecipients() : selectedUsers;
    
    if (recipients.length === 0) {
      toast.error('Please select at least one user');
      return;
    }

    if (isGroup && !chatTitle.trim()) {
      toast.error('Please enter a chat title');
      return;
    }

    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create chat
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .insert({
          title: isGroup ? chatTitle.trim() : null,
          is_group: isGroup,
          created_by: user.id,
          location_id: locationId || null,
        })
        .select()
        .single();

      if (chatError) throw chatError;

      // Add members (including creator)
      const members = [...recipients, user.id].map(userId => ({
        chat_id: chat.id,
        user_id: userId,
      }));

      const { error: membersError } = await supabase
        .from('chat_members')
        .insert(members);

      if (membersError) throw membersError;

      toast.success('Chat created');
      onChatCreated(chat.id);
      
      // Reset form
      setSelectedUsers([]);
      setSelectedRoles([]);
      setChatTitle('');
      setIsGroup(false);
    } catch (error: any) {
      console.error('Error creating chat:', error);
      toast.error('Failed to create chat');
    } finally {
      setCreating(false);
    }
  };

  const toggleUser = (userId: string) => {
    setSelectedUsers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const deselectAll = () => {
    setSelectedUsers([]);
    setSelectedRoles([]);
  };

  const totalUserCount = profiles.length;
  const selectedCount = getFinalRecipients().length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Chat</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {canCreateGroup && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="group"
                checked={isGroup}
                onCheckedChange={(checked) => setIsGroup(checked as boolean)}
              />
              <Label htmlFor="group">Create group chat</Label>
            </div>
          )}

          {isGroup && (
            <div className="space-y-2">
              <Label htmlFor="title">Group Name</Label>
              <Input
                id="title"
                value={chatTitle}
                onChange={(e) => setChatTitle(e.target.value)}
                placeholder="Enter group name"
              />
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Select Users {isGroup && `(${selectedCount} selected)`}</Label>
              {isGroup && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={deselectAll}
                >
                  Clear
                </Button>
              )}
            </div>

            {/* Group chat: Show role selection and all-at-location option */}
            {isGroup && (isAdmin || isOrgAdmin || isSuperAdmin) && (
              <>
                {/* Quick Select: All at Location */}
                <Button
                  type="button"
                  variant={selectedCount === totalUserCount ? 'default' : 'outline'}
                  className="w-full justify-start gap-2"
                  onClick={handleSelectAllAtLocation}
                >
                  <Users className="h-4 w-4" />
                  All at {locationName || 'Location'} ({totalUserCount})
                </Button>

                {/* Role Selection */}
                <div className="space-y-2">
                  <Label className="text-sm">Or select by role:</Label>
                  <div className="flex flex-wrap gap-2">
                    {ROLE_OPTIONS.map(role => {
                      const count = profiles.filter(p => p.role === role.value).length;
                      if (count === 0) return null;
                      return (
                        <Badge
                          key={role.value}
                          variant={selectedRoles.includes(role.value) ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => toggleRole(role.value)}
                        >
                          {role.label} ({count})
                        </Badge>
                      );
                    })}
                  </div>
                </div>

                {/* Individual Selection (Collapsible for groups) */}
                <Collapsible open={showIndividualSelection} onOpenChange={setShowIndividualSelection}>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between"
                    >
                      Select individual users
                      {showIndividualSelection ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border rounded-lg max-h-40 overflow-y-auto mt-2">
                      {profiles.map((profile) => (
                        <label
                          key={profile.id}
                          className="flex items-center gap-3 p-2 hover:bg-muted cursor-pointer transition-colors"
                        >
                          <Checkbox
                            checked={selectedUsers.includes(profile.id) || selectedRoles.includes(profile.role || 'team_member')}
                            onCheckedChange={() => toggleUser(profile.id)}
                          />
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={profile.profile_photo_url || undefined} />
                            <AvatarFallback className="text-xs">
                              {profile.full_name?.charAt(0) || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <span className="flex-1 text-sm">{profile.full_name}</span>
                          <span className="text-xs text-muted-foreground capitalize">{profile.role?.replace('_', ' ')}</span>
                        </label>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}

            {/* DM or non-admin group: Simple list */}
            {(!isGroup || (!isAdmin && !isOrgAdmin && !isSuperAdmin)) && (
              <div className="border rounded-lg max-h-60 overflow-y-auto">
                {profiles.map((profile) => (
                  <label
                    key={profile.id}
                    className="flex items-center gap-3 p-3 hover:bg-muted cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedUsers.includes(profile.id)}
                      onCheckedChange={() => toggleUser(profile.id)}
                    />
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={profile.profile_photo_url || undefined} />
                      <AvatarFallback>
                        {profile.full_name?.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1">{profile.full_name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating...' : 'Create Chat'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
