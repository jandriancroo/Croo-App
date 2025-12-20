interface BreakIndicatorProps {
  hasBreak: boolean;
  size?: 'sm' | 'md';
}

export function BreakIndicator({ hasBreak, size = 'md' }: BreakIndicatorProps) {
  if (!hasBreak) return null;

  return (
    <span 
      className={`inline-flex items-center justify-center bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 rounded shrink-0 ${
        size === 'sm' ? 'text-[10px] w-5 h-5' : 'text-xs px-1.5 py-1 gap-1'
      }`}
      title="30-minute unpaid break"
    >
      <span className={size === 'sm' ? 'text-xs' : ''}>☕</span>
      {size === 'md' && <span>30min break</span>}
    </span>
  );
}