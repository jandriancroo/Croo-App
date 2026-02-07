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
import { Trash2, ArrowUp, Share2 } from 'lucide-react';
import { getTodayInPST } from '@/utils/dateUtils';
import { parseDateStringInTimezone } from '@/utils/timezoneUtils';
import { ShiftOfferDialog } from './ShiftOfferDialog';

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
  locationId?: string | null;
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
  templates = [],
  locationId
}: MobileShiftDialogProps) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [shiftDate, setShiftDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [offeredShifts, setOfferedShifts] = useState<any[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [showOfferDialog, setShowOfferDialog] = useState(false);

  useEffect(() => {
    if (shift) {
      setStartTime(shift.start_time);
      setEndTime(shift.end_time);
      setSelectedUserId(shift.user_id || 'unassigned');
      setSelectedTemplateId(shift.template_id || '');
      setShiftDate(shift.shift_date);
    } else if (isCreating && templates.length > 0) {
      // Set defaults for new shift
      setStartTime('09:00');
      setEndTime('17:00');
      setSelectedUserId('unassigned');
      setSelectedTemplateId('');
      setShiftDate(shift?.shift_date || getTodayInPST());
    }
  }, [shift, isCreating, templates]);

  useEffect(() => {
    if (open && scheduleId) {
      fetchOfferedShifts();
    }
  }, [open, scheduleId]);

  const fetchOfferedShifts = async () => {
    if (!scheduleId) return;
    
    try {
      const { data, error } = await supabase
        .from('shift_offers')
        .select(`
          id,
          shift_id,
          offered_by_user_id,
          status,
          scheduled_shifts!inner (
            id,
            start_time,
            end_time,
            shift_date,
            day_of_week,
            user_id,
            template_id,
            shift_templates (
              template_name,
              position
            )
          ),
          profiles!shift_offers_offered_by_user_id_fkey (
            full_name
          )
        `)
        .eq('status', 'available')
        .eq('scheduled_shifts.schedule_id', scheduleId);

      if (error) throw error;
      setOfferedShifts(data || []);
    } catch (error) {
      console.error('Error fetching offered shifts:', error);
    }
  };

  if (!shift) return null;

  const profile = profiles.find(p => p.id === shift.user_id);

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const handleSave = async () => {
    if (!isAdmin) return;

    setSaving(true);
    try {
      const isApprovingClaim = !!selectedOfferId;
      
      // If an offered shift was selected, approve it
      if (selectedOfferId) {
        const { error: offerError } = await supabase
          .from('shift_offers')
          .update({ status: 'approved' })
          .eq('id', selectedOfferId);

        if (offerError) throw offerError;
      }

      if (isCreating) {
        // Create new shift
        if (!scheduleId) {
          throw new Error('Schedule ID is required to create a shift');
        }
        
        // Calculate day_of_week from the selected date using timezone-safe parsing
        const selectedDate = parseDateStringInTimezone(shiftDate, 'America/Los_Angeles');
        const dayOfWeek = selectedDate.getDay();
        
        const { error: shiftError } = await supabase
          .from('scheduled_shifts')
          .insert({
            schedule_id: scheduleId,
            start_time: startTime,
            end_time: endTime,
            user_id: selectedUserId === 'unassigned' ? null : selectedUserId,
            template_id: selectedTemplateId || null,
            day_of_week: dayOfWeek,
            shift_date: shiftDate,
          });

        if (shiftError) throw shiftError;
      } else {
        // Update existing shift (including date if changed)
        const selectedDate = parseDateStringInTimezone(shiftDate, 'America/Los_Angeles');
        const dayOfWeek = selectedDate.getDay();
        
        const { error: shiftError } = await supabase
          .from('scheduled_shifts')
          .update({
            start_time: startTime,
            end_time: endTime,
            user_id: selectedUserId === 'unassigned' ? null : selectedUserId,
            template_id: selectedTemplateId || null,
            shift_date: shiftDate,
            day_of_week: dayOfWeek,
          })
          .eq('id', shift!.id);

        if (shiftError) throw shiftError;
      }

      // Auto-notify when a shift claim is approved
      if (isApprovingClaim && selectedUserId && selectedUserId !== 'unassigned') {
        const formattedDate = shiftDate ? parseDateStringInTimezone(shiftDate, 'America/Los_Angeles').toLocaleDateString('en-US', { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric' 
        }) : '';
        
        await supabase.functions.invoke('send-push-notification', {
          body: {
            user_ids: [selectedUserId],
            title: 'Shift Claim Approved!',
            body: `Your shift claim for ${formattedDate} has been approved`,
            notification_type: 'shift_approvals',
            data: { type: 'shift_approval', schedule_id: scheduleId }
          }
        });
      }

      toast.success(isApprovingClaim ? 'Shift claim approved!' : (isCreating ? 'Shift created' : 'Shift updated'));
      onShiftUpdated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving shift:', error);
      toast.error('Failed to save shift');
    } finally {
      setSaving(false);
    }
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
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
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
          {isAdmin ? (
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={shiftDate}
                onChange={(e) => setShiftDate(e.target.value)}
              />
            </div>
          ) : (
            <div>
              <Label className="text-muted-foreground">Date</Label>
              <p className="font-medium">{parseDateStringInTimezone(shift.shift_date, 'America/Los_Angeles').toLocaleDateString()}</p>
            </div>
          )}

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
              <Label>Quick Fill</Label>
              <Select 
                value={selectedTemplateId || 'none'} 
                onValueChange={(value) => {
                  if (value.startsWith('offer-')) {
                    // Handle offered shift selection
                    const offerId = value.replace('offer-', '');
                    const offer = offeredShifts.find(o => o.id === offerId);
                    if (offer && offer.scheduled_shifts) {
                      setSelectedOfferId(offerId);
                      setStartTime(offer.scheduled_shifts.start_time);
                      setEndTime(offer.scheduled_shifts.end_time);
                      if (offer.scheduled_shifts.template_id) {
                        setSelectedTemplateId(offer.scheduled_shifts.template_id);
                      } else {
                        setSelectedTemplateId(`offer-${offerId}`);
                      }
                    }
                  } else if (value !== 'none') {
                    setSelectedOfferId(null);
                    setSelectedTemplateId(value);
                    const template = templates.find(t => t.id === value);
                    if (template) {
                      setStartTime(template.start_time);
                      setEndTime(template.end_time);
                    }
                  } else {
                    setSelectedOfferId(null);
                    setSelectedTemplateId('');
                  }
                }}
              >
              <SelectTrigger>
                  <SelectValue placeholder="Select quick fill option" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  
                  {/* Offered Shifts Section */}
                  {offeredShifts.length > 0 && offeredShifts.map((offer) => {
                    const shiftData = offer.scheduled_shifts;
                    const offeredBy = offer.profiles?.full_name || 'Unknown';
                    const templateName = shiftData?.shift_templates?.template_name || shiftData?.shift_templates?.position || 'Shift';
                    const formatTime = (time: string) => {
                      const [hours, minutes] = time.split(':');
                      const hour = parseInt(hours);
                      const ampm = hour >= 12 ? 'PM' : 'AM';
                      const displayHour = hour % 12 || 12;
                      return `${displayHour}:${minutes} ${ampm}`;
                    };
                    
                    return (
                      <SelectItem 
                        key={offer.id} 
                        value={`offer-${offer.id}`}
                        className="font-semibold text-primary bg-primary/10 border-l-4 border-primary"
                      >
                        <div className="flex items-center gap-2">
                          <ArrowUp className="h-4 w-4 animate-pulse" />
                          <span className="italic">
                            {templateName} ({formatTime(shiftData.start_time)} - {formatTime(shiftData.end_time)}) - Offered by {offeredBy}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                  
                  {/* Regular Templates */}
                  {templates.map(t => {
                    const formatTime = (time: string) => {
                      const [hours, minutes] = time.split(':');
                      const hour = parseInt(hours);
                      const ampm = hour >= 12 ? 'PM' : 'AM';
                      const displayHour = hour % 12 || 12;
                      return `${displayHour}:${minutes} ${ampm}`;
                    };
                    
                    return (
                      <SelectItem key={t.id} value={t.id}>
                        {t.template_name} ({formatTime(t.start_time)} - {formatTime(t.end_time)})
                      </SelectItem>
                    );
                  })}
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
          {/* Offer Up button - show for assigned shifts that aren't being created */}
          {!isCreating && shift?.user_id && (
            <Button 
              variant="outline"
              onClick={() => setShowOfferDialog(true)}
              className="w-full sm:w-auto sm:mr-auto border-primary/50 text-primary hover:bg-primary/10"
            >
              <Share2 className="h-4 w-4 mr-2" />
              Offer Up
            </Button>
          )}
          {isAdmin && !isCreating && !shift?.user_id && (
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
          {isAdmin && !isCreating && shift?.user_id && (
            <Button 
              variant="destructive" 
              onClick={handleDelete} 
              disabled={deleting}
              className="w-full sm:w-auto"
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
              <Button onClick={handleSave} disabled={saving} className="flex-1 sm:flex-none">
                {saving ? 'Saving...' : isCreating ? 'Create' : 'Save'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Offer Up Dialog */}
      {shift && (
        <ShiftOfferDialog
          open={showOfferDialog}
          onOpenChange={setShowOfferDialog}
          shift={{
            ...shift,
            location_id: locationId,
          }}
          onOfferCreated={() => {
            onShiftUpdated?.();
            onOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}
