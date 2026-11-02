import { useState } from 'react';
import { DateTime } from 'luxon';
import { Pencil, Radio, CalendarDays, CircleHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { resolveGoalWithSource, type GoalSource } from '@/lib/goalResolver';

interface ProjectionTagProps {
  source?: GoalSource | null;
  size?: 'sm' | 'md'; showLabel?: boolean; className?: string;
  locationId?: string; dateStr?: string; timezone?: string;
  planningValue?: number | null;
}
const dollars = (n: number) => `$${Math.round(n).toLocaleString()}`;
export function ProjectionTag({ source = 'none', size = 'sm', showLabel = true, className = '', locationId, dateStr, timezone = 'America/Los_Angeles', planningValue }: ProjectionTagProps) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['goal-version-details', locationId, dateStr], enabled: open && !!locationId && !!dateStr,
    queryFn: async () => {
      const [goal, audit] = await Promise.all([
        supabase.from('sales_cache').select('initial_projection, living_projection, override_projection').eq('location_id', locationId ?? '').eq('sale_date', dateStr ?? '').maybeSingle(),
        supabase.from('sales_goal_override_log').select('*').eq('location_id', locationId ?? '').eq('sale_date', dateStr ?? '').order('changed_at', { ascending: false }),
      ]);
      if (goal.error) throw goal.error;
      const logs = audit.data ?? [];
      const ids = [...new Set(logs.flatMap(r => r.changed_by ? [r.changed_by] : []))];
      const profiles = ids.length ? await supabase.from('profiles').select('id, full_name').in('id', ids) : { data: [] };
      const names = new Map((profiles.data ?? []).map(p => [p.id, p.full_name]));
      return { goal: goal.data, logs: logs.map(r => ({ ...r, name: r.changed_by ? names.get(r.changed_by) ?? 'Manager' : 'System' })) };
    }, staleTime: 0,
  });
  const kind = source ?? 'none';
  const labels = { planning: 'Planning', living: 'Living', override: 'Override', none: 'None' };
  const Icon = kind === 'override' ? Pencil : kind === 'living' ? Radio : kind === 'planning' ? CalendarDays : CircleHelp;
  const planning = data?.goal?.initial_projection ?? planningValue;
  const date = DateTime.fromFormat(dateStr ?? '', 'yyyy-MM-dd', { zone: timezone });
  const lockDate = date.isValid ? date.startOf('week').minus({ weeks: 1 }).toFormat('MMM d') : '';
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()} className={`h-auto min-h-5 gap-1 rounded-sm border-border bg-muted text-foreground px-1.5 py-0 font-medium ${size === 'sm' ? 'text-[10px]' : 'text-xs'} ${className}`} aria-label={`${labels[kind]} goal details`}>
        <Icon className="h-3 w-3" />{showLabel && labels[kind]}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-72 max-h-64 overflow-y-auto text-xs space-y-2" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
      {kind === 'none' && <p>No goal yet</p>}
      {kind === 'living' && <p>{planning != null ? `Started at ${dollars(planning)} (Planning, locked Mon ${lockDate})` : `Planning locks Mon ${lockDate}`}</p>}
      {kind === 'planning' && <p>{planning != null ? `${dollars(planning)} · Planning, locked Mon ${lockDate}` : `Planning locks Mon ${lockDate}`}</p>}
      {kind === 'override' && (data?.logs.length ? data.logs.map(log => {
        const prior = resolveGoalWithSource({ override_projection: log.old_value, living_projection: log.living_at_change, initial_projection: log.planning_value });
        const at = DateTime.fromISO(log.changed_at, { setZone: true }).setZone(timezone).toFormat('MMM d, yyyy h:mm a');
        return <p key={log.id}>Set by {log.name} · {at} · was {dollars(prior.value)} ({labels[prior.source]}){log.action === 'clear' ? ' · cleared' : ''}</p>;
      }) : <p>{open && data ? 'No recorded changes' : 'Loading changes…'}</p>)}
    </PopoverContent>
  </Popover>;
}
export function ProjectionIcon(props: ProjectionTagProps) {
  return <ProjectionTag {...props} showLabel={false} />;
}
