import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';

export type AudienceRole = string;

// Friendly labels for known roles; unknown roles fall back to a humanized version.
const ROLE_LABEL_OVERRIDES: Record<string, string> = {
  team_member: 'Team Members',
  shift_manager: 'Shift Managers',
  manager: 'Managers',
  general_manager: 'General Managers',
  admin: 'Admins',
  org_admin: 'Org Admins',
  brand_admin: 'Brand Admins',
  super_admin: 'Super Admins',
  fbc: 'FBC',
};

// Roles we never want to show as an audience option (system-only / too privileged to scope by).
const HIDDEN_ROLES = new Set<string>(['super_admin', 'brand_admin', 'org_admin', 'fbc']);

const humanize = (role: string) =>
  ROLE_LABEL_OVERRIDES[role] ??
  role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) + 's';

interface AudienceSelectorProps {
  value: AudienceRole[] | null; // null = everyone
  onChange: (roles: AudienceRole[] | null) => void;
}

/**
 * Compact audience-roles picker for unified widgets.
 * Roles are pulled live from `role_permissions` (the Permissions page source of truth),
 * so adding/renaming a role there flows through automatically.
 * Empty selection → null (visible to everyone in scope).
 */
export function AudienceSelector({ value, onChange }: AudienceSelectorProps) {
  const [roleOptions, setRoleOptions] = useState<{ value: string; label: string }[]>([]);
  const selected = value ?? [];
  const allSelected = selected.length === 0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('role');
      if (error || cancelled) return;
      const distinct = Array.from(new Set((data ?? []).map((r: any) => r.role as string)))
        .filter((r) => !HIDDEN_ROLES.has(r))
        .sort();
      setRoleOptions(distinct.map((r) => ({ value: r, label: humanize(r) })));
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = (role: AudienceRole) => {
    const next = selected.includes(role)
      ? selected.filter(r => r !== role)
      : [...selected, role];
    onChange(next.length === 0 ? null : next);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Visible to</Label>
        {!allSelected && (
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => onChange(null)}
          >
            Reset to everyone
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {allSelected ? 'Everyone with access to this scope' : `${selected.length} role${selected.length === 1 ? '' : 's'} selected`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {roleOptions.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">Loading roles…</p>
        ) : roleOptions.map(opt => {
          const checked = selected.includes(opt.value);
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                checked ? 'border-primary bg-primary/10' : 'hover:bg-accent'
              }`}
            >
              <Checkbox checked={checked} onCheckedChange={() => toggle(opt.value)} className="h-3.5 w-3.5" />
              {opt.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
