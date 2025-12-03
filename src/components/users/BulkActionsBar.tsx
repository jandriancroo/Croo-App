import { Button } from '@/components/ui/button';
import { X, UserX, DollarSign } from 'lucide-react';

interface BulkActionsBarProps {
  selectedCount: number;
  onDeactivate: () => void;
  onWageUpdate: () => void;
  onClearSelection: () => void;
}

export function BulkActionsBar({
  selectedCount,
  onDeactivate,
  onWageUpdate,
  onClearSelection
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-primary text-primary-foreground rounded-lg shadow-lg px-6 py-3 flex items-center gap-4 border-2 border-primary-foreground/20">
        <span className="font-semibold">{selectedCount} selected</span>
        <div className="h-6 w-px bg-primary-foreground/20" />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={onDeactivate}
            className="gap-2"
          >
            <UserX className="h-4 w-4" />
            Deactivate
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onWageUpdate}
            className="gap-2"
          >
            <DollarSign className="h-4 w-4" />
            Update Wages
          </Button>
        </div>
        <div className="h-6 w-px bg-primary-foreground/20" />
        <Button
          size="sm"
          variant="ghost"
          onClick={onClearSelection}
          className="hover:bg-primary-foreground/10"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}