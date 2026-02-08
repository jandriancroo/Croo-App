import { Coffee } from "lucide-react";

interface BreakIndicatorProps {
  hasBreak: boolean;
  size?: 'sm' | 'md';
  variant?: 'light' | 'dark';
}

export function BreakIndicator({ hasBreak, size = 'md', variant = 'dark' }: BreakIndicatorProps) {
  if (!hasBreak) return null;

  const colorClass = variant === 'light' 
    ? 'text-white/80' 
    : 'text-amber-600 dark:text-amber-400';

  return (
    <span 
      className={`inline-flex items-center justify-center ${
        size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
      }`}
      title="30-minute unpaid break"
    >
      <Coffee className={`${colorClass} ${size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'}`} />
    </span>
  );
}