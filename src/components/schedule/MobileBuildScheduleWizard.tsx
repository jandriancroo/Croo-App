import { useState, useEffect, useMemo } from 'react';
import { format, addWeeks, addDays, startOfWeek, endOfWeek, differenceInCalendarDays } from 'date-fns';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Calendar, Check, Copy, FilePlus2, LayoutGrid, Loader2, Sparkles, Trash2, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Profile {
  id: string;
  full_name: string;
  nickname?: string | null;
  profile_photo_url: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentWeekStart: Date; // Monday of the week the user is currently viewing
  locationId?: string | null;
  profiles: Profile[];
  onWeekChange?: (weekStart: Date) => void;
  onCompleted?: () => void;
  onOpenWeekEditor?: (weekStart: Date) => void;
}

type Step = 'pick-week' | 'drafts' | 'review' | 'source' | 'applying';

interface DraftSummary {
  scheduleId: string | null;
  isPublished: boolean;
  totalDrafts: number;
  byUser: { userId: string; count: number }[];
}

const fmtDate = (d: Date) => format(d, 'yyyy-MM-dd');

function getInitials(p: Profile) {
  const name = p.nickname || p.full_name || '?';
  return name
    .split(' ')
    .map(n => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function MobileBuildScheduleWizard({
  open,
  onOpenChange,
  currentWeekStart,
  locationId,
  profiles,
  onWeekChange,
  onCompleted,
  onOpenWeekEditor,
}: Props) {
  const thisMonday = useMemo(
    () => startOfWeek(new Date(), { weekStartsOn: 1 }),
    [open] // re-anchor each time wizard opens
  );

  const weekOptions = useMemo(() => {
    return [0, 1, 2, 3].map(offset => {
      const ws = addWeeks(thisMonday, offset);
      const we = endOfWeek(ws, { weekStartsOn: 1 });
      const label = offset === 0 ? 'This week' : offset === 1 ? 'Next week' : `In ${offset} weeks`;
      return { offset, ws, we, label };
    });
  }, [thisMonday]);

  // Lightweight lookup of publish status for the 4 week options
  const [weekStatuses, setWeekStatuses] = useState<Record<string, { isPublished: boolean; draftCount: number }>>({});
  useEffect(() => {
    if (!open || !locationId) return;
    let cancelled = false;
    (async () => {
      const keys = weekOptions.map(o => fmtDate(o.ws));
      const { data: scheds } = await supabase
        .from('schedules')
        .select('id, week_start_date, is_published')
        .eq('location_id', locationId)
        .in('week_start_date', keys);
      if (cancelled || !scheds) return;
      const result: Record<string, { isPublished: boolean; draftCount: number }> = {};
      for (const s of scheds) {
        let draftCount = 0;
        if (!s.is_published) {
          const { count } = await supabase
            .from('scheduled_shifts')
            .select('id', { count: 'exact', head: true })
            .eq('schedule_id', s.id);
          draftCount = count ?? 0;
        }
        result[s.week_start_date as string] = { isPublished: !!s.is_published, draftCount };
      }
      if (!cancelled) setWeekStatuses(result);
    })();
    return () => { cancelled = true; };
  }, [open, locationId, weekOptions]);

  const [step, setStep] = useState<Step>('pick-week');
  const [targetWeek, setTargetWeek] = useState<Date | null>(null);
  const [draftSummary, setDraftSummary] = useState<DraftSummary | null>(null);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [working, setWorking] = useState(false);
  const [clearedUserIds, setClearedUserIds] = useState<Set<string>>(new Set());

  // Reset state whenever the wizard reopens
  useEffect(() => {
    if (open) {
      setStep('pick-week');
      setTargetWeek(null);
      setDraftSummary(null);
      setClearedUserIds(new Set());
    }
  }, [open]);

  // ---------- helpers ----------
  const fetchScheduleAndDrafts = async (weekStart: Date): Promise<DraftSummary> => {
    if (!locationId) return { scheduleId: null, isPublished: false, totalDrafts: 0, byUser: [] };
    const { data: sched } = await supabase
      .from('schedules')
      .select('id, is_published')
      .eq('location_id', locationId)
      .eq('week_start_date', fmtDate(weekStart))
      .maybeSingle();

    if (!sched) return { scheduleId: null, isPublished: false, totalDrafts: 0, byUser: [] };

    // Only count "drafts" if the schedule is unpublished. Published shifts are not drafts.
    if (sched.is_published) {
      return { scheduleId: sched.id, isPublished: true, totalDrafts: 0, byUser: [] };
    }

    const { data: rows } = await supabase
      .from('scheduled_shifts')
      .select('user_id')
      .eq('schedule_id', sched.id);

    const counts = new Map<string, number>();
    (rows || []).forEach(r => {
      const uid = r.user_id || '__unassigned__';
      counts.set(uid, (counts.get(uid) || 0) + 1);
    });
    return {
      scheduleId: sched.id,
      isPublished: false,
      totalDrafts: rows?.length || 0,
      byUser: Array.from(counts.entries()).map(([userId, count]) => ({ userId, count })),
    };
  };

  // ---------- Step 1: pick week ----------
  const handlePickWeek = async (weekStart: Date) => {
    setTargetWeek(weekStart);
    setLoadingDrafts(true);
    try {
      const summary = await fetchScheduleAndDrafts(weekStart);
      setDraftSummary(summary);
      if (summary.isPublished) {
        // Already live — don't run the build flow. Just open the week for edits.
        onWeekChange?.(weekStart);
        onCompleted?.();
        onOpenWeekEditor?.(weekStart);
        onOpenChange(false);
        return;
      }
      if (summary.totalDrafts > 0) {
        setStep('drafts');
      } else {
        setStep('source');
      }
    } catch (e) {
      console.error(e);
      toast.error('Could not check that week. Try again.');
    } finally {
      setLoadingDrafts(false);
    }
  };

  // ---------- Action: Keep & continue ----------
  const handleKeepAndContinue = () => {
    if (!targetWeek) return;
    onWeekChange?.(targetWeek);
    onCompleted?.();
    onOpenWeekEditor?.(targetWeek);
    onOpenChange(false);
  };

  // ---------- Action: Clear all drafts in target week ----------
  const clearDraftsForUsers = async (userIds: string[] | 'all') => {
    if (!draftSummary?.scheduleId) return;
    setWorking(true);
    try {
      let q = supabase.from('scheduled_shifts').delete().eq('schedule_id', draftSummary.scheduleId);
      if (userIds !== 'all') {
        // Split unassigned vs real user ids
        const real = userIds.filter(u => u !== '__unassigned__');
        const hasUnassigned = userIds.includes('__unassigned__');
        if (real.length && hasUnassigned) {
          // Two-step deletion
          await supabase.from('scheduled_shifts').delete().eq('schedule_id', draftSummary.scheduleId).in('user_id', real);
          const { error } = await supabase.from('scheduled_shifts').delete().eq('schedule_id', draftSummary.scheduleId).is('user_id', null);
          if (error) throw error;
        } else if (real.length) {
          const { error } = await q.in('user_id', real);
          if (error) throw error;
        } else if (hasUnassigned) {
          const { error } = await q.is('user_id', null);
          if (error) throw error;
        }
      } else {
        const { error } = await q;
        if (error) throw error;
      }
    } finally {
      setWorking(false);
    }
  };

  const handleClearAndRestart = async () => {
    try {
      await clearDraftsForUsers('all');
      // Refresh summary then go to source step
      if (targetWeek) {
        const fresh = await fetchScheduleAndDrafts(targetWeek);
        setDraftSummary(fresh);
      }
      setStep('source');
    } catch (e) {
      console.error(e);
      toast.error('Failed to clear drafts.');
    }
  };

  // ---------- Action: Review per-person ----------
  const handleReviewDone = async () => {
    if (clearedUserIds.size > 0) {
      try {
        await clearDraftsForUsers(Array.from(clearedUserIds));
      } catch (e) {
        console.error(e);
        toast.error('Failed to clear some drafts.');
        return;
      }
    }
    // After review, drop into the editor for that week with kept drafts intact
    if (targetWeek) {
      onWeekChange?.(targetWeek);
      onOpenWeekEditor?.(targetWeek);
    }
    onCompleted?.();
    onOpenChange(false);
  };

  // ---------- Step 3: Source (copy / blank) ----------
  const ensureSchedule = async (weekStart: Date): Promise<string | null> => {
    if (!locationId) return null;
    const existing = await supabase
      .from('schedules')
      .select('id')
      .eq('location_id', locationId)
      .eq('week_start_date', fmtDate(weekStart))
      .maybeSingle();
    if (existing.data?.id) return existing.data.id;
    const we = endOfWeek(weekStart, { weekStartsOn: 1 });
    const { data: created, error } = await supabase
      .from('schedules')
      .insert({
        week_start_date: fmtDate(weekStart),
        week_end_date: fmtDate(we),
        location_id: locationId,
        is_published: false,
      })
      .select('id')
      .single();
    if (error) throw error;
    return created.id;
  };

  const handleStartBlank = async () => {
    if (!targetWeek) return;
    setStep('applying');
    setWorking(true);
    try {
      await ensureSchedule(targetWeek);
      onWeekChange?.(targetWeek);
      onCompleted?.();
      onOpenWeekEditor?.(targetWeek);
      toast.success('Empty week ready — start adding shifts.');
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error('Could not set up that week.');
      setStep('source');
    } finally {
      setWorking(false);
    }
  };

  const handleCopyFromPrior = async () => {
    if (!targetWeek || !locationId) return;
    setStep('applying');
    setWorking(true);
    try {
      // Walk back up to 8 weeks looking for the most recent PUBLISHED week
      let sourceSnapshot: any[] | null = null;
      let sourceWeekStart: Date | null = null;
      for (let back = 1; back <= 8; back++) {
        const candidate = addWeeks(targetWeek, -back);
        const { data: sched } = await supabase
          .from('schedules')
          .select('id, is_published, published_shifts_snapshot')
          .eq('location_id', locationId)
          .eq('week_start_date', fmtDate(candidate))
          .maybeSingle();
        if (sched?.is_published && Array.isArray(sched.published_shifts_snapshot) && sched.published_shifts_snapshot.length > 0) {
          sourceSnapshot = sched.published_shifts_snapshot as any[];
          sourceWeekStart = candidate;
          break;
        }
      }

      if (!sourceSnapshot || !sourceWeekStart) {
        toast.error('No published week found in the last 8 weeks to copy from.');
        setStep('source');
        return;
      }

      const targetScheduleId = await ensureSchedule(targetWeek);
      if (!targetScheduleId) throw new Error('Schedule create failed');

      const weekShift = differenceInCalendarDays(targetWeek, sourceWeekStart);
      const newRows = sourceSnapshot.map((s: any) => {
        const oldDate = s.shift_date ? new Date(s.shift_date + 'T00:00:00') : null;
        const newDate = oldDate ? addDays(oldDate, weekShift) : addDays(targetWeek, s.day_of_week ?? 0);
        return {
          schedule_id: targetScheduleId,
          user_id: s.user_id ?? null,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          is_time_off: s.is_time_off ?? false,
          template_id: s.template_id ?? null,
          shift_date: fmtDate(newDate),
        };
      });

      if (newRows.length > 0) {
        const { error } = await supabase.from('scheduled_shifts').insert(newRows);
        if (error) throw error;
      }

      onWeekChange?.(targetWeek);
      onCompleted?.();
      onOpenWeekEditor?.(targetWeek);
      toast.success(`Copied ${newRows.length} shifts from week of ${format(sourceWeekStart, 'MMM d')} as drafts.`);
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to copy from prior week.');
      setStep('source');
    } finally {
      setWorking(false);
    }
  };

  // ---------- profile helper ----------
  const profileById = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach(p => m.set(p.id, p));
    return m;
  }, [profiles]);

  // ---------- render ----------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-primary" />
            {step === 'pick-week' && 'Build Schedule'}
            {step === 'drafts' && 'In-Progress Drafts'}
            {step === 'review' && 'Review Per Person'}
            {step === 'source' && 'Starting Point'}
            {step === 'applying' && 'Setting Up…'}
          </DialogTitle>
          <DialogDescription>
            {step === 'pick-week' && 'Pick the week you want to build. Past weeks are locked.'}
            {step === 'drafts' && targetWeek && (
              <>This week has <b>{draftSummary?.totalDrafts}</b> draft shift{draftSummary?.totalDrafts === 1 ? '' : 's'} in progress.</>
            )}
            {step === 'review' && 'Keep or clear each person’s drafts, then continue.'}
            {step === 'source' && 'How would you like to start?'}
            {step === 'applying' && 'Preparing your draft week…'}
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1: Pick week */}
        {step === 'pick-week' && (
          <div className="space-y-2 pt-1">
            {weekOptions.map(opt => {
              const status = weekStatuses[fmtDate(opt.ws)];
              const isLive = !!status?.isPublished;
              const draftCount = status?.draftCount ?? 0;
              return (
                <button
                  key={opt.offset}
                  disabled={loadingDrafts}
                  onClick={() => handlePickWeek(opt.ws)}
                  className={cn(
                    'w-full flex items-center justify-between gap-3 p-4 rounded-xl border bg-card hover:bg-primary/5 transition-colors text-left',
                    isLive ? 'border-destructive/40 hover:border-destructive/60' : 'border-border/50 hover:border-primary/60',
                    loadingDrafts && 'opacity-50 pointer-events-none'
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn('p-2 rounded-lg shrink-0', isLive ? 'bg-destructive/10' : 'bg-primary/10')}>
                      <Calendar className={cn('h-4 w-4', isLive ? 'text-destructive' : 'text-primary')} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm flex items-center gap-2">
                        {opt.label}
                        {isLive && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-destructive/10 border border-destructive/30 text-[9px] font-semibold uppercase tracking-wide text-destructive">
                            Live
                          </span>
                        )}
                        {!isLive && draftCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                            {draftCount} draft{draftCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {format(opt.ws, 'MMM d')} – {format(opt.we, 'MMM d')}
                        {isLive && ' · already published — opens for edits'}
                      </div>
                    </div>
                  </div>
                  {loadingDrafts && targetWeek && fmtDate(targetWeek) === fmtDate(opt.ws) && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* STEP 2: Drafts exist */}
        {step === 'drafts' && draftSummary && targetWeek && (
          <div className="space-y-3 pt-1">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                These are unpublished drafts — staff can’t see them yet. Keep building, review person-by-person, or
                start over.
              </span>
            </div>

            <Button className="w-full justify-start h-auto py-3" onClick={handleKeepAndContinue}>
              <Check className="h-4 w-4" />
              <div className="text-left ml-1">
                <div className="font-semibold text-sm">Keep & continue</div>
                <div className="text-[11px] opacity-80">Open the week as-is and keep editing.</div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start h-auto py-3"
              onClick={() => {
                setClearedUserIds(new Set());
                setStep('review');
              }}
            >
              <Users className="h-4 w-4" />
              <div className="text-left ml-1">
                <div className="font-semibold text-sm">Review per person</div>
                <div className="text-[11px] text-muted-foreground">Keep some, clear others.</div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start h-auto py-3 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
              onClick={handleClearAndRestart}
              disabled={working}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              <div className="text-left ml-1">
                <div className="font-semibold text-sm">Clear all & restart</div>
                <div className="text-[11px] opacity-80">Delete every draft, then start fresh.</div>
              </div>
            </Button>
          </div>
        )}

        {/* STEP 2b: Review per-person */}
        {step === 'review' && draftSummary && (
          <div className="space-y-3 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setStep('drafts')} className="-ml-2 h-8">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <div className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-1">
              {draftSummary.byUser.map(({ userId, count }) => {
                const profile = userId === '__unassigned__' ? null : profileById.get(userId);
                const cleared = clearedUserIds.has(userId);
                return (
                  <div
                    key={userId}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded-lg border',
                      cleared ? 'border-destructive/40 bg-destructive/5' : 'border-border/50 bg-card'
                    )}
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      {profile?.profile_photo_url && <AvatarImage src={profile.profile_photo_url} />}
                      <AvatarFallback className="text-xs">
                        {profile ? getInitials(profile) : '—'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className={cn('text-sm font-medium truncate', cleared && 'line-through opacity-60')}>
                        {profile ? (profile.nickname || profile.full_name) : 'Unassigned'}
                      </div>
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 mt-0.5">
                        {count} draft{count === 1 ? '' : 's'}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant={cleared ? 'outline' : 'ghost'}
                      className={cn('h-8 px-2 text-xs', !cleared && 'text-destructive hover:text-destructive')}
                      onClick={() => {
                        setClearedUserIds(prev => {
                          const next = new Set(prev);
                          if (next.has(userId)) next.delete(userId);
                          else next.add(userId);
                          return next;
                        });
                      }}
                    >
                      {cleared ? 'Undo' : 'Clear'}
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button className="w-full" onClick={handleReviewDone} disabled={working}>
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {clearedUserIds.size > 0 ? `Clear ${clearedUserIds.size} & open week` : 'Open week'}
            </Button>
          </div>
        )}

        {/* STEP 3: Source */}
        {step === 'source' && targetWeek && (
          <div className="space-y-3 pt-1">
            <Button
              className="w-full justify-start h-auto py-3"
              onClick={handleCopyFromPrior}
              disabled={working}
            >
              <Copy className="h-4 w-4" />
              <div className="text-left ml-1">
                <div className="font-semibold text-sm">Copy from prior week</div>
                <div className="text-[11px] opacity-80">Most recent published week, brought in as drafts.</div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start h-auto py-3"
              onClick={handleStartBlank}
              disabled={working}
            >
              <FilePlus2 className="h-4 w-4" />
              <div className="text-left ml-1">
                <div className="font-semibold text-sm">Start blank</div>
                <div className="text-[11px] text-muted-foreground">Open an empty week and build from scratch.</div>
              </div>
            </Button>

            <Button variant="ghost" size="sm" onClick={() => setStep('pick-week')} className="-ml-2 h-8">
              <ArrowLeft className="h-3.5 w-3.5" /> Pick a different week
            </Button>
          </div>
        )}

        {/* STEP 4: Applying */}
        {step === 'applying' && (
          <div className="py-8 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            Preparing your draft week…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
