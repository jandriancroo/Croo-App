import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

const DEFAULT_ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'shift_manager', label: 'Shift Manager' },
  { value: 'shift_manager_in_training', label: 'Shift Manager in Training' },
  { value: 'team_member', label: 'Team Member' },
];

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  role: string;
}

export interface AssigneePickerProps {
  locationId?: string | null;
  selectedRoles: string[];
  onRolesChange: (roles: string[]) => void;
  selectedUserIds: string[];
  onUserIdsChange: (ids: string[]) => void;
  label?: string;
  helperText?: string;
  roleOptions?: { value: string; label: string }[];
}

/**
 * Chat-style assignee picker: pick roles (auto-expands to matching users at the location)
 * and optionally add specific individuals on top. Users covered by a role are shown as
 * locked/checked; explicit extras appear as chips.
 */
export function AssigneePicker({
  locationId,
  selectedRoles,
  onRolesChange,
  selectedUserIds,
  onUserIdsChange,
  label = 'Assigned To',
  helperText,
  roleOptions = DEFAULT_ROLE_OPTIONS,
}: AssigneePickerProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [showIndividuals, setShowIndividuals] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!locationId) {
      setProfiles([]);
      return;
    }
    (async () => {
      setLoading(true);
      const { data: userLocs } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', locationId);
      const userIds = (userLocs ?? []).map((u: any) => u.user_id);
      if (userIds.length === 0) {
        if (!cancelled) setProfiles([]);
        setLoading(false);
        return;
      }
      const [{ data: profs }, { data: roles }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, profile_photo_url')
          .in('id', userIds)
          .eq('is_active', true)
          .order('full_name'),
        supabase.from('user_roles').select('user_id, role').in('user_id', userIds),
      ]);
      if (cancelled) return;
      const merged: Profile[] = (profs ?? []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name ?? '(no name)',
        profile_photo_url: p.profile_photo_url,
        role: roles?.find((r: any) => r.user_id === p.id)?.role ?? 'team_member',
      }));
      setProfiles(merged);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  const roleCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of profiles) map[p.role] = (map[p.role] ?? 0) + 1;
    return map;
  }, [profiles]);

  // Users covered by role selection
  const roleCoveredIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of profiles) if (selectedRoles.includes(p.role)) set.add(p.id);
    return set;
  }, [profiles, selectedRoles]);

  const totalRecipients = useMemo(() => {
    const set = new Set<string>(roleCoveredIds);
    for (const id of selectedUserIds) set.add(id);
    return set.size;
  }, [roleCoveredIds, selectedUserIds]);

  const toggleRole = (role: string) => {
    if (selectedRoles.includes(role)) onRolesChange(selectedRoles.filter((r) => r !== role));
    else onRolesChange([...selectedRoles, role]);
  };

  const toggleUser = (userId: string) => {
    // If the user is already covered by a role, individual click is a no-op
    if (roleCoveredIds.has(userId) && !selectedUserIds.includes(userId)) return;
    if (selectedUserIds.includes(userId)) onUserIdsChange(selectedUserIds.filter((id) => id !== userId));
    else onUserIdsChange([...selectedUserIds, userId]);
  };

  const clear = () => {
    onRolesChange([]);
    onUserIdsChange([]);
  };

  const extras = profiles.filter((p) => selectedUserIds.includes(p.id) && !roleCoveredIds.has(p.id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">
          {label}
          {totalRecipients > 0 && (
            <span className="text-muted-foreground font-normal ml-1">({totalRecipients})</span>
          )}
        </Label>
        {(selectedRoles.length > 0 || selectedUserIds.length > 0) && (
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground"
            onClick={clear}
          >
            Clear
          </button>
        )}
      </div>

      {/* Role chips */}
      <div className="flex flex-wrap gap-1.5">
        {roleOptions.map((role) => {
          const count = roleCounts[role.value] ?? 0;
          const selected = selectedRoles.includes(role.value);
          return (
            <Badge
              key={role.value}
              variant={selected ? 'default' : 'outline'}
              className="cursor-pointer text-xs"
              onClick={() => toggleRole(role.value)}
            >
              {role.label}
              {count > 0 && <span className="ml-1 opacity-75">({count})</span>}
            </Badge>
          );
        })}
      </div>

      {/* Extras chips */}
      {extras.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {extras.map((p) => (
            <Badge key={p.id} variant="secondary" className="gap-1 text-xs">
              +{p.full_name.split(' ')[0]}
              <X className="h-3 w-3 cursor-pointer" onClick={() => toggleUser(p.id)} />
            </Badge>
          ))}
        </div>
      )}

      {/* Collapsible individual picker */}
      <Collapsible open={showIndividuals} onOpenChange={setShowIndividuals}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="w-full justify-between h-8">
            <span className="text-xs">Add specific people</span>
            {showIndividuals ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border rounded-md max-h-52 overflow-y-auto mt-1">
            {loading ? (
              <p className="p-3 text-xs text-muted-foreground">Loading…</p>
            ) : profiles.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No users at this location</p>
            ) : (
              profiles.map((p) => {
                const covered = roleCoveredIds.has(p.id);
                const checked = covered || selectedUserIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 px-2 py-1.5 text-xs transition-colors ${
                      covered ? 'opacity-60' : 'hover:bg-muted cursor-pointer'
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={covered}
                      onCheckedChange={() => toggleUser(p.id)}
                    />
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={p.profile_photo_url ?? undefined} />
                      <AvatarFallback className="text-[10px]">
                        {p.full_name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1">{p.full_name}</span>
                    <span className="text-[10px] text-muted-foreground capitalize">
                      {p.role.replace('_', ' ')}
                      {covered && ' · via role'}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {helperText && <p className="text-[10px] text-muted-foreground">{helperText}</p>}
    </div>
  );
}
