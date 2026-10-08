import { Coffee } from "lucide-react";

interface BreakIndicatorProps {
  hasBreak: boolean;
  size?: 'sm' | 'md';
  variant?: 'light' | 'dark';
  /** Hint text from the store's meal rules (mealBreakLabel). */
  title?: string;
}

export function BreakIndicator({ hasBreak, size = 'md', variant = 'dark', title }: BreakIndicatorProps) {
  if (!hasBreak) return null;

  const colorClass = variant === 'light' 
    ? 'text-white/80' 
    : 'text-amber-600 dark:text-amber-400';

  return (
    <span 
      className={`inline-flex items-center justify-center ${
        size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
      }`}
      title={title}
    >
      <Coffee className={`${colorClass} ${size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'}`} />
    </span>
  );
}