import { useState, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format, addDays, startOfWeek } from 'date-fns';
import { DateTime } from 'luxon';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Trash2, Check, Eye, CalendarOff, Clock, AlertTriangle, Plus, X as XIcon, Sparkles, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MobileDayPreviewSheet } from './MobileDayPreviewSheet';
import { AvailabilityRequest } from '@/hooks/useScheduleData';
import { useLocationStations } from '@/hooks/useLocationStations';
import { useUserStationAssignments } from '@/hooks/useUserStationAssignments';
import { useQuery } from '@tanstack/react-query';

interface Profile {
  id: string;
  full_name: string;
  nickname?: string | null;
  profile_photo_url: string | null;
  role?: string | null;
}

const ROLE_GROUPS: { key: string; label: string; roles: string[] }[] = [
  { key: 'admin', label: 'Admins', roles: ['super_admin', 'brand_admin', 'org_admin', 'admin'] },
  { key: 'manager', label: 'Managers', roles: ['manager'] },
  { key: 'shift_manager', label: 'Shift Managers', roles: ['shift_manager', 'shift_manager_in_training'] },
  { key: 'team_member', label: 'Team Members', roles: ['team_member'] },
];

const GROUP_STYLE: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  admin:        { bg: 'bg-red-500/12', text: 'text-red-700', border: 'border-red-500/30', dot: 'bg-red-500' },
  manager:      { bg: 'bg-blue-500/12', text: 'text-blue-700', border: 'border-blue-500/30', dot: 'bg-blue-500' },
  shift_manager:{ bg: 'bg-amber-500/12', text: 'text-amber-800', border: 'border-amber-500/30', dot: 'bg-amber-500' },
  team_member:  { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border', dot: 'bg-muted-foreground' },
};

function groupProfilesByRole(profiles: Profile[]) {
  return ROLE_GROUPS.map(g => ({
    ...g,
    members: profiles
      .filter(p => g.roles.includes((p.role || 'team_member') as string))
      .sort((a, b) => (a.nickname || a.full_name).localeCompare(b.nickname || b.full_name)),
  })).filter(g => g.members.length > 0);
}

function ProfileSelectItem({ p, count }: { p: Profile; count: number }) {
  return (
    <SelectItem value={p.id}>
      <span className="flex items-center justify-between gap-2 w-full">
        <span className="truncate">{p.nickname || p.full_name}</span>
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold leading-none shrink-0">
            {count}
          </span>
        )}
      </span>
    </SelectItem>
  );
}

function RoleGroupLabel({ group }: { group: { key: string; label: string } }) {
  const style = GROUP_STYLE[group.key] || GROUP_STYLE.team_member;
  return (
    <SelectLabel
      className={cn(
        "my-1.5 mx-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border flex items-center gap-2",
        style.bg, style.text, style.border
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {group.label}
    </SelectLabel>
  );
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
  /** Prior week's shifts — used to surface "Last Week" templates per employee (Smart Tap behavior). */
  lastWeekShifts?: Array<{ user_id: string | null; template_id: string | null; shift_date: string }>;
  defaultDate?: Date;
  defaultEmployeeId?: string | null;
  defaultTab?: 'shift' | 'employee';
  /** When true, hide the tab switcher and lock to defaultTab (used by the New Shift entry). */
  lockTab?: boolean;
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
  lastWeekShifts = [],
  defaultDate,
  defaultEmployeeId,
  defaultTab = 'shift',
  lockTab = false,
  locationSettings,
  availabilityRequests = [],
  onCreated,
}: Props) {
  const queryClient = useQueryClient();
  const initialTab = lockTab ? defaultTab : 'employee';
  const [tab, setTab] = useState<'shift' | 'employee'>(initialTab);
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);
  const [dayPreviewOpen, setDayPreviewOpen] = useState(false);
  const [availPreviewRequest, setAvailPreviewRequest] = useState<AvailabilityRequest | null>(null);

  // Week anchored to Monday
  const mondayStart = useMemo(() => startOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(mondayStart, i)),
    [mondayStart]
  );

  // ============ ADD SHIFT TAB STATE ============
  const [shiftUserId, setShiftUserId] = useState<string>('');
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
  // When user picks a different team member while drafts exist, we route through Confirm Week.
  // If Apply succeeds → switch to this id; if Back → keep working on the current employee.
  const [pendingEmpSwitchId, setPendingEmpSwitchId] = useState<string | null>(null);
  // Smart-Tap popover state — which day's chip is currently open (0..6, or null)
  const [popoverDayIdx, setPopoverDayIdx] = useState<number | null>(null);
  const customStartRef = useRef<HTMLInputElement>(null);

  // Stations support — only render station UI when location toggled it on
  const { data: stationsEnabledRow } = useQuery({
    queryKey: ['location_stations_enabled', locationId],
    enabled: !!locationId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('location_settings')
        .select('stations_enabled')
        .eq('location_id', locationId)
        .maybeSingle();
      return data;
    },
  });
  const { stations } = useLocationStations(locationId);
  const stationsList = stations ?? [];
  const stationsEnabled = !!(stationsEnabledRow as any)?.stations_enabled && stationsList.length > 0;
  const { assignments: stationAssignments, assign: assignUserStation } = useUserStationAssignments(locationId);

  // Init defaults on open
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setShiftUserId('');
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

  // Smart Tap: last 3 unique template IDs this employee worked LAST WEEK (any day),
  // ordered by most recent. Surfaces at top of the Apply Template dropdown.
  const recentTemplateIds = useMemo(() => {
    if (!empUserId) return [] as string[];
    const employeeShifts = lastWeekShifts
      .filter(s => s.user_id === empUserId && s.template_id)
      .sort((a, b) => (b.shift_date || '').localeCompare(a.shift_date || ''));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of employeeShifts) {
      const tid = s.template_id as string;
      if (!seen.has(tid) && templates.some(t => t.id === tid)) {
        seen.add(tid);
        out.push(tid);
        if (out.length >= 3) break;
      }
    }
    return out;
  }, [empUserId, lastWeekShifts, templates]);

  // Shift count per user (for dropdown badges). For the currently selected user,
  // include in-progress drafts so the badge reflects what they're building right now.
  const shiftCountByUser = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    shifts.forEach(s => {
      if (!s.user_id) return;
      if (!m[s.user_id]) m[s.user_id] = new Set();
      m[s.user_id].add(s.shift_date);
    });
    const out: Record<string, number> = {};
    Object.entries(m).forEach(([uid, set]) => { out[uid] = set.size; });
    if (empUserId) {
      const days = new Set(m[empUserId] || []);
      Object.entries(weekDraft).forEach(([i, v]) => {
        if (v) days.add(format(weekDays[parseInt(i)], 'yyyy-MM-dd'));
      });
      out[empUserId] = days.size;
    }
    return out;
  }, [shifts, weekDraft, empUserId, weekDays]);

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

  // Smart Tap on a day chip → apply template to THAT day and advance cursor to it
  const applyTemplateToDay = (dayIdx: number, templateId: string) => {
    const t = templates.find(x => x.id === templateId);
    if (!t) return;
    setWeekDraft(prev => ({
      ...prev,
      [dayIdx]: { start: t.start_time, end: t.end_time, templateId },
    }));
    setDayCursor(dayIdx);
    setPopoverDayIdx(null);
  };

  // Smart Tap "+ Create" → seed an empty draft (manual), focus cursor to that day,
  // close popover, and focus the custom-times start input below.
  const startManualForDay = (dayIdx: number) => {
    setWeekDraft(prev => ({
      ...prev,
      [dayIdx]: prev[dayIdx] ?? { start: '09:00', end: '17:00', templateId: null },
    }));
    setDayCursor(dayIdx);
    setPopoverDayIdx(null);
    setTimeout(() => customStartRef.current?.focus(), 80);
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
    if (!shiftUserId) {
      toast.error("Pick an employee — shifts can't be left unassigned.");
      return;
    }
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
          user_id: shiftUserId,
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
      // Reset builder state but keep the sheet open so manager can pick the next employee.
      setWeekDraft({});
      setDayCursor(0);
      if (pendingEmpSwitchId) {
        setEmpUserId(pendingEmpSwitchId);
        setPendingEmpSwitchId(null);
      } else {
        setEmpUserId('');
      }
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
    return availabilityForDay(availabilityRequests, empUserId, format(currentDay, 'yyyy-MM-dd'));
  }, [empUserId, currentDay, availabilityRequests]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{lockTab && defaultTab === 'shift' ? 'New Shift' : 'Employee Schedule'}</DialogTitle>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">

            {/* ============ ADD SHIFT TAB ============ */}
            <TabsContent value="shift" className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label>Assign To <span className="text-destructive">*</span></Label>
                <Select value={shiftUserId} onValueChange={setShiftUserId}>
                  <SelectTrigger><SelectValue placeholder="Pick an employee" /></SelectTrigger>
                  <SelectContent>
                    {groupProfilesByRole(profiles).map(g => (
                      <SelectGroup key={g.key}>
                        <RoleGroupLabel group={g} />
                        {g.members.map(p => <ProfileSelectItem key={p.id} p={p} count={shiftCountByUser[p.id] || 0} />)}
                      </SelectGroup>
                    ))}

                  </SelectContent>
                </Select>
              </div>

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
                <Select value={empUserId} onValueChange={(v) => {
                  if (v === empUserId) return;
                  const hasDrafts = Object.values(weekDraft).some(Boolean);
                  if (hasDrafts && empUserId) {
                    setPendingEmpSwitchId(v);
                    setReviewOpen(true);
                  } else {
                    setEmpUserId(v);
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick employee">
                      {empProfile ? (empProfile.nickname || empProfile.full_name) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {groupProfilesByRole(profiles).map(g => (
                      <SelectGroup key={g.key}>
                        <RoleGroupLabel group={g} />
                        {g.members.map(p => <ProfileSelectItem key={p.id} p={p} count={shiftCountByUser[p.id] || 0} />)}
                      </SelectGroup>
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
                          <button
                            key={req.id}
                            type="button"
                            onClick={() => setAvailPreviewRequest(req)}
                            className={cn(
                              "w-full flex items-center gap-2 rounded-md border px-3 py-2 text-left cursor-pointer transition active:scale-95",
                              req.status === 'pending'
                                ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50 hover:bg-amber-100"
                                : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-100"
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
                          </button>
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

                  {/* Day chips — tapping opens a centered fixed Smart Tap dialog */}
                  <div className="grid grid-cols-7 gap-1">
                    {weekDays.map((d, i) => {
                      const dateStr = format(d, 'yyyy-MM-dd');
                      const draft = weekDraft[i];
                      const existing = empExistingByDay[dateStr];
                      const isCursor = i === dayCursor;

                      // Availability requests for this employee on this day
                      const dayAvail = empUserId
                        ? availabilityForDay(availabilityRequests, empUserId, dateStr)
                        : [];
                      const hasApprovedOff = dayAvail.some(r => r.status === 'approved');
                      const hasPendingOff = dayAvail.some(r => r.status === 'pending');

                      // Color line(s) under day label. Draft first, then existing.
                      const lineColors: string[] = [];
                      if (draft) {
                        const tpl = templates.find(t => t.id === draft?.templateId);
                        lineColors.push(tpl?.color || '#94a3b8'); // manual = slate
                      } else if (existing) {
                        const tpl = templates.find(t => t.id === existing.template_id);
                        lineColors.push(tpl?.color || '#94a3b8');
                      }

                      const hasAvail = hasApprovedOff || hasPendingOff;
                      const stripeColor = hasApprovedOff
                        ? 'rgba(16,185,129,0.18)' // emerald
                        : 'rgba(245,158,11,0.20)'; // amber

                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => { setDayCursor(i); setPopoverDayIdx(i); }}
                          className={cn(
                            "flex flex-col items-center justify-between gap-1.5 py-2.5 px-1 rounded-lg border text-[10px] transition active:scale-95 min-h-[52px]",
                            isCursor ? "border-primary bg-primary/10 shadow-sm" : "border-border bg-background",
                            lineColors.length > 0 && !isCursor && "bg-muted/30",
                            hasAvail && !isCursor && "border-dashed border-2 bg-muted/30"
                          )}
                          style={
                            hasAvail && !isCursor
                              ? {
                                  backgroundImage: `repeating-linear-gradient(45deg, ${stripeColor}, ${stripeColor} 4px, transparent 4px, transparent 8px)`,
                                }
                              : undefined
                          }
                          title={
                            hasApprovedOff
                              ? 'Approved time off'
                              : hasPendingOff
                                ? 'Pending time-off request'
                                : undefined
                          }
                        >
                          <span className="uppercase font-semibold tracking-wide">{DAY_LABELS[i]}</span>
                          <div className="flex flex-col items-center gap-0.5 w-full px-1.5">
                            {lineColors.length > 0 ? (
                              lineColors.slice(0, 3).map((c, idx) => (
                                <span
                                  key={idx}
                                  className="h-[3px] w-full rounded-full"
                                  style={{ backgroundColor: c }}
                                />
                              ))
                            ) : (
                              <span className="h-[3px] w-full rounded-full bg-transparent" />
                            )}
                          </div>
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

                  {/* Applied template — read-only display */}
                  <div className="space-y-2">
                    <Label>Applied Template</Label>
                    {(() => {
                      const tpl = templates.find(t => t.id === currentDraft?.templateId);
                      const isOverridden = !!tpl && !!currentDraft &&
                        (currentDraft.start !== tpl.start_time || currentDraft.end !== tpl.end_time);
                      const isManual = !!currentDraft && (!tpl || isOverridden);
                      const isEmpty = !currentDraft;

                      return (
                        <div
                          className={cn(
                            "rounded-md border px-3 py-2.5 flex items-center gap-2.5 min-h-[3rem]",
                            isEmpty && "border-dashed bg-muted/20",
                            !isEmpty && isManual && "border-slate-400/40 bg-slate-500/5",
                            !isEmpty && !isManual && "border-primary/40 bg-primary/5"
                          )}
                        >
                          {isEmpty ? (
                            <p className="text-xs text-muted-foreground italic">
                              Tap a day chip above to apply a template or create manually
                            </p>
                          ) : isManual ? (
                            <>
                              <span className="h-3 w-3 rounded-sm shrink-0 bg-slate-400" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold leading-tight">Manual entry</p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {tpl ? `Overrides "${tpl.template_name.split(/\d{1,2}:\d{2}/)[0].trim()}"` : 'Custom times below'}
                                </p>
                              </div>
                              <Button variant="ghost" size="icon" onClick={clearDayDraft} className="h-7 w-7 shrink-0">
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <span
                                className="h-3 w-3 rounded-sm shrink-0"
                                style={{ backgroundColor: tpl!.color || '#ef4444' }}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold leading-tight truncate">
                                  {tpl!.template_name.split(/\d{1,2}:\d{2}/)[0].trim()}
                                </p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {fmt12(tpl!.start_time)} – {fmt12(tpl!.end_time)}
                                </p>
                              </div>
                              <Button variant="ghost" size="icon" onClick={clearDayDraft} className="h-7 w-7 shrink-0">
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Custom times — overrides the template */}
                  <div className="space-y-2">
                    <Label>Or Custom Times <span className="text-[10px] font-normal text-muted-foreground">(overrides template)</span></Label>
                    <div className="flex items-center gap-2">
                      <Input
                        ref={customStartRef}
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

      {/* ============ SMART TAP DIALOG (centered, fixed) ============ */}
      <Dialog open={popoverDayIdx !== null} onOpenChange={(o) => !o && setPopoverDayIdx(null)}>
        <DialogContent
          className="max-w-[300px] p-2 gap-2 rounded-2xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {popoverDayIdx !== null && (() => {
            const i = popoverDayIdx;
            const d = weekDays[i];
            const dateStr = format(d, 'yyyy-MM-dd');
            const draft = weekDraft[i];
            const existing = empExistingByDay[dateStr];
            return (
              <>
                <DialogHeader className="px-2 pt-1 pb-0">
                  <DialogTitle className="text-sm font-medium text-center">
                    {DAY_LABELS[i]} {format(d, 'MMM d')}
                  </DialogTitle>
                </DialogHeader>

                <div className="space-y-0.5">
                  {/* Stations — assign primary station to this employee */}
                  {stationsEnabled && empUserId && (
                    <>
                      <div className="flex items-center justify-center gap-1 px-2 pt-1 pb-0.5">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Station
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 px-1 pb-1">
                        {stationsList.map((s) => {
                          const active = stationAssignments[empUserId] === s.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => assignUserStation(empUserId, active ? null : s.id)}
                              className={cn(
                                "flex items-center gap-1 px-2 py-1 rounded-md border text-xs transition",
                                active ? "border-primary bg-primary/10" : "border-border hover:bg-accent/70"
                              )}
                            >
                              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                              <span className="truncate max-w-[80px]">{s.name}</span>
                              {active && <Check className="h-3 w-3 text-primary" />}
                            </button>
                          );
                        })}
                        {stationAssignments[empUserId] && (
                          <button
                            type="button"
                            onClick={() => assignUserStation(empUserId, null)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-accent/70"
                          >
                            <XIcon className="h-3 w-3" />
                            Unassign
                          </button>
                        )}
                      </div>
                      <div className="my-1 h-px bg-border" />
                    </>
                  )}


                  {/* + Create — compact, text-only */}
                  <button
                    type="button"
                    onClick={() => startManualForDay(i)}
                    className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left hover:bg-accent/70 transition"
                  >
                    <Plus className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Create — manual times</span>
                  </button>

                  {(recentTemplateIds.length > 0 || templates.length > 0) && (
                    <div className="my-1 h-px bg-border" />
                  )}

                  {/* Last Week */}
                  {recentTemplateIds.length > 0 && (
                    <div className="mb-1">
                      <div className="flex items-center justify-center gap-1 px-2 pt-1 pb-0.5">
                        <Sparkles className="h-3 w-3 text-amber-500" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                          Last Week
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {recentTemplateIds
                          .map(id => templates.find(t => t.id === id))
                          .filter(Boolean)
                          .map((t) => (
                            <button
                              key={t!.id}
                              type="button"
                              onClick={() => applyTemplateToDay(i, t!.id)}
                              className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left hover:bg-accent/70 transition"
                            >
                              <span
                                className="h-3 w-3 rounded-sm shrink-0"
                                style={{ backgroundColor: t!.color || '#ef4444' }}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {t!.template_name.split(/\d{1,2}:\d{2}/)[0].trim()}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {fmt12(t!.start_time)} – {fmt12(t!.end_time)}
                                </p>
                              </div>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* All Templates */}
                  {templates.filter(t => !recentTemplateIds.includes(t.id)).length > 0 && (
                    <>
                      {recentTemplateIds.length > 0 && (
                        <div className="px-2 pt-1 pb-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            All Templates
                          </span>
                        </div>
                      )}
                      <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
                        {templates
                          .filter(t => !recentTemplateIds.includes(t.id))
                          .map(t => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => applyTemplateToDay(i, t.id)}
                              className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left hover:bg-accent/70 transition"
                            >
                              <span
                                className="h-3 w-3 rounded-sm shrink-0"
                                style={{ backgroundColor: t.color || '#ef4444' }}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {t.template_name.split(/\d{1,2}:\d{2}/)[0].trim()}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {fmt12(t.start_time)} – {fmt12(t.end_time)}
                                </p>
                              </div>
                            </button>
                          ))}
                      </div>
                    </>
                  )}

                  {draft && (
                    <>
                      <div className="my-1 h-px bg-border" />
                      <button
                        type="button"
                        onClick={() => { clearDayDraft(); setPopoverDayIdx(null); }}
                        className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-destructive hover:bg-destructive/10 transition"
                      >
                        <XIcon className="h-4 w-4" />
                        <span className="text-sm font-medium">Clear this day</span>
                      </button>
                    </>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ============ REVIEW DIALOG ============ */}
      <Dialog open={reviewOpen} onOpenChange={(o) => { if (!o) setPendingEmpSwitchId(null); setReviewOpen(o); }}>
        <DialogContent className="max-w-md p-0 gap-0 max-h-[90vh] flex flex-col">
          <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0">
            <DialogTitle className="text-base truncate pr-6">Confirm Week — {empName}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {weekDays.map((d, i) => {
              const draft = weekDraft[i];
              const existing = empExistingByDay[format(d, 'yyyy-MM-dd')];
              const dateStr = format(d, 'EEE, MMM d');
              const dayAvailability = empUserId
                ? availabilityForDay(availabilityRequests, empUserId, format(d, 'yyyy-MM-dd'))
                : [];
              const hasAvail = dayAvailability.length > 0;
              const topReq = dayAvailability[0];
              return (
                <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-tight">{dateStr}</p>
                    {draft ? (
                      <p className={cn(
                        "text-xs font-semibold mt-0.5 truncate",
                        hasAvail ? "text-amber-600" : "text-primary"
                      )}>
                        NEW: {fmt12(draft.start)} – {fmt12(draft.end)} ({hoursBetween(draft.start, draft.end).toFixed(1)}h)
                      </p>
                    ) : existing ? (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {fmt12(existing.start_time)} – {fmt12(existing.end_time)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5">Off</p>
                    )}
                  </div>

                  {hasAvail && topReq && (
                    <button
                      type="button"
                      onClick={() => setAvailPreviewRequest(topReq)}
                      className={cn(
                        "flex items-center gap-1 rounded-md border px-1.5 py-1 shrink-0 cursor-pointer transition active:scale-95",
                        topReq.status === 'pending'
                          ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50 hover:bg-amber-100"
                          : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-100"
                      )}
                      title="Tap to view request details"
                    >
                      <CalendarOff className={cn(
                        "h-3 w-3 shrink-0",
                        topReq.status === 'pending' ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                      )} />
                      <span className={cn(
                        "text-[10px] font-medium leading-none",
                        topReq.status === 'pending' ? "text-amber-800 dark:text-amber-300" : "text-emerald-800 dark:text-emerald-300"
                      )}>
                        {topReq.status === 'pending' ? 'Pending' : 'Approved'}
                      </span>
                    </button>
                  )}

                  {draft && <Check className="h-4 w-4 text-primary shrink-0" />}
                </div>
              );
            })}
          </div>

          <div className="px-4 py-3 border-t shrink-0 space-y-3">
            <div className="flex items-center justify-between rounded-xl bg-primary/10 border border-primary/20 px-4 py-2.5">
              <span className="text-sm font-medium">Total week hours</span>
              <Badge className="text-base px-3 py-1">{totalWeekHours.toFixed(1)}h</Badge>
            </div>
            <DialogFooter className="gap-2 flex-row">
              <Button variant="outline" onClick={() => { setPendingEmpSwitchId(null); setReviewOpen(false); }} className="flex-1">Back</Button>
              <Button onClick={handleApplyWeek} disabled={savingWeek} className="flex-1">
                {savingWeek ? 'Applying...' : 'Apply'}
              </Button>
            </DialogFooter>
          </div>
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

      {/* ============ AVAILABILITY REQUEST PREVIEW ============ */}
      <Dialog open={!!availPreviewRequest} onOpenChange={(o) => !o && setAvailPreviewRequest(null)}>
        <DialogContent className="max-w-md p-0 gap-0 max-h-[85vh] flex flex-col">
          <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0">
            <DialogTitle className="text-base pr-6">
              {availPreviewRequest?.request_type === 'time_off' ? 'Time Off Request' : 'Availability Request'}
            </DialogTitle>
          </DialogHeader>

          {availPreviewRequest && (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {/* Status badge */}
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full",
                    availPreviewRequest.status === 'pending'
                      ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                      : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                  )}
                >
                  {availPreviewRequest.status === 'pending' ? 'Pending Approval' : 'Approved'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {availPreviewRequest.request_type === 'time_off' ? 'Time off' : 'Availability'}
                </span>
              </div>

              {/* When */}
              <div className="space-y-2">
                <div className="flex items-start gap-2.5">
                  <CalendarOff className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Dates</p>
                    <p className="text-sm text-muted-foreground">
                      {availPreviewRequest.time_scope === 'multi_day' && availPreviewRequest.end_date
                        ? `${DateTime.fromISO(availPreviewRequest.start_date, { zone: 'America/Los_Angeles' }).toFormat('EEE, MMM d')} – ${DateTime.fromISO(availPreviewRequest.end_date, { zone: 'America/Los_Angeles' }).toFormat('EEE, MMM d')}`
                        : DateTime.fromISO(availPreviewRequest.start_date, { zone: 'America/Los_Angeles' }).toFormat('EEE, MMM d')}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Time</p>
                    <p className="text-sm text-muted-foreground">
                      {availPreviewRequest.time_scope === 'partial_day' && availPreviewRequest.start_time && availPreviewRequest.end_time
                        ? `${fmt12(availPreviewRequest.start_time)} – ${fmt12(availPreviewRequest.end_time)}`
                        : 'All day'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Conflict warning */}
              {(() => {
                // Gather all days covered by this request
                const days: string[] = [];
                if (availPreviewRequest.time_scope === 'multi_day' && availPreviewRequest.end_date) {
                  let cursor = DateTime.fromISO(availPreviewRequest.start_date, { zone: 'America/Los_Angeles' });
                  const end = DateTime.fromISO(availPreviewRequest.end_date, { zone: 'America/Los_Angeles' });
                  while (cursor <= end) {
                    days.push(cursor.toFormat('yyyy-MM-dd'));
                    cursor = cursor.plus({ days: 1 });
                  }
                } else {
                  days.push(availPreviewRequest.start_date);
                }
                const conflicts = days.filter(dateStr => {
                  const dayIdx = weekDays.findIndex(d => format(d, 'yyyy-MM-dd') === dateStr);
                  const draftOnDay = dayIdx >= 0 ? weekDraft[dayIdx] : null;
                  const existingOnDay = empUserId ? empExistingByDay[dateStr] : null;
                  return !!draftOnDay || !!existingOnDay;
                });
                if (conflicts.length === 0) return null;
                const firstConflict = conflicts[0];
                return (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50 px-3 py-3 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Potential conflict</p>
                      <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                        A shift is scheduled for this employee on {DateTime.fromISO(firstConflict, { zone: 'America/Los_Angeles' }).toFormat('EEE, MMM d')}
                        {conflicts.length > 1 && ` and ${conflicts.length - 1} other day${conflicts.length > 2 ? 's' : ''}`}. Review before applying.
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="px-4 py-3 border-t shrink-0">
            <DialogFooter>
              <Button onClick={() => setAvailPreviewRequest(null)} className="w-full">Close</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
