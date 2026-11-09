import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import toastLogo from '@/assets/toast-logo.png.asset.json';

export function ToastLinkedBadge() {
  return (
    <Badge variant="outline" className="h-5 px-1.5 py-0 text-[10px] font-semibold gap-1 shrink-0" title="Linked to Toast">
      <img src={toastLogo.url} alt="" className="h-3 w-3" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      Toast
    </Badge>
  );
}

export function ToastLinkPlus({ onClick, nested = false }: { onClick: () => void; nested?: boolean }) {
  if (nested) {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label="Link to Toast"
        title="Link to Toast"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            onClick();
          }
        }}
      >
        <Plus className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      className="shrink-0"
      aria-label="Link to Toast"
      title="Link to Toast"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <Plus className="h-3.5 w-3.5" />
    </Button>
  );
}
