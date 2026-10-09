import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useScheduleStations } from '@/hooks/useLocationStations';
import { ASSIGNABLE_ROLE_OPTIONS, ROLE_DISPLAY_NAMES, type AppRole } from '@/hooks/useUserRole';
import { cn } from '@/lib/utils';

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

interface Props {
  locationId?: string | null;
  value: TaskAssignment;
  /** Receives all four fields; the chosen one is set, the other three cleared. */
  onChange: (next: Required<TaskAssignment>) => void;
  availablePositions: string[];
  className?: string;
}

/** ONE per-task "Assigned to" picker, shared by every checklist editor. */
export function TaskAssigneePicker({ locationId, value, onChange, availablePositions, className }: Props) {
  const { stations, enabled: stationMode } = useScheduleStations(locationId);
  const { data: people = [] } = useLocationPeople(locationId);
  const current = encode(value);
  // A position stored while in Station mode stays visible so it isn't lost.
  const legacyPosition = stationMode && value.position && !value.station_id && !value.assigned_role && !value.assigned_user_id
    ? value.position : null;
  const positions = availablePositions.includes(value.position ?? '') || !value.position || stationMode
    ? availablePositions : [...availablePositions, value.position];

  return (
    <Select value={current} onValueChange={(v) => onChange(decode(v))}>
      <SelectTrigger className={cn('w-auto min-w-0 h-7 px-2 text-[11px] border-dashed shrink-0 max-w-[160px]', className)}>
        <SelectValue placeholder="Everyone" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Everyone</SelectItem>
        {stationMode ? (
          <SelectGroup>
            <SelectLabel>Stations</SelectLabel>
            {stations.map((s) => (
              <SelectItem key={s.id} value={`station:${s.id}`}>
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                </span>
              </SelectItem>
            ))}
            {legacyPosition && (
              <SelectItem value={`pos:${legacyPosition}`}>Position: {legacyPosition} (position mode)</SelectItem>
            )}
          </SelectGroup>
        ) : positions.length > 0 && (
          <SelectGroup>
            <SelectLabel>Positions</SelectLabel>
            {positions.map((p) => <SelectItem key={p} value={`pos:${p}`}>{p}</SelectItem>)}
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel>Roles</SelectLabel>
          {ASSIGNABLE_ROLE_OPTIONS.map((r) => (
            <SelectItem key={r.value} value={`role:${r.value}`}>{r.value === 'admin' ? 'Admin / GM' : r.label}</SelectItem>
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
            {people.map((p) => <SelectItem key={p.id} value={`user:${p.id}`}>{p.name}</SelectItem>)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
