import { Button } from '@/components/ui/button';
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
    <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-primary text-primary-foreground rounded-lg shadow-lg px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4 border-2 border-primary-foreground/20">
        <span className="font-semibold text-sm sm:text-base">{selectedCount} selected</span>
        <div className="h-6 w-px bg-primary-foreground/20" />
        <div className="flex gap-2">
          <Select value={selectedStatus} onValueChange={handleStatusChange} disabled={isUpdating}>
            <SelectTrigger className="w-[130px] sm:w-[150px] bg-secondary text-secondary-foreground border-0">
              <SelectValue placeholder="Set Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="interested">Interested</SelectItem>
              <SelectItem value="interviewing">Interviewing</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            onClick={onDelete}
            disabled={isUpdating}
            className="gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">Delete</span>
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
