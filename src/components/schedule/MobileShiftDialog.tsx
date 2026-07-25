import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
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
import { Trash2, ArrowUp, ArrowRightLeft, CalendarClock, ChevronLeft, ChevronRight, Coffee } from 'lucide-react';
import { getTodayInPST } from '@/utils/dateUtils';
import { format, addDays, subDays } from 'date-fns';
import { parseDateStringInTimezone } from '@/utils/timezoneUtils';
import { ShiftOfferDialog } from './ShiftOfferDialog';
import { BreakEditor } from './BreakEditor';
import { useBreakCoverageEnabled } from '@/hooks/useBreakCoverageEnabled';
import { ShiftBreak, normalizeBreaks } from '@/types/shiftBreak';

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
  breaks?: unknown;
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
  currentWeekStart?: Date;
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
  locationId,
  currentWeekStart
}: MobileShiftDialogProps) {
  const queryClient = useQueryClient();
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
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
  const [breaks, setBreaks] = useState<ShiftBreak[]>([]);
  const breakCoverageEnabled = useBreakCoverageEnabled(locationId);

  useEffect(() => {
    if (shift) {
      setStartTime(shift.start_time);
      setEndTime(shift.end_time);
      setSelectedUserId(shift.user_id || '');
      setSelectedTemplateId(shift.template_id || '');
      setShiftDate(shift.shift_date);
      setBreaks(normalizeBreaks(shift.breaks));
    } else if (isCreating && templates.length > 0) {
      // Set defaults for new shift
      setStartTime('09:00');
      setEndTime('17:00');
      setSelectedUserId('');
      setSelectedTemplateId('');
      setShiftDate(shift?.shift_date || getTodayInPST());
      setBreaks([]);
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
    if (!selectedUserId || selectedUserId === 'unassigned') {
      toast.error("Pick an employee — shifts can't be left unassigned.");
      return;
    }

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
        const selectedDate = parseDateStringInTimezone(shiftDate, timezone);
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
            breaks: breakCoverageEnabled ? breaks : [],
          } as any);

        if (shiftError) throw shiftError;
      } else {
        // Update existing shift (including date if changed)
        const selectedDate = parseDateStringInTimezone(shiftDate, timezone);
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
            breaks: breakCoverageEnabled ? breaks : (shift?.breaks ?? []),
          } as any)
          .eq('id', shift!.id);

        if (shiftError) throw shiftError;
      }

      // Auto-notify when a shift claim is approved
      if (isApprovingClaim && selectedUserId && selectedUserId !== 'unassigned') {
        const formattedDate = shiftDate ? parseDateStringInTimezone(shiftDate, timezone).toLocaleDateString('en-US', { 
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

      // Optimistically update cache so Schedule Tools reflects changes instantly
      if (currentWeekStart && (currentLocation?.id || locationId)) {
        const locId = currentLocation?.id || locationId;
        const scheduleKey = ['schedule', locId, format(currentWeekStart, 'yyyy-MM-dd')];
        
        if (!isCreating && shift) {
          // Update existing shift in cache
          const updatedUserId = selectedUserId === 'unassigned' ? null : selectedUserId;
          queryClient.setQueryData(scheduleKey, (old: any) => {
            if (!old) return old;
            return {
              ...old,
              shifts: old.shifts.map((s: any) =>
                s.id === shift.id
                  ? { ...s, start_time: startTime, end_time: endTime, user_id: updatedUserId, template_id: selectedTemplateId || null }
                  : s
              ),
            };
          });
        }
        // For creates, the refetch will pick up the new shift
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

      // Optimistically remove from cache
      if (currentWeekStart && (currentLocation?.id || locationId)) {
        const locId = currentLocation?.id || locationId;
        const scheduleKey = ['schedule', locId, format(currentWeekStart, 'yyyy-MM-dd')];
        queryClient.setQueryData(scheduleKey, (old: any) => {
          if (!old) return old;
          return { ...old, shifts: old.shifts.filter((s: any) => s.id !== shift.id) };
        });
      }

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
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="max-w-sm max-h-[85vh] p-0 gap-0 flex flex-col overflow-hidden"
      >
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <CalendarClock className="h-5 w-5" />
            {isCreating ? 'Add Shift' : 'Shift Details'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 pb-4 overflow-y-auto flex-1 min-h-0">
          {/* Employee selector card (merged avatar + dropdown) */}
          {isAdmin ? (
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="h-auto p-3 bg-primary/5 rounded-lg border [&>svg]:opacity-60">
                <div className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  {(() => {
                    const sel = profiles.find(p => p.id === selectedUserId);
                    return (
                      <>
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarImage src={sel?.profile_photo_url || undefined} />
                          <AvatarFallback>{sel?.full_name?.charAt(0) ?? '?'}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium leading-tight truncate">
                            {sel?.full_name ?? 'Select employee'}
                          </p>
                          {shift.template?.position && (
                            <p className="text-xs text-muted-foreground truncate">
                              {shift.template.position}
                            </p>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </SelectTrigger>
              <SelectContent>
                {profiles.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={p.profile_photo_url || undefined} />
                        <AvatarFallback className="text-xs">{p.full_name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <span>{p.full_name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : profile && (
            <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg border">
              <Avatar className="h-10 w-10">
                <AvatarImage src={profile.profile_photo_url || undefined} />
                <AvatarFallback>{profile.full_name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-medium leading-tight truncate">{profile.full_name}</p>
                {shift.template?.position && (
                  <p className="text-xs text-muted-foreground truncate">{shift.template.position}</p>
                )}
              </div>
            </div>
          )}


          {isAdmin ? (
            <>
              {/* Date Selector with chevrons */}
              <div className="space-y-2">
                <Label>Date</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => {
                      const current = new Date(shiftDate + 'T12:00:00');
                      setShiftDate(format(subDays(current, 1), 'yyyy-MM-dd'));
                    }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input
                    type="date"
                    value={shiftDate}
                    onChange={(e) => setShiftDate(e.target.value)}
                    className="flex-1 text-center"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => {
                      const current = new Date(shiftDate + 'T12:00:00');
                      setShiftDate(format(addDays(current, 1), 'yyyy-MM-dd'));
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Start / End Times */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start</Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    autoFocus={false}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End</Label>
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    autoFocus={false}
                  />
                </div>
              </div>

              {/* Break hint chip */}
              {shiftHasBreak(startTime, endTime) && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Coffee className="h-3.5 w-3.5 text-amber-600" />
                  <span>30-min unpaid break (shift &gt; 5 hrs)</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-between gap-3 text-sm">
              <div>
                <Label className="text-muted-foreground text-xs">Date</Label>
                <p className="font-medium">{parseDateStringInTimezone(shift.shift_date, timezone).toLocaleDateString()}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Time</Label>
                <div className="flex items-center gap-1.5">
                  <p className="font-medium">{formatTime(shift.start_time)} - {formatTime(shift.end_time)}</p>
                  {shiftHasBreak(shift.start_time, shift.end_time) && (
                    <BreakIndicator hasBreak={true} size="sm" />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Scheduled Breaks + Coverage — gated on master toggle */}
          {isAdmin && breakCoverageEnabled && (
            <BreakEditor
              value={breaks}
              onChange={setBreaks}
              showCoverer
              coverers={profiles.map((p) => ({ id: p.id, full_name: p.full_name }))}
              shiftStart={startTime}
              shiftEnd={endTime}
            />
          )}

          {/* Template Selection - Admin Only */}
          {isAdmin && templates.length > 0 && (
            <div className="space-y-2">
              <Label>Quick Fill</Label>
              <Select
                value={selectedTemplateId || 'none'}
                onValueChange={(value) => {
                  if (value.startsWith('offer-')) {
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
                <SelectContent className="max-w-[calc(100vw-2rem)]">
                  <SelectItem value="none">None</SelectItem>

                  {/* Offered Shifts Section */}
                  {offeredShifts.length > 0 && offeredShifts.map((offer) => {
                    const shiftData = offer.scheduled_shifts;
                    const offeredBy = offer.profiles?.full_name || 'Unknown';
                    const rawTemplateName = shiftData?.shift_templates?.template_name;
                    const position = shiftData?.shift_templates?.position;
                    const displayName = position || (rawTemplateName ? rawTemplateName.split(/\d{1,2}:\d{2}/)[0].trim() : 'Shift');
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
                        className="font-semibold text-primary bg-primary/10 border-l-4 border-primary max-w-full"
                      >
                        <div className="flex flex-col gap-0.5 py-0.5 max-w-full">
                          <span className="font-semibold leading-tight flex items-center gap-1">
                            <ArrowUp className="h-3 w-3 animate-pulse" />
                            {displayName}
                          </span>
                          <span className="text-xs text-muted-foreground leading-tight">
                            {formatTime(shiftData.start_time)} - {formatTime(shiftData.end_time)} • Offered by {offeredBy}
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
                    const displayName = t.template_name.split(/\d{1,2}:\d{2}/)[0].trim();
                    const color = t.color || '#ef4444';
                    return (
                      <SelectItem
                        key={t.id}
                        value={t.id}
                        className="my-1 rounded-md border-2 focus:bg-transparent max-w-full"
                        style={{
                          backgroundColor: `${color}15`,
                          borderColor: `${color}55`,
                        }}
                      >
                        <div className="flex flex-col gap-0.5 py-0.5 max-w-full">
                          <span className="font-semibold leading-tight break-words" style={{ color }}>
                            {displayName}
                          </span>
                          <span className="text-xs text-muted-foreground leading-tight">
                            {formatTime(t.start_time)} – {formatTime(t.end_time)}
                          </span>
                        </div>
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

        <DialogFooter className="flex-col gap-2 px-5 py-3 border-t shrink-0 bg-background sm:flex-col sm:space-x-0">
          {/* Primary row: Cancel + Save */}
          <div className="grid grid-cols-2 gap-2 w-full">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {isAdmin ? 'Cancel' : 'Close'}
            </Button>
            {isAdmin && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : isCreating ? 'Create' : 'Save'}
              </Button>
            )}
          </div>

          {/* Secondary row: Offer Up + Delete */}
          {isAdmin && !isCreating && (shift?.user_id || shift) && (
            <div className={`grid ${shift?.user_id ? 'grid-cols-2' : 'grid-cols-1'} gap-2 w-full`}>
              {shift?.user_id && (
                <Button
                  variant="outline"
                  onClick={() => setShowOfferDialog(true)}
                  className="border-primary/50 text-primary hover:bg-primary/10"
                >
                  <ArrowRightLeft className="h-4 w-4 mr-1.5" />
                  Offer Up
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                {deleting ? '...' : 'Delete'}
              </Button>
            </div>
          )}
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
