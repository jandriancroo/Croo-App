import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Active / Inactive pill for Orgs and Locations (super admin views). */
export const ActiveStatusBadge = ({ active, className }: { active: boolean; className?: string }) => (
  <Badge
    variant={active ? 'secondary' : 'destructive'}
    className={cn('h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wide', className)}
  >
    {active ? 'Active' : 'Inactive'}
  </Badge>
);
