import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface BulkApplicantActionsBarProps {
  selectedCount: number;
  onStatusChange: (status: string) => void;
  onDelete: () => void;
  onClearSelection: () => void;
  isUpdating?: boolean;
}

export function BulkApplicantActionsBar({
  selectedCount,
  onStatusChange,
  onDelete,
  onClearSelection,
  isUpdating = false
}: BulkApplicantActionsBarProps) {
  const [selectedStatus, setSelectedStatus] = useState<string>('');

  if (selectedCount === 0) return null;

  const handleStatusChange = (value: string) => {
    setSelectedStatus(value);
    if (value) {
      onStatusChange(value);
      setSelectedStatus('');
    }
  };

  return (
    <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in">
      <div className="flex items-center gap-1 rounded-full border border-border bg-primary px-1 py-1 shadow-lg">
        <Badge variant="secondary" className="rounded-full px-3 py-1.5 text-xs font-semibold bg-primary-foreground text-primary shrink-0">
          {selectedCount} selected
        </Badge>

        <div className="relative">
          <Select value={selectedStatus} onValueChange={handleStatusChange} disabled={isUpdating}>
            <SelectTrigger className="h-7 w-[120px] text-[11px] bg-transparent border-none text-primary-foreground focus:ring-0 focus:ring-offset-0 px-3">
              <SelectValue placeholder="Set Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="interested">Interested</SelectItem>
              <SelectItem value="interviewing">Interviewing</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-destructive hover:bg-primary-foreground/20 transition-colors whitespace-nowrap disabled:opacity-50"
          onClick={onDelete}
          disabled={isUpdating}
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Delete</span>
        </button>

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
