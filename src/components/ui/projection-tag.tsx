import { Badge } from "@/components/ui/badge";
import { Pencil, Radio } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectionSource } from "@/hooks/useResolvedProjection";

interface ProjectionTagProps {
  source: ProjectionSource;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}

/**
 * Visual tag to indicate projection source:
 * - living: "Live AI Projection" with sparkles icon (blue)
 * - override: Pencil icon (amber/orange)
 * - initial: No tag (default for schedule planning)
 * - legacy: No tag (backwards compatibility)
 */
export function ProjectionTag({ 
  source, 
  size = 'sm', 
  showLabel = true,
  className = '' 
}: ProjectionTagProps) {
  if (!source || source === 'legacy') {
    return null;
  }

  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const badgeSize = size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5';

  if (source === 'living' || source === 'initial') {
    const tooltipText = source === 'living' 
      ? 'Live AI Projection - Updated daily based on recent trends'
      : 'AI Projection - Generated for schedule planning';
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`${badgeSize} border-primary/30 bg-primary/10 text-primary font-medium gap-1 ${className}`}
          >
            <Radio className={`${iconSize} animate-pulse`} />
            {showLabel && <span>Live AI</span>}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (source === 'override') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`${badgeSize} border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium gap-1 ${className}`}
          >
            <Pencil className={iconSize} />
            {showLabel && <span>Override</span>}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Manager Override - Manually set projection</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return null;
}

/**
 * Compact icon-only version for tight spaces (like schedule cells)
 */
export function ProjectionIcon({ 
  source, 
  className = '' 
}: { 
  source: ProjectionSource; 
  className?: string;
}) {
  if (!source || source === 'legacy') {
    return null;
  }

  if (source === 'living' || source === 'initial') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Radio className={`h-3 w-3 text-primary animate-pulse ${className}`} />
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Live AI Projection</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (source === 'override') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Pencil className={`h-3 w-3 text-amber-500 ${className}`} />
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Manager Override</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return null;
}
