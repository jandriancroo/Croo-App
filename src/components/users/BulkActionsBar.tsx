import { Badge } from '@/components/ui/badge';
import { X, UserX, DollarSign, RefreshCw, Shield } from 'lucide-react';

interface BulkActionsBarProps {
  selectedCount: number;
  onDeactivate: () => void;
  onWageUpdate: () => void;
  onForceUpdate?: () => void;
  onRequestI9?: () => void;
  onClearSelection: () => void;
  isUpdating?: boolean;
}

export function BulkActionsBar({
  selectedCount,
  onDeactivate,
  onWageUpdate,
  onForceUpdate,
  onRequestI9,
  onClearSelection,
  isUpdating = false
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in">
      <div className="flex items-center gap-1 rounded-full border border-border bg-primary px-1 py-1 shadow-lg">
        <Badge variant="secondary" className="rounded-full px-3 py-1.5 text-xs font-semibold bg-primary-foreground text-primary shrink-0">
          {selectedCount} selected
        </Badge>

        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
          onClick={onDeactivate}
        >
          <UserX className="h-3.5 w-3.5" />
          Deactivate
        </button>

        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
          onClick={onWageUpdate}
        >
          <DollarSign className="h-3.5 w-3.5" />
          Wages
        </button>

        {onRequestI9 && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
            onClick={onRequestI9}
          >
            <Shield className="h-3.5 w-3.5" />
            Docs
          </button>
        )}

        {onForceUpdate && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap disabled:opacity-50"
            onClick={onForceUpdate}
            disabled={isUpdating}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
            Sync
          </button>
        )}

        <button
          className="p-1.5 rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors shrink-0"
          onClick={onClearSelection}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
