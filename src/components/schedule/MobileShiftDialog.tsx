import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { BreakIndicator } from './BreakIndicator';
import { shiftHasBreak } from '@/utils/shiftUtils';
import { Trash2 } from 'lucide-react';

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface Shift {
  id: string;
  user_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  shift_date: string;
  template_id?: string | null;
  template?: {
    position: string | null;
    color: string | null;
  };
}

interface MobileShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: Shift | null;
  profiles: Profile[];
  isAdmin: boolean;
  onShiftUpdated?: () => void;
  isCreating?: boolean;
  scheduleId?: string | null;
  templates?: Array<{
    id: string;
    template_name: string;
    start_time: string;
    end_time: string;
    color: string | null;
  }>;
}

export function MobileShiftDialog({ 
  open, 
  onOpenChange, 
  shift, 
  profiles,
  isAdmin,
  onShiftUpdated,
  isCreating = false,
  scheduleId,
  templates = []
}: MobileShiftDialogProps) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (shift) {
      setStartTime(shift.start_time);
      setEndTime(shift.end_time);
      setSelectedUserId(shift.user_id || 'unassigned');
      setSelectedTemplateId(shift.template_id || '');
    } else if (isCreating && templates.length > 0) {
      // Set defaults for new shift
      setStartTime('09:00');
      setEndTime('17:00');
      setSelectedUserId('unassigned');
      setSelectedTemplateId('');
    }
  }, [shift, isCreating, templates]);

  if (!shift) return null;

  const profile = profiles.find(p => p.id === shift.user_id);

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const handleSave = async (publish = false) => {
    if (!isAdmin) return;

    setSaving(true);
    try {
      if (isCreating) {
        // Create new shift
        if (!scheduleId) {
          throw new Error('Schedule ID is required to create a shift');
        }
        
        const { error: shiftError } = await supabase
          .from('scheduled_shifts')
          .insert({
            schedule_id: scheduleId,
            start_time: startTime,
            end_time: endTime,
            user_id: selectedUserId === 'unassigned' ? null : selectedUserId,
            template_id: selectedTemplateId || null,
            day_of_week: shift?.day_of_week || 0,
            shift_date: shift?.shift_date || new Date().toISOString(),
          });

        if (shiftError) throw shiftError;
      } else {
        // Update existing shift
        const { error: shiftError } = await supabase
          .from('scheduled_shifts')
          .update({
            start_time: startTime,
            end_time: endTime,
            user_id: selectedUserId === 'unassigned' ? null : selectedUserId,
            template_id: selectedTemplateId || null,
          })
          .eq('id', shift!.id);

        if (shiftError) throw shiftError;
      }

      // Handle publish status
      const shiftDate = shift?.shift_date || new Date().toISOString();
      const { data: scheduleData } = await supabase
        .from('schedules')
        .select('id')
        .eq('week_start_date', shiftDate.split('T')[0])
        .single();

      if (scheduleData) {
        if (publish) {
          await supabase
            .from('schedules')
            .update({ is_published: true })
            .eq('id', scheduleData.id);
        } else {
          // Mark as unpublished if just saving
          await supabase
            .from('schedules')
            .update({ is_published: false })
            .eq('id', scheduleData.id);
        }
      }

      toast.success(isCreating ? 'Shift created' : 'Shift updated');
      onShiftUpdated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving shift:', error);
      toast.error('Failed to save shift');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    await handleSave(true);
    setPublishing(false);
  };

  const handleDelete = async () => {
    if (!isAdmin || !shift) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('scheduled_shifts')
        .delete()
        .eq('id', shift.id);

      if (error) throw error;

      toast.success('Shift deleted');
      onShiftUpdated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error deleting shift:', error);
      toast.error('Failed to delete shift');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCreating ? 'Add Shift' : 'Shift Details'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Employee Info */}
          {profile && (
            <div className="flex items-center gap-3 pb-4 border-b">
              <Avatar className="h-12 w-12">
                <AvatarImage src={profile.profile_photo_url || undefined} />
                <AvatarFallback>{profile.full_name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{profile.full_name}</p>
                <p className="text-sm text-muted-foreground">{shift.template?.position}</p>
              </div>
            </div>
          )}

          {/* Date */}
          <div>
            <Label className="text-muted-foreground">Date</Label>
            <p className="font-medium">{new Date(shift.shift_date).toLocaleDateString()}</p>
          </div>

          {/* Time Range */}
          {isAdmin ? (
            <div className="space-y-2">
              <Label>Shift Times</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  autoFocus={false}
                />
                <span>-</span>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  autoFocus={false}
                />
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-muted-foreground">Time</Label>
              <div className="flex items-center gap-2">
                <p className="font-medium">
                  {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                </p>
                {shiftHasBreak(shift.start_time, shift.end_time) && (
                  <BreakIndicator hasBreak={true} size="sm" />
                )}
              </div>
            </div>
          )}

          {/* Break Indicator for Admin */}
          {isAdmin && shiftHasBreak(startTime, endTime) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <BreakIndicator hasBreak={true} size="sm" />
              <span>30-minute unpaid break (shift over 5 hours)</span>
            </div>
          )}

          {/* Template Selection - Admin Only */}
          {isAdmin && templates.length > 0 && (
            <div className="space-y-2">
              <Label>Shift Template</Label>
              <Select value={selectedTemplateId || 'none'} onValueChange={(value) => {
                setSelectedTemplateId(value === 'none' ? '' : value);
                const template = templates.find(t => t.id === value);
                if (template) {
                  setStartTime(template.start_time);
                  setEndTime(template.end_time);
                }
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select template (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {templates.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.template_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Employee Assignment - Admin Only */}
          {isAdmin && (
            <div className="space-y-2">
              <Label>Assigned Employee</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {profiles.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {isAdmin && !isCreating && (
            <Button 
              variant="destructive" 
              onClick={handleDelete} 
              disabled={deleting}
              className="w-full sm:w-auto sm:mr-auto"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          )}
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-none">
              {isAdmin ? 'Cancel' : 'Close'}
            </Button>
            {isAdmin && (
              <>
                <Button onClick={() => handleSave(false)} disabled={saving} className="flex-1 sm:flex-none">
                  {saving ? 'Saving...' : isCreating ? 'Create' : 'Save'}
                </Button>
                <Button onClick={handlePublish} disabled={publishing} variant="default" className="flex-1 sm:flex-none">
                  {publishing ? 'Publishing...' : 'Publish'}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
