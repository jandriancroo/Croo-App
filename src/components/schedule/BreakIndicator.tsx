import { Coffee } from "lucide-react";

interface BreakIndicatorProps {
  hasBreak: boolean;
  size?: 'sm' | 'md';
}

export function BreakIndicator({ hasBreak, size = 'md' }: BreakIndicatorProps) {
  if (!hasBreak) return null;

  return (
    <span 
      className={`inline-flex items-center justify-center ${
        size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
      }`}
      title="30-minute unpaid break"
    >
      <Coffee className={`text-white/80 ${size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'}`} />
    </span>
  );
}