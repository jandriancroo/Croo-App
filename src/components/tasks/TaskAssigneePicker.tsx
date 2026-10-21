import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useScheduleStations } from '@/hooks/useLocationStations';
import { ASSIGNABLE_ROLE_OPTIONS, ROLE_DISPLAY_NAMES, type AppRole } from '@/hooks/useUserRole';
import { cn } from '@/lib/utils';
import { ROLE_BADGE_COLOR, ROLE_BADGE_FALLBACK, type AssignmentInfo } from '@/lib/assignmentBadge';
import { AssignmentBadge } from './AssignmentBadge';

/** The four per-task assignment fields. At most one is set. */
export interface TaskAssignment {
  position?: string | null;
  station_id?: string | null;
  assigned_role?: AppRole | string | null;
  assigned_user_id?: string | null;
}

export const EMPTY_ASSIGNMENT: Required<TaskAssignment> = {
  position: null,
  station_id: null,
  assigned_role: null,
  assigned_user_id: null,
};

/** Encode/decode one assignment as a single select value. */
function encode(a: TaskAssignment): string {
  if (a.assigned_user_id) return `user:${a.assigned_user_id}`;
  if (a.assigned_role) return `role:${a.assigned_role}`;
  if (a.station_id) return `station:${a.station_id}`;
  if (a.position) return `pos:${a.position}`;
  return 'none';
}

function decode(v: string): Required<TaskAssignment> {
  const next = { ...EMPTY_ASSIGNMENT };
  const i = v.indexOf(':');
  if (i < 0) return next;
  const kind = v.slice(0, i);
  const val = v.slice(i + 1);
  if (kind === 'user') next.assigned_user_id = val;
  else if (kind === 'role') next.assigned_role = val;
  else if (kind === 'station') next.station_id = val;
  else if (kind === 'pos') next.position = val;
  return next;
}

/** Active people at this store (user_locations membership + active profile). */
export function useLocationPeople(locationId?: string | null) {
  return useQuery({
    queryKey: ['task-assignee-people', locationId],
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: links } = await supabase.from('user_locations').select('user_id').eq('location_id', locationId!);
      const ids = [...new Set((links ?? []).map((l) => l.user_id))];
      if (!ids.length) return [] as { id: string; name: string }[];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, is_active')
        .in('id', ids);
      return ((profiles ?? []) as any[])
        .filter((p) => p.is_active !== false)
        .map((p) => ({ id: p.id as string, name: (p.full_name as string) || 'Unnamed' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/** Position colors from the store's shift templates (same source the schedule uses). */
export function usePositionColors(locationId?: string | null) {
  return useQuery({
    queryKey: ['position-colors', locationId],
    enabled: !!locationId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('shift_templates').select('position, color').eq('location_id', locationId!);
      const map: Record<string, string> = {};
      for (const t of (data ?? []) as any[]) if (t.position && t.color && !map[t.position]) map[t.position] = t.color;
      return map;
    },
  }).data ?? {};
}

const shortName = (n: string) => {
  const parts = n.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};
const initialsOf = (n: string) => n.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const roleLabel = (r: string) => r === 'admin' ? 'Admin / GM' : ASSIGNABLE_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? ROLE_DISPLAY_NAMES[r as AppRole] ?? r;

/** Badge info for a task's assignment, using today's names and colors. */
export function useAssignmentLabeler(locationId?: string | null) {
  const { stations } = useScheduleStations(locationId);
  const { data: people = [] } = useLocationPeople(locationId);
  const posColors = usePositionColors(locationId);
  return (a: TaskAssignment): AssignmentInfo => {
    if (a.assigned_user_id) {
      const n = people.find((p) => p.id === a.assigned_user_id)?.name;
      return { kind: 'person', text: n ? shortName(n) : 'Person', initials: n ? initialsOf(n) : undefined };
    }
    if (a.assigned_role) return { kind: 'role', text: roleLabel(String(a.assigned_role)), color: ROLE_BADGE_COLOR[String(a.assigned_role)] ?? ROLE_BADGE_FALLBACK };
    if (a.station_id) {
      const st = stations.find((s) => s.id === a.station_id);
      return { kind: 'station', text: st?.name ?? 'Station', color: st?.color };
    }
    if (a.position) return { kind: 'position', text: a.position, color: posColors[a.position] };
    return { kind: 'none', text: 'Anyone' };
  };
}

interface Props {
  locationId?: string | null;
  value: TaskAssignment;
  /** Receives all four fields; the chosen one is set, the other three cleared. */
  onChange: (next: Required<TaskAssignment>) => void;
  availablePositions: string[];
  className?: string;
  /** Text for no assignment (default "Everyone"). */
  noneLabel?: string;
  /** Show each choice as a colored badge (checklist editor only). */
  badges?: boolean;
}

/** ONE per-task "Assigned to" picker, shared by every checklist editor. */
export function TaskAssigneePicker({ locationId, value, onChange, availablePositions, className, noneLabel = 'Everyone', badges = false }: Props) {
  const { stations, enabled: stationMode } = useScheduleStations(locationId);
  const { data: people = [] } = useLocationPeople(locationId);
  const current = encode(value);
  const posColors = usePositionColors(badges ? locationId : null);
  const B = (info: AssignmentInfo) => <AssignmentBadge info={info} />;
  // A position stored while in Station mode stays visible so it isn't lost.
  const legacyPosition = stationMode && value.position && !value.station_id && !value.assigned_role && !value.assigned_user_id
    ? value.position : null;
  const positions = availablePositions.includes(value.position ?? '') || !value.position || stationMode
    ? availablePositions : [...availablePositions, value.position];

  return (
    <Select value={current} onValueChange={(v) => onChange(decode(v))}>
      <SelectTrigger className={cn('w-auto min-w-0 h-7 px-2 text-[11px] border-dashed shrink-0 max-w-[160px]', className)}>
        <SelectValue placeholder={noneLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{badges ? B({ kind: 'none', text: noneLabel }) : noneLabel}</SelectItem>
        {stationMode ? (
          <SelectGroup>
            <SelectLabel>Stations</SelectLabel>
            {stations.map((s) => (
              <SelectItem key={s.id} value={`station:${s.id}`}>
                {badges ? B({ kind: 'station', text: s.name, color: s.color }) : (
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                </span>)}
              </SelectItem>
            ))}
            {legacyPosition && (
              <SelectItem value={`pos:${legacyPosition}`}>Position: {legacyPosition} (position mode)</SelectItem>
            )}
          </SelectGroup>
        ) : positions.length > 0 && (
          <SelectGroup>
            <SelectLabel>Positions</SelectLabel>
            {positions.map((p) => <SelectItem key={p} value={`pos:${p}`}>{badges ? B({ kind: 'position', text: p, color: posColors[p] }) : p}</SelectItem>)}
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel>Roles</SelectLabel>
          {ASSIGNABLE_ROLE_OPTIONS.map((r) => (
            <SelectItem key={r.value} value={`role:${r.value}`}>{badges ? B({ kind: 'role', text: roleLabel(r.value), color: ROLE_BADGE_COLOR[r.value] ?? ROLE_BADGE_FALLBACK }) : (r.value === 'admin' ? 'Admin / GM' : r.label)}</SelectItem>
          ))}
          {value.assigned_role && !ASSIGNABLE_ROLE_OPTIONS.some((r) => r.value === value.assigned_role) && (
            <SelectItem value={`role:${value.assigned_role}`}>
              {ROLE_DISPLAY_NAMES[value.assigned_role as AppRole] ?? value.assigned_role}
            </SelectItem>
          )}
        </SelectGroup>
        {people.length > 0 && (
          <SelectGroup>
            <SelectLabel>People</SelectLabel>
            {people.map((p) => <SelectItem key={p.id} value={`user:${p.id}`}>{badges ? B({ kind: 'person', text: p.name, initials: initialsOf(p.name) }) : p.name}</SelectItem>)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
