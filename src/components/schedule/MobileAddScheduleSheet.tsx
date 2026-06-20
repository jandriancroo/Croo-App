import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format, addDays, startOfWeek } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Trash2, Check, Eye, CalendarOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MobileDayPreviewSheet } from './MobileDayPreviewSheet';
import { AvailabilityRequest } from '@/hooks/useScheduleData';

interface Profile {
  id: string;
  full_name: string;
  nickname?: string | null;
  profile_photo_url: string | null;
}

interface Template {
  id: string;
  template_name: string;
  start_time: string;
  end_time: string;
  color: string | null;
}

interface ExistingShift {
  id: string;
  user_id: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  template_id?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekStart: Date;
  profiles: Profile[];
  templates: Template[];
  scheduleId: string | null;
  locationId?: string | null;
  shifts: ExistingShift[];
  defaultDate?: Date;
  defaultEmployeeId?: string | null;
  locationSettings?: { hours_open?: string; hours_close?: string } | null;
  availabilityRequests?: AvailabilityRequest[];
  onCreated?: () => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  // Subtract 30-min unpaid break if shift > 5h
  if (mins > 5 * 60) mins -= 30;
  return mins / 60;
}

function fmt12(t: string): string {
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${m} ${ampm}`;
}

function availabilityForDay(
  requests: AvailabilityRequest[],
  userId: string,
  dateStr: string
): AvailabilityRequest[] {
  return requests.filter(r => {
    if (r.user_id !== userId) return false;
    if (r.status !== 'pending' && r.status !== 'approved') return false;
    if (r.time_scope === 'multi_day' && r.end_date) {
      return dateStr >= r.start_date && dateStr <= r.end_date;
    }
    return r.start_date === dateStr;
  });
}


export function MobileAddScheduleSheet({
  open,
  onOpenChange,
  weekStart,
  profiles,
  templates,
  scheduleId,
  locationId,
  shifts,
  defaultDate,
  defaultEmployeeId,
  locationSettings,
  availabilityRequests = [],
  onCreated,
}: Props) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'shift' | 'employee'>('shift');
  const [dayPreviewOpen, setDayPreviewOpen] = useState(false);

  // Week anchored to Monday
  const mondayStart = useMemo(() => startOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(mondayStart, i)),
    [mondayStart]
  );

  // ============ ADD SHIFT TAB STATE ============
  const [shiftUserId, setShiftUserId] = useState<string>('unassigned');
  const [shiftTemplateId, setShiftTemplateId] = useState<string>('');
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('17:00');
  const [selectedDayIdxs, setSelectedDayIdxs] = useState<number[]>([]);
  const [savingShift, setSavingShift] = useState(false);

  // ============ EMPLOYEE SCHEDULE TAB STATE ============
  const [empUserId, setEmpUserId] = useState<string>('');
  const [dayCursor, setDayCursor] = useState(0); // 0..6 (Mon..Sun)
  // per-day draft: dayIdx -> { start, end, templateId } | null (skip)
  type DayDraft = { start: string; end: string; templateId: string | null } | null;
  const [weekDraft, setWeekDraft] = useState<Record<number, DayDraft>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [savingWeek, setSavingWeek] = useState(false);

  // Init defaults on open
  useEffect(() => {
    if (!open) return;
    setTab('shift');
    setShiftUserId('unassigned');
    setShiftTemplateId('');
    setShiftStart('09:00');
    setShiftEnd('17:00');
    if (defaultDate) {
      const idx = weekDays.findIndex(d => format(d, 'yyyy-MM-dd') === format(defaultDate, 'yyyy-MM-dd'));
      setSelectedDayIdxs(idx >= 0 ? [idx] : []);
      setDayCursor(idx >= 0 ? idx : 0);
    } else {
      setSelectedDayIdxs([]);
      setDayCursor(0);
    }
    setEmpUserId(defaultEmployeeId || '');
    setWeekDraft({});
  }, [open]); // eslint-disable-line

  const empProfile = profiles.find(p => p.id === empUserId);
  const empName = empProfile ? (empProfile.nickname || empProfile.full_name) : '';

  // Existing shifts for picked employee this week
  const empExistingByDay = useMemo(() => {
    const map: Record<string, ExistingShift> = {};
    if (!empUserId) return map;
    shifts
      .filter(s => s.user_id === empUserId)
      .forEach(s => { map[s.shift_date] = s; });
    return map;
  }, [empUserId, shifts]);

  const totalWeekHours = useMemo(() => {
    let h = 0;
    // existing shifts not overridden
    weekDays.forEach((d, i) => {
      const draft = weekDraft[i];
      if (draft) {
        h += hoursBetween(draft.start, draft.end);
      } else {
        const ex = empExistingByDay[format(d, 'yyyy-MM-dd')];
        if (ex) h += hoursBetween(ex.start_time, ex.end_time);
      }
    });
    return h;
  }, [weekDraft, empExistingByDay, weekDays]);

  // ============ HANDLERS ============
  const applyTemplateToShift = (id: string) => {
    setShiftTemplateId(id);
    const t = templates.find(x => x.id === id);
    if (t) {
      setShiftStart(t.start_time);
      setShiftEnd(t.end_time);
    }
  };

  const applyTemplateToDayDraft = (id: string) => {
    const t = templates.find(x => x.id === id);
    if (!t) return;
    setWeekDraft(prev => ({
      ...prev,
      [dayCursor]: { start: t.start_time, end: t.end_time, templateId: id },
    }));
  };

  const setCustomDayDraft = (start: string, end: string) => {
    setWeekDraft(prev => ({
      ...prev,
      [dayCursor]: { start, end, templateId: prev[dayCursor]?.templateId ?? null },
    }));
  };

  const clearDayDraft = () => {
    setWeekDraft(prev => {
      const next = { ...prev };
      delete next[dayCursor];
      return next;
    });
  };

  const toggleDay = (i: number) => {
    setSelectedDayIdxs(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i].sort());
  };

  const ensureSchedule = async (): Promise<string | null> => {
    if (scheduleId) return scheduleId;
    if (!locationId) return null;
    const weekStartStr = format(mondayStart, 'yyyy-MM-dd');
    const weekEndStr = format(addDays(mondayStart, 6), 'yyyy-MM-dd');
    const { data: existing } = await supabase
      .from('schedules')
      .select('id')
      .eq('week_start_date', weekStartStr)
      .eq('location_id', locationId)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data: created, error } = await supabase
      .from('schedules')
      .insert({ week_start_date: weekStartStr, week_end_date: weekEndStr, location_id: locationId })
      .select('id')
      .single();
    if (error) throw error;
    return created.id;
  };

  const handleSaveShift = async () => {
    if (selectedDayIdxs.length === 0) {
      toast.error('Select at least one day');
      return;
    }
    setSavingShift(true);
    try {
      const sid = await ensureSchedule();
      if (!sid) {
        toast.error('No location selected');
        return;
      }
      const rows = selectedDayIdxs.map(i => {
        const d = weekDays[i];
        return {
          schedule_id: sid,
          start_time: shiftStart,
          end_time: shiftEnd,
          user_id: shiftUserId === 'unassigned' ? null : shiftUserId,
          template_id: shiftTemplateId || null,
          day_of_week: d.getDay(),
          shift_date: format(d, 'yyyy-MM-dd'),
        };
      });
      const { error } = await supabase.from('scheduled_shifts').insert(rows);
      if (error) throw error;
      toast.success(`Created ${rows.length} shift${rows.length > 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: ['schedule', locationId] });
      onCreated?.();
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to create shifts');
    } finally {
      setSavingShift(false);
    }
  };

  const handleApplyWeek = async () => {
    if (!empUserId) {
      toast.error('Pick a team member first');
      return;
    }
    const entries = Object.entries(weekDraft).filter(([, v]) => v) as [string, NonNullable<DayDraft>][];
    if (entries.length === 0) {
      toast.error('No shifts drafted');
      return;
    }
    setSavingWeek(true);
    try {
      const sid = await ensureSchedule();
      if (!sid) {
        toast.error('No location selected');
        return;
      }
      const rows = entries.map(([idxStr, v]) => {
        const i = parseInt(idxStr);
        const d = weekDays[i];
        return {
          schedule_id: sid,
          start_time: v.start,
          end_time: v.end,
          user_id: empUserId,
          template_id: v.templateId || null,
          day_of_week: d.getDay(),
          shift_date: format(d, 'yyyy-MM-dd'),
        };
      });
      const { error } = await supabase.from('scheduled_shifts').insert(rows);
      if (error) throw error;
      toast.success(`Scheduled ${rows.length} shift${rows.length > 1 ? 's' : ''} for ${empName}`);
      queryClient.invalidateQueries({ queryKey: ['schedule', locationId] });
      onCreated?.();
      setReviewOpen(false);
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to apply schedule');
    } finally {
      setSavingWeek(false);
    }
  };

  // Current day in employee tab
  const currentDay = weekDays[dayCursor];
  const currentDraft = weekDraft[dayCursor];
  const currentExisting = empUserId ? empExistingByDay[format(currentDay, 'yyyy-MM-dd')] : null;

  const currentDayAvailability = useMemo(() => {
    if (!empUserId || !currentDay) return [];
    const dateStr = format(currentDay, 'yyyy-MM-dd');
    return availabilityRequests.filter(r => {
      if (r.user_id !== empUserId) return false;
      if (r.status !== 'pending' && r.status !== 'approved') return false;
      if (r.time_scope === 'multi_day' && r.end_date) {
        return dateStr >= r.start_date && dateStr <= r.end_date;
      }
      return r.start_date === dateStr;
    });
  }, [empUserId, currentDay, availabilityRequests]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Add to Schedule</DialogTitle>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="shift">Add Shift</TabsTrigger>
              <TabsTrigger value="employee">Employee Schedule</TabsTrigger>
            </TabsList>

            {/* ============ ADD SHIFT TAB ============ */}
            <TabsContent value="shift" className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label>Quick Fill</Label>
                <Select
                  value={shiftTemplateId || 'none'}
                  onValueChange={(v) => v === 'none' ? setShiftTemplateId('') : applyTemplateToShift(v)}
                >
                  <SelectTrigger><SelectValue placeholder="Choose template" /></SelectTrigger>
                  <SelectContent className="max-w-[calc(100vw-2rem)]">
                    <SelectItem value="none">None — custom times</SelectItem>
                    {templates.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{t.template_name.split(/\d{1,2}:\d{2}/)[0].trim()}</span>
                          <span className="text-xs text-muted-foreground">{fmt12(t.start_time)} – {fmt12(t.end_time)}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Times</Label>
                <div className="flex items-center gap-2">
                  <Input type="time" value={shiftStart} onChange={e => setShiftStart(e.target.value)} />
                  <span>–</span>
                  <Input type="time" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Assign To</Label>
                <Select value={shiftUserId} onValueChange={setShiftUserId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {profiles.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.nickname || p.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Days {selectedDayIdxs.length > 0 && <span className="text-muted-foreground font-normal">({selectedDayIdxs.length} selected)</span>}</Label>
                <div className="grid grid-cols-7 gap-1">
                  {weekDays.map((d, i) => {
                    const active = selectedDayIdxs.includes(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleDay(i)}
                        className={cn(
                          "flex flex-col items-center py-2 rounded-lg border transition",
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:bg-muted"
                        )}
                      >
                        <span className="text-[10px] font-medium uppercase">{DAY_LABELS[i]}</span>
                        <span className="text-sm font-bold">{format(d, 'd')}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">Tap to apply this shift to multiple days at once.</p>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={handleSaveShift} disabled={savingShift || selectedDayIdxs.length === 0}>
                  {savingShift ? 'Creating...' : `Create ${selectedDayIdxs.length || ''} Shift${selectedDayIdxs.length === 1 ? '' : 's'}`}
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* ============ EMPLOYEE SCHEDULE TAB ============ */}
            <TabsContent value="employee" className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label>Team Member</Label>
                <Select value={empUserId} onValueChange={setEmpUserId}>
                  <SelectTrigger><SelectValue placeholder="Pick employee" /></SelectTrigger>
                  <SelectContent>
                    {profiles.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.nickname || p.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {empProfile && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={empProfile.profile_photo_url || undefined} />
                        <AvatarFallback>{empName.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{empName}</p>
                        <p className="text-xs text-muted-foreground">{totalWeekHours.toFixed(1)}h this week</p>
                      </div>
                    </div>

                    {currentDayAvailability.length > 0 && (
                      <div className="space-y-1.5">
                        {currentDayAvailability.map(req => (
                          <div
                            key={req.id}
                            className={cn(
                              "flex items-center gap-2 rounded-md border px-3 py-2",
                              req.status === 'pending'
                                ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50"
                                : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50"
                            )}
                          >
                            <CalendarOff className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              req.status === 'pending' ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                            )} />
                            <div className="flex-1 min-w-0">
                              <p className={cn(
                                "text-xs font-medium",
                                req.status === 'pending' ? "text-amber-800 dark:text-amber-300" : "text-emerald-800 dark:text-emerald-300"
                              )}>
                                {req.request_type === 'time_off' ? 'Time Off' : 'Availability'} {req.status === 'pending' ? 'Pending' : 'Approved'}
                              </p>
                              <p className={cn(
                                "text-[10px] truncate",
                                req.status === 'pending' ? "text-amber-700/80 dark:text-amber-400/80" : "text-emerald-700/80 dark:text-emerald-400/80"
                              )}>
                                {req.time_scope === 'partial_day' && req.start_time && req.end_time
                                  ? `${fmt12(req.start_time)} – ${fmt12(req.end_time)}`
                                  : req.time_scope === 'multi_day' && req.end_date
                                    ? `${format(new Date(req.start_date + 'T12:00:00'), 'MMM d')} – ${format(new Date(req.end_date + 'T12:00:00'), 'MMM d')}`
                                    : 'All day'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {empUserId && (
                <>
                  {/* Day stepper */}
                  <div className="flex items-center justify-between rounded-xl border bg-card px-2 py-2">
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => setDayCursor(c => (c - 1 + 7) % 7)}
                      className="h-9 w-9"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <button
                      type="button"
                      onClick={() => scheduleId && setDayPreviewOpen(true)}
                      disabled={!scheduleId}
                      className="text-center flex flex-col items-center gap-0.5 px-3 py-1 rounded-md hover:bg-muted/50 active:bg-muted transition disabled:opacity-100 disabled:cursor-default"
                    >
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{format(currentDay, 'EEEE')}</p>
                      <p className="text-sm font-semibold flex items-center gap-1.5">
                        {format(currentDay, 'MMM d')}
                        {scheduleId && <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                      </p>
                    </button>
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => setDayCursor(c => (c + 1) % 7)}
                      className="h-9 w-9"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                  </div>

                  {/* Day dots */}
                  <div className="grid grid-cols-7 gap-1">
                    {weekDays.map((d, i) => {
                      const has = !!weekDraft[i] || !!empExistingByDay[format(d, 'yyyy-MM-dd')];
                      const isCursor = i === dayCursor;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setDayCursor(i)}
                          className={cn(
                            "flex flex-col items-center py-1.5 rounded-md border text-[10px] transition",
                            isCursor ? "border-primary bg-primary/10" : "border-border",
                            has && !isCursor && "bg-primary/5"
                          )}
                        >
                          <span className="uppercase font-medium">{DAY_LABELS[i]}</span>
                          {has && <span className="mt-0.5 h-1 w-1 rounded-full bg-primary" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Existing shift hint */}
                  {currentExisting && !currentDraft && (
                    <div className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
                      Already scheduled: {fmt12(currentExisting.start_time)} – {fmt12(currentExisting.end_time)}.
                      Drafting here will add another shift.
                    </div>
                  )}

                  {/* Apply template */}
                  <div className="space-y-2">
                    <Label>Apply Template</Label>
                    {(() => {
                      const selectedTpl = templates.find(t => t.id === currentDraft?.templateId);
                      return (
                        <Select
                          value={currentDraft?.templateId || 'none'}
                          onValueChange={(v) => v === 'none' ? clearDayDraft() : applyTemplateToDayDraft(v)}
                        >
                          <SelectTrigger className={cn(
                            "h-auto min-h-[3rem] py-2",
                            selectedTpl && "border-primary/40 bg-primary/5"
                          )}>
                            {selectedTpl ? (
                              <div className="flex flex-col items-start text-left flex-1 min-w-0">
                                <span className="font-semibold text-sm leading-tight truncate w-full">
                                  {selectedTpl.template_name.split(/\d{1,2}:\d{2}/)[0].trim()}
                                </span>
                                <span className="text-xs text-muted-foreground mt-0.5">
                                  {fmt12(selectedTpl.start_time)} – {fmt12(selectedTpl.end_time)}
                                </span>
                              </div>
                            ) : (
                              <SelectValue placeholder="Choose template" />
                            )}
                          </SelectTrigger>
                          <SelectContent className="max-w-[calc(100vw-2rem)]">
                            <SelectItem value="none">Skip this day</SelectItem>
                            {templates.map(t => (
                              <SelectItem key={t.id} value={t.id}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{t.template_name.split(/\d{1,2}:\d{2}/)[0].trim()}</span>
                                  <span className="text-xs text-muted-foreground">{fmt12(t.start_time)} – {fmt12(t.end_time)}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                  </div>

                  {/* Custom times */}
                  <div className="space-y-2">
                    <Label>Or Custom Times</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={currentDraft?.start || ''}
                        onChange={e => setCustomDayDraft(e.target.value, currentDraft?.end || '17:00')}
                      />
                      <span>–</span>
                      <Input
                        type="time"
                        value={currentDraft?.end || ''}
                        onChange={e => setCustomDayDraft(currentDraft?.start || '09:00', e.target.value)}
                      />
                      {currentDraft && (
                        <Button variant="ghost" size="icon" onClick={clearDayDraft} className="h-9 w-9 shrink-0">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                    {currentDraft && (
                      <p className="text-xs text-muted-foreground">
                        {hoursBetween(currentDraft.start, currentDraft.end).toFixed(1)}h
                      </p>
                    )}
                  </div>

                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button
                      onClick={() => setReviewOpen(true)}
                      disabled={Object.values(weekDraft).filter(Boolean).length === 0}
                    >
                      Review & Apply
                    </Button>
                  </DialogFooter>
                </>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ============ REVIEW DIALOG ============ */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Week for {empName}</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            {weekDays.map((d, i) => {
              const draft = weekDraft[i];
              const existing = empExistingByDay[format(d, 'yyyy-MM-dd')];
              const dateStr = format(d, 'EEE, MMM d');
              return (
                <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{dateStr}</p>
                    {draft ? (
                      <p className="text-xs text-primary font-semibold">
                        NEW: {fmt12(draft.start)} – {fmt12(draft.end)} ({hoursBetween(draft.start, draft.end).toFixed(1)}h)
                      </p>
                    ) : existing ? (
                      <p className="text-xs text-muted-foreground">
                        {fmt12(existing.start_time)} – {fmt12(existing.end_time)} (existing)
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Off</p>
                    )}
                  </div>
                  {draft && <Check className="h-4 w-4 text-primary shrink-0" />}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-primary/10 border border-primary/20 px-4 py-3">
            <span className="text-sm font-medium">Total week hours</span>
            <Badge className="text-base px-3 py-1">{totalWeekHours.toFixed(1)}h</Badge>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Back</Button>
            <Button onClick={handleApplyWeek} disabled={savingWeek}>
              {savingWeek ? 'Applying...' : 'Apply Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ DAY PREVIEW (mobile, with pending draft) ============ */}
      {scheduleId && (
        <MobileDayPreviewSheet
          open={dayPreviewOpen}
          onOpenChange={setDayPreviewOpen}
          date={currentDay}
          scheduleId={scheduleId}
          shifts={shifts}
          profiles={profiles as any}
          locationSettings={locationSettings}
          pendingDraft={
            currentDraft && empProfile
              ? {
                  employeeId: empProfile.id,
                  employeeName: empName,
                  employeePhoto: empProfile.profile_photo_url,
                  start: currentDraft.start,
                  end: currentDraft.end,
                }
              : null
          }
        />
      )}
    </>
  );
}
