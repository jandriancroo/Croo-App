import { Badge } from "@/components/ui/badge";
import type { InventoryMode } from "@/hooks/useInventoryMode";

interface Props {
  mode?: InventoryMode | string | null;
  className?: string;
}

/**
 * Small badge indicating whether a location runs on Lite Inventory (yellow)
 * or Brand Inventory (blue). Renders nothing for unknown/other modes so it
 * stays visually quiet on non-inventory contexts.
 */
export function InventoryModeBadge({ mode, className = "" }: Props) {
  if (mode !== "lite" && mode !== "brand") return null;
  const isLite = mode === "lite";
  const label = isLite ? "LITE" : "BRAND";
  const styles = isLite
    ? "bg-yellow-400/15 text-yellow-700 border-yellow-500/40 dark:text-yellow-300"
    : "bg-blue-500/15 text-blue-700 border-blue-500/40 dark:text-blue-300";
  return (
    <Badge
      variant="outline"
      className={`px-1.5 py-0 text-[9px] font-semibold tracking-wider ${styles} ${className}`}
    >
      {label}
    </Badge>
  );
}
