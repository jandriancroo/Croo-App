import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

import { format, addDays } from 'date-fns';
import { Loader2, CalendarCheck, Clock, AlertCircle, CheckCircle2, RefreshCw, Users, UserCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MapPin, Video, Phone } from 'lucide-react';
import { isValidMeetingUrl, type InterviewModality } from '@/lib/hiring/interviewActions';

export interface InterviewScheduleDetails {
  modality: InterviewModality;
  meetingUrl: string | null;
}

export interface InterviewScheduleInitial {
  date?: string | null; // yyyy-MM-dd
  time?: string | null; // HH:mm[:ss]
  modality?: InterviewModality | null;
  meetingUrl?: string | null;
}

interface InterviewScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSchedule: (date: Date, time: string, details: InterviewScheduleDetails) => Promise<void>;
  initial?: InterviewScheduleInitial | null;
  applicantName: string;
  isRescheduling?: boolean;
  applicationId?: string;
}

export function InterviewScheduleDialog({ 
  open, 
  onOpenChange, 
  onSchedule,
  applicantName,
  isRescheduling = false,
  applicationId,
  initial,
}: InterviewScheduleDialogProps) {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(addDays(new Date(), 1));
  const [selectedTime, setSelectedTime] = useState<string>('10:00');
  const [myShifts, setMyShifts] = useState<any[]>([]);
  const [managerShifts, setManagerShifts] = useState<any[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSchedule, setCheckingSchedule] = useState(false);
  const [modality, setModality] = useState<InterviewModality>('in_person');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [urlTouched, setUrlTouched] = useState(false);

  // Reset / prefill each time the dialog opens
  useEffect(() => {
    if (!open) return;
    if (initial?.date) {
      const [y, m, d] = initial.date.split('-').map(Number);
      const prefilled = new Date(y, m - 1, d, 12);
      setSelectedDate(prefilled < new Date(new Date().setHours(0, 0, 0, 0)) ? addDays(new Date(), 1) : prefilled);
    } else {
      setSelectedDate(addDays(new Date(), 1));
    }
    setSelectedTime(initial?.time ? initial.time.slice(0, 5) : '10:00');
    setModality(initial?.modality || 'in_person');
    setMeetingUrl(initial?.meetingUrl || '');
    setUrlTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const urlValid = modality !== 'virtual' || isValidMeetingUrl(meetingUrl);

  // Time slots from 8 AM to 6 PM
  const timeSlots = Array.from({ length: 21 }, (_, i) => {
    const hour = Math.floor(i / 2) + 8;
    const minute = i % 2 === 0 ? '00' : '30';
    const time24 = `${hour.toString().padStart(2, '0')}:${minute}`;
    const hour12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return {
      value: time24,
      label: `${hour12}:${minute} ${ampm}`
    };
  });

  // Fetch the application's location when dialog opens
  useEffect(() => {
    if (!open || !applicationId) return;
    
    const fetchApplicationLocation = async () => {
      const { data } = await supabase
        .from('job_applications')
        .select('location_id')
        .eq('id', applicationId)
        .single();
      
      setLocationId(data?.location_id || null);
    };
    
    fetchApplicationLocation();
  }, [open, applicationId]);

  // Fetch all manager shifts when date changes
  useEffect(() => {
    if (!selectedDate || !user || !locationId) return;
    
    const fetchShifts = async () => {
      setCheckingSchedule(true);
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      
      // Get published schedules for this date
      const { data: schedules } = await supabase
        .from('schedules')
        .select('id')
        .eq('location_id', locationId)
        .eq('is_published', true)
        .lte('week_start_date', dateStr)
        .gte('week_end_date', dateStr);

      const scheduleIds = schedules?.map(s => s.id) || [];
      
      if (scheduleIds.length === 0) {
        setMyShifts([]);
        setManagerShifts([]);
        setCheckingSchedule(false);
        return;
      }

      // Fetch all shifts for this date
      const { data: shifts } = await supabase
        .from('scheduled_shifts')
        .select('*')
        .in('schedule_id', scheduleIds)
        .eq('shift_date', dateStr)
        .eq('is_time_off', false);

      if (!shifts?.length) {
        setMyShifts([]);
        setManagerShifts([]);
        setCheckingSchedule(false);
        return;
      }

      // Get current user's shifts
      const userShifts = shifts.filter(s => s.user_id === user.id);
      setMyShifts(userShifts);

      // Get user IDs from shifts
      const shiftUserIds = [...new Set(shifts.map(s => s.user_id).filter(Boolean))];
      
      // Get manager roles for these users
      const { data: managerRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('user_id', shiftUserIds)
        .in('role', ['super_admin', 'admin', 'manager', 'shift_manager', 'shift_manager_in_training']);

      const managerUserIds = new Set(managerRoles?.map(r => r.user_id) || []);
      
      // Get profile data for managers
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', Array.from(managerUserIds));

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      // Filter shifts to only managers and attach profile data
      const managersWorking = shifts
        .filter(shift => managerUserIds.has(shift.user_id))
        .map(shift => ({
          ...shift,
          user: profileMap.get(shift.user_id) || null
        }));
      setManagerShifts(managersWorking);
      setCheckingSchedule(false);
    };
    
    fetchShifts();
  }, [selectedDate, user, locationId]);

  const handleSchedule = async () => {
    if (!selectedDate || !selectedTime || loading) return;
    if (!urlValid) { setUrlTouched(true); return; }
    setLoading(true);
    try {
      await onSchedule(selectedDate, selectedTime, {
        modality,
        meetingUrl: modality === 'virtual' ? meetingUrl.trim() : null,
      });
      onOpenChange(false);
    } catch {
      // Caller shows the error toast; keep the dialog open so the manager can retry.
    } finally {
      setLoading(false);
    }
  };

  const isWorkingOnSelectedDate = myShifts.length > 0;
  const selectedDateShift = myShifts[0];

  const formatTime12h = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const hour12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isRescheduling ? (
              <>
                <RefreshCw className="h-5 w-5 text-primary" />
                Reschedule Interview
              </>
            ) : (
              <>
                <CalendarCheck className="h-5 w-5 text-primary" />
                Schedule Interview
              </>
            )}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {isRescheduling ? 'Reschedule' : 'Schedule'} an interview with <span className="font-medium text-foreground">{applicantName}</span>
          </p>

          {/* Interview type */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Interview type</Label>
            <RadioGroup
              value={modality}
              onValueChange={(v) => setModality(v as InterviewModality)}
              className="grid grid-cols-3 gap-2"
            >
              {([
                { v: 'in_person', label: 'In person', Icon: MapPin },
                { v: 'virtual', label: 'Virtual', Icon: Video },
                { v: 'phone', label: 'Phone', Icon: Phone },
              ] as const).map(({ v, label, Icon }) => (
                <Label
                  key={v}
                  htmlFor={`modality-${v}`}
                  className={cn(
                    'flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 text-sm',
                    modality === v ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                  )}
                >
                  <RadioGroupItem id={`modality-${v}`} value={v} className="sr-only" />
                  <Icon className="h-4 w-4" />
                  {label}
                </Label>
              ))}
            </RadioGroup>

            {modality === 'virtual' && (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="meeting-url" className="text-sm">Meeting link *</Label>
                <Input
                  id="meeting-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://zoom.us/j/..."
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  onBlur={() => setUrlTouched(true)}
                  aria-invalid={urlTouched && !urlValid}
                />
                {urlTouched && !urlValid && (
                  <p className="text-xs text-destructive">Paste a full link starting with https://</p>
                )}
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>Create the meeting in Zoom, Google Meet, or Teams, then paste the join link here. It goes on the invite email and calendar.</p>
                  <p>Zoom: New Meeting → Copy Invitation / Copy Link</p>
                  <p>Google Meet: Calendar → Add Google Meet → copy meet.google.com link</p>
                  <p>Teams: Calendar → New meeting → Copy meeting link</p>
                  <p>Prefer a lasting room (Zoom PMI / recurring Meet) if you might reschedule.</p>
                </div>
              </div>
            )}

            {modality === 'phone' && (
              <p className="text-xs text-muted-foreground">
                You'll call the applicant. Their invite just says a manager will reach out by phone.
              </p>
            )}
          </div>

          {/* Calendar */}
          <div className="flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              disabled={(date) => { const t = new Date(); t.setHours(0,0,0,0); return date < t; }}
              className="rounded-md border pointer-events-auto"
            />
          </div>

          {/* Schedule status for selected date */}
          {selectedDate && (
            <div className={cn(
              "p-3 rounded-lg border",
              isWorkingOnSelectedDate 
                ? "bg-green-500/10 border-green-500/30" 
                : "bg-amber-500/10 border-amber-500/30"
            )}>
              {checkingSchedule ? (
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking your schedule...
                </div>
              ) : isWorkingOnSelectedDate ? (
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    You work {formatTime12h(selectedDateShift.start_time)} - {formatTime12h(selectedDateShift.end_time)} on {format(selectedDate, 'MMM d')}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-4 w-4" />
                  <span>You are not scheduled to work on {format(selectedDate, 'MMM d')}</span>
                </div>
              )}
            </div>
          )}

          {/* Managers working that day */}
          {selectedDate && (
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                Managers Working ({managerShifts.length})
              </label>
              {checkingSchedule ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </div>
              ) : managerShifts.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No managers scheduled</p>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {managerShifts.map(shift => {
                    const shiftUser = Array.isArray(shift.user) ? shift.user[0] : shift.user;
                    return (
                      <Card key={shift.id} className="bg-muted/50">
                        <CardContent className="py-1.5 px-2">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={shiftUser?.profile_photo_url} />
                              <AvatarFallback>
                                <UserCircle className="h-4 w-4" />
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium flex-1 truncate">
                              {shiftUser?.full_name || 'Unknown'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatTime12h(shift.start_time)} - {formatTime12h(shift.end_time)}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Time selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Interview Time
            </label>
            <Select value={selectedTime} onValueChange={setSelectedTime}>
              <SelectTrigger>
                <SelectValue placeholder="Select time" />
              </SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {timeSlots.filter(slot => { if (!selectedDate) return true; const n = new Date(); if (selectedDate.toDateString() !== n.toDateString()) return true; const [h,m] = slot.value.split(':').map(Number); return h*60+m > n.getHours()*60+n.getMinutes(); }).map(slot => (
                  <SelectItem key={slot.value} value={slot.value}>
                    {slot.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedDate && selectedTime && (
            <div className="bg-muted/50 p-3 rounded-lg text-center">
              <p className="text-sm text-muted-foreground">Interview scheduled for:</p>
              <p className="font-semibold text-lg">
                {format(selectedDate, 'EEEE, MMMM d, yyyy')}
              </p>
              <p className="text-primary font-medium">
                {timeSlots.find(t => t.value === selectedTime)?.label}
                {' · '}
                {modality === 'virtual' ? 'Virtual' : modality === 'phone' ? 'Phone call' : 'In person'}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSchedule} 
            disabled={!selectedDate || !selectedTime || loading || (modality === 'virtual' && !urlValid)}
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isRescheduling ? 'Send New Invitation' : 'Send Invitation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
