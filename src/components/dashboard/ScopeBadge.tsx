import { Badge } from "@/components/ui/badge";
import type { AuthorityScope } from "@/lib/dashboardWidgetsClient";

const SCOPE_META: Record<AuthorityScope, { label: string; className: string }> = {
  self:     { label: 'JUST ME',  className: 'bg-slate-500/15 text-slate-600 border-slate-500/30 dark:text-slate-300' },
  location: { label: 'LOCATION', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300' },
  org:      { label: 'ORG',      className: 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300' },
  brand:    { label: 'BRAND',    className: 'bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-300' },
  app:      { label: 'APP',      className: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300' },
};

export function ScopeBadge({ scope, className = '' }: { scope?: AuthorityScope | null; className?: string }) {
  const meta = SCOPE_META[(scope || 'self') as AuthorityScope];
  return (
    <Badge variant="outline" className={`px-1.5 py-0 text-[9px] font-semibold tracking-wider ${meta.className} ${className}`}>
      {meta.label}
    </Badge>
  );
}
