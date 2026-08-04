import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Paperclip, X, Clock, Calendar, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { compressImage, uploadWithRetry } from '@/utils/imageCompression';
import { format, addDays, setHours, setMinutes, isAfter } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getDisplayName } from '@/utils/displayName';

interface Profile {
  id: string;
  full_name: string;
  nickname?: string | null;
  profile_photo_url: string | null;
  role?: string;
}

interface AnnouncementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAnnouncementCreated: (chatId: string) => void;
  locationId?: string;
  locationName?: string;
}

const ROLE_OPTIONS = [
  { value: 'team_member', label: 'Team Member' },
  { value: 'shift_manager', label: 'Shift Manager' },
  { value: 'shift_manager_in_training', label: 'Shift Manager in Training' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

export function AnnouncementDialog({ open, onOpenChange, onAnnouncementCreated, locationId, locationName }: AnnouncementDialogProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [showIndividualSelection, setShowIndividualSelection] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      fetchProfiles();
      // Reset scheduling when dialog opens
      setIsScheduled(false);
      setScheduledDate('');
      setScheduledTime('');
      setSelectedRoles([]);
      setSelectedUsers([]);
      setShowIndividualSelection(false);
    }
  }, [open, locationId]);

  const fetchProfiles = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get users at current location with their roles
      let userIds: string[] = [];
      if (locationId) {
        const { data: locationUsers } = await supabase
          .from('user_locations')
          .select('user_id')
          .eq('location_id', locationId);
        userIds = locationUsers?.map(u => u.user_id) || [];
      }

      // Get profiles
      let query = supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .eq('is_active', true)
        .eq('appears_on_schedule', true)
        .neq('id', user.id);

      if (userIds.length > 0) {
        query = query.in('id', userIds);
      }

      const { data: profileData, error } = await query;
      if (error) throw error;

      // Get roles for these users
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role');

      // Merge profiles with their highest role
      const profilesWithRoles = (profileData || []).map(p => ({
        ...p,
        role: roles?.find(r => r.user_id === p.id)?.role || 'team_member'
      }));

      setProfiles(profilesWithRoles);
    } catch (error: any) {
      console.error('Error fetching profiles:', error);
      toast.error('Failed to load users');
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let fileToUpload: File | Blob = file;
      let fileName = `${user.id}/${Date.now()}.${file.name.split('.').pop()}`;
      
      if (file.type.startsWith('image/')) {
        fileToUpload = await compressImage(file, 1200, 1200, 0.8);
        fileName = `${user.id}/${Date.now()}.jpg`;
      }

      const { publicUrl } = await uploadWithRetry(supabase, 'message-attachments', fileName, fileToUpload as File, 3);

      setUploadedFile(file);
      setUploadedFileUrl(publicUrl);
      toast.success('File attached');
    } catch (error: any) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload file');
    }
  };

  const removeAttachment = () => {
    setUploadedFile(null);
    setUploadedFileUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const setQuickSchedule = (option: 'tonight' | 'tomorrow') => {
    const now = new Date();
    let targetDate: Date;
    
    if (option === 'tonight') {
      targetDate = setMinutes(setHours(now, 18), 0);
      if (!isAfter(targetDate, now)) {
        targetDate = setMinutes(setHours(addDays(now, 1), 18), 0);
      }
    } else {
      targetDate = setMinutes(setHours(addDays(now, 1), 9), 0);
    }
    
    setScheduledDate(format(targetDate, 'yyyy-MM-dd'));
    setScheduledTime(format(targetDate, 'HH:mm'));
    setIsScheduled(true);
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
    const recipients = getFinalRecipients();
    
    if (recipients.length === 0) {
      toast.error('Please select at least one recipient');
      return;
    }

    if (!title.trim()) {
      toast.error('Please enter an announcement title');
      return;
    }

    if (!message.trim()) {
      toast.error('Please enter an announcement message');
      return;
    }

    if (isScheduled) {
      if (!scheduledDate || !scheduledTime) {
        toast.error('Please select a date and time for scheduling');
        return;
      }
      const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
      if (!isAfter(scheduledDateTime, new Date())) {
        toast.error('Scheduled time must be in the future');
        return;
      }
    }

    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const scheduledAt = isScheduled ? new Date(`${scheduledDate}T${scheduledTime}`).toISOString() : null;

      // Create announcement chat
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .insert({
          title: title.trim(),
          is_group: true,
          is_announcement: true,
          created_by: user.id,
          location_id: locationId || null,
        })
        .select()
        .single();

      if (chatError) throw chatError;

      // Add members (recipients + creator)
      const members = [...recipients, user.id].map(userId => ({
        chat_id: chat.id,
        user_id: userId,
      }));

      const { error: membersError } = await supabase
        .from('chat_members')
        .insert(members);

      if (membersError) throw membersError;

      // Send the announcement message
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          chat_id: chat.id,
          sender_id: user.id,
          content: message.trim(),
          attachment_url: uploadedFileUrl,
          attachment_type: uploadedFile?.type || null,
          scheduled_at: scheduledAt,
        });

      if (messageError) throw messageError;

      // Send push notifications only if not scheduled
      if (!isScheduled) {
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: recipients,
              title: `📢 ${title.trim()}`,
              body: message.trim().substring(0, 100),
              notification_type: 'announcements',
              data: {
                chat_id: chat.id,
                type: 'announcement'
              }
            }
          });
        } catch (notifError) {
          console.error('Error sending announcement push notification:', notifError);
        }
      }

      if (isScheduled) {
        toast.success(`Announcement scheduled for ${format(new Date(`${scheduledDate}T${scheduledTime}`), 'MMM d, h:mm a')}`);
      } else {
        toast.success('Announcement sent');
      }
      onAnnouncementCreated(chat.id);
      
      // Reset form
      setSelectedUsers([]);
      setSelectedRoles([]);
      setTitle('');
      setMessage('');
      setIsScheduled(false);
      setScheduledDate('');
      setScheduledTime('');
      removeAttachment();
    } catch (error: any) {
      console.error('Error creating announcement:', error);
      toast.error('Failed to create announcement');
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
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Announcement</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Announcement Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter announcement title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter announcement message"
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>Attachment (optional)</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={!!uploadedFile}
              >
                <Paperclip className="h-4 w-4 mr-2" />
                {uploadedFile ? 'File Attached' : 'Attach File'}
              </Button>
              {uploadedFile && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate max-w-[200px]">{uploadedFile.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={removeAttachment}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
            />
            <p className="text-xs text-muted-foreground">
              Max file size: 10MB. Supported: Images, PDF, Word, Excel
            </p>
          </div>

          {/* Scheduling Section */}
          <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
            <div className="flex items-center gap-2">
              <Checkbox
                id="schedule"
                checked={isScheduled}
                onCheckedChange={(checked) => setIsScheduled(checked === true)}
              />
              <Label htmlFor="schedule" className="flex items-center gap-2 cursor-pointer">
                <Clock className="h-4 w-4" />
                Schedule for later
              </Label>
            </div>

            {isScheduled && (
              <div className="space-y-3 pt-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQuickSchedule('tonight')}
                    className="flex-1"
                  >
                    Tonight 6pm
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQuickSchedule('tomorrow')}
                    className="flex-1"
                  >
                    Tomorrow 9am
                  </Button>
                </div>
                
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label htmlFor="date" className="text-xs">Date</Label>
                    <Input
                      id="date"
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      min={format(new Date(), 'yyyy-MM-dd')}
                    />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="time" className="text-xs">Time</Label>
                    <Input
                      id="time"
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                    />
                  </div>
                </div>

                {scheduledDate && scheduledTime && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Will send on {format(new Date(`${scheduledDate}T${scheduledTime}`), 'EEEE, MMM d \'at\' h:mm a')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Recipients Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Recipients ({selectedCount} selected)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={deselectAll}
              >
                Clear
              </Button>
            </div>

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

            {/* Individual Selection (Collapsible) */}
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
                          {getDisplayName(profile.full_name, profile.nickname)?.charAt(0) || '?'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex-1 text-sm">{getDisplayName(profile.full_name, profile.nickname)}</span>
                      <span className="text-xs text-muted-foreground capitalize">{profile.role?.replace('_', ' ')}</span>
                    </label>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Sending...' : isScheduled ? 'Schedule Announcement' : 'Send Announcement'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
