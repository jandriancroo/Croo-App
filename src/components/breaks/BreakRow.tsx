import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type BreakValue = { startTime: string; endTime: string; type: 'paid' | 'unpaid' };

export function BreakRow({ value, onChange, onRemove, disabled, className }: {
  value: BreakValue;
  onChange: (patch: Partial<BreakValue>) => void;
  onRemove: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [startH, startM] = value.startTime.split(':').map(Number);
  const [endH, endM] = value.endTime.split(':').map(Number);
  const minutes = value.startTime && value.endTime ? (endH * 60 + endM) - (startH * 60 + startM) : undefined;

  return (
    <div className={cn('grid grid-cols-[1.35fr_.85fr_.85fr_30px_14px] gap-1.5 items-center whitespace-nowrap', className)}>
      <Select value={value.type} onValueChange={type => { if (type === 'paid' || type === 'unpaid') onChange({ type }); }} disabled={disabled}>
        <SelectTrigger className="h-8 min-w-0 px-1 text-xs [&>svg]:h-3 [&>svg]:w-3" title={value.type === 'unpaid' ? 'Meal break' : 'Paid break'} aria-label="Break type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unpaid">Unpaid (30m)</SelectItem>
          <SelectItem value="paid">Paid (10m)</SelectItem>
        </SelectContent>
      </Select>
      <Input type="time" aria-label="Break start" className="h-8 w-full min-w-0 px-1 text-xs" value={value.startTime} onChange={e => onChange({ startTime: e.target.value })} disabled={disabled} />
      <Input type="time" aria-label="Break end" className="h-8 w-full min-w-0 px-1 text-xs" value={value.endTime} onChange={e => onChange({ endTime: e.target.value })} disabled={disabled} />
      <span className="text-[10px] text-muted-foreground tabular-nums text-right" aria-label="Break minutes">{minutes === undefined ? '—' : `${minutes}m`}</span>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-3.5 p-0 text-muted-foreground" aria-label="Remove break" title="Remove break" onClick={onRemove} disabled={disabled}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function AddBreakButton({ onClick, disabled, hint }: { onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      <Button type="button" variant="link" size="sm" className="h-6 px-0 text-xs" onClick={onClick} disabled={disabled}>+ Break</Button>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}