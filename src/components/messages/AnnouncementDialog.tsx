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
import { Paperclip, X, Clock, Calendar } from 'lucide-react';
import { compressImage, uploadWithRetry } from '@/utils/imageCompression';
import { format, addDays, setHours, setMinutes, isAfter } from 'date-fns';

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface AnnouncementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAnnouncementCreated: (chatId: string) => void;
  locationId?: string;
}

export function AnnouncementDialog({ open, onOpenChange, onAnnouncementCreated, locationId }: AnnouncementDialogProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      fetchProfiles();
      // Reset scheduling when dialog opens
      setIsScheduled(false);
      setScheduledDate('');
      setScheduledTime('');
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
      // Tonight at 6pm
      targetDate = setMinutes(setHours(now, 18), 0);
      // If it's already past 6pm, schedule for next day
      if (!isAfter(targetDate, now)) {
        targetDate = setMinutes(setHours(addDays(now, 1), 18), 0);
      }
    } else {
      // Tomorrow at 9am
      targetDate = setMinutes(setHours(addDays(now, 1), 9), 0);
    }
    
    setScheduledDate(format(targetDate, 'yyyy-MM-dd'));
    setScheduledTime(format(targetDate, 'HH:mm'));
    setIsScheduled(true);
  };

  const handleCreate = async () => {
    if (selectedUsers.length === 0) {
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
      const members = [...selectedUsers, user.id].map(userId => ({
        chat_id: chat.id,
        user_id: userId,
      }));

      const { error: membersError } = await supabase
        .from('chat_members')
        .insert(members);

      if (membersError) throw membersError;

      // Send the announcement message (with optional scheduled_at)
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
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single();

          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: selectedUsers,
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

  const selectAll = () => {
    setSelectedUsers(profiles.map(p => p.id));
  };

  const deselectAll = () => {
    setSelectedUsers([]);
  };

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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Select Recipients</Label>
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
              {creating ? 'Sending...' : isScheduled ? 'Schedule Announcement' : 'Send Announcement'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
