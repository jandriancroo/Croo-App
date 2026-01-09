import { format, isToday, isYesterday } from 'date-fns';

interface DateSeparatorProps {
  date: Date;
}

export function DateSeparator({ date }: DateSeparatorProps) {
  const getDateLabel = () => {
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'EEEE, MMMM d, yyyy');
  };

  return (
    <div className="flex items-center justify-center my-4 px-4">
      <div className="flex-1 h-px bg-border/50" />
      <span className="px-3 text-xs text-muted-foreground font-medium">
        {getDateLabel()}
      </span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}
