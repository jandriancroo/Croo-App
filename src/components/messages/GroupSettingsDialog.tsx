import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ImageIcon, X } from 'lucide-react';
import { compressImage, uploadWithRetry } from '@/utils/imageCompression';
import { getDisplayName } from '@/utils/displayName';

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface Member {
  user_id: string;
  profiles: Profile;
}

interface GroupSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string;
  chatTitle: string;
  groupImageUrl: string | null;
  onUpdate: () => void;
}

export function GroupSettingsDialog({
  open,
  onOpenChange,
  chatId,
  chatTitle,
  groupImageUrl,
  onUpdate
}: GroupSettingsDialogProps) {
  const [title, setTitle] = useState(chatTitle);
  const [members, setMembers] = useState<Member[]>([]);
  const [availableUsers, setAvailableUsers] = useState<Profile[]>([]);
  const [selectedNewUsers, setSelectedNewUsers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState(groupImageUrl);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(chatTitle);
      setImageUrl(groupImageUrl);
      fetchMembers();
      fetchAvailableUsers();
    }
  }, [open, chatId, chatTitle, groupImageUrl]);

  const fetchMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('chat_members')
        .select('user_id, profiles(id, full_name, nickname, profile_photo_url)')
        .eq('chat_id', chatId);

      if (error) throw error;
      setMembers(data as Member[]);
    } catch (error: any) {
      console.error('Error fetching members:', error);
    }
  };

  const fetchAvailableUsers = async () => {
    try {
      // Get current members and chat's location
      const [{ data: memberData }, { data: chatData }] = await Promise.all([
        supabase
          .from('chat_members')
          .select('user_id')
          .eq('chat_id', chatId),
        supabase
          .from('chats')
          .select('location_id')
          .eq('id', chatId)
          .single()
      ]);

      const memberIds = memberData?.map(m => m.user_id) || [];
      const locationId = chatData?.location_id;

      // If chat has a location, only show users at that location
      if (locationId) {
        const { data: locationUsers } = await supabase
          .from('user_locations')
          .select('user_id')
          .eq('location_id', locationId);

        const locationUserIds = locationUsers?.map(u => u.user_id) || [];

        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, profile_photo_url')
          .eq('is_active', true)
          .eq('appears_on_schedule', true)
          .in('id', locationUserIds.filter(id => !memberIds.includes(id)))
          .order('full_name');

        if (error) throw error;
        setAvailableUsers(data || []);
      } else {
        // Fallback: no location scoping (shouldn't happen for normal chats)
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, profile_photo_url')
          .eq('is_active', true)
          .eq('appears_on_schedule', true)
          .not('id', 'in', `(${memberIds.join(',')})`)
          .order('full_name');

        if (error) throw error;
        setAvailableUsers(data || []);
      }
    } catch (error: any) {
      console.error('Error fetching available users:', error);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Compress image to reduce memory usage on mobile
      const compressedFile = await compressImage(file, 800, 800, 0.8);
      const fileName = `chat-images/${chatId}/${Date.now()}.jpg`;

      // Use retry logic for flaky mobile connections
      const { publicUrl } = await uploadWithRetry(supabase, 'checklist-images', fileName, compressedFile, 3);

      setImageUrl(publicUrl);
      toast.success('Image uploaded');
    } catch (error: any) {
      console.error('Error uploading image:', error);
      toast.error('Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Please enter a group name');
      return;
    }

    setSaving(true);
    try {
      // Update chat details
      const { error: updateError } = await supabase
        .from('chats')
        .update({
          title: title.trim(),
          group_image_url: imageUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', chatId);

      if (updateError) throw updateError;

      // Add new members
      if (selectedNewUsers.length > 0) {
        const newMembers = selectedNewUsers.map(userId => ({
          chat_id: chatId,
          user_id: userId
        }));

        const { error: membersError } = await supabase
          .from('chat_members')
          .insert(newMembers);

        if (membersError) throw membersError;
      }

      toast.success('Group updated');
      onUpdate();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating group:', error);
      toast.error('Failed to update group');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      const { error } = await supabase
        .from('chat_members')
        .delete()
        .eq('chat_id', chatId)
        .eq('user_id', userId);

      if (error) throw error;

      toast.success('Member removed');
      fetchMembers();
      fetchAvailableUsers();
    } catch (error: any) {
      console.error('Error removing member:', error);
      toast.error('Failed to remove member');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Group Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Group Image</Label>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={imageUrl || undefined} />
                <AvatarFallback>
                  <ImageIcon className="h-8 w-8" />
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleImageUpload}
                  accept="image/*"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? 'Uploading...' : 'Upload Image'}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Group Name</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter group name"
            />
          </div>

          <div className="space-y-2">
            <Label>Current Members ({members.length})</Label>
            <div className="border rounded-lg max-h-48 overflow-y-auto">
              {members.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center justify-between gap-3 p-3 hover:bg-muted"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member.profiles.profile_photo_url || undefined} />
                      <AvatarFallback>
                        {getDisplayName(member.profiles.full_name, member.profiles.nickname)?.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <span>{getDisplayName(member.profiles.full_name, member.profiles.nickname)}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveMember(member.user_id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {availableUsers.length > 0 && (
            <div className="space-y-2">
              <Label>Add Members</Label>
              <div className="border rounded-lg max-h-48 overflow-y-auto">
                {availableUsers.map((user) => (
                  <label
                    key={user.id}
                    className="flex items-center gap-3 p-3 hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedNewUsers.includes(user.id)}
                      onCheckedChange={(checked) => {
                        setSelectedNewUsers(prev =>
                          checked
                            ? [...prev, user.id]
                            : prev.filter(id => id !== user.id)
                        );
                      }}
                    />
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.profile_photo_url || undefined} />
                      <AvatarFallback>{user.full_name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span>{user.full_name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}