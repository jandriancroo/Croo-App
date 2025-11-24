import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChatCreated: (chatId: string) => void;
  canCreateGroup: boolean;
}

export function NewChatDialog({ open, onOpenChange, onChatCreated, canCreateGroup }: NewChatDialogProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [chatTitle, setChatTitle] = useState('');
  const [isGroup, setIsGroup] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      fetchProfiles();
    }
  }, [open]);

  const fetchProfiles = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .eq('is_active', true)
        .neq('id', user.id);

      if (error) throw error;
      setProfiles(data || []);
    } catch (error: any) {
      console.error('Error fetching profiles:', error);
      toast.error('Failed to load users');
    }
  };

  const handleCreate = async () => {
    if (selectedUsers.length === 0) {
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
        })
        .select()
        .single();

      if (chatError) throw chatError;

      // Add members (including creator)
      const members = [...selectedUsers, user.id].map(userId => ({
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

  const selectAll = () => {
    setSelectedUsers(profiles.map(p => p.id));
  };

  const deselectAll = () => {
    setSelectedUsers([]);
  };

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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Select Users</Label>
              {isGroup && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={selectAll}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={deselectAll}
                  >
                    Clear
                  </Button>
                </div>
              )}
            </div>

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
                      {profile.full_name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1">{profile.full_name}</span>
                </label>
              ))}
            </div>
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