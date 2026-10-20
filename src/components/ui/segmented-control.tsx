import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  ariaLabel?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  variant?: "primary" | "neutral";
  fullWidth?: boolean;
  className?: string;
  itemClassName?: string;
  "aria-label"?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  variant = "neutral",
  fullWidth = false,
  className,
  itemClassName,
  ...rest
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      // Never deselect: ignore empty values so one option always stays selected.
      onValueChange={(v) => { if (v) onValueChange(v as T); }}
      aria-label={rest["aria-label"]}
      className={cn(
        "items-center rounded-xl p-[3px] bg-foreground/[0.06] h-10",
        fullWidth ? "flex w-full" : "inline-flex",
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroupPrimitive.Item
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
          className={cn(
            "inline-flex h-full min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-sm md:text-[15px] font-medium text-foreground/70 transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
            fullWidth && "flex-1",
            variant === "primary"
              ? "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm data-[state=on]:font-semibold"
              : "data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_3px_rgba(0,0,0,0.12)] data-[state=on]:font-semibold",
            itemClassName,
          )}
        >
          {o.icon}
          <span className="truncate">{o.label}</span>
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
