import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

export type AudienceRole = 'team_member' | 'shift_manager' | 'manager' | 'admin' | 'org_admin' | 'brand_admin' | 'super_admin';

const ROLE_OPTIONS: { value: AudienceRole; label: string }[] = [
  { value: 'team_member', label: 'Team Members' },
  { value: 'shift_manager', label: 'Shift Managers' },
  { value: 'manager', label: 'Managers' },
  { value: 'admin', label: 'Admins' },
];

interface AudienceSelectorProps {
  value: AudienceRole[] | null; // null = everyone
  onChange: (roles: AudienceRole[] | null) => void;
}

/**
 * Compact audience-roles picker for unified widgets.
 * Empty selection → null (visible to everyone in scope).
 */
export function AudienceSelector({ value, onChange }: AudienceSelectorProps) {
  const selected = value ?? [];
  const allSelected = selected.length === 0;

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
        {ROLE_OPTIONS.map(opt => {
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
