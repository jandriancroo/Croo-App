import { forwardRef, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Editable-field look for the Week Insights bar (presentational only).
 * - onClick set  → renders a real <button>.
 * - onClick unset → renders a <span> for use inside an existing trigger button
 *   (e.g. LaborGoalPopover); hover/focus styles follow that parent button.
 * - plain → just the value text, no box / pencil / tooltip.
 */
interface Props {
  tone?: 'neutral' | 'actual';
  leftIcon?: ReactNode;
  value: ReactNode;
  suffix?: ReactNode;
  tooltip?: ReactNode;
  onClick?: () => void;
  plain?: boolean;
  showPencil?: boolean;
  className?: string;
  'data-sales-cell'?: string;
  'aria-label'?: string;
}

const base =
  'group/field w-full h-8 min-w-0 flex items-center gap-1.5 rounded-lg border pl-[9px] pr-2 text-left cursor-pointer transition-colors outline-none ' +
  'shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] ' +
  'hover:border-blue-400 hover:bg-blue-400/[0.16] focus-visible:border-blue-400 focus-visible:bg-blue-400/[0.16] focus-visible:ring-[3px] focus-visible:ring-blue-400/[0.22] ' +
  '[button:hover>&]:border-blue-400 [button:hover>&]:bg-blue-400/[0.16] ' +
  '[button:focus-visible>&]:border-blue-400 [button:focus-visible>&]:bg-blue-400/[0.16] [button:focus-visible>&]:ring-[3px] [button:focus-visible>&]:ring-blue-400/[0.22]';

const tones = {
  neutral: 'border-slate-300/[0.22] bg-white/[0.065]',
  actual: 'border-green-400/40 bg-green-400/10 text-green-200',
};

export const InsightField = forwardRef<HTMLElement, Props>(function InsightField(
  { tone = 'neutral', leftIcon, value, suffix, tooltip, onClick, plain, showPencil = true, className, ...rest },
  ref,
) {
  if (plain) return <span className="inline-flex items-center gap-1">{value}{suffix}</span>;

  const inner = (
    <>
      {leftIcon && <span className="shrink-0 flex items-center">{leftIcon}</span>}
      <span className="shrink-0">{value}</span>
      {suffix && <span className="truncate text-[11px] text-slate-400">{suffix}</span>}
      <span className="flex-1" />
      {showPencil && (
        <Pencil
          aria-hidden
          className="h-3 w-3 shrink-0 text-slate-500 transition-colors group-hover/field:text-slate-200 group-focus-visible/field:text-slate-200 [button:focus-visible_&]:text-slate-200"
        />
      )}
    </>
  );

  const cls = cn(base, tones[tone], className);
  const el = onClick ? (
    <button ref={ref as any} type="button" onClick={onClick} className={cls} {...rest}>{inner}</button>
  ) : (
    <span ref={ref as any} className={cls} {...rest}>{inner}</span>
  );

  if (!tooltip) return el;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
});
